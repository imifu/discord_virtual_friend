import { loadConfig, requireGithubConfig } from '../config/env.js';
import { FeedCooldownError } from '../utils/errors.js';
import { checkFeedCooldown, recordFeedSubmission } from '../state/feed-cooldown.js';
import { classifyFeedback, type FeedbackCategory } from './feedback-classifier.js';
import { buildIssueContent } from './feedback-content.js';
import { createGithubIssue } from './github-client.js';

export interface SubmitFeedbackParams {
  text: string;
  userId: string;
  authorName: string;
  guildName: string;
}

export interface SubmitFeedbackResult {
  category: FeedbackCategory;
  issueUrl: string;
  issueNumber: number;
}

/**
 * Classifies /feed text and posts it as a new GitHub issue immediately (Issue #7 Phase 1: no
 * human review step, no similar-issue lookup - both are deferred to a later phase). The
 * per-user cooldown is only consumed on a successful post, so a failed GitHub call doesn't
 * block the user's next retry.
 */
export async function submitFeedback(params: SubmitFeedbackParams): Promise<SubmitFeedbackResult> {
  const { text, userId, authorName, guildName } = params;

  const cooldown = checkFeedCooldown(userId);
  if (!cooldown.ok) {
    throw new FeedCooldownError(cooldown.retryAfterMs);
  }

  const githubConfig = requireGithubConfig(loadConfig());
  const category = classifyFeedback(text);
  const content = buildIssueContent({ text, category, authorName, guildName, submittedAt: new Date() });
  const issue = await createGithubIssue(githubConfig, content);

  recordFeedSubmission(userId);

  return { category, issueUrl: issue.url, issueNumber: issue.number };
}
