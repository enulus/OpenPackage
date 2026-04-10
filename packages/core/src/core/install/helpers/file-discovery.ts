import { packageManager } from '../../package.js';
import { FILE_PATTERNS, PACKAGE_PATHS } from '../../../constants/index.js';
import type { PackageFile } from '../../../types/index.js';
import type { Platform } from '../../platforms.js';
import { isManifestPath, normalizePackagePath } from '../../../utils/manifest-paths.js';
import { getPlatformRootFileNames } from '../../platform/platform-root-files.js';
import { join } from 'path';
import { exists } from '../../../utils/fs.js';
import { hasPluginContent } from '../plugin-detector.js';
import { matchPackagePath } from '../../../utils/match-path.js';

export interface CategorizedInstallFiles {
  pathBasedFiles: PackageFile[];
  rootFiles: Map<string, string>;
}

export async function discoverAndCategorizeFiles(
  packageName: string,
  version: string,
  platforms: Platform[],
  contentRoot?: string,
  matchedPattern?: string  // Phase 4: Pattern for filtering
): Promise<CategorizedInstallFiles> {
  // Root file discovery only works for OpenPackage dirs or Claude plugins.
  // Also treat directories with plugin content (commands/agents/skills/hooks or .mcp.json/.lsp.json)
  // as loadable so marketplace-defined plugins without plugin.json can install.
  if (contentRoot) {
    const hasOpenPackageYml = await exists(join(contentRoot, 'openpackage.yml'));
    const hasClaudePluginJson = await exists(join(contentRoot, '.claude-plugin', 'plugin.json'));
    const hasClaudeMarketplaceJson = await exists(join(contentRoot, '.claude-plugin', 'marketplace.json'));
    const hasPluginContentDirs = await hasPluginContent(contentRoot);
    const isLoadableRoot =
      hasOpenPackageYml || hasClaudePluginJson || hasClaudeMarketplaceJson || hasPluginContentDirs;

    if (!isLoadableRoot) {
      return { pathBasedFiles: [], rootFiles: new Map() };
    }
  }

  // Load once
  const pkg = await packageManager.loadPackage(packageName, version, {
    packageRootDir: contentRoot
  });

  // Phase 4: Build include filter that considers matchedPattern
  const shouldInclude = (path: string): boolean => {
    // Check matched pattern (from base detection or resource scoping)
    if (matchedPattern && !matchPackagePath(path, matchedPattern)) {
      return false;
    }
    
    return true;
  };

  // Precompute platform root filenames
  const platformRootNames = getPlatformRootFileNames(platforms);

  // Single pass classification
  const pathBasedFiles: PackageFile[] = [];
  const rootFiles = new Map<string, string>();
  for (const file of pkg.files) {
    const p = file.path;
    const normalized = normalizePackagePath(p);
    // Never install registry package metadata files
    if (isManifestPath(p) || normalized === PACKAGE_PATHS.INDEX_RELATIVE) continue;
    if (!shouldInclude(p)) continue;

    pathBasedFiles.push(file);

    if (normalized === FILE_PATTERNS.AGENTS_MD || platformRootNames.has(normalized)) {
      rootFiles.set(normalized, file.content);
    }
  }

  return { pathBasedFiles, rootFiles };
}


