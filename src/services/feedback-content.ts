import { CATEGORY_INFO, type FeedbackCategory } from './feedback-classifier.js';

const TITLE_BODY_MAX_LENGTH = 80;

export interface FeedbackContentInput {
  text: string;
  category: FeedbackCategory;
  authorName: string;
  guildName: string;
  submittedAt: Date;
}

export interface IssueContent {
  title: string;
  body: string;
  labels: string[];
}

function truncateForTitle(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= TITLE_BODY_MAX_LENGTH) return singleLine;
  return `${singleLine.slice(0, TITLE_BODY_MAX_LENGTH)}…`;
}

/** Builds a new-issue title/body/labels from /feed input. Pure formatting - no I/O. */
export function buildIssueContent(input: FeedbackContentInput): IssueContent {
  const { text, category, authorName, guildName, submittedAt } = input;
  const info = CATEGORY_INFO[category];

  const title = `[${info.label}] ${truncateForTitle(text)}`;

  const body = [
    '## フィードバック内容',
    '',
    text,
    '',
    '---',
    `- 分類: ${info.label}`,
    `- 送信者: ${authorName} (Discordユーザー)`,
    `- サーバー: ${guildName}`,
    `- 送信日時: ${submittedAt.toLocaleString('ja-JP')}`,
    '',
    '*このIssueはDiscordの `/feed` コマンドから自動投稿されました。*',
  ].join('\n');

  return { title, body, labels: [info.githubLabel] };
}
