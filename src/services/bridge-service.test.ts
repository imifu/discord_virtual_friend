import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import type { Client } from 'discord.js';
import { getRuntime, getStatus, resetGuildState, updateStatus } from '../state/bridge-state.js';
import { VoiceActivityGate } from '../audio/voice-activity.js';
import { attachUtteranceRecorder } from './utterance-recorder.js';
import { stopRelay } from './bridge-service.js';

/**
 * Installs a real (spied) utteranceRecorder + a stub client into the guild's runtime, mirroring
 * what startRelay() would have set up. No other runtime handles are populated: stopRelay() only
 * ever touches them via `?.`, so leaving them undefined exercises the exact same code paths a
 * real relay session would hit once torn down, without needing to fake Discord/audify objects.
 */
function setUpRunningGuild(guildId: string): { detachCalls: () => number } {
  resetGuildState(guildId);

  const gptAudioStream = new PassThrough();
  const vadGate = new VoiceActivityGate(0.02, 400);
  const recorder = attachUtteranceRecorder({
    vadGate,
    gptAudioStream,
    gptSampleRate: 24000,
    gptChannels: 1,
    discordSampleRate: 48000,
    discordChannels: 2,
  });

  let detachCalls = 0;
  const originalDetach = recorder.detach.bind(recorder);
  recorder.detach = async () => {
    detachCalls += 1;
    return originalDetach();
  };

  const runtime = getRuntime(guildId);
  runtime.utteranceRecorder = recorder;
  runtime.client = {} as unknown as Client;
  updateStatus(guildId, { relayRunning: true });

  return { detachCalls: () => detachCalls };
}

test('stopRelay detaches the utterance recorder exactly once for a single call', async () => {
  const guildId = 'guild-stop-single';
  const { detachCalls } = setUpRunningGuild(guildId);

  await stopRelay(guildId);

  assert.equal(detachCalls(), 1);
  assert.equal(getRuntime(guildId).utteranceRecorder, undefined);
  assert.equal(getStatus(guildId).relayRunning, false);
});

test('concurrent stopRelay calls detach the utterance recorder only once (Issue #4 regression)', async () => {
  const guildId = 'guild-stop-concurrent';
  const { detachCalls } = setUpRunningGuild(guildId);

  await Promise.all([stopRelay(guildId), stopRelay(guildId), stopRelay(guildId)]);

  assert.equal(detachCalls(), 1, 'detach() must run exactly once no matter how many concurrent stopRelay() calls race');
  assert.equal(getRuntime(guildId).utteranceRecorder, undefined);
  assert.equal(getStatus(guildId).relayRunning, false);
});

test('stopRelay is safe to call again after the relay is already stopped', async () => {
  const guildId = 'guild-stop-idempotent';
  const { detachCalls } = setUpRunningGuild(guildId);

  await stopRelay(guildId);
  await assert.doesNotReject(stopRelay(guildId));

  assert.equal(detachCalls(), 1);
});
