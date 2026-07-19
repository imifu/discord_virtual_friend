import { loadConfig, requireGithubConfig } from '../config/env.js';
import { FeedCooldownError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';
import { endFeedSubmission, recordFeedSubmission, tryBeginFeedSubmission } from '../state/feed-cooldown.js';
import { classifyFeedback, type FeedbackCategory } from './feedback-classifier.js';
import { buildCommentContent, buildIssueContent } from './feedback-content.js';
import { createGithubIssue, createIssueComment, listOpenIssues } from './github-client.js';
import { embedFeedbackText } from './feedback-embedding.js';
import { findMostSimilarIssue, getIssueEmbeddings } from './feedback-similarity.js';

const logger = createLogger('feedback-service');

export interface SubmitFeedbackParams {
  text: string;
  userId: string;
  authorName: string;
  guildName: string;
}

export type SubmitFeedbackResult =
  | { outcome: 'created'; category: FeedbackCategory; issueUrl: string; issueNumber: number }
  | {
      outcome: 'commented';
      category: FeedbackCategory;
      issueUrl: string;
      issueNumber: number;
      similarity: number;
    };

/** Injectable I/O for tests. Production code always uses the real implementations (the defaults). */
export interface SubmitFeedbackDeps {
  createIssue?: typeof createGithubIssue;
  createComment?: typeof createIssueComment;
  listOpenIssues?: typeof listOpenIssues;
  embedText?: typeof embedFeedbackText;
}

/**
 * Classifies /feed text, compares it against open GitHub issues using local sentence embeddings,
 * and either adds a comment to a sufficiently similar existing issue or creates a new one
 * (Issue #7 Phase 2a). No human review step either way. Discord's response stays synchronous:
 * the interaction is deferred but not answered until the whole GitHub round-trip finishes.
 *
 * If listing issues or embedding fails, the whole submission fails (GithubApiError /
 * FeedbackEmbeddingError) rather than silently falling back to "always create a new issue" -
 * Issue #7 prioritizes not merging into an unrelated issue over always succeeding.
 *
 * authorName is published to GitHub in masked form only (see buildIssueContent/maskAuthorName -
 * a deliberate, explicit exception to Issue #7's "don't publish Discord identities" principle).
 * guildName has no such exception: it's logged locally for audit purposes only and is never sent
 * to GitHub.
 *
 * The submission claim (tryBeginFeedSubmission/endFeedSubmission) is held across the whole
 * operation, not just the cooldown check: without it, two near-simultaneous /feed calls from the
 * same user could both pass the check before either resolves and both would post - the same
 * class of race already fixed for startRelay (Issue #3).
 */
export async function submitFeedback(
  params: SubmitFeedbackParams,
  deps: SubmitFeedbackDeps = {},
): Promise<SubmitFeedbackResult> {
  const { text, userId, authorName, guildName } = params;
  const createIssue = deps.createIssue ?? createGithubIssue;
  const createComment = deps.createComment ?? createIssueComment;
  const listIssues = deps.listOpenIssues ?? listOpenIssues;
  const embedText = deps.embedText ?? embedFeedbackText;

  const claim = tryBeginFeedSubmission(userId);
  if (!claim.ok) {
    throw new FeedCooldownError(claim.retryAfterMs);
  }

  try {
    const config = loadConfig();
    const githubConfig = requireGithubConfig(config);
    const category = classifyFeedback(text);
    const submittedAt = new Date();

    const [feedbackEmbedding, openIssues] = await Promise.all([embedText(text), listIssues(githubConfig)]);
    const issueEmbeddings = await getIssueEmbeddings(openIssues, embedText);
    const match = findMostSimilarIssue(feedbackEmbedding, issueEmbeddings, config.feed.similarityThreshold);

    let result: SubmitFeedbackResult;
    if (match) {
      const content = buildCommentContent({ text, category, authorName, submittedAt, similarity: match.similarity });
      const comment = await createComment(githubConfig, match.issue.number, content.body);
      result = {
        outcome: 'commented',
        category,
        issueUrl: comment.url,
        issueNumber: match.issue.number,
        similarity: match.similarity,
      };
    } else {
      const content = buildIssueContent({ text, category, authorName, submittedAt });
      const issue = await createIssue(githubConfig, content);
      result = { outcome: 'created', category, issueUrl: issue.url, issueNumber: issue.number };
    }

    logger.info(
      `/feed受付: user=${userId} (${authorName}) guild=${guildName} category=${category} ` +
        `outcome=${result.outcome} issue=${result.issueUrl}`,
    );
    recordFeedSubmission(userId);

    return result;
  } finally {
    endFeedSubmission(userId);
  }
}
