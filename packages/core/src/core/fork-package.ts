import { join, dirname } from 'path';
import * as yaml from 'js-yaml';
import { classifyInputBase } from './install/input-classifier-base.js';
import { loadPackageFromPath } from './install/path-package-loader.js';
import { loadPackageFromGit } from './install/git-package-loader.js';
import { writeTextFile, ensureDir } from '../utils/fs.js';
import { writePackageYml } from '../utils/package-yml.js';
import type { PackageYml } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface ForkPackageOptions {
  /** The --from value (package name, gh@owner/repo, path) */
  source: string;
  /** Target directory where files should be written */
  targetDir: string;
  /** The new package name */
  newPackageName: string;
  /** Current working directory for resolving relative paths */
  cwd: string;
}

export interface ForkPackageResult {
  filesCopied: number;
  sourcePackageName: string;
}

/**
 * Fork a package from a source, copying all files to the target directory.
 * The source manifest is copied with full metadata (description, version,
 * keywords, dependencies, etc.) but with the name field updated to the
 * new package name. This overwrites the minimal manifest created by createPackage.
 */
export async function forkPackageFromSource(options: ForkPackageOptions): Promise<ForkPackageResult> {
  const { source, targetDir, newPackageName, cwd } = options;

  // Classify the source input
  const classification = await classifyInputBase(source, cwd);

  let pkg: { metadata: { name: string }; files: { path: string; content: string }[] };

  switch (classification.type) {
    case 'git': {
      const result = await loadPackageFromGit({
        url: classification.gitUrl,
        ref: classification.gitRef,
        path: classification.gitPath,
      });
      if (!result.pkg) {
        throw new Error(
          `Could not load package from git source "${source}". ` +
          `The repository may be a marketplace that requires plugin selection.`
        );
      }
      pkg = result.pkg;
      break;
    }
    case 'local-path': {
      pkg = await loadPackageFromPath(classification.absolutePath);
      break;
    }
    case 'registry': {
      throw new Error(
        `Registry packages cannot be forked directly. Install the package first, then fork from its local path.\n` +
        `  opkg install ${source}\n` +
        `  opkg new ${newPackageName} --from .openpackage/packages/${classification.packageName}`
      );
    }
    default:
      throw new Error(`Unsupported source type for --from: "${source}"`);
  }

  const sourcePackageName = pkg.metadata?.name || 'unknown';
  let filesCopied = 0;

  // Copy all non-manifest files
  for (const file of pkg.files) {
    if (file.path === 'openpackage.yml') {
      continue; // root manifest handled separately below
    }

    const targetPath = join(targetDir, file.path);
    await ensureDir(dirname(targetPath));
    await writeTextFile(targetPath, file.content);
    filesCopied++;
  }

  // Copy source manifest with name updated to new package name.
  // This overwrites the minimal manifest created by createPackage(),
  // preserving description, version, keywords, dependencies, etc.
  const manifestFile = pkg.files.find(f => f.path === 'openpackage.yml');
  if (manifestFile) {
    const sourceManifest = yaml.load(manifestFile.content) as PackageYml;
    sourceManifest.name = newPackageName;
    await writePackageYml(join(targetDir, 'openpackage.yml'), sourceManifest);
  }

  logger.info('Forked package files', {
    source,
    sourcePackageName,
    targetDir,
    filesCopied
  });

  return { filesCopied, sourcePackageName };
}
