/** Minimum time a Discord user must wait between /feed submissions, to bound abuse/spam. */
export const FEED_COOLDOWN_MS = 5 * 60 * 1000;

const lastSubmissionAt = new Map<string, number>();

export type FeedCooldownCheck = { ok: true } | { ok: false; retryAfterMs: number };

/** Checks whether userId is currently within the cooldown window. Does not itself consume the cooldown. */
export function checkFeedCooldown(userId: string, now: Date = new Date()): FeedCooldownCheck {
  const last = lastSubmissionAt.get(userId);
  if (last === undefined) return { ok: true };

  const elapsed = now.getTime() - last;
  if (elapsed >= FEED_COOLDOWN_MS) return { ok: true };

  return { ok: false, retryAfterMs: FEED_COOLDOWN_MS - elapsed };
}

/** Starts the cooldown window for userId. Call only after a successful submission. */
export function recordFeedSubmission(userId: string, now: Date = new Date()): void {
  lastSubmissionAt.set(userId, now.getTime());
}
