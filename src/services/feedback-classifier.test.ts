import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFeedback } from './feedback-classifier.js';

test('classifies bug-keyword text as bug', () => {
  assert.equal(classifyFeedback('音声中継中にBotが落ちた'), 'bug');
  assert.equal(classifyFeedback('ハウリングみたいな変な音がする'), 'bug');
});

test('classifies text ending with a half-width or full-width question mark as question', () => {
  assert.equal(classifyFeedback('これは何のためのコマンドですか?'), 'question');
  assert.equal(classifyFeedback('これは何のためのコマンドですか？'), 'question');
});

test('classifies text containing question keywords as question', () => {
  assert.equal(classifyFeedback('使い方を教えてください'), 'question');
});

test('classifies enhancement-keyword text as enhancement', () => {
  assert.equal(classifyFeedback('AIがもう少しゆっくり喋る機能が欲しい'), 'enhancement');
});

test('unmatched text falls back to enhancement', () => {
  assert.equal(classifyFeedback('今日は天気がいいですね'), 'enhancement');
});

test('bug phrasing wins over question phrasing when both are present', () => {
  assert.equal(classifyFeedback('なぜ毎回落ちるんですか？'), 'bug');
});
