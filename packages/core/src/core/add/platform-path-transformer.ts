import { join, resolve } from 'path';

import { getPlatformDefinition, deriveRootDirFromFlows } from '../platforms.js';
import { mapPlatformFileToUniversal } from '../../utils/platform-mapper.js';
import { suffixFileBasename, suffixFirstContentDir } from '../../utils/platform-specific-paths.js';
import { isWithinDirectory } from '../../utils/path-normalization.js';
import { isPlatformRootFile } from '../../utils/platform-utils.js';
import type { SourceEntry } from './source-collector.js';

export interface PlatformPathTransformOptions {
  inputIsDirectory: boolean;
  inputIsFile: boolean;
}

export function applyPlatformSpecificPaths(
  cwd: string,
  entries: SourceEntry[],
  resolvedInputPath: string,
  options: PlatformPathTransformOptions
): SourceEntry[] {
  const normalizedInput = resolve(resolvedInputPath);

  for (const entry of entries) {
    const { registryPath, sourcePath } = entry;

    const fileName = registryPath.split('/').pop();
    if (fileName && isPlatformRootFile(fileName)) {
      continue;
    }

    const mapping = mapPlatformFileToUniversal(sourcePath, cwd);
    if (!mapping) {
      continue;
    }

    const definition = getPlatformDefinition(mapping.platform);
    
    // TODO: Update to use flows-based path resolution
    // For now, use the mapping.subdir as the path directly
    const subdirPath = mapping.subdir;
    if (!subdirPath) {
      continue;
    }

    const rootDir = deriveRootDirFromFlows(definition);
    const subdirAbs = resolve(join(cwd, rootDir, subdirPath));
    const sourceAbs = resolve(sourcePath);
    const withinSubdir = sourceAbs === subdirAbs || isWithinDirectory(subdirAbs, sourceAbs);
    if (!withinSubdir) {
      continue;
    }

    if (options.inputIsFile && sourceAbs === normalizedInput) {
      entry.registryPath = suffixFileBasename(registryPath, mapping.platform);
      continue;
    }

    if (!options.inputIsDirectory) {
      continue;
    }

    if (normalizedInput === subdirAbs) {
      entry.registryPath = suffixFileBasename(registryPath, mapping.platform);
      continue;
    }

    if (isWithinDirectory(normalizedInput, sourceAbs)) {
      entry.registryPath = suffixFirstContentDir(registryPath, mapping.platform);
    }
  }

  return entries;
}

