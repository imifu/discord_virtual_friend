import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIssueContent } from './feedback-content.js';

const baseInput = {
  authorName: 'テストユーザー',
  guildName: 'テストサーバー',
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

test('body includes author, guild, and category metadata', () => {
  const { body } = buildIssueContent({ ...baseInput, text: 'テスト内容', category: 'question' });

  assert.ok(body.includes('テストユーザー'));
  assert.ok(body.includes('テストサーバー'));
  assert.ok(body.includes('質問'));
  assert.ok(body.includes('/feed'));
});
