/**
 * Phase 4 Integration Tests
 * 
 * Tests the complete save-to-source pipeline with write coordination
 * and result reporting.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { runSaveToSourcePipeline } from '../../../src/core/save/save-to-source-pipeline.js';
import { writeWorkspaceIndex, getWorkspaceIndexPath } from '../../../src/utils/workspace-index-yml.js';

test('Phase 4: Complete pipeline - single file update', async () => {
  // Setup
  const tmpDir = await mkdtemp(join(tmpdir(), 'save-phase4-'));
  const packageDir = join(tmpDir, 'package-source');
  const workspaceDir = tmpDir;
  
  try {
    // Create package source
    await mkdir(packageDir, { recursive: true });
    await mkdir(join(packageDir, 'tools'), { recursive: true });
    await writeFile(
      join(packageDir, 'tools', 'search.md'),
      '# Old Content\n\nThis is the original content.'
    );
    
    // Create workspace with changed file
    await mkdir(join(workspaceDir, '.cursor', 'tools'), { recursive: true });
    await writeFile(
      join(workspaceDir, '.cursor', 'tools', 'search.md'),
      '# New Content\n\nThis is the updated content.'
    );
    
    // Create workspace index
    await mkdir(join(workspaceDir, '.openpackage'), { recursive: true });
    const index = {
      packages: {
        'test-package': {
          path: packageDir,
          version: '1.0.0',
          files: {
            'tools/search.md': ['.cursor/tools/search.md']
          }
        }
      }
    };
    await writeWorkspaceIndex({ path: getWorkspaceIndexPath(workspaceDir), index });
    
    // Change to workspace directory for test
    const originalCwd = process.cwd();
    process.chdir(workspaceDir);
    
    try {
      // Execute save pipeline
      const result = await runSaveToSourcePipeline('test-package', { force: false });
      
      // Verify result
      assert.strictEqual(result.success, true, 'Pipeline should succeed');
      assert.ok(result.data, 'Result should have data');
      
      // Verify file was updated in source
      const updatedContent = await readFile(
        join(packageDir, 'tools', 'search.md'),
        'utf-8'
      );
      assert.strictEqual(
        updatedContent,
        '# New Content\n\nThis is the updated content.',
        'Source file should be updated'
      );
      
      console.log('✓ Single file update test passed');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    // Cleanup
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 4: Complete pipeline - no changes detected', async () => {
  // Setup
  const tmpDir = await mkdtemp(join(tmpdir(), 'save-phase4-'));
  const packageDir = join(tmpDir, 'package-source');
  const workspaceDir = tmpDir;
  
  try {
    // Create package source
    await mkdir(packageDir, { recursive: true });
    await mkdir(join(packageDir, 'tools'), { recursive: true });
    await writeFile(
      join(packageDir, 'tools', 'search.md'),
      '# Same Content\n\nThis content matches.'
    );
    
    // Create workspace with identical file
    await mkdir(join(workspaceDir, '.cursor', 'tools'), { recursive: true });
    await writeFile(
      join(workspaceDir, '.cursor', 'tools', 'search.md'),
      '# Same Content\n\nThis content matches.'
    );
    
    // Create workspace index
    await mkdir(join(workspaceDir, '.openpackage'), { recursive: true });
    const index = {
      packages: {
        'test-package': {
          path: packageDir,
          version: '1.0.0',
          files: {
            'tools/search.md': ['.cursor/tools/search.md']
          }
        }
      }
    };
    await writeWorkspaceIndex({ path: getWorkspaceIndexPath(workspaceDir), index });
    
    // Change to workspace directory for test
    const originalCwd = process.cwd();
    process.chdir(workspaceDir);
    
    try {
      // Execute save pipeline
      const result = await runSaveToSourcePipeline('test-package', { force: false });
      
      // Verify result
      assert.strictEqual(result.success, true, 'Pipeline should succeed');
      assert.ok(result.data, 'Result should have data');
      assert.ok(
        result.data.message.includes('No') && result.data.message.includes('changes'),
        `Should indicate no changes, got: ${result.data.message}`
      );
      
      console.log('✓ No changes detected test passed');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    // Cleanup
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('Phase 4: Complete pipeline - create new file', async () => {
  // Setup
  const tmpDir = await mkdtemp(join(tmpdir(), 'save-phase4-'));
  const packageDir = join(tmpDir, 'package-source');
  const workspaceDir = tmpDir;
  
  try {
    // Create package source (no existing file)
    await mkdir(packageDir, { recursive: true });
    await mkdir(join(packageDir, 'tools'), { recursive: true });
    
    // Create workspace with new file
    await mkdir(join(workspaceDir, '.cursor', 'tools'), { recursive: true });
    await writeFile(
      join(workspaceDir, '.cursor', 'tools', 'new-tool.md'),
      '# New Tool\n\nThis is a new file.'
    );
    
    // Create workspace index
    await mkdir(join(workspaceDir, '.openpackage'), { recursive: true });
    const index = {
      packages: {
        'test-package': {
          path: packageDir,
          version: '1.0.0',
          files: {
            'tools/new-tool.md': ['.cursor/tools/new-tool.md']
          }
        }
      }
    };
    await writeWorkspaceIndex({ path: getWorkspaceIndexPath(workspaceDir), index });
    
    // Change to workspace directory for test
    const originalCwd = process.cwd();
    process.chdir(workspaceDir);
    
    try {
      // Execute save pipeline
      const result = await runSaveToSourcePipeline('test-package', { force: false });
      
      // Verify result
      assert.strictEqual(result.success, true, 'Pipeline should succeed');
      assert.ok(result.data, 'Result should have data');
      
      // Verify file was created in source
      const content = await readFile(
        join(packageDir, 'tools', 'new-tool.md'),
        'utf-8'
      );
      assert.strictEqual(
        content,
        '# New Tool\n\nThis is a new file.',
        'Source file should be created'
      );
      
      console.log('✓ Create new file test passed');
    } finally {
      process.chdir(originalCwd);
    }
  } finally {
    // Cleanup
    await rm(tmpDir, { recursive: true, force: true });
  }
});

console.log('\n✅ All Phase 4 integration tests completed!\n');
