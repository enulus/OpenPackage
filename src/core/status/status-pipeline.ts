import path from 'path';

import type { CommandResult } from '../../types/index.js';
import { ValidationError } from '../../utils/errors.js';
import { getLocalOpenPackageDir, getLocalPackageYmlPath } from '../../utils/paths.js';
import { readWorkspaceIndex } from '../../utils/workspace-index-yml.js';
import { resolveDeclaredPath } from '../../utils/path-resolution.js';
import { calculateFileHash } from '../../utils/hash-utils.js';
import { exists, readTextFile, walkFiles } from '../../utils/fs.js';
import { isDirKey } from '../../utils/package-index-yml.js';
import type { WorkspaceIndexPackage } from '../../types/workspace-index.js';
import { logger } from '../../utils/logger.js';

export type PackageSyncState = 'synced' | 'modified' | 'missing';

export interface StatusFileDiff {
  sourcePath: string;
  workspacePath: string;
  reason: 'missing' | 'hash-mismatch';
}

export interface StatusPackageReport {
  name: string;
  version?: string;
  path: string;
  state: PackageSyncState;
  diffs: StatusFileDiff[];
}

export interface StatusPipelineResult {
  packages: StatusPackageReport[];
}

async function collectDirFiles(absDir: string, prefix: string): Promise<string[]> {
  const files: string[] = [];
  if (!(await exists(absDir))) return files;
  for await (const filePath of walkFiles(absDir)) {
    // Use path.relative instead of substring math so trailing slashes don't
    // corrupt the first character of filenames.
    const rel = path.relative(absDir, filePath).replace(/\\/g, '/');
    files.push(path.posix.join(prefix, rel));
  }
  return files;
}

async function hashOrNull(absPath: string): Promise<string | null> {
  if (!(await exists(absPath))) return null;
  const content = await readTextFile(absPath);
  return await calculateFileHash(content);
}

async function comparePackage(
  cwd: string,
  pkgName: string,
  entry: WorkspaceIndexPackage
): Promise<StatusPackageReport> {
  const openpkgDir = getLocalOpenPackageDir(cwd);
  const resolved = resolveDeclaredPath(entry.path, openpkgDir);
  const sourceRoot = resolved.absolute;

  if (!(await exists(sourceRoot))) {
    return {
      name: pkgName,
      version: entry.version,
      path: entry.path,
      state: 'missing',
      diffs: [
        {
          sourcePath: sourceRoot,
          workspacePath: '',
          reason: 'missing'
        }
      ]
    };
  }

  const diffs: StatusFileDiff[] = [];
  const filesMapping = entry.files || {};

  for (const [rawKey, targets] of Object.entries(filesMapping)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const isDir = isDirKey(rawKey);
    if (isDir) {
      const sourceDir = path.join(sourceRoot, rawKey);
      const sourceFiles = await collectDirFiles(sourceDir, rawKey.replace(/\/$/, ''));
      for (const rel of sourceFiles) {
        for (const targetDir of targets) {
          const workspacePath = path.join(cwd, targetDir, rel.slice(rawKey.length));
          const sourcePath = path.join(sourceRoot, rel);
          const [sourceHash, workspaceHash] = await Promise.all([
            hashOrNull(sourcePath),
            hashOrNull(workspacePath)
          ]);
          if (!workspaceHash) {
            diffs.push({ sourcePath, workspacePath, reason: 'missing' });
            continue;
          }
          if (!sourceHash || sourceHash !== workspaceHash) {
            diffs.push({ sourcePath, workspacePath, reason: 'hash-mismatch' });
          }
        }
      }
    } else {
      const sourcePath = path.join(sourceRoot, rawKey);
      for (const targetPath of targets) {
        const workspacePath = path.join(cwd, targetPath);
        const [sourceHash, workspaceHash] = await Promise.all([
          hashOrNull(sourcePath),
          hashOrNull(workspacePath)
        ]);
        if (!workspaceHash) {
          diffs.push({ sourcePath, workspacePath, reason: 'missing' });
          continue;
        }
        if (!sourceHash || sourceHash !== workspaceHash) {
          diffs.push({ sourcePath, workspacePath, reason: 'hash-mismatch' });
        }
      }
    }
  }

  const state: PackageSyncState = diffs.length === 0 ? 'synced' : 'modified';

  return {
    name: pkgName,
    version: entry.version,
    path: entry.path,
    state,
    diffs
  };
}

export async function runStatusPipeline(): Promise<CommandResult<StatusPipelineResult>> {
  const cwd = process.cwd();
  const openpkgDir = getLocalOpenPackageDir(cwd);
  const manifestPath = getLocalPackageYmlPath(cwd);

  if (!(await exists(openpkgDir)) || !(await exists(manifestPath))) {
    throw new ValidationError(
      `No .openpackage/openpackage.yml found in ${cwd}. Run 'opkg init' first.`
    );
  }

  const { index } = await readWorkspaceIndex(cwd);
  const packages = index.packages || {};
  const reports: StatusPackageReport[] = [];

  for (const [pkgName, pkgEntry] of Object.entries(packages)) {
    try {
      const report = await comparePackage(cwd, pkgName, pkgEntry);
      reports.push(report);
    } catch (error) {
      logger.warn(`Failed to compute status for ${pkgName}: ${error}`);
      reports.push({
        name: pkgName,
        version: pkgEntry?.version,
        path: pkgEntry?.path ?? '',
        state: 'missing',
        diffs: []
      });
    }
  }

  return {
    success: true,
    data: { packages: reports }
  };
}
