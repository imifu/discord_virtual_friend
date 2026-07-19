import { GithubApiError } from '../utils/errors.js';

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
}

/** Creates a new issue via the GitHub REST API. Native fetch - no new dependency. */
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
  return { url: json.html_url, number: json.number };
}
