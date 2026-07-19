import { CATEGORY_INFO, type FeedbackCategory } from './feedback-classifier.js';

const TITLE_BODY_MAX_LENGTH = 80;

/** Matches C0 control characters other than \n and \t (which are needed for readable formatting). */
// eslint-disable-next-line no-control-regex -- intentional: stripping control chars from untrusted /feed input
const CONTROL_CHARS_EXCEPT_NEWLINE_TAB = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export interface FeedbackContentInput {
  text: string;
  category: FeedbackCategory;
  submittedAt: Date;
}

export interface IssueContent {
  title: string;
  body: string;
  labels: string[];
}

/**
 * Neutralizes raw /feed text before it reaches a public GitHub issue: strips control characters,
 * and breaks GitHub's @user / @org/team mention parsing by inserting U+200B (zero width space)
 * right after every "@", so a Discord participant can't trigger GitHub notifications to third
 * parties just by mentioning them in free-form feedback text (Issue #7 explicitly calls out
 * mentions/control chars as a threat to defend against).
 */
function sanitizeForGithub(text: string): string {
  return text.replace(CONTROL_CHARS_EXCEPT_NEWLINE_TAB, '').replace(/@/g, '@\u200B');
}

function truncateForTitle(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= TITLE_BODY_MAX_LENGTH) return singleLine;
  return `${singleLine.slice(0, TITLE_BODY_MAX_LENGTH)}…`;
}

/**
 * Builds a new-issue title/body/labels from /feed input. Pure formatting - no I/O.
 * Deliberately does NOT include the Discord author name or guild name: Issue #7 states Discord
 * usernames/IDs must not be published to GitHub as a matter of principle. Caller is expected to
 * log that metadata locally (non-public) instead, if needed for audit purposes.
 */
export function buildIssueContent(input: FeedbackContentInput): IssueContent {
  const { category, submittedAt } = input;
  const text = sanitizeForGithub(input.text);
  const info = CATEGORY_INFO[category];

  const title = `[${info.label}] ${truncateForTitle(text)}`;

  const body = [
    '## Discordからのフィードバック',
    '',
    text,
    '',
    '## 自動判定',
    '',
    `- 分類: ${info.label}`,
    '- 類似Issue判定: 未実施(Phase 2で対応予定)',
    `- 送信日時: ${submittedAt.toLocaleString('ja-JP')}`,
    '',
    '*このIssueはDiscordの `/feed` コマンドから自動投稿されました。*',
  ].join('\n');

  return { title, body, labels: [info.githubLabel] };
}
