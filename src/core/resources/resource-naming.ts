import { basename } from 'path';

export function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '') || filename;
}

export function defaultNameFromPath(filePath: string): string {
  return stripExtension(basename(filePath));
}

export function defaultNameFromSkillDir(dirPath: string): string {
  return basename(dirPath);
}

export function preferFrontmatterName(
  frontmatterName: string | undefined,
  fallbackName: string
): string {
  return frontmatterName && frontmatterName.trim().length > 0
    ? frontmatterName
    : fallbackName;
}

/**
 * Derive a display name from an untracked file's workspace path.
 * For SKILL.md files nested in a directory, uses the parent directory name.
 * Otherwise uses the filename without extension.
 */
export function deriveUntrackedResourceName(workspacePath: string): string {
  const parts = workspacePath.split('/');
  const fileName = parts[parts.length - 1];
  if (fileName === 'SKILL.md' && parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return stripExtension(fileName);
}
