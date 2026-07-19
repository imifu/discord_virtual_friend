/** Default minimum time (ms) a Discord user must wait between /feed submissions, used when the
 *  caller doesn't pass an explicit cooldownMs (production always does - see config.feed.cooldownMs). */
export const DEFAULT_FEED_COOLDOWN_MS = 5 * 60 * 1000;

/** Wait hint shown when a user's previous /feed is still in flight (not yet on the timed cooldown). */
const IN_FLIGHT_RETRY_HINT_MS = 5000;

const lastSubmissionAt = new Map<string, number>();
const submittingUsers = new Set<string>();

export type FeedCooldownCheck = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * Atomically checks the cooldown AND claims an in-flight submission slot for userId. Must be
 * paired with endFeedSubmission() in a try/finally: a second concurrent call for the same user
 * must see the claim already held, not just an unset cooldown timestamp - otherwise two
 * near-simultaneous /feed calls could both pass the check before either's GitHub API call
 * resolves, and both would end up posting an issue.
 */
export function tryBeginFeedSubmission(
  userId: string,
  cooldownMs: number = DEFAULT_FEED_COOLDOWN_MS,
  now: Date = new Date(),
): FeedCooldownCheck {
  if (submittingUsers.has(userId)) {
    return { ok: false, retryAfterMs: IN_FLIGHT_RETRY_HINT_MS };
  }

  const last = lastSubmissionAt.get(userId);
  if (last !== undefined) {
    const elapsed = now.getTime() - last;
    if (elapsed < cooldownMs) return { ok: false, retryAfterMs: cooldownMs - elapsed };
  }

  submittingUsers.add(userId);
  return { ok: true };
}

/** Releases the claim taken by tryBeginFeedSubmission. Safe to call even if no claim is held. */
export function endFeedSubmission(userId: string): void {
  submittingUsers.delete(userId);
}

/** Starts the timed cooldown window for userId. Call only after a successful GitHub post. */
export function recordFeedSubmission(userId: string, now: Date = new Date()): void {
  lastSubmissionAt.set(userId, now.getTime());
}
