import { CATEGORY_INFO, type FeedbackCategory } from './feedback-classifier.js';

const TITLE_BODY_MAX_LENGTH = 80;
const AUTHOR_NAME_VISIBLE_CHARS = 2;

/** Matches C0 control characters other than \n and \t (which are needed for readable formatting). */
// eslint-disable-next-line no-control-regex -- intentional: stripping control chars from untrusted /feed input
const CONTROL_CHARS_EXCEPT_NEWLINE_TAB = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export interface FeedbackContentInput {
  text: string;
  category: FeedbackCategory;
  authorName: string;
  submittedAt: Date;
}

export interface CommentContentInput extends FeedbackContentInput {
  /** Cosine similarity (0-1) to the existing issue this comment is being added to. */
  similarity: number;
}

export interface IssueContent {
  title: string;
  body: string;
  labels: string[];
}

/**
 * Neutralizes raw /feed input before it reaches a public GitHub issue: strips control characters,
 * and breaks GitHub's @user / @org/team mention parsing by inserting U+200B (zero width space)
 * right after every "@", so a Discord participant can't trigger GitHub notifications to third
 * parties just by mentioning them in free-form text (Issue #7 explicitly calls out mentions/
 * control chars as a threat to defend against). Applied to both the feedback text and the
 * (already-masked) author name, since Discord display names aren't restricted to safe characters.
 */
function sanitizeForGithub(text: string): string {
  return text.replace(CONTROL_CHARS_EXCEPT_NEWLINE_TAB, '').replace(/@/g, '@\u200B');
}

/**
 * Partially masks a Discord display name for inclusion in a public GitHub issue: keeps only the
 * first 2 characters, replacing the rest with '*'. This is a deliberate, explicit exception to
 * Issue #7's general "don't publish Discord identities" principle - the repo owner chose partial
 * masking over full exclusion so repeat feedback from the same person stays recognizable. The
 * guild name has no such exception and is never sent to GitHub (see submitFeedback in
 * feedback-service.ts, which only logs it locally).
 */
function maskAuthorName(name: string): string {
  const chars = Array.from(name);
  if (chars.length <= AUTHOR_NAME_VISIBLE_CHARS) return name;
  return chars.slice(0, AUTHOR_NAME_VISIBLE_CHARS).join('') + '*'.repeat(chars.length - AUTHOR_NAME_VISIBLE_CHARS);
}

function truncateForTitle(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= TITLE_BODY_MAX_LENGTH) return singleLine;
  return `${singleLine.slice(0, TITLE_BODY_MAX_LENGTH)}…`;
}

/**
 * Builds a new-issue title/body/labels from /feed input. Pure formatting - no I/O.
 * The guild name is deliberately NOT part of this input: it must never be published to GitHub
 * (Issue #7). The author name IS included, but only in masked form (see maskAuthorName).
 * Called only when no existing open issue was similar enough (see buildCommentContent otherwise).
 */
export function buildIssueContent(input: FeedbackContentInput): IssueContent {
  const { category, submittedAt } = input;
  const text = sanitizeForGithub(input.text);
  const authorName = sanitizeForGithub(maskAuthorName(input.authorName));
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
    `- 送信者: ${authorName}`,
    '- 類似Issue判定: 十分に類似するOpen Issueなし(新規作成)',
    `- 送信日時: ${submittedAt.toLocaleString('ja-JP')}`,
    '',
    '*このIssueはDiscordの `/feed` コマンドから自動投稿されました。*',
  ].join('\n');

  return { title, body, labels: [info.githubLabel] };
}

/**
 * Builds a comment body (no title/labels - comments don't have either) for when an existing open
 * issue is similar enough to the new /feed submission. Same sanitization/masking as
 * buildIssueContent.
 */
export function buildCommentContent(input: CommentContentInput): { body: string } {
  const { category, submittedAt, similarity } = input;
  const text = sanitizeForGithub(input.text);
  const authorName = sanitizeForGithub(maskAuthorName(input.authorName));
  const info = CATEGORY_INFO[category];

  const body = [
    '## Discordからの追加フィードバック',
    '',
    text,
    '',
    '## 自動判定',
    '',
    `- 分類: ${info.label}`,
    `- 送信者: ${authorName}`,
    `- このIssueとの類似度: ${similarity.toFixed(2)}`,
    `- 送信日時: ${submittedAt.toLocaleString('ja-JP')}`,
    '',
    '*このコメントはDiscordの `/feed` コマンドから自動投稿されました。*',
  ].join('\n');

  return { body };
}
