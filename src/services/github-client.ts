import { GithubApiError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('github-client');

const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'discord-virtual-friend-bot';
/** Bounds listOpenIssues to at most this many pages (100/page), so a repository with an unusually
 *  large number of open issues can't make every /feed call scan an unbounded amount of history. */
const MAX_ISSUE_LIST_PAGES = 3;

export interface GithubRepoConfig {
  token: string;
  owner: string;
  repo: string;
}

export interface CreateIssueContent {
  title: string;
  body: string;
  labels: string[];
}

export interface CreatedIssue {
  url: string;
  number: number;
}

export interface CreatedComment {
  url: string;
}

/** A GitHub issue as summarized for similarity matching (src/services/feedback-similarity.ts). */
export interface OpenIssueSummary {
  number: number;
  title: string;
  body: string;
  url: string;
  /** ISO 8601 updated_at - used as the embedding cache's invalidation key. */
  updatedAt: string;
}

interface GithubIssueResponse {
  html_url: string;
  number: number;
  labels: Array<{ name: string } | string>;
}

interface GithubIssueListItem {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  updated_at: string;
  /** Present (non-null) only for pull requests - GitHub's issues list endpoint returns both. */
  pull_request?: unknown;
}

interface GithubCommentResponse {
  html_url: string;
}

function authHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': USER_AGENT,
    ...extra,
  };
}

async function githubFetch(url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    throw new GithubApiError(`network error calling ${url}`, err);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '(no body)');
    throw new GithubApiError(`${response.status} ${response.statusText} from ${url}: ${detail}`);
  }

  return response;
}

/**
 * Creates a new issue via the GitHub REST API. Native fetch - no new dependency.
 *
 * Whether GitHub auto-creates a label that doesn't yet exist in the repo when it's passed here
 * is not something this code relies on either way: after creation, the response's actual labels
 * are compared against what was requested, and any that didn't attach are logged as a warning
 * (issue creation itself still succeeds - a missing label is a data-quality issue, not a reason
 * to fail the user's /feed submission). Tracked separately: Issue #12.
 */
export async function createGithubIssue(
  config: GithubRepoConfig,
  content: CreateIssueContent,
): Promise<CreatedIssue> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues`;

  const response = await githubFetch(url, {
    method: 'POST',
    headers: authHeaders(config.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title: content.title, body: content.body, labels: content.labels }),
  });

  const json = (await response.json()) as GithubIssueResponse;

  const appliedLabels = new Set(json.labels.map((label) => (typeof label === 'string' ? label : label.name)));
  const missingLabels = content.labels.filter((label) => !appliedLabels.has(label));
  if (missingLabels.length > 0) {
    logger.warn(
      `Issue #${json.number}にラベルが付与されませんでした(リポジトリに存在しない可能性): ${missingLabels.join(', ')}`,
    );
  }

  return { url: json.html_url, number: json.number };
}

/** Adds a comment to an existing issue via the GitHub REST API. */
export async function createIssueComment(
  config: GithubRepoConfig,
  issueNumber: number,
  body: string,
): Promise<CreatedComment> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues/${issueNumber}/comments`;

  const response = await githubFetch(url, {
    method: 'POST',
    headers: authHeaders(config.token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ body }),
  });

  const json = (await response.json()) as GithubCommentResponse;
  return { url: json.html_url };
}

/**
 * Lists open issues (excluding pull requests, which GitHub's issues-list endpoint also returns)
 * for similarity matching. Bounded to MAX_ISSUE_LIST_PAGES*100 most-recently-updated issues - see
 * README "現在の制限事項" for the accepted limitation on very large repositories.
 */
export async function listOpenIssues(config: GithubRepoConfig): Promise<OpenIssueSummary[]> {
  const issues: OpenIssueSummary[] = [];

  for (let page = 1; page <= MAX_ISSUE_LIST_PAGES; page++) {
    const url =
      `https://api.github.com/repos/${config.owner}/${config.repo}/issues` +
      `?state=open&sort=updated&per_page=100&page=${page}`;

    const response = await githubFetch(url, { headers: authHeaders(config.token) });
    const json = (await response.json()) as GithubIssueListItem[];

    for (const item of json) {
      if (item.pull_request) continue;
      issues.push({
        number: item.number,
        title: item.title,
        body: item.body ?? '',
        url: item.html_url,
        updatedAt: item.updated_at,
      });
    }

    if (json.length < 100) break;
  }

  return issues;
}
