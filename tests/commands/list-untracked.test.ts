/**
 * Integration tests for untracked file detection in opkg list
 *
 * After the removal of --tracked/--untracked flags, untracked scanning
 * is always performed as part of the regular list pipeline. These tests
 * verify that untracked files are properly detected and included.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runListPipeline } from '../../packages/core/src/core/list/list-pipeline.js';
import { writeWorkspaceIndex } from '../../packages/core/src/utils/workspace-index-yml.js';
import { getWorkspaceIndexPath } from '../../packages/core/src/utils/workspace-index-yml.js';
import type { WorkspaceIndex } from '../../packages/core/src/types/workspace-index.js';
import type { ExecutionContext } from '../../packages/core/src/types/index.js';

async function createTestWorkspace(dir: string, index: WorkspaceIndex): Promise<void> {
  const indexPath = getWorkspaceIndexPath(dir);
  await fs.mkdir(join(dir, '.openpackage'), { recursive: true });
  await writeWorkspaceIndex({ path: indexPath, index });
  await fs.writeFile(
    join(dir, '.openpackage', 'openpackage.yml'),
    'name: test-workspace\nversion: 0.0.0\n'
  );
}

function makeExecContext(testDir: string, isGlobal = false): ExecutionContext {
  return {
    sourceCwd: testDir,
    targetDir: testDir,
    isGlobal,
  } as ExecutionContext;
}

describe('list untracked integration', () => {
  it('returns untracked files when workspace has untracked content', async () => {
    const testDir = join(tmpdir(), `opkg-test-list-untracked-${Date.now()}-2`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'untracked.md'), 'Untracked content');

      await createTestWorkspace(testDir, { packages: {} });

      const result = await runListPipeline(undefined, makeExecContext(testDir), {});

      assert.ok(result.success, 'Should succeed');
      assert.ok(result.data?.untrackedFiles, 'Should have untrackedFiles');
      assert.ok(result.data!.untrackedFiles!.totalFiles > 0, 'Should have files');

      const hasUntrackedFile = result.data!.untrackedFiles!.files.some(
        f => f.workspacePath.includes('untracked.md')
      );
      assert.ok(hasUntrackedFile, 'Should include untracked.md');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('works with global scope (home directory)', async () => {
    const testDir = join(tmpdir(), `opkg-test-list-untracked-${Date.now()}-3`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'global-rule.md'), 'Global rule');

      await createTestWorkspace(testDir, { packages: {} });

      const result = await runListPipeline(undefined, makeExecContext(testDir, true), {});

      assert.ok(result.success, 'Should succeed');
      assert.ok(result.data?.untrackedFiles, 'Should have untrackedFiles');
      assert.ok(result.data!.untrackedFiles!.totalFiles > 0, 'Should have files');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('distinguishes between tracked and untracked files', async () => {
    const testDir = join(tmpdir(), `opkg-test-list-untracked-${Date.now()}-4`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'tracked.md'), 'Tracked');
      await fs.writeFile(join(testDir, '.claude', 'rules', 'untracked.md'), 'Untracked');

      await createTestWorkspace(testDir, {
        packages: {
          'test-package': {
            path: './packages/test',
            files: {
              'rules/tracked.md': ['.claude/rules/tracked.md']
            }
          }
        }
      });

      const result = await runListPipeline(undefined, makeExecContext(testDir), {});

      assert.ok(result.success);
      const untrackedFiles = result.data!.untrackedFiles!;

      assert.equal(untrackedFiles.totalFiles, 1, 'Should only show untracked file');
      assert.ok(untrackedFiles.files[0].workspacePath.includes('untracked.md'));

      const hasExactTrackedFile = untrackedFiles.files.some(f => f.workspacePath === '.claude/rules/tracked.md');
      assert.ok(!hasExactTrackedFile, 'Should not include tracked file');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('handles multiple platforms with different file types', async () => {
    const testDir = join(tmpdir(), `opkg-test-list-untracked-${Date.now()}-5`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'claude.md'), 'Claude rule');

      await fs.mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.cursor', 'rules', 'cursor.mdc'), 'Cursor rule');

      await createTestWorkspace(testDir, { packages: {} });

      const result = await runListPipeline(undefined, makeExecContext(testDir), {});

      assert.ok(result.success);
      const untrackedFiles = result.data!.untrackedFiles!;

      assert.equal(untrackedFiles.totalFiles, 2, 'Should detect both files');
      assert.ok(untrackedFiles.platformGroups.has('claude'), 'Should have Claude');
      assert.ok(untrackedFiles.platformGroups.has('cursor'), 'Should have Cursor');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('handles empty workspace with no untracked files', async () => {
    const testDir = join(tmpdir(), `opkg-test-list-untracked-${Date.now()}-6`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await fs.mkdir(join(testDir, '.claude'), { recursive: true });
      await createTestWorkspace(testDir, { packages: {} });

      const result = await runListPipeline(undefined, makeExecContext(testDir), {});

      assert.ok(result.success);
      assert.equal(result.data?.untrackedFiles?.totalFiles, 0);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('includes untracked count in regular list results', async () => {
    const testDir = join(tmpdir(), `opkg-test-list-untracked-${Date.now()}-7`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'test.md'), 'Test');
      await createTestWorkspace(testDir, { packages: {} });

      const result = await runListPipeline(undefined, makeExecContext(testDir), {});

      assert.ok(result.success);
      assert.ok(result.data?.untrackedFiles, 'Should have untrackedFiles in regular list');
      assert.ok(result.data!.untrackedCount > 0, 'Should have untrackedCount > 0');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });
});
