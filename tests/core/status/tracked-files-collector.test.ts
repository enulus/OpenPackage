/**
 * Tests for tracked files collector
 */

import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectTrackedFiles } from '../../../src/core/status/tracked-files-collector.js';
import { writeWorkspaceIndex, getWorkspaceIndexPath } from '../../../src/utils/workspace-index-yml.js';
import type { WorkspaceIndex } from '../../../src/types/workspace-index.js';

// Helper function
async function createWorkspaceIndex(dir: string, index: WorkspaceIndex): Promise<void> {
  const indexPath = getWorkspaceIndexPath(dir);
  await fs.mkdir(join(dir, '.openpackage'), { recursive: true });
  await writeWorkspaceIndex({ path: indexPath, index });
}

// Test: Empty workspace
{
  const testDir = join(tmpdir(), `opkg-test-tracked-${Date.now()}-1`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await createWorkspaceIndex(testDir, { packages: {} });
    
    const result = await collectTrackedFiles(testDir);
    
    assert.equal(result.totalFiles, 0, 'Should have 0 tracked files');
    assert.equal(result.existingFiles, 0);
    assert.equal(result.missingFiles, 0);
    assert.equal(result.platformGroups.size, 0);
    
    console.log('✓ Empty workspace');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Collect tracked files with existence check
{
  const testDir = join(tmpdir(), `opkg-test-tracked-${Date.now()}-2`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    // Create some files
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'existing.md'), 'Content');
    
    // Track files (one exists, one missing)
    await createWorkspaceIndex(testDir, {
      packages: {
        'test-package': {
          path: './packages/test',
          version: '1.0.0',
          files: {
            'rules/existing.md': ['.claude/rules/existing.md'],
            'rules/missing.md': ['.claude/rules/missing.md']
          }
        }
      }
    });
    
    const result = await collectTrackedFiles(testDir);
    
    assert.equal(result.totalFiles, 2, 'Should have 2 tracked files');
    assert.equal(result.existingFiles, 1, 'Should have 1 existing file');
    assert.equal(result.missingFiles, 1, 'Should have 1 missing file');
    
    // Check platform grouping
    assert.ok(result.platformGroups.has('claude'), 'Should have Claude platform');
    assert.equal(result.platformGroups.get('claude')?.length, 2);
    
    // Check file details
    const files = result.files;
    assert.equal(files.length, 2);
    
    const existingFile = files.find(f => f.workspacePath.includes('existing.md'));
    const missingFile = files.find(f => f.workspacePath.includes('missing.md'));
    
    assert.ok(existingFile, 'Should find existing file');
    assert.ok(missingFile, 'Should find missing file');
    assert.ok(existingFile!.exists, 'Existing file should be marked as exists');
    assert.ok(!missingFile!.exists, 'Missing file should be marked as not exists');
    
    console.log('✓ Collect tracked files with existence check');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Multiple platforms
{
  const testDir = join(tmpdir(), `opkg-test-tracked-${Date.now()}-3`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    // Create files for multiple platforms
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.mkdir(join(testDir, '.cursor', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'claude-rule.md'), 'Claude');
    await fs.writeFile(join(testDir, '.cursor', 'rules', 'cursor-rule.mdc'), 'Cursor');
    
    await createWorkspaceIndex(testDir, {
      packages: {
        'package-a': {
          path: './packages/a',
          files: {
            'rules/claude-rule.md': ['.claude/rules/claude-rule.md']
          }
        },
        'package-b': {
          path: './packages/b',
          files: {
            'rules/cursor-rule.mdc': ['.cursor/rules/cursor-rule.mdc']
          }
        }
      }
    });
    
    const result = await collectTrackedFiles(testDir);
    
    assert.equal(result.totalFiles, 2);
    assert.ok(result.platformGroups.has('claude'), 'Should have Claude');
    assert.ok(result.platformGroups.has('cursor'), 'Should have Cursor');
    assert.equal(result.platformGroups.get('claude')?.length, 1);
    assert.equal(result.platformGroups.get('cursor')?.length, 1);
    
    console.log('✓ Multiple platforms');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Package metadata
{
  const testDir = join(tmpdir(), `opkg-test-tracked-${Date.now()}-4`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await fs.mkdir(join(testDir, '.claude', 'rules'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'rules', 'test.md'), 'Test');
    
    await createWorkspaceIndex(testDir, {
      packages: {
        'my-package': {
          path: './packages/my-package',
          version: '2.5.0',
          files: {
            'rules/test.md': ['.claude/rules/test.md']
          }
        }
      }
    });
    
    const result = await collectTrackedFiles(testDir);
    
    const file = result.files[0];
    assert.equal(file.packageName, 'my-package');
    assert.equal(file.packageVersion, '2.5.0');
    assert.equal(file.platform, 'claude');
    assert.ok(file.exists);
    
    console.log('✓ Package metadata');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Complex file mappings (object format)
{
  const testDir = join(tmpdir(), `opkg-test-tracked-${Date.now()}-5`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    await fs.mkdir(join(testDir, '.claude'), { recursive: true });
    await fs.writeFile(join(testDir, '.claude', 'config.json'), '{}');
    
    await createWorkspaceIndex(testDir, {
      packages: {
        'test-package': {
          path: './packages/test',
          files: {
            'config.json': [
              {
                target: '.claude/config.json',
                merge: 'deep'
              }
            ]
          }
        }
      }
    });
    
    const result = await collectTrackedFiles(testDir);
    
    assert.equal(result.totalFiles, 1);
    assert.equal(result.files[0].workspacePath, '.claude/config.json');
    assert.ok(result.files[0].exists);
    
    console.log('✓ Complex file mappings (object format)');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

// Test: Platform inference
{
  const testDir = join(tmpdir(), `opkg-test-tracked-${Date.now()}-6`);
  await fs.mkdir(testDir, { recursive: true });
  
  try {
    // Create files in various platform directories
    await fs.mkdir(join(testDir, '.opencode'), { recursive: true });
    await fs.mkdir(join(testDir, '.codex'), { recursive: true });
    await fs.writeFile(join(testDir, '.opencode', 'test.md'), 'OpenCode');
    await fs.writeFile(join(testDir, '.codex', 'test.md'), 'Codex');
    await fs.writeFile(join(testDir, 'CLAUDE.md'), 'Claude root');
    
    await createWorkspaceIndex(testDir, {
      packages: {
        'test-package': {
          path: './packages/test',
          files: {
            'opencode-file.md': ['.opencode/test.md'],
            'codex-file.md': ['.codex/test.md'],
            'claude-root.md': ['CLAUDE.md']
          }
        }
      }
    });
    
    const result = await collectTrackedFiles(testDir);
    
    const opencodeFile = result.files.find(f => f.workspacePath === '.opencode/test.md');
    const codexFile = result.files.find(f => f.workspacePath === '.codex/test.md');
    const claudeFile = result.files.find(f => f.workspacePath === 'CLAUDE.md');
    
    assert.equal(opencodeFile?.platform, 'opencode');
    assert.equal(codexFile?.platform, 'codex');
    assert.equal(claudeFile?.platform, 'claude');
    
    console.log('✓ Platform inference');
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

console.log('\n✅ All tracked files collector tests passed');
