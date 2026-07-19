import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endRelayStart, resetGuildState, tryBeginRelayStart, updateStatus } from './bridge-state.js';

test('tryBeginRelayStart claims the lock for a guild not yet starting or running', () => {
  const guildId = 'guild-claim';
  resetGuildState(guildId);

  assert.equal(tryBeginRelayStart(guildId), true);

  endRelayStart(guildId);
});

test('a second tryBeginRelayStart is rejected while the first claim is still held', () => {
  const guildId = 'guild-concurrent-start';
  resetGuildState(guildId);

  assert.equal(tryBeginRelayStart(guildId), true);
  assert.equal(tryBeginRelayStart(guildId), false, 'second concurrent start attempt must be rejected');

  endRelayStart(guildId);
});

test('tryBeginRelayStart is rejected while relayRunning is already true, without claiming a start', () => {
  const guildId = 'guild-already-running';
  resetGuildState(guildId);
  updateStatus(guildId, { relayRunning: true });

  assert.equal(tryBeginRelayStart(guildId), false);
});

test('endRelayStart releases the claim so a subsequent start can proceed (failure-path guard release)', () => {
  const guildId = 'guild-retry-after-failure';
  resetGuildState(guildId);

  assert.equal(tryBeginRelayStart(guildId), true);
  endRelayStart(guildId); // simulates the finally-block release after an init failure
  assert.equal(tryBeginRelayStart(guildId), true, 'a start must be retryable after the previous claim was released');

  endRelayStart(guildId);
});

test('endRelayStart is a no-op when no claim is held', () => {
  const guildId = 'guild-no-claim';
  resetGuildState(guildId);

  assert.doesNotThrow(() => endRelayStart(guildId));
});

test('claims for different guilds do not interfere with each other', () => {
  const guildA = 'guild-a';
  const guildB = 'guild-b';
  resetGuildState(guildA);
  resetGuildState(guildB);

  assert.equal(tryBeginRelayStart(guildA), true);
  assert.equal(tryBeginRelayStart(guildB), true, 'a claim on one guild must not block another guild');

  endRelayStart(guildA);
  endRelayStart(guildB);
});
