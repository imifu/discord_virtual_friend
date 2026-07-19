import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRetryingLazySingleton } from './feedback-embedding-worker.js';

test('memoizes a successful factory call: later calls reuse the same resolved value', async () => {
  let calls = 0;
  const get = createRetryingLazySingleton(async () => {
    calls += 1;
    return 'ok';
  });

  assert.equal(await get(), 'ok');
  assert.equal(await get(), 'ok');
  assert.equal(calls, 1, 'a successful factory must not be called again');
});

test('a failed factory call is retried on the next get(), not permanently cached (Codex regression)', async () => {
  let calls = 0;
  const get = createRetryingLazySingleton(async () => {
    calls += 1;
    if (calls === 1) throw new Error('simulated model load failure');
    return 'ready';
  });

  await assert.rejects(get(), /simulated model load failure/);
  assert.equal(await get(), 'ready', 'a call after a failure must retry the factory, not reuse the rejected promise');
  assert.equal(calls, 2);
});

test('concurrent calls while the factory is still pending share the same in-flight promise', async () => {
  let calls = 0;
  let resolveFactory: (value: string) => void;
  const pendingResult = new Promise<string>((resolve) => {
    resolveFactory = resolve;
  });
  const get = createRetryingLazySingleton(async () => {
    calls += 1;
    return pendingResult;
  });

  const first = get();
  const second = get();
  resolveFactory!('done');

  assert.deepEqual(await Promise.all([first, second]), ['done', 'done']);
  assert.equal(calls, 1, 'two calls made before the factory settles must not trigger two factory invocations');
});
