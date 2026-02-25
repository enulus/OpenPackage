/**
 * Index Write Collector
 *
 * Collects workspace index mutations during parallel package installations
 * and flushes them in a single atomic read-modify-write cycle.
 *
 * During parallel installs within a wave, each package records its index
 * updates to the collector instead of writing to disk immediately. After
 * all packages in the wave complete, `flush()` applies all mutations at once.
 *
 * This eliminates read-modify-write race conditions on openpackage.index.yml.
 */

import type { WorkspaceIndexFileMapping, WorkspaceIndexPackage } from '../../../types/workspace-index.js';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../../utils/workspace-index-yml.js';
import { sortMapping } from '../../../utils/package-index-yml.js';
import { formatPathForYaml } from '../../../utils/path-resolution.js';
import { getTargetPath } from '../../../utils/workspace-index-helpers.js';
import { normalizePathForProcessing } from '../../../utils/path-normalization.js';
import { logger } from '../../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * A complete package entry update (replaces or creates the package in the index).
 */
export interface PackageEntryUpdate {
  type: 'upsert';
  packageName: string;
  path: string;
  version?: string;
  files: Record<string, (string | WorkspaceIndexFileMapping)[]>;
  dependencies?: string[];
  marketplace?: { url: string; commitSha: string; pluginName: string };
}

/**
 * An additive file augmentation (merges file entries into an existing package).
 * Used by the root-file augmentation in installation-executor.ts.
 */
export interface FileAugmentation {
  type: 'augment-files';
  packageName: string;
  files: Record<string, (string | WorkspaceIndexFileMapping)[]>;
}

/**
 * A file mapping rename within a package's index entry.
 * Used by executeNamespace() when physically relocating another package's file.
 */
export interface FileMappingRename {
  type: 'rename';
  packageName: string;
  /** The index key (source) that contains the mapping */
  indexKey: string;
  /** The old target path */
  oldTargetPath: string;
  /** The new target path (after rename) */
  newTargetPath: string;
  /** Full package entry snapshot (for path/version recovery if entry is missing) */
  entrySnapshot?: {
    path: string;
    version?: string;
    files: Record<string, (string | WorkspaceIndexFileMapping)[]>;
  };
}

/**
 * A dependency-graph update for a package.
 * Used by index-updater.ts after wave resolution.
 */
export interface DependencyUpdate {
  type: 'dependency-update';
  packageName: string;
  version?: string;
  contentRoot?: string;
  dependencies?: string[];
}

export type IndexMutation =
  | PackageEntryUpdate
  | FileAugmentation
  | FileMappingRename
  | DependencyUpdate;

// ============================================================================
// Collector
// ============================================================================

export class IndexWriteCollector {
  private mutations: IndexMutation[] = [];

  /**
   * Record a full package entry upsert (creates or replaces the entry).
   */
  recordPackageUpdate(update: Omit<PackageEntryUpdate, 'type'>): void {
    this.mutations.push({ type: 'upsert', ...update });
  }

  /**
   * Record additive file entries for an existing package (root files, etc.).
   */
  recordFileAugmentation(augmentation: Omit<FileAugmentation, 'type'>): void {
    this.mutations.push({ type: 'augment-files', ...augmentation });
  }

  /**
   * Record a file mapping rename (namespace relocation).
   */
  recordFileMappingRename(rename: Omit<FileMappingRename, 'type'>): void {
    this.mutations.push({ type: 'rename', ...rename });
  }

  /**
   * Record a dependency graph update for a package.
   */
  recordDependencyUpdate(update: Omit<DependencyUpdate, 'type'>): void {
    this.mutations.push({ type: 'dependency-update', ...update });
  }

  /**
   * Returns true if any mutations have been recorded.
   */
  get hasMutations(): boolean {
    return this.mutations.length > 0;
  }

  /**
   * Apply all collected mutations to the workspace index in a single
   * read-modify-write cycle, then clear the mutation buffer.
   *
   * @param targetDir - Workspace directory containing the index file
   */
  async flush(targetDir: string): Promise<void> {
    if (this.mutations.length === 0) return;

    let record;
    try {
      record = await readWorkspaceIndex(targetDir);
    } catch {
      logger.warn('IndexWriteCollector: could not read workspace index; skipping flush');
      this.mutations = [];
      return;
    }

    const index = record.index;
    index.packages = index.packages ?? {};

    for (const mutation of this.mutations) {
      try {
        applyMutation(index, mutation, targetDir);
      } catch (error) {
        logger.warn(`IndexWriteCollector: failed to apply mutation (${mutation.type}): ${error}`);
      }
    }

    try {
      await writeWorkspaceIndex(record);
      logger.debug(`IndexWriteCollector: flushed ${this.mutations.length} mutations`);
    } catch (error) {
      logger.warn(`IndexWriteCollector: failed to write workspace index: ${error}`);
    }

    this.mutations = [];
  }
}

// ============================================================================
// Mutation application
// ============================================================================

function applyMutation(
  index: { packages: Record<string, WorkspaceIndexPackage> },
  mutation: IndexMutation,
  targetDir: string
): void {
  switch (mutation.type) {
    case 'upsert': {
      const formattedPath = formatPathForYaml(mutation.path, targetDir);
      const entry: WorkspaceIndexPackage = {
        ...(index.packages[mutation.packageName] ?? {} as any),
        path: formattedPath,
        files: sortMapping(mutation.files),
      };
      if (mutation.version) entry.version = mutation.version;
      if (mutation.dependencies && mutation.dependencies.length > 0) {
        entry.dependencies = mutation.dependencies;
      }
      if (mutation.marketplace) entry.marketplace = mutation.marketplace;
      index.packages[mutation.packageName] = entry;
      break;
    }

    case 'augment-files': {
      const existing = index.packages[mutation.packageName];
      if (!existing) break;
      const files = { ...(existing.files ?? {}) };
      for (const [key, values] of Object.entries(mutation.files)) {
        const current = files[key] ?? [];
        // Deduplicate by target path
        const byTarget = new Map<string, string | WorkspaceIndexFileMapping>();
        for (const m of current) {
          byTarget.set(getTargetPath(m), m);
        }
        for (const m of values) {
          const tp = getTargetPath(m);
          if (!byTarget.has(tp)) {
            byTarget.set(tp, m);
          }
        }
        files[key] = Array.from(byTarget.values());
      }
      existing.files = files;
      break;
    }

    case 'rename': {
      const entry = index.packages[mutation.packageName];
      if (!entry) {
        // Entry might not exist yet if the collector is used during a fresh install.
        // Use the snapshot to create it.
        if (mutation.entrySnapshot) {
          const formattedPath = formatPathForYaml(mutation.entrySnapshot.path, targetDir);
          index.packages[mutation.packageName] = {
            path: formattedPath,
            version: mutation.entrySnapshot.version,
            files: sortMapping(mutation.entrySnapshot.files),
          };
        }
        break;
      }

      const normalizedOld = normalizePathForProcessing(mutation.oldTargetPath);
      const normalizedNew = normalizePathForProcessing(mutation.newTargetPath);
      const values = entry.files[mutation.indexKey];
      if (!values) break;

      const idx = values.findIndex(mapping => {
        const target = getTargetPath(mapping);
        return normalizePathForProcessing(target) === normalizedOld;
      });
      if (idx === -1) break;

      const oldMapping = values[idx];
      values[idx] = typeof oldMapping === 'string'
        ? normalizedNew
        : { ...oldMapping, target: normalizedNew };
      break;
    }

    case 'dependency-update': {
      const existing = index.packages[mutation.packageName];
      if (existing) {
        if (mutation.version) existing.version = mutation.version;
        if (mutation.dependencies && mutation.dependencies.length > 0) {
          existing.dependencies = mutation.dependencies;
        }
      } else if (mutation.contentRoot) {
        const formattedPath = formatPathForYaml(mutation.contentRoot, targetDir);
        index.packages[mutation.packageName] = {
          path: formattedPath,
          version: mutation.version,
          dependencies: mutation.dependencies && mutation.dependencies.length > 0
            ? mutation.dependencies : undefined,
          files: {},
        };
      }
      break;
    }
  }
}
