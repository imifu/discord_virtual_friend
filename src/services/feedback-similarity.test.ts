import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, findMostSimilarIssue, getIssueEmbeddings, type IssueEmbedding } from './feedback-similarity.js';
import type { OpenIssueSummary } from './github-client.js';

test('cosineSimilarity of identical vectors is 1', () => {
  const v = Float32Array.from([1, 2, 3]);
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-6);
});

test('cosineSimilarity of orthogonal vectors is 0', () => {
  const a = Float32Array.from([1, 0]);
  const b = Float32Array.from([0, 1]);
  assert.equal(cosineSimilarity(a, b), 0);
});

test('cosineSimilarity of opposite vectors is -1', () => {
  const a = Float32Array.from([1, 0]);
  const b = Float32Array.from([-1, 0]);
  assert.ok(Math.abs(cosineSimilarity(a, b) - -1) < 1e-6);
});

test('cosineSimilarity throws on mismatched vector lengths', () => {
  assert.throws(() => cosineSimilarity(Float32Array.from([1, 2]), Float32Array.from([1, 2, 3])), RangeError);
});

test('cosineSimilarity of a zero vector against anything is 0 (no divide-by-zero)', () => {
  const zero = Float32Array.from([0, 0, 0]);
  const other = Float32Array.from([1, 2, 3]);
  assert.equal(cosineSimilarity(zero, other), 0);
});

const issueA: OpenIssueSummary = { number: 1, title: 'A', body: '', url: 'https://example.com/1', updatedAt: 't1' };
const issueB: OpenIssueSummary = { number: 2, title: 'B', body: '', url: 'https://example.com/2', updatedAt: 't2' };

test('findMostSimilarIssue returns undefined when nothing meets the threshold', () => {
  const feedback = Float32Array.from([1, 0]);
  const embeddings: IssueEmbedding[] = [{ issue: issueA, embedding: Float32Array.from([0, 1]) }];
  assert.equal(findMostSimilarIssue(feedback, embeddings, 0.8), undefined);
});

test('findMostSimilarIssue returns the issue at or above the threshold', () => {
  const feedback = Float32Array.from([1, 0]);
  const embeddings: IssueEmbedding[] = [{ issue: issueA, embedding: Float32Array.from([1, 0]) }];
  const match = findMostSimilarIssue(feedback, embeddings, 0.8);
  assert.equal(match?.issue.number, 1);
  assert.ok(match && match.similarity >= 0.99);
});

test('findMostSimilarIssue picks the highest similarity among multiple qualifying issues', () => {
  const feedback = Float32Array.from([1, 0]);
  const embeddings: IssueEmbedding[] = [
    { issue: issueA, embedding: Float32Array.from([0.85, Math.sqrt(1 - 0.85 ** 2)]) },
    { issue: issueB, embedding: Float32Array.from([1, 0]) },
  ];
  const match = findMostSimilarIssue(feedback, embeddings, 0.8);
  assert.equal(match?.issue.number, 2, 'must pick issueB (similarity ~1.0) over issueA (similarity 0.85)');
});

test('findMostSimilarIssue is exclusive at the threshold boundary from below', () => {
  const feedback = Float32Array.from([1, 0]);
  // cos(angle) just under 0.8
  const embeddings: IssueEmbedding[] = [{ issue: issueA, embedding: Float32Array.from([0.79, Math.sqrt(1 - 0.79 ** 2)]) }];
  assert.equal(findMostSimilarIssue(feedback, embeddings, 0.8), undefined);
});

test('getIssueEmbeddings embeds every issue when nothing is cached yet', async () => {
  let embedCalls = 0;
  const embed = async (): Promise<Float32Array> => {
    embedCalls += 1;
    return Float32Array.from([1, 0]);
  };
  const issues: OpenIssueSummary[] = [
    { number: 101, title: 'X', body: '', url: 'u1', updatedAt: 'v1' },
    { number: 102, title: 'Y', body: '', url: 'u2', updatedAt: 'v1' },
  ];

  const results = await getIssueEmbeddings(issues, embed);

  assert.equal(embedCalls, 2);
  assert.equal(results.length, 2);
});

test('getIssueEmbeddings reuses a cached embedding when updatedAt is unchanged', async () => {
  let embedCalls = 0;
  const embed = async (): Promise<Float32Array> => {
    embedCalls += 1;
    return Float32Array.from([1, 0]);
  };
  const issue: OpenIssueSummary = { number: 201, title: 'Z', body: '', url: 'u', updatedAt: 'same' };

  await getIssueEmbeddings([issue], embed);
  const callsAfterFirst = embedCalls;
  await getIssueEmbeddings([issue], embed);

  assert.equal(embedCalls, callsAfterFirst, 'a second call with the same updatedAt must not re-embed');
});

test('getIssueEmbeddings re-embeds when updatedAt changes', async () => {
  let embedCalls = 0;
  const embed = async (): Promise<Float32Array> => {
    embedCalls += 1;
    return Float32Array.from([1, 0]);
  };
  const issue: OpenIssueSummary = { number: 202, title: 'Z', body: '', url: 'u', updatedAt: 'v1' };

  await getIssueEmbeddings([issue], embed);
  const callsAfterFirst = embedCalls;
  await getIssueEmbeddings([{ ...issue, updatedAt: 'v2' }], embed);

  assert.equal(embedCalls, callsAfterFirst + 1, 'a changed updatedAt must trigger a fresh embed call');
});
