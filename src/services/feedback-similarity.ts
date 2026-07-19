import { embedFeedbackText } from './feedback-embedding.js';
import type { OpenIssueSummary } from './github-client.js';

export interface IssueEmbedding {
  issue: OpenIssueSummary;
  embedding: Float32Array;
}

export interface SimilarIssueMatch {
  issue: OpenIssueSummary;
  similarity: number;
}

/** Cosine similarity of two equal-length vectors, in [-1, 1] (both inputs from the same
 *  normalized embedding model are typically in [0, 1] for semantically related text). */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new RangeError(`cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Picks the single most similar issue at or above `threshold`, or undefined if none qualifies
 * (Issue #7: avoid merging into an unrelated issue - only act on a sufficiently confident match).
 * Pure - takes pre-computed embeddings so it's testable without a real model.
 */
export function findMostSimilarIssue(
  feedbackEmbedding: Float32Array,
  issueEmbeddings: IssueEmbedding[],
  threshold: number,
): SimilarIssueMatch | undefined {
  let best: SimilarIssueMatch | undefined;
  for (const { issue, embedding } of issueEmbeddings) {
    const similarity = cosineSimilarity(feedbackEmbedding, embedding);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { issue, similarity };
    }
  }
  return best;
}

const MAX_ISSUE_TEXT_LENGTH = 2000;

function issueEmbeddingText(issue: OpenIssueSummary): string {
  return `${issue.title}\n${issue.body}`.slice(0, MAX_ISSUE_TEXT_LENGTH);
}

/** issue number -> embedding, invalidated whenever the issue's updatedAt changes. Module-scope
 *  Map, same pattern as bridge-state.ts / feed-cooldown.ts - avoids re-embedding every open issue
 *  on every single /feed call. */
const issueEmbeddingCache = new Map<number, { updatedAt: string; embedding: Float32Array }>();

/**
 * Embeds every given issue (title+body), reusing a cached embedding when the issue hasn't
 * changed since it was last embedded. `embed` is injectable for tests; production code always
 * uses the real embedFeedbackText (I/O, worker thread - not unit tested itself).
 */
export async function getIssueEmbeddings(
  issues: OpenIssueSummary[],
  embed: (text: string) => Promise<Float32Array> = embedFeedbackText,
): Promise<IssueEmbedding[]> {
  const results: IssueEmbedding[] = [];
  for (const issue of issues) {
    const cached = issueEmbeddingCache.get(issue.number);
    if (cached && cached.updatedAt === issue.updatedAt) {
      results.push({ issue, embedding: cached.embedding });
      continue;
    }
    const embedding = await embed(issueEmbeddingText(issue));
    issueEmbeddingCache.set(issue.number, { updatedAt: issue.updatedAt, embedding });
    results.push({ issue, embedding });
  }
  return results;
}
