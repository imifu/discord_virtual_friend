import { loadConfig, requireGithubConfig } from '../config/env.js';
import { FeedCooldownError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { endFeedSubmission, recordFeedSubmission, tryBeginFeedSubmission } from '../state/feed-cooldown.js';
import { classifyFeedback, type FeedbackCategory } from './feedback-classifier.js';
import { buildIssueContent } from './feedback-content.js';
import { createGithubIssue } from './github-client.js';

const logger = createLogger('feedback-service');

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
 * human review step, no similar-issue lookup - both are deferred to a later phase).
 *
 * authorName is published to GitHub in masked form only (see buildIssueContent/maskAuthorName -
 * a deliberate, explicit exception to Issue #7's "don't publish Discord identities" principle).
 * guildName has no such exception: it's logged locally for audit purposes only and is never sent
 * to GitHub.
 *
 * The submission claim (tryBeginFeedSubmission/endFeedSubmission) is held across the whole
 * GitHub API call, not just the cooldown check: without it, two near-simultaneous /feed calls
 * from the same user could both pass the check before either's createGithubIssue() resolves and
 * both would post an issue - the same class of race already fixed for startRelay (Issue #3).
 * The `createIssue` param exists only so tests can inject a delayed fake without real network
 * calls; production code always uses the default.
 */
export async function submitFeedback(
  params: SubmitFeedbackParams,
  createIssue: typeof createGithubIssue = createGithubIssue,
): Promise<SubmitFeedbackResult> {
  const { text, userId, authorName, guildName } = params;

  const claim = tryBeginFeedSubmission(userId);
  if (!claim.ok) {
    throw new FeedCooldownError(claim.retryAfterMs);
  }

  try {
    const githubConfig = requireGithubConfig(loadConfig());
    const category = classifyFeedback(text);
    const content = buildIssueContent({ text, category, authorName, submittedAt: new Date() });
    const issue = await createIssue(githubConfig, content);

    logger.info(
      `/feed受付: user=${userId} (${authorName}) guild=${guildName} category=${category} issue=${issue.url}`,
    );
    recordFeedSubmission(userId);

    return { category, issueUrl: issue.url, issueNumber: issue.number };
  } finally {
    endFeedSubmission(userId);
  }
}
