import { ValidationError } from './errors.js';

export interface GitSpec {
  url: string;
  ref?: string;
}

function parseGithubShorthand(raw: string): GitSpec | null {
  if (!raw.startsWith('github:')) return null;
  const remainder = raw.slice('github:'.length);
  const [repoPart, ref] = remainder.split('#', 2);
  const [owner, repo] = repoPart.split('/');
  if (!owner || !repo) {
    throw new ValidationError(`Invalid github spec '${raw}'. Expected github:owner/repo[#ref]`);
  }
  const url = `https://github.com/${owner}/${repo}.git`;
  return { url, ref };
}

function parseGitUrl(raw: string): GitSpec | null {
  if (!raw.startsWith('git:')) return null;
  const remainder = raw.slice('git:'.length);
  const [url, ref] = remainder.split('#', 2);
  if (!url) {
    throw new ValidationError(`Invalid git spec '${raw}'. Expected git:<url>[#ref]`);
  }
  return { url, ref };
}

/**
 * Parse git/github specs:
 * - github:owner/repo[#ref] -> https://github.com/owner/repo.git
 * - git:<url>[#ref] -> uses provided url
 */
export function parseGitSpec(raw: string): GitSpec | null {
  return parseGithubShorthand(raw) ?? parseGitUrl(raw);
}
