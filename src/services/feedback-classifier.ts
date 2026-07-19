export type FeedbackCategory = 'bug' | 'enhancement' | 'question';

export interface CategoryInfo {
  /** Japanese label shown in Discord replies and the issue title. */
  label: string;
  /** GitHub label name applied to the created issue. GitHub auto-creates it if missing. */
  githubLabel: string;
}

export const CATEGORY_INFO: Record<FeedbackCategory, CategoryInfo> = {
  bug: { label: '不具合', githubLabel: 'bug' },
  enhancement: { label: '改善提案', githubLabel: 'enhancement' },
  question: { label: '質問', githubLabel: 'question' },
};

const BUG_KEYWORDS = [
  'バグ',
  '不具合',
  'エラー',
  '落ちる',
  '落ちた',
  'クラッシュ',
  '止まる',
  '止まった',
  '固まる',
  '固まった',
  '動かない',
  '失敗',
  'おかしい',
  '変な音',
  'ノイズ',
  '聞こえない',
  '聞こえなかった',
  'ずれる',
  'ずれた',
  '切れる',
  '切れた',
];

const QUESTION_KEYWORDS = ['教えて', 'どうやって', 'なぜ', 'どうして', 'ですか', 'ますか'];

const ENHANCEMENT_KEYWORDS = [
  '提案',
  '改善',
  '追加してほしい',
  '追加して',
  '欲しい',
  'ほしい',
  'あったらいい',
  'できるようにして',
  '機能',
  '早口',
  '遅い',
  '速い',
  '調整して',
];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function endsWithQuestionMark(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith('?') || trimmed.endsWith('？');
}

/**
 * Classifies free-form /feed text into a category using fixed Japanese keyword rules (no ML,
 * no external API - Issue #7 Phase 1). Bug phrasing wins over question phrasing ("なぜ落ちるん
 * ですか？" is a bug report, not a generic question) since it's more specific and actionable.
 * Unmatched text falls back to 'enhancement' as the most generic, least alarming category.
 */
export function classifyFeedback(text: string): FeedbackCategory {
  if (includesAny(text, BUG_KEYWORDS)) return 'bug';
  if (endsWithQuestionMark(text) || includesAny(text, QUESTION_KEYWORDS)) return 'question';
  if (includesAny(text, ENHANCEMENT_KEYWORDS)) return 'enhancement';
  return 'enhancement';
}
