/**
 * Tests for untracked files scanner
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanUntrackedFiles, extractStaticWalkRoot } from '../../../packages/core/src/core/list/untracked-files-scanner.js';
import { writeWorkspaceIndex } from '../../../packages/core/src/utils/workspace-index-yml.js';
import { getWorkspaceIndexPath } from '../../../packages/core/src/utils/workspace-index-yml.js';
import type { WorkspaceIndex } from '../../../packages/core/src/types/workspace-index.js';

async function createWorkspaceIndex(dir: string, index: WorkspaceIndex): Promise<void> {
  const indexPath = getWorkspaceIndexPath(dir);
  await fs.mkdir(join(dir, '.openpackage'), { recursive: true });
  await writeWorkspaceIndex({ path: indexPath, index });
}

async function createClaudePlatform(dir: string): Promise<void> {
  await fs.mkdir(join(dir, '.claude'), { recursive: true });
  await fs.writeFile(join(dir, '.claude', '.gitkeep'), '');
}

async function createCursorPlatform(dir: string): Promise<void> {
  await fs.mkdir(join(dir, '.cursor'), { recursive: true });
  await fs.writeFile(join(dir, '.cursor', '.gitkeep'), '');
}

describe('scanUntrackedFiles', () => {
  it('returns empty result when no platforms detected', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-1`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createWorkspaceIndex(testDir, { packages: {} });

      const result = await scanUntrackedFiles(testDir);

      assert.equal(result.totalFiles, 0, 'Should have 0 untracked files when no platforms');
      assert.equal(result.files.length, 0);
      assert.equal(result.platformGroups.size, 0);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('detects untracked files in Claude platform', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-2`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createClaudePlatform(testDir);

      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'typescript.md'), 'TS rules');
      await fs.writeFile(join(testDir, '.claude', 'rules', 'react.md'), 'React rules');

      await createWorkspaceIndex(testDir, { packages: {} });

      const result = await scanUntrackedFiles(testDir);

      assert.equal(result.totalFiles, 2, 'Should detect 2 untracked files');
      assert.ok(result.platformGroups.has('claude'), 'Should detect Claude platform');
      assert.equal(result.platformGroups.get('claude')?.length, 2);

      const claudeFiles = result.platformGroups.get('claude')!;
      const hasTypescript = claudeFiles.some(f => f.workspacePath.includes('typescript.md'));
      const hasReact = claudeFiles.some(f => f.workspacePath.includes('react.md'));
      assert.ok(hasTypescript, 'Should include typescript.md');
      assert.ok(hasReact, 'Should include react.md');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('excludes tracked files from results', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-3`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createClaudePlatform(testDir);

      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'tracked.md'), 'Tracked');
      await fs.writeFile(join(testDir, '.claude', 'rules', 'untracked.md'), 'Untracked');

      await createWorkspaceIndex(testDir, {
        packages: {
          'test-package': {
            path: './packages/test',
            files: {
              'rules/tracked.md': ['.claude/rules/tracked.md']
            }
          }
        }
      });

      const result = await scanUntrackedFiles(testDir);

      assert.equal(result.totalFiles, 1, 'Should only show untracked file');
      assert.ok(result.files[0].workspacePath.includes('untracked.md'));

      const hasExactTrackedFile = result.files.some(f => f.workspacePath === '.claude/rules/tracked.md');
      assert.ok(!hasExactTrackedFile, 'Should not include tracked.md file');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('detects files across multiple platforms', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-4`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createClaudePlatform(testDir);
      await createCursorPlatform(testDir);

      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'claude-rule.md'), 'Claude');

      await fs.mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.cursor', 'rules', 'cursor-rule.mdc'), 'Cursor');

      await createWorkspaceIndex(testDir, { packages: {} });

      const result = await scanUntrackedFiles(testDir);

      assert.equal(result.totalFiles, 2, 'Should detect files from both platforms');
      assert.ok(result.platformGroups.has('claude'), 'Should have Claude');
      assert.ok(result.platformGroups.has('cursor'), 'Should have Cursor');
      assert.equal(result.platformGroups.get('claude')?.length, 1);
      assert.equal(result.platformGroups.get('cursor')?.length, 1);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('groups files by category', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-5`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createClaudePlatform(testDir);

      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.mkdir(join(testDir, '.claude', 'commands'), { recursive: true });

      await fs.writeFile(join(testDir, '.claude', 'rules', 'rule1.md'), 'Rule');
      await fs.writeFile(join(testDir, '.claude', 'commands', 'cmd1.md'), 'Command');

      await createWorkspaceIndex(testDir, { packages: {} });

      const result = await scanUntrackedFiles(testDir);

      assert.equal(result.totalFiles, 2);
      assert.ok(result.categoryGroups.has('rules'), 'Should have rules category');
      assert.ok(result.categoryGroups.has('commands'), 'Should have commands category');
      assert.equal(result.categoryGroups.get('rules')?.length, 1);
      assert.equal(result.categoryGroups.get('commands')?.length, 1);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('handles nested directory structures', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-6`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createClaudePlatform(testDir);

      await fs.mkdir(join(testDir, '.claude', 'rules', 'typescript'), { recursive: true });
      await fs.writeFile(
        join(testDir, '.claude', 'rules', 'typescript', 'best-practices.md'),
        'Content'
      );

      await createWorkspaceIndex(testDir, { packages: {} });

      const result = await scanUntrackedFiles(testDir);

      assert.equal(result.totalFiles, 1);
      assert.ok(result.files[0].workspacePath.includes('typescript/best-practices.md'));
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('handles workspace index with complex file mappings', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-7`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createClaudePlatform(testDir);

      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'file1.md'), 'File 1');
      await fs.writeFile(join(testDir, '.claude', 'rules', 'file2.md'), 'File 2');

      await createWorkspaceIndex(testDir, {
        packages: {
          'test-package': {
            path: './packages/test',
            files: {
              'rules/file1.md': [
                {
                  target: '.claude/rules/file1.md',
                  merge: 'deep'
                }
              ]
            }
          }
        }
      });

      const result = await scanUntrackedFiles(testDir);

      assert.equal(result.totalFiles, 1, 'Should only show file2');
      assert.ok(result.files[0].workspacePath.includes('file2.md'));
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('normalizes paths correctly for comparison', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-8`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createClaudePlatform(testDir);

      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'test.md'), 'Test');

      await createWorkspaceIndex(testDir, {
        packages: {
          'test-package': {
            path: './packages/test',
            files: {
              'rules/test.md': ['.claude/rules/test.md']
            }
          }
        }
      });

      const result = await scanUntrackedFiles(testDir);

      assert.equal(result.totalFiles, 0, 'Should recognize tracked file');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('does not walk unrelated directories (performance guard)', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-perf`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createClaudePlatform(testDir);

      const unrelatedDir = join(testDir, 'huge-project', 'src', 'deeply', 'nested');
      await fs.mkdir(unrelatedDir, { recursive: true });
      await fs.writeFile(join(unrelatedDir, 'file.md'), 'Should not be found');

      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'real.md'), 'Real rule');

      await createWorkspaceIndex(testDir, { packages: {} });

      const start = Date.now();
      const result = await scanUntrackedFiles(testDir);
      const elapsed = Date.now() - start;

      assert.equal(result.totalFiles, 1, 'Should only find platform files');
      assert.ok(result.files[0].workspacePath.includes('real.md'));
      assert.ok(elapsed < 5000, `Scan should complete quickly (took ${elapsed}ms)`);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('filters out .DS_Store and Thumbs.db from scan results', async () => {
    const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-junk`);
    await fs.mkdir(testDir, { recursive: true });

    try {
      await createClaudePlatform(testDir);

      await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'rules', 'real-rule.md'), 'Real rule');
      await fs.writeFile(join(testDir, '.claude', 'rules', '.DS_Store'), '');
      await fs.writeFile(join(testDir, '.claude', 'rules', 'Thumbs.db'), '');

      await fs.mkdir(join(testDir, '.claude', 'skills'), { recursive: true });
      await fs.writeFile(join(testDir, '.claude', 'skills', '.DS_Store'), '');

      await createWorkspaceIndex(testDir, { packages: {} });

      const result = await scanUntrackedFiles(testDir);

      const hasDSStore = result.files.some(f => f.workspacePath.includes('.DS_Store'));
      const hasThumbsDb = result.files.some(f => f.workspacePath.includes('Thumbs.db'));
      const hasRealRule = result.files.some(f => f.workspacePath.includes('real-rule.md'));

      assert.ok(!hasDSStore, '.DS_Store should be filtered out');
      assert.ok(!hasThumbsDb, 'Thumbs.db should be filtered out');
      assert.ok(hasRealRule, 'Real rule file should still appear');
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });
});

describe('extractStaticWalkRoot', () => {
  it('correctly identifies walk roots', () => {
    const claude = extractStaticWalkRoot('.claude/rules/*.md');
    assert.deepEqual(claude, { root: '.claude/rules', rootOnly: false });

    const cursor = extractStaticWalkRoot('.cursor/rules/*.mdc');
    assert.deepEqual(cursor, { root: '.cursor/rules', rootOnly: false });

    const nested = extractStaticWalkRoot('.claude/commands/deep/nested/*.md');
    assert.deepEqual(nested, { root: '.claude/commands/deep/nested', rootOnly: false });

    const agents = extractStaticWalkRoot('AGENTS.md');
    assert.deepEqual(agents, { root: null, rootOnly: true });

    const dotfile = extractStaticWalkRoot('.cursorrules');
    assert.deepEqual(dotfile, { root: null, rootOnly: true });

    const doublestar = extractStaticWalkRoot('**/*.md');
    assert.deepEqual(doublestar, { root: null, rootOnly: false });

    const starFirst = extractStaticWalkRoot('*/rules/*.md');
    assert.deepEqual(starFirst, { root: null, rootOnly: false });

    const backslash = extractStaticWalkRoot('.claude\\rules\\*.md');
    assert.deepEqual(backslash, { root: '.claude/rules', rootOnly: false });
  });
});
