import { splitFrontmatter } from '../../utils/markdown-frontmatter.js';

export interface MarkdownResourceMetadata {
  name?: string;
  description?: string;
  version?: string;
}

export function extractMarkdownResourceMetadata(content: string): MarkdownResourceMetadata {
  const { frontmatter } = splitFrontmatter(content);

  if (!frontmatter || typeof frontmatter !== 'object') {
    return {};
  }

  return {
    name: typeof frontmatter.name === 'string' ? frontmatter.name : undefined,
    description: typeof frontmatter.description === 'string' ? frontmatter.description : undefined,
    version: extractVersionFromFrontmatter(frontmatter),
  };
}

function extractVersionFromFrontmatter(frontmatter: any): string | undefined {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return undefined;
  }

  const version = frontmatter.version ?? frontmatter.metadata?.version;

  if (typeof version === 'string') {
    const trimmed = version.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  return undefined;
}
