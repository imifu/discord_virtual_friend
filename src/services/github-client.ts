import { GithubApiError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('github-client');

const GITHUB_API_VERSION = '2022-11-28';
const USER_AGENT = 'discord-virtual-friend-bot';

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

interface GithubIssueResponse {
  html_url: string;
  number: number;
  labels: Array<{ name: string } | string>;
}

/**
 * Creates a new issue via the GitHub REST API. Native fetch - no new dependency.
 *
 * Whether GitHub auto-creates a label that doesn't yet exist in the repo when it's passed here
 * is not something this code relies on either way: after creation, the response's actual labels
 * are compared against what was requested, and any that didn't attach are logged as a warning
 * (issue creation itself still succeeds - a missing label is a data-quality issue, not a reason
 * to fail the user's /feed submission).
 */
export async function createGithubIssue(
  config: GithubRepoConfig,
  content: CreateIssueContent,
): Promise<CreatedIssue> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/issues`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({ title: content.title, body: content.body, labels: content.labels }),
    });
  } catch (err) {
    throw new GithubApiError(`network error calling ${url}`, err);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '(no body)');
    throw new GithubApiError(`${response.status} ${response.statusText} from ${url}: ${detail}`);
  }

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
