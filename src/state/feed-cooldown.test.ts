import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FEED_COOLDOWN_MS, endFeedSubmission, recordFeedSubmission, tryBeginFeedSubmission } from './feed-cooldown.js';

test('a user with no prior submission can claim a slot', () => {
  const userId = 'user-first-time';
  const claim = tryBeginFeedSubmission(userId);
  assert.equal(claim.ok, true);
  endFeedSubmission(userId);
});

test('a second claim for the same user is rejected while the first is still in flight (Codex regression)', () => {
  const userId = 'user-concurrent';
  assert.equal(tryBeginFeedSubmission(userId).ok, true);

  const second = tryBeginFeedSubmission(userId);
  assert.equal(second.ok, false, 'a second concurrent claim must be rejected, not just the timed cooldown');

  endFeedSubmission(userId);
});

test('a user is on the timed cooldown immediately after a recorded submission', () => {
  const userId = 'user-just-submitted';
  const now = new Date('2026-01-01T00:00:00Z');
  recordFeedSubmission(userId, now);

  const result = tryBeginFeedSubmission(userId, DEFAULT_FEED_COOLDOWN_MS, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.retryAfterMs, DEFAULT_FEED_COOLDOWN_MS);
});

test('a user is no longer on cooldown once the cooldown duration has elapsed', () => {
  const userId = 'user-cooldown-elapsed';
  const start = new Date('2026-01-01T00:00:00Z');
  recordFeedSubmission(userId, start);

  const after = new Date(start.getTime() + DEFAULT_FEED_COOLDOWN_MS);
  const result = tryBeginFeedSubmission(userId, DEFAULT_FEED_COOLDOWN_MS, after);
  assert.equal(result.ok, true);
  endFeedSubmission(userId);
});

test('a custom (shorter) cooldownMs is honored, e.g. for local testing', () => {
  const userId = 'user-custom-cooldown';
  const start = new Date('2026-01-01T00:00:00Z');
  const shortCooldownMs = 5_000;
  recordFeedSubmission(userId, start);

  assert.equal(tryBeginFeedSubmission(userId, shortCooldownMs, new Date(start.getTime() + 1_000)).ok, false);
  assert.equal(tryBeginFeedSubmission(userId, shortCooldownMs, new Date(start.getTime() + 6_000)).ok, true);
  endFeedSubmission(userId);
});

test('cooldowns and in-flight claims are independent per user', () => {
  const userA = 'user-a';
  const userB = 'user-b';
  assert.equal(tryBeginFeedSubmission(userA).ok, true);

  assert.equal(tryBeginFeedSubmission(userA).ok, false);
  assert.equal(tryBeginFeedSubmission(userB).ok, true);

  endFeedSubmission(userA);
  endFeedSubmission(userB);
});

test('endFeedSubmission releases the claim so a later call can succeed, without starting the timed cooldown', () => {
  const userId = 'user-release';
  const now = new Date('2026-01-01T00:00:00Z');
  assert.equal(tryBeginFeedSubmission(userId, DEFAULT_FEED_COOLDOWN_MS, now).ok, true);

  endFeedSubmission(userId);

  assert.equal(
    tryBeginFeedSubmission(userId, DEFAULT_FEED_COOLDOWN_MS, now).ok,
    true,
    'releasing an in-flight claim without recording a submission must not start the timed cooldown',
  );
  endFeedSubmission(userId);
});

test('endFeedSubmission is a no-op when no claim is held', () => {
  assert.doesNotThrow(() => endFeedSubmission('user-no-claim'));
});
