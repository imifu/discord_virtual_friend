import { Worker } from 'node:worker_threads';
import { createLogger } from '../utils/logger.js';
import { FeedbackEmbeddingError } from '../utils/errors.js';

const logger = createLogger('feedback-embedding');

interface WorkerResponse {
  id: number;
  embedding?: number[];
  error?: string;
}

type PendingRequest = { resolve: (embedding: Float32Array) => void; reject: (err: FeedbackEmbeddingError) => void };

let worker: Worker | undefined;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

function rejectPending(err: FeedbackEmbeddingError): void {
  for (const entry of pending.values()) entry.reject(err);
  pending.clear();
}

/**
 * Sentence-embedding inference (like Whisper transcription in stt.ts) is CPU-heavy enough to
 * block the event loop for a noticeable moment; running it on a dedicated worker thread keeps
 * /feed from delaying Discord's gateway/interaction handling or the live audio pipeline.
 */
function getWorker(): Worker {
  if (!worker) {
    const workerUrl = new URL('./feedback-embedding-worker.js', import.meta.url);
    logger.info('フィードバック類似度用Embedding workerを起動します');
    worker = new Worker(workerUrl);

    worker.on('message', (msg: WorkerResponse) => {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new FeedbackEmbeddingError(msg.error));
      else entry.resolve(Float32Array.from(msg.embedding ?? []));
    });
    worker.on('error', (err) => {
      logger.error('フィードバック類似度用Embedding workerでエラーが発生しました', err);
      worker = undefined;
      rejectPending(new FeedbackEmbeddingError('worker error', err));
    });
    worker.on('exit', (code) => {
      if (code !== 0) logger.warn(`フィードバック類似度用Embedding workerが異常終了しました: code=${code}`);
      worker = undefined;
      rejectPending(new FeedbackEmbeddingError(`worker exited with code ${code}`));
    });
  }
  return worker;
}

/** Kicks off model loading early so the first real /feed call isn't slowed down by it. */
export function preloadFeedbackEmbeddingModel(): void {
  getWorker().postMessage({ id: 0, preload: true });
}

function requestEmbeddingFromWorker(text: string): Promise<Float32Array> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      getWorker().postMessage({ id, text });
    } catch (err) {
      pending.delete(id);
      reject(new FeedbackEmbeddingError('failed to post message to embedding worker', err));
    }
  });
}

/**
 * Wraps a raw (potentially concurrency-unsafe) embed function so at most one call is ever
 * in flight at a time, in FIFO order, and concurrent calls for the identical text share a single
 * in-flight request instead of issuing duplicate work. Exported (not just used internally) so
 * this concurrency behavior can be unit tested with a fake `requestEmbedding` - the real worker
 * communication itself isn't unit tested (I/O, like every other worker in this codebase).
 *
 * Without this, two Discord users calling /feed around the same time - or two cache-miss issues
 * within a single /feed's getIssueEmbeddings() loop racing against another /feed's loop - could
 * each start their own `extractor(...)` call on the shared pipeline at the same time.
 * `intraOpNumThreads: 1` only bounds a single inference's own thread pool; it does not limit how
 * many inferences run concurrently, so without this queue the live audio pipeline could still be
 * starved of CPU exactly as Issue #7's "dedicated worker, concurrency 1" requirement warns against.
 */
export function createSerializedEmbedder(
  requestEmbedding: (text: string) => Promise<Float32Array>,
): (text: string) => Promise<Float32Array> {
  interface QueuedJob {
    text: string;
    resolve: (embedding: Float32Array) => void;
    reject: (err: unknown) => void;
  }

  let inFlight = false;
  const queue: QueuedJob[] = [];
  const inFlightByText = new Map<string, Promise<Float32Array>>();

  function pump(): void {
    if (inFlight) return;
    const job = queue.shift();
    if (!job) return;
    inFlight = true;

    requestEmbedding(job.text)
      .then(job.resolve, job.reject)
      .finally(() => {
        inFlight = false;
        pump();
      });
  }

  return function embed(text: string): Promise<Float32Array> {
    const existing = inFlightByText.get(text);
    if (existing) return existing;

    const promise = new Promise<Float32Array>((resolve, reject) => {
      queue.push({ text, resolve, reject });
      pump();
    }).finally(() => {
      inFlightByText.delete(text);
    });

    inFlightByText.set(text, promise);
    return promise;
  };
}

/**
 * Embeds free-form text (a /feed submission, or an open issue's title+body) into a normalized
 * sentence vector using a local multilingual model (no external API) - off the main thread, and
 * serialized to at most one concurrent inference (see createSerializedEmbedder).
 */
export const embedFeedbackText = createSerializedEmbedder(requestEmbeddingFromWorker);
