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

/**
 * Only the title is embedded for similarity matching, not title+body. Empirically (real /feed
 * usage against this repo, see README section 21), comparing a new submission's raw text against
 * an existing issue's full body - which for /feed-created issues is mostly fixed template text
 * ("## 自動判定", "- 分類: ...", "- 送信日時: ...", the "自動投稿されました" footer etc., largely
 * identical across every issue) drowns out the few words of actual feedback content: genuine
 * paraphrases of the same request measured ~0.79 title-to-title but only ~0.39 when the existing
 * issue's full title+body was used instead - well under any reasonable threshold. Titles avoid
 * this because they're short and, for /feed-created issues, are literally "[category] " + the
 * feedback text itself (see buildIssueContent) - no boilerplate to dilute the signal. The
 * category prefix is kept (not stripped) because it also empirically improved separation from
 * unrelated issues (~0.28 vs ~0.49 similarity in the same real-world comparison).
 */
function issueEmbeddingText(issue: OpenIssueSummary): string {
  return issue.title;
}

/** issue number -> embedding, invalidated whenever the issue's updatedAt changes. Module-scope
 *  Map, same pattern as bridge-state.ts / feed-cooldown.ts - avoids re-embedding every open issue
 *  on every single /feed call. */
const issueEmbeddingCache = new Map<number, { updatedAt: string; embedding: Float32Array }>();

/**
 * Embeds every given issue's title (see issueEmbeddingText for why title-only), reusing a cached
 * embedding when the issue hasn't changed since it was last embedded. `embed` is injectable for
 * tests; production code always uses the real embedFeedbackText (I/O, worker thread - not unit
 * tested itself).
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
