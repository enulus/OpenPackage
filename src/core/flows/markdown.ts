import yaml from 'js-yaml';

export type MarkdownDocument = {
  frontmatter?: any;
  body: string;
};

/**
 * Parse markdown with optional YAML frontmatter.
 *
 * Notes:
 * - When frontmatter is present but invalid YAML:
 *   - lenient=false (default): throws
 *   - lenient=true: returns { body: originalContent } (treat as plain markdown)
 */
export function parseMarkdownDocument(
  content: string,
  options?: { lenient?: boolean }
): MarkdownDocument {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { body: content };
  }

  const [, frontmatterRaw, body] = match;

  try {
    const frontmatter = (yaml.load(frontmatterRaw) ?? {}) as any;
    return { frontmatter, body };
  } catch (error) {
    if (options?.lenient) {
      return { body: content };
    }
    throw error;
  }
}

/**
 * Serialize markdown content (optionally with YAML frontmatter).
 *
 * Uses consistent YAML dump settings (flowLevel=1 for compact arrays).
 */
export function serializeMarkdownDocument(content: any): string {
  if (typeof content === 'string') {
    return content;
  }

  const body = typeof content?.body === 'string' ? content.body : '';
  const hasFrontmatter = content && typeof content === 'object' && 'frontmatter' in content && content.frontmatter;

  if (!hasFrontmatter) {
    return body;
  }

  const frontmatterYaml = yaml.dump(content.frontmatter, {
    indent: 2,
    flowLevel: -1,
    lineWidth: -1,
    noRefs: true,
  });

  // Normalize with a blank line between frontmatter and body (common markdown convention).
  return `---\n${frontmatterYaml}---\n\n${body}`;
}

