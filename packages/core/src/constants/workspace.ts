export const DEFAULT_INSTALL_ROOT = 'ai';

export const PACKAGE_BOUNDARY_DIRS: ReadonlySet<string> = new Set(['packages']);

export const WORKSPACE_DISCOVERY_EXCLUDES = new Set([
  '.openpackage',
  'node_modules',
  '.git',
  '.idea',
  '.vscode',
  'packages'
]);


