import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueContent } from './feedback-content.js';

const baseInput = {
  submittedAt: new Date('2026-07-19T12:00:00+09:00'),
};

test('title is prefixed with the Japanese category label', () => {
  const { title } = buildIssueContent({ ...baseInput, text: 'AIが少し早口だった', category: 'enhancement' });
  assert.equal(title, '[改善提案] AIが少し早口だった');
});

test('long feedback text is truncated for the title but kept in full in the body', () => {
  const longText = 'あ'.repeat(120);
  const { title, body } = buildIssueContent({ ...baseInput, text: longText, category: 'bug' });

  assert.ok(title.endsWith('…'));
  assert.ok(title.length < longText.length);
  assert.ok(body.includes(longText), 'the full untruncated text must still appear in the body');
});

test('labels reflect the classified category', () => {
  const { labels } = buildIssueContent({ ...baseInput, text: '落ちた', category: 'bug' });
  assert.deepEqual(labels, ['bug']);
});

test('body includes the category and a /feed attribution, but never the Discord author or guild name (Issue #7 requirement / Codex finding)', () => {
  const { body } = buildIssueContent({ ...baseInput, text: 'テスト内容', category: 'question' });

  assert.ok(body.includes('質問'));
  assert.ok(body.includes('/feed'));
  assert.ok(!body.includes('送信者'));
  assert.ok(!body.includes('サーバー'));
});

test('mentions in feedback text are neutralized so GitHub does not notify the mentioned account (Codex finding)', () => {
  const { title, body } = buildIssueContent({
    ...baseInput,
    text: '@octocat さん、@some-org/some-team にも見てほしいです',
    category: 'enhancement',
  });

  assert.ok(!/@[A-Za-z0-9]/.test(title), 'title must not contain a live-looking @mention');
  assert.ok(!/@[A-Za-z0-9]/.test(body), 'body must not contain a live-looking @mention');
  assert.ok(body.includes('octocat'), 'the original text content should still be readable');
});

test('control characters in feedback text are stripped, while newlines/tabs are preserved (Codex finding)', () => {
  const text = 'line one\nline two\twith tab\x07\x1Bbell-and-escape';
  const { body } = buildIssueContent({ ...baseInput, text, category: 'bug' });

  assert.ok(body.includes('line one\nline two\twith tab'));
  assert.ok(!body.includes('\x07'));
  assert.ok(!body.includes('\x1B'));
});
