import path from 'path';
import { getRegistryDirectories } from '../core/directory.js';

export function isRegistryPath(absPath: string): boolean {
  const registryRoot = getRegistryDirectories().packages;
  const resolvedRegistry = path.resolve(registryRoot);
  const resolvedTarget = path.resolve(absPath);

  const relativePath = path.relative(resolvedRegistry, resolvedTarget);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function assertMutableSourceOrThrow(
  absPath: string,
  ctx: { packageName: string; command: string }
): void {
  if (isRegistryPath(absPath)) {
    throw new Error(
      `Package ${ctx.packageName} cannot run '${ctx.command}' because its source path is immutable (registry snapshot): ${absPath}`
    );
  }
}
