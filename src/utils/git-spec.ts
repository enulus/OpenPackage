import { ValidationError } from './errors.js';

export interface GitSpec {
  url: string;
  ref?: string;
  subdirectory?: string;
}

function parseGithubShorthand(raw: string): GitSpec | null {
  if (!raw.startsWith('github:')) return null;
  const remainder = raw.slice('github:'.length);
  
  // Split on '#' to get repo part and ref/options
  const [repoPart, hashPart] = remainder.split('#', 2);
  const [owner, repo] = repoPart.split('/');
  if (!owner || !repo) {
    throw new ValidationError(`Invalid github spec '${raw}'. Expected github:owner/repo[#ref][&subdirectory=path]`);
  }
  
  const url = `https://github.com/${owner}/${repo}.git`;
  const result: GitSpec = { url };
  
  // Parse hash part for ref and subdirectory
  if (hashPart) {
    const { ref, subdirectory } = parseHashPart(hashPart);
    if (ref) result.ref = ref;
    if (subdirectory) result.subdirectory = subdirectory;
  }
  
  return result;
}

function parseGitUrl(raw: string): GitSpec | null {
  if (!raw.startsWith('git:')) return null;
  const remainder = raw.slice('git:'.length);
  const [url, hashPart] = remainder.split('#', 2);
  if (!url) {
    throw new ValidationError(`Invalid git spec '${raw}'. Expected git:<url>[#ref][&subdirectory=path]`);
  }
  
  const result: GitSpec = { url };
  
  // Parse hash part for ref and subdirectory
  if (hashPart) {
    const { ref, subdirectory } = parseHashPart(hashPart);
    if (ref) result.ref = ref;
    if (subdirectory) result.subdirectory = subdirectory;
  }
  
  return result;
}

/**
 * Parse the hash part of a git spec to extract ref and subdirectory.
 * 
 * Supported formats:
 * - #ref
 * - #subdirectory=path
 * - #ref&subdirectory=path
 * 
 * Examples:
 * - #main -> { ref: 'main' }
 * - #subdirectory=plugins/my-plugin -> { subdirectory: 'plugins/my-plugin' }
 * - #v1.0.0&subdirectory=plugins/my-plugin -> { ref: 'v1.0.0', subdirectory: 'plugins/my-plugin' }
 */
function parseHashPart(hashPart: string): { ref?: string; subdirectory?: string } {
  const result: { ref?: string; subdirectory?: string } = {};
  
  // Split on '&' to get ref and options
  const parts = hashPart.split('&');
  
  for (const part of parts) {
    if (part.includes('=')) {
      // It's a key=value option
      const [key, value] = part.split('=', 2);
      if (key === 'subdirectory') {
        result.subdirectory = value;
      } else {
        throw new ValidationError(`Unknown git spec option: ${key}. Supported: subdirectory`);
      }
    } else {
      // It's the ref (branch/tag/sha)
      if (result.ref) {
        throw new ValidationError(`Multiple refs specified in git spec: ${hashPart}`);
      }
      result.ref = part;
    }
  }
  
  return result;
}

/**
 * Parse git/github specs:
 * - github:owner/repo[#ref][&subdirectory=path] -> https://github.com/owner/repo.git
 * - git:<url>[#ref][&subdirectory=path] -> uses provided url
 * 
 * Examples:
 * - github:anthropics/claude-code
 * - github:anthropics/claude-code#main
 * - github:anthropics/claude-code#subdirectory=plugins/commit-commands
 * - github:anthropics/claude-code#main&subdirectory=plugins/commit-commands
 * - git:https://github.com/user/repo.git#v1.0.0&subdirectory=packages/plugin-a
 */
export function parseGitSpec(raw: string): GitSpec | null {
  return parseGithubShorthand(raw) ?? parseGitUrl(raw);
}
