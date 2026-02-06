/**
 * Integration tests for opkg status command
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runStatusPipeline } from '../../src/core/status/status-pipeline.js';
import { writeWorkspaceIndex, getWorkspaceIndexPath } from '../../src/utils/workspace-index-yml.js';
import type { WorkspaceIndex } from '../../src/types/workspace-index.js';
import type { ExecutionContext } from '../../src/types/index.js';

// Helper function
async function createWorkspaceIndex(dir: string, index: WorkspaceIndex): Promise<void> {
  const indexPath = getWorkspaceIndexPath(dir);
  await fs.mkdir(join(dir, '.openpackage'), { recursive: true });
  await writeWorkspaceIndex({ path: indexPath, index });
}

// Test: Fail when no workspace index exists
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-1`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    let errorThrown = false;
    try {
      await runStatusPipeline(execContext, {});
    } catch (error) {
      errorThrown = true;
      assert.ok(String(error).includes('No workspace index found'));
    }
    
    assert.ok(errorThrown, 'Should throw when no workspace index');
    
    console.log('✓ Fail when no workspace index exists');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Summary view with counts
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-2`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    // Create Claude platform
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'tracked.md'), 'Tracked');
    await fs.writeFile(join(testDir, '.claude', 'rules', 'untracked.md'), 'Untracked');
    
    // Track only one file
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
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    const result = await runStatusPipeline(execContext, {});
    
    assert.ok(result.success);
    assert.equal(result.data?.trackedCount, 1);
    assert.equal(result.data?.untrackedCount, 1);
    
    console.log('✓ Summary view with counts');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: --tracked flag shows tracked files
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-3`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'file1.md'), 'File 1');
    await fs.writeFile(join(testDir, '.claude', 'rules', 'file2.md'), 'File 2');
    
    await createWorkspaceIndex(testDir, {
      packages: {
        'package-a': {
          path: './packages/a',
          version: '1.0.0',
          files: {
            'rules/file1.md': ['.claude/rules/file1.md'],
            'rules/file2.md': ['.claude/rules/file2.md']
          }
        }
      }
    });
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    const result = await runStatusPipeline(execContext, { tracked: true });
    
    assert.ok(result.success);
    assert.ok(result.data?.trackedFiles);
    assert.equal(result.data!.trackedFiles.totalFiles, 2);
    assert.equal(result.data!.trackedFiles.existingFiles, 2);
    assert.equal(result.data!.trackedFiles.missingFiles, 0);
    
    console.log('✓ --tracked flag shows tracked files');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: --tracked detects missing files
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-4`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'exists.md'), 'Exists');
    // Don't create missing.md
    
    await createWorkspaceIndex(testDir, {
      packages: {
        'test-package': {
          path: './packages/test',
          files: {
            'rules/exists.md': ['.claude/rules/exists.md'],
            'rules/missing.md': ['.claude/rules/missing.md']
          }
        }
      }
    });
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    const result = await runStatusPipeline(execContext, { tracked: true });
    
    assert.ok(result.success);
    assert.equal(result.data!.trackedFiles!.totalFiles, 2);
    assert.equal(result.data!.trackedFiles!.existingFiles, 1);
    assert.equal(result.data!.trackedFiles!.missingFiles, 1);
    
    // Check individual file status
    const files = result.data!.trackedFiles!.files;
    const existsFile = files.find(f => f.workspacePath.includes('exists.md'));
    const missingFile = files.find(f => f.workspacePath.includes('missing.md'));
    
    assert.ok(existsFile?.exists);
    assert.ok(!missingFile?.exists);
    
    console.log('✓ --tracked detects missing files');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: --untracked flag shows untracked files
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-5`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'untracked1.md'), 'Untracked 1');
    await fs.writeFile(join(testDir, '.claude', 'rules', 'untracked2.md'), 'Untracked 2');
    
    await createWorkspaceIndex(testDir, { packages: {} });
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    const result = await runStatusPipeline(execContext, { untracked: true });
    
    assert.ok(result.success);
    assert.ok(result.data?.untrackedFiles);
    assert.equal(result.data!.untrackedFiles.totalFiles, 2);
    
    console.log('✓ --untracked flag shows untracked files');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Mutual exclusivity of --tracked and --untracked
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-6`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await createWorkspaceIndex(testDir, { packages: {} });
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    let errorThrown = false;
    try {
      await runStatusPipeline(execContext, { tracked: true, untracked: true });
    } catch (error) {
      errorThrown = true;
      assert.ok(String(error).includes('Cannot use --tracked and --untracked together'));
    }
    
    assert.ok(errorThrown, 'Should throw when both flags used');
    
    console.log('✓ Mutual exclusivity of --tracked and --untracked');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Multiple platforms in tracked files
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-7`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'claude.md'), 'Claude');
    await fs.writeFile(join(testDir, '.cursor', 'rules', 'cursor.mdc'), 'Cursor');
    
    await createWorkspaceIndex(testDir, {
      packages: {
        'package-a': {
          path: './packages/a',
          files: {
            'rules/claude.md': ['.claude/rules/claude.md']
          }
        },
        'package-b': {
          path: './packages/b',
          files: {
            'rules/cursor.mdc': ['.cursor/rules/cursor.mdc']
          }
        }
      }
    });
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    const result = await runStatusPipeline(execContext, { tracked: true });
    
    assert.ok(result.success);
    assert.equal(result.data!.trackedFiles!.totalFiles, 2);
    assert.ok(result.data!.trackedFiles!.platformGroups.has('claude'));
    assert.ok(result.data!.trackedFiles!.platformGroups.has('cursor'));
    
    console.log('✓ Multiple platforms in tracked files');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Empty workspace (no packages)
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-8`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await createWorkspaceIndex(testDir, { packages: {} });
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    const result = await runStatusPipeline(execContext, {});
    
    assert.ok(result.success);
    assert.equal(result.data?.trackedCount, 0);
    assert.equal(result.data?.untrackedCount, 0);
    
    console.log('✓ Empty workspace (no packages)');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: --platforms filter for tracked files
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-9`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
    await fs.mkdir(join(testDir, '.opencode', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'claude.md'), 'Claude');
    await fs.writeFile(join(testDir, '.cursor', 'rules', 'cursor.mdc'), 'Cursor');
    await fs.writeFile(join(testDir, '.opencode', 'rules', 'opencode.md'), 'OpenCode');
    
    await createWorkspaceIndex(testDir, {
      packages: {
        'package-a': {
          path: './packages/a',
          files: {
            'rules/claude.md': ['.claude/rules/claude.md']
          }
        },
        'package-b': {
          path: './packages/b',
          files: {
            'rules/cursor.mdc': ['.cursor/rules/cursor.mdc']
          }
        },
        'package-c': {
          path: './packages/c',
          files: {
            'rules/opencode.md': ['.opencode/rules/opencode.md']
          }
        }
      }
    });
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    // Test filtering for just claude
    const claudeResult = await runStatusPipeline(execContext, { tracked: true, platforms: ['claude'] });
    
    assert.ok(claudeResult.success);
    assert.equal(claudeResult.data!.trackedFiles!.totalFiles, 1);
    assert.ok(claudeResult.data!.trackedFiles!.platformGroups.has('claude'));
    assert.ok(!claudeResult.data!.trackedFiles!.platformGroups.has('cursor'));
    assert.ok(!claudeResult.data!.trackedFiles!.platformGroups.has('opencode'));
    
    // Test filtering for multiple platforms
    const multiResult = await runStatusPipeline(execContext, { tracked: true, platforms: ['claude', 'cursor'] });
    
    assert.ok(multiResult.success);
    assert.equal(multiResult.data!.trackedFiles!.totalFiles, 2);
    assert.ok(multiResult.data!.trackedFiles!.platformGroups.has('claude'));
    assert.ok(multiResult.data!.trackedFiles!.platformGroups.has('cursor'));
    assert.ok(!multiResult.data!.trackedFiles!.platformGroups.has('opencode'));
    
    console.log('✓ --platforms filter for tracked files');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: --platforms filter for untracked files
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-10`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'untracked-claude.md'), 'Claude');
    await fs.writeFile(join(testDir, '.cursor', 'rules', 'untracked-cursor.mdc'), 'Cursor');
    
    await createWorkspaceIndex(testDir, { packages: {} });
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    // Test filtering for just cursor
    const cursorResult = await runStatusPipeline(execContext, { untracked: true, platforms: ['cursor'] });
    
    assert.ok(cursorResult.success);
    assert.ok(cursorResult.data?.untrackedFiles);
    assert.equal(cursorResult.data!.untrackedFiles.totalFiles, 1);
    assert.ok(cursorResult.data!.untrackedFiles.platformGroups.has('cursor'));
    assert.ok(!cursorResult.data!.untrackedFiles.platformGroups.has('claude'));
    
    console.log('✓ --platforms filter for untracked files');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: --platforms filter in summary mode
{
  const testDir = join(tmpdir(), `opkg-test-status-${Date.now()}-11`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'tracked.md'), 'Tracked Claude');
    await fs.writeFile(join(testDir, '.claude', 'rules', 'untracked.md'), 'Untracked Claude');
    await fs.writeFile(join(testDir, '.cursor', 'rules', 'tracked.mdc'), 'Tracked Cursor');
    await fs.writeFile(join(testDir, '.cursor', 'rules', 'untracked.mdc'), 'Untracked Cursor');
    
    await createWorkspaceIndex(testDir, {
      packages: {
        'package-a': {
          path: './packages/a',
          files: {
            'rules/tracked.md': ['.claude/rules/tracked.md']
          }
        },
        'package-b': {
          path: './packages/b',
          files: {
            'rules/tracked.mdc': ['.cursor/rules/tracked.mdc']
          }
        }
      }
    });
    
    const execContext: ExecutionContext = {
      targetDir: testDir,
      homeDir: testDir,
      isGlobalScope: false
    };
    
    // Test summary with platform filter
    const result = await runStatusPipeline(execContext, { platforms: ['claude'] });
    
    assert.ok(result.success);
    assert.equal(result.data?.trackedCount, 1); // Only claude tracked file
    assert.equal(result.data?.untrackedCount, 1); // Only claude untracked file
    
    console.log('✓ --platforms filter in summary mode');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

console.log('\n✅ All status command integration tests passed');
