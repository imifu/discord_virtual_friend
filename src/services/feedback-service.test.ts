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
import { submitFeedback } from './feedback-service.js';
import type { CreatedIssue, CreateIssueContent, GithubRepoConfig } from './github-client.js';

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
    fake.createIssue,
  );

  assert.equal(fake.callCount(), 1);
  assert.equal(result.issueNumber, 1);
});

test('concurrent submitFeedback calls from the same user post only one issue (Codex regression)', async () => {
  const fake = makeDelayedFakeCreateIssue(20);
  const params = { text: 'テスト', userId: 'user-concurrent', authorName: 'テストユーザー', guildName: 'テストサーバー' };

  const results = await Promise.allSettled([
    submitFeedback(params, fake.createIssue),
    submitFeedback(params, fake.createIssue),
    submitFeedback(params, fake.createIssue),
  ]);

  assert.equal(fake.callCount(), 1, 'createGithubIssue must be called exactly once no matter how many concurrent /feed calls race');
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 2);
});

test('concurrent submitFeedback calls from different users are independent', async () => {
  const fake = makeDelayedFakeCreateIssue(10);

  const results = await Promise.all([
    submitFeedback({ text: 'A', userId: 'user-a', authorName: 'A', guildName: 'G' }, fake.createIssue),
    submitFeedback({ text: 'B', userId: 'user-b', authorName: 'B', guildName: 'G' }, fake.createIssue),
  ]);

  assert.equal(fake.callCount(), 2);
  assert.equal(results.length, 2);
});
