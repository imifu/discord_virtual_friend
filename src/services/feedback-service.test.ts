// loadConfig() is called unconditionally inside submitFeedback(), so a minimal valid config must
// exist before any test runs. node:test runs each test file in its own process, so this doesn't
// leak into other test files.
process.env.DISCORD_TOKEN ??= 'test-discord-token';
process.env.DISCORD_CLIENT_ID ??= 'test-discord-client-id';
process.env.DISCORD_GUILD_ID ??= 'test-discord-guild-id';
process.env.GITHUB_TOKEN ??= 'test-github-token';
process.env.GITHUB_REPO ??= 'test-owner/test-repo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { submitFeedback, type SubmitFeedbackDeps } from './feedback-service.js';
import type { CreatedComment, CreatedIssue, CreateIssueContent, GithubRepoConfig, OpenIssueSummary } from './github-client.js';

const noOpenIssues = async (): Promise<OpenIssueSummary[]> => [];
const fixedEmbed = async (): Promise<Float32Array> => Float32Array.from([1, 0, 0]);

function makeDelayedFakeCreateIssue(delayMs: number): {
  createIssue: (config: GithubRepoConfig, content: CreateIssueContent) => Promise<CreatedIssue>;
  callCount: () => number;
} {
  let calls = 0;
  return {
    createIssue: async () => {
      calls += 1;
      await delay(delayMs);
      return { url: `https://github.com/test-owner/test-repo/issues/${calls}`, number: calls };
    },
    callCount: () => calls,
  };
}

test('submitFeedback posts exactly one issue for a single call', async () => {
  const fake = makeDelayedFakeCreateIssue(5);
  const result = await submitFeedback(
    { text: 'テスト', userId: 'user-single', authorName: 'テストユーザー', guildName: 'テストサーバー' },
    { createIssue: fake.createIssue, listOpenIssues: noOpenIssues, embedText: fixedEmbed },
  );

  assert.equal(fake.callCount(), 1);
  assert.equal(result.outcome, 'created');
  assert.equal(result.issueNumber, 1);
});

test('concurrent submitFeedback calls from the same user post only one issue (Codex regression)', async () => {
  const fake = makeDelayedFakeCreateIssue(20);
  const params = { text: 'テスト', userId: 'user-concurrent', authorName: 'テストユーザー', guildName: 'テストサーバー' };
  const deps: SubmitFeedbackDeps = { createIssue: fake.createIssue, listOpenIssues: noOpenIssues, embedText: fixedEmbed };

  const results = await Promise.allSettled([
    submitFeedback(params, deps),
    submitFeedback(params, deps),
    submitFeedback(params, deps),
  ]);

  assert.equal(fake.callCount(), 1, 'createGithubIssue must be called exactly once no matter how many concurrent /feed calls race');
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 2);
});

test('concurrent submitFeedback calls from different users are independent', async () => {
  const fake = makeDelayedFakeCreateIssue(10);
  const deps: SubmitFeedbackDeps = { createIssue: fake.createIssue, listOpenIssues: noOpenIssues, embedText: fixedEmbed };

  const results = await Promise.all([
    submitFeedback({ text: 'A', userId: 'user-a', authorName: 'A', guildName: 'G' }, deps),
    submitFeedback({ text: 'B', userId: 'user-b', authorName: 'B', guildName: 'G' }, deps),
  ]);

  assert.equal(fake.callCount(), 2);
  assert.equal(results.length, 2);
});

test('creates a new issue when no open issue is similar enough', async () => {
  let createCalls = 0;
  let commentCalls = 0;
  const createIssue = async (): Promise<CreatedIssue> => {
    createCalls += 1;
    return { url: 'https://github.com/test-owner/test-repo/issues/42', number: 42 };
  };
  const createComment = async (): Promise<CreatedComment> => {
    commentCalls += 1;
    return { url: 'https://github.com/test-owner/test-repo/issues/1#issuecomment-1' };
  };
  const listOpenIssues = async (): Promise<OpenIssueSummary[]> => [
    { number: 1, title: '無関係なIssue', body: '無関係な本文', url: 'https://github.com/test-owner/test-repo/issues/1', updatedAt: '2026-01-01T00:00:00Z' },
  ];
  // Feedback embeds to [1,0,0]; the unrelated issue embeds to an orthogonal vector -> similarity 0.
  const embedText = async (text: string): Promise<Float32Array> =>
    text.includes('無関係') ? Float32Array.from([0, 1, 0]) : Float32Array.from([1, 0, 0]);

  const result = await submitFeedback(
    { text: '音声が途切れる', userId: 'user-no-match', authorName: 'テストユーザー', guildName: 'G' },
    { createIssue, createComment, listOpenIssues, embedText },
  );

  assert.equal(createCalls, 1);
  assert.equal(commentCalls, 0);
  assert.equal(result.outcome, 'created');
  assert.equal(result.issueNumber, 42);
});

test('comments on an existing issue when similarity is at/above the configured threshold', async () => {
  let createCalls = 0;
  let commentCalls = 0;
  let commentedIssueNumber: number | undefined;
  const createIssue = async (): Promise<CreatedIssue> => {
    createCalls += 1;
    return { url: 'https://github.com/test-owner/test-repo/issues/99', number: 99 };
  };
  const createComment = async (_config: GithubRepoConfig, issueNumber: number): Promise<CreatedComment> => {
    commentCalls += 1;
    commentedIssueNumber = issueNumber;
    return { url: `https://github.com/test-owner/test-repo/issues/${issueNumber}#issuecomment-1` };
  };
  const listOpenIssues = async (): Promise<OpenIssueSummary[]> => [
    { number: 1, title: '無関係なIssue', body: '無関係な本文', url: 'https://github.com/test-owner/test-repo/issues/1', updatedAt: '2026-01-01T00:00:00Z' },
    { number: 7, title: '音声が途切れる', body: '会話中に音声が途切れる不具合', url: 'https://github.com/test-owner/test-repo/issues/7', updatedAt: '2026-01-02T00:00:00Z' },
  ];
  // The feedback text and issue #7 share the marker "音声が途切れる" -> identical vector -> similarity 1.
  const embedText = async (text: string): Promise<Float32Array> =>
    text.includes('音声が途切れる') ? Float32Array.from([1, 0, 0]) : Float32Array.from([0, 1, 0]);

  const result = await submitFeedback(
    { text: '音声が途切れる現象がまた起きました', userId: 'user-match', authorName: 'テストユーザー', guildName: 'G' },
    { createIssue, createComment, listOpenIssues, embedText },
  );

  assert.equal(commentCalls, 1);
  assert.equal(createCalls, 0);
  assert.equal(commentedIssueNumber, 7, 'must comment on the more similar issue, not the unrelated one');
  assert.equal(result.outcome, 'commented');
  if (result.outcome === 'commented') {
    assert.equal(result.issueNumber, 7);
    assert.ok(result.similarity >= 0.99);
  }
});
