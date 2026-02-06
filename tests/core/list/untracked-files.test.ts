/**
 * Tests for untracked files scanner
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanUntrackedFiles, extractStaticWalkRoot } from '../../../src/core/list/untracked-files-scanner.js';
import { writeWorkspaceIndex } from '../../../src/utils/workspace-index-yml.js';
import { getWorkspaceIndexPath } from '../../../src/utils/workspace-index-yml.js';
import type { WorkspaceIndex } from '../../../src/types/workspace-index.js';

// Helper functions
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

// Test: Empty result when no platforms detected
{
  const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-1`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await createWorkspaceIndex(testDir, { packages: {} });
    
    const result = await scanUntrackedFiles(testDir);
    
    assert.equal(result.totalFiles, 0, 'Should have 0 untracked files when no platforms');
    assert.equal(result.files.length, 0);
    assert.equal(result.platformGroups.size, 0);
    
    console.log('✓ Empty result when no platforms detected');
  } catch (error) {
    console.error('Test 1 failed:', error);
    throw error;
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Detect untracked files in Claude platform
{
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
    
    console.log('✓ Detect untracked files in Claude platform');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Exclude tracked files from results
{
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
    
    // Check that tracked.md is not in the list (but untracked.md contains 'tracked' substring, so be specific)
    const hasExactTrackedFile = result.files.some(f => f.workspacePath === '.claude/rules/tracked.md');
    assert.ok(!hasExactTrackedFile, 'Should not include tracked.md file');
    
    console.log('✓ Exclude tracked files from results');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Detect files across multiple platforms
{
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
    
    console.log('✓ Detect files across multiple platforms');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Group files by category
{
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
    
    console.log('✓ Group files by category');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Handle nested directory structures
{
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
    
    console.log('✓ Handle nested directory structures');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Handle workspace index with complex file mappings
{
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
    
    console.log('✓ Handle workspace index with complex file mappings');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Normalize paths correctly for comparison
{
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
    
    // Should recognize as tracked despite path format differences
    assert.equal(result.totalFiles, 0, 'Should recognize tracked file');
    
    console.log('✓ Normalize paths correctly for comparison');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: extractStaticWalkRoot correctly identifies walk roots
{
  // Platform directory patterns -> scoped walk root
  const claude = extractStaticWalkRoot('.claude/rules/*.md');
  assert.deepEqual(claude, { root: '.claude/rules', rootOnly: false });

  const cursor = extractStaticWalkRoot('.cursor/rules/*.mdc');
  assert.deepEqual(cursor, { root: '.cursor/rules', rootOnly: false });

  const nested = extractStaticWalkRoot('.claude/commands/deep/nested/*.md');
  assert.deepEqual(nested, { root: '.claude/commands/deep/nested', rootOnly: false });

  // Root-level file patterns -> rootOnly (no recursive walk)
  const agents = extractStaticWalkRoot('AGENTS.md');
  assert.deepEqual(agents, { root: null, rootOnly: true });

  const dotfile = extractStaticWalkRoot('.cursorrules');
  assert.deepEqual(dotfile, { root: null, rootOnly: true });

  // Unsafe patterns (glob in first segment) -> null root
  const doublestar = extractStaticWalkRoot('**/*.md');
  assert.deepEqual(doublestar, { root: null, rootOnly: false });

  const starFirst = extractStaticWalkRoot('*/rules/*.md');
  assert.deepEqual(starFirst, { root: null, rootOnly: false });

  // Backslash normalization
  const backslash = extractStaticWalkRoot('.claude\\rules\\*.md');
  assert.deepEqual(backslash, { root: '.claude/rules', rootOnly: false });

  console.log('✓ extractStaticWalkRoot correctly identifies walk roots');
}

// Test: Scanner does not walk unrelated directories (performance guard)
{
  const testDir = join(tmpdir(), `opkg-test-untracked-${Date.now()}-perf`);
  await fs.mkdir(testDir, { recursive: true });

  try {
    await createClaudePlatform(testDir);

    // Create a large unrelated directory tree that should NOT be walked
    const unrelatedDir = join(testDir, 'huge-project', 'src', 'deeply', 'nested');
    await fs.mkdir(unrelatedDir, { recursive: true });
    await fs.writeFile(join(unrelatedDir, 'file.md'), 'Should not be found');

    // Create actual platform files
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'real.md'), 'Real rule');

    await createWorkspaceIndex(testDir, { packages: {} });

    const start = Date.now();
    const result = await scanUntrackedFiles(testDir);
    const elapsed = Date.now() - start;

    assert.equal(result.totalFiles, 1, 'Should only find platform files');
    assert.ok(result.files[0].workspacePath.includes('real.md'));
    assert.ok(elapsed < 5000, `Scan should complete quickly (took ${elapsed}ms)`);

    console.log('✓ Scanner does not walk unrelated directories');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

console.log('\n✅ All untracked files scanner tests passed');
