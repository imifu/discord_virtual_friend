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

let extractorPromise: Promise<FeatureExtractionPipeline> | undefined;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_NAME, {
      session_options: { intraOpNumThreads: INTRA_OP_NUM_THREADS, interOpNumThreads: 1, executionMode: 'sequential' },
    });
  }
  return extractorPromise;
}

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
