import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFeedCooldown, FEED_COOLDOWN_MS, recordFeedSubmission } from './feed-cooldown.js';

test('a user with no prior submission is not on cooldown', () => {
  const userId = 'user-first-time';
  assert.deepEqual(checkFeedCooldown(userId), { ok: true });
});

test('a user is on cooldown immediately after a recorded submission', () => {
  const userId = 'user-just-submitted';
  const now = new Date('2026-01-01T00:00:00Z');
  recordFeedSubmission(userId, now);

  const result = checkFeedCooldown(userId, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.retryAfterMs, FEED_COOLDOWN_MS);
});

test('a user is no longer on cooldown once FEED_COOLDOWN_MS has elapsed', () => {
  const userId = 'user-cooldown-elapsed';
  const start = new Date('2026-01-01T00:00:00Z');
  recordFeedSubmission(userId, start);

  const after = new Date(start.getTime() + FEED_COOLDOWN_MS);
  assert.deepEqual(checkFeedCooldown(userId, after), { ok: true });
});

test('cooldowns are independent per user', () => {
  const userA = 'user-a';
  const userB = 'user-b';
  const now = new Date('2026-01-01T00:00:00Z');
  recordFeedSubmission(userA, now);

  assert.equal(checkFeedCooldown(userA, now).ok, false);
  assert.equal(checkFeedCooldown(userB, now).ok, true);
});

test('checkFeedCooldown alone does not start the cooldown', () => {
  const userId = 'user-check-only';
  const now = new Date('2026-01-01T00:00:00Z');
  checkFeedCooldown(userId, now);
  assert.deepEqual(checkFeedCooldown(userId, now), { ok: true });
});
