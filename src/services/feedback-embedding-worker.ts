import { parentPort } from 'node:worker_threads';
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

const MODEL_NAME = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
/** Same rationale as stt-worker.ts: cap ONNX Runtime's own thread pool to 1 so embedding
 *  inference (which can run while a live relay session is active) never competes with the
 *  real-time audio pipeline's own threads for CPU. */
const INTRA_OP_NUM_THREADS = 1;

interface EmbeddingWorkerRequest {
  id: number;
  text?: string;
  preload?: boolean;
}

interface EmbeddingWorkerResponse {
  id: number;
  embedding?: number[];
  error?: string;
}

/**
 * Memoizes factory() the first time it succeeds, but does NOT memoize a failure: if factory()
 * rejects, the cached promise is cleared so the next call retries from scratch. A plain
 * `if (!cached) cached = factory()` (as this used to be) would otherwise permanently break the
 * consumer after a single transient failure (e.g. a network hiccup during the model's first
 * download) - every subsequent call would keep awaiting the same already-rejected promise until
 * the whole process restarts. Exported for unit testing without needing a real pipeline().
 */
export function createRetryingLazySingleton<T>(factory: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;
  return function get(): Promise<T> {
    if (!cached) {
      cached = factory().catch((err: unknown) => {
        cached = undefined;
        throw err;
      });
    }
    return cached;
  };
}

const getExtractor = createRetryingLazySingleton<FeatureExtractionPipeline>(() =>
  pipeline('feature-extraction', MODEL_NAME, {
    session_options: { intraOpNumThreads: INTRA_OP_NUM_THREADS, interOpNumThreads: 1, executionMode: 'sequential' },
  }),
);

function post(message: EmbeddingWorkerResponse): void {
  parentPort?.postMessage(message);
}

parentPort?.on('message', (msg: EmbeddingWorkerRequest) => {
  void (async () => {
    try {
      const extractor = await getExtractor();
      if (msg.preload || !msg.text) {
        post({ id: msg.id, embedding: [] });
        return;
      }
      const output = await extractor(msg.text, { pooling: 'mean', normalize: true });
      post({ id: msg.id, embedding: Array.from(output.data as Float32Array) });
    } catch (err) {
      post({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
    }
  })();
});
