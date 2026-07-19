import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createSerializedEmbedder } from './feedback-embedding.js';

function makeTrackingRequestEmbedding(delayMs: number): {
  requestEmbedding: (text: string) => Promise<Float32Array>;
  callCount: () => number;
  maxConcurrent: () => number;
} {
  let calls = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  return {
    requestEmbedding: async (text: string) => {
      calls += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(delayMs);
      concurrent -= 1;
      return Float32Array.from([text.length, 0]);
    },
    callCount: () => calls,
    maxConcurrent: () => maxConcurrent,
  };
}

test('embeds a single text and returns its result', async () => {
  const fake = makeTrackingRequestEmbedding(1);
  const embed = createSerializedEmbedder(fake.requestEmbedding);

  const result = await embed('hello');

  assert.deepEqual(Array.from(result), [5, 0]);
  assert.equal(fake.callCount(), 1);
});

test('concurrent requests for different text never run more than one inference at a time (Codex regression)', async () => {
  const fake = makeTrackingRequestEmbedding(10);
  const embed = createSerializedEmbedder(fake.requestEmbedding);

  await Promise.all([embed('aaa'), embed('bb'), embed('c')]);

  assert.equal(fake.callCount(), 3);
  assert.equal(fake.maxConcurrent(), 1, 'no two requestEmbedding calls may overlap in time');
});

test('concurrent requests for the identical text share one in-flight call instead of duplicating work (Codex regression)', async () => {
  const fake = makeTrackingRequestEmbedding(10);
  const embed = createSerializedEmbedder(fake.requestEmbedding);

  const results = await Promise.all([embed('same text'), embed('same text'), embed('same text')]);

  assert.equal(fake.callCount(), 1, 'identical concurrent requests must be de-duplicated, not queued 3 times');
  assert.deepEqual(Array.from(results[0]!), Array.from(results[1]!));
  assert.deepEqual(Array.from(results[0]!), Array.from(results[2]!));
});

test('the same text can be embedded again (a fresh call, not a stale dedup) once the first call has resolved', async () => {
  const fake = makeTrackingRequestEmbedding(1);
  const embed = createSerializedEmbedder(fake.requestEmbedding);

  await embed('repeat me');
  await embed('repeat me');

  assert.equal(fake.callCount(), 2, 'once the in-flight promise has settled, a later call must issue a fresh request');
});

test('a rejected request does not block the queue or poison later requests for the same text', async () => {
  let calls = 0;
  const requestEmbedding = async (text: string): Promise<Float32Array> => {
    calls += 1;
    if (text === 'boom' && calls === 1) throw new Error('simulated transient failure');
    return Float32Array.from([1, 0]);
  };
  const embed = createSerializedEmbedder(requestEmbedding);

  await assert.rejects(embed('boom'));
  const result = await embed('boom');

  assert.deepEqual(Array.from(result), [1, 0]);
  assert.equal(calls, 2, 'the retry after a rejection must issue a fresh request, not reuse the rejected one');
});

test('a rejected request does not block later requests for other queued text', async () => {
  const requestEmbedding = async (text: string): Promise<Float32Array> => {
    if (text === 'boom') throw new Error('simulated failure');
    return Float32Array.from([text.length, 0]);
  };
  const embed = createSerializedEmbedder(requestEmbedding);

  const [boomResult, okResult] = await Promise.allSettled([embed('boom'), embed('ok')]);

  assert.equal(boomResult.status, 'rejected');
  assert.equal(okResult.status, 'fulfilled');
});
