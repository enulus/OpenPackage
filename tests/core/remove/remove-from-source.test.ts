import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runRemoveFromSourcePipeline } from '../../../src/core/remove/remove-from-source-pipeline.js';
import { runAddToSourcePipeline } from '../../../src/core/add/add-to-source-pipeline.js';
import { readWorkspaceIndex, getWorkspaceIndexPath } from '../../../src/utils/workspace-index-yml.js';

const UTF8 = 'utf-8';

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p: string, content: string) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, { encoding: UTF8 });
}

function writePackageManifest(pkgDir: string, pkgName: string, version = '1.0.0') {
  const manifest = [`name: ${pkgName}`, `version: ${version}`, ''].join('\n');
  writeFile(path.join(pkgDir, 'openpackage.yml'), manifest);
}

/**
 * Test: Remove works on workspace package without installation
 */
async function testRemoveFromWorkspacePackageWithoutIndex(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-no-index-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'workspace-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package in workspace
    writePackageManifest(pkgDir, pkgName);

    // Add some files to the package first
    const fileToAdd = path.join(tmp, 'data', 'config.yml');
    writeFile(fileToAdd, 'config: value');
    
    const addResult = await runAddToSourcePipeline(pkgName, 'data/config.yml', { apply: false });
    assert.ok(addResult.success, addResult.error);

    // Verify file exists
    const addedFile = path.join(pkgDir, 'root', 'data', 'config.yml');
    assert.ok(fs.existsSync(addedFile), 'File should exist before removal');

    // Remove the file
    const result = await runRemoveFromSourcePipeline(pkgName, 'root/data/config.yml', { force: true });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesRemoved, 1);
    assert.equal(result.data?.sourceType, 'workspace');

    // Verify file was removed
    assert.ok(!fs.existsSync(addedFile), 'File should be removed from package source');

    // Verify index was not created/updated
    const indexPath = getWorkspaceIndexPath(tmp);
    assert.ok(!fs.existsSync(indexPath), 'Workspace index should not be created by remove');

    console.log('✓ Remove works on workspace package without installation');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Remove works on global package from any directory
 */
async function testRemoveFromGlobalPackageFromAnyDirectory(): Promise<void> {
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-workspace-'));
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-home-'));
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  
  try {
    process.env.HOME = tmpHome;
    process.chdir(tmpWorkspace);

    const pkgName = 'global-pkg';
    const pkgDir = path.join(tmpHome, '.openpackage', 'packages', pkgName);

    // Create global package
    writePackageManifest(pkgDir, pkgName);

    // Add a file first
    const fileToAdd = path.join(tmpWorkspace, 'shared', 'utility.sh');
    writeFile(fileToAdd, '#!/bin/bash\necho "utility"');
    
    const addResult = await runAddToSourcePipeline(pkgName, 'shared/utility.sh', { apply: false });
    assert.ok(addResult.success, addResult.error);

    const addedFile = path.join(pkgDir, 'root', 'shared', 'utility.sh');
    assert.ok(fs.existsSync(addedFile), 'File should exist before removal');

    // Remove from global package
    const result = await runRemoveFromSourcePipeline(pkgName, 'root/shared/utility.sh', { force: true });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesRemoved, 1);
    assert.equal(result.data?.sourceType, 'global');

    // Verify file was removed
    assert.ok(!fs.existsSync(addedFile), 'File should be removed from global package source');

    // Verify workspace index was not affected
    const indexPath = getWorkspaceIndexPath(tmpWorkspace);
    assert.ok(!fs.existsSync(indexPath), 'Workspace index should not be created');

    console.log('✓ Remove works on global package from any directory');
  } finally {
    process.chdir(originalCwd);
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

/**
 * Test: Remove --apply requires installation
 */
async function testRemoveApplyRequiresInstallation(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-apply-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'uninstalled-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package without installing
    writePackageManifest(pkgDir, pkgName);

    // Add a file first
    const fileToAdd = path.join(tmp, 'test.md');
    writeFile(fileToAdd, '# Test');
    
    await runAddToSourcePipeline(pkgName, 'test.md', { apply: false });

    const addedFile = path.join(pkgDir, 'root', 'test.md');
    assert.ok(fs.existsSync(addedFile), 'File should exist before removal');

    // Remove with --apply should fail gracefully
    const result = await runRemoveFromSourcePipeline(pkgName, 'root/test.md', { apply: true, force: true });
    assert.ok(!result.success, 'Should fail when --apply used with uninstalled package');
    assert.ok(result.error?.includes('not installed in this workspace'), 'Should explain why apply failed');
    assert.ok(result.error?.includes('opkg install'), 'Should suggest installation');

    // But file should still be removed from source
    assert.ok(!fs.existsSync(addedFile), 'File should still be removed from source despite apply failure');

    console.log('✓ Remove --apply correctly requires installation');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Remove rejects registry packages (immutable)
 */
async function testRemoveRejectsRegistryPackages(): Promise<void> {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-home-registry-'));
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-workspace-'));
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  
  try {
    process.env.HOME = tmpHome;
    process.chdir(tmpWorkspace);

    const pkgName = 'registry-pkg';
    const pkgDir = path.join(tmpHome, '.openpackage', 'registry', pkgName, '1.0.0');

    // Create package in registry with a file
    writePackageManifest(pkgDir, pkgName, '1.0.0');
    writeFile(path.join(pkgDir, 'test.md'), '# Test');

    // Remove should fail for registry packages
    const result = await runRemoveFromSourcePipeline(pkgName, 'test.md', { force: true });
    assert.ok(!result.success, 'Should fail for registry packages');
    assert.ok(result.error?.includes('not found in workspace or global packages'), 
      'Should indicate registry packages are not mutable');

    console.log('✓ Remove correctly rejects registry packages');
  } finally {
    process.chdir(originalCwd);
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    fs.rmSync(tmpWorkspace, { recursive: true, force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
}

/**
 * Test: Remove with directory removes all files
 */
async function testRemoveDirectoryRemovesAllFiles(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-dir-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'test-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package
    writePackageManifest(pkgDir, pkgName);

    // Add multiple files in a directory
    const commandsDir = path.join(pkgDir, 'commands');
    writeFile(path.join(commandsDir, 'test1.md'), '# Test 1');
    writeFile(path.join(commandsDir, 'test2.md'), '# Test 2');
    writeFile(path.join(commandsDir, 'subdir', 'test3.md'), '# Test 3');

    // Remove entire directory
    const result = await runRemoveFromSourcePipeline(pkgName, 'commands/', { force: true });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesRemoved, 3, 'Should remove all files in directory');

    // Verify all files were removed
    assert.ok(!fs.existsSync(commandsDir), 'Directory should be completely removed');

    console.log('✓ Remove with directory removes all files');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Remove with --dry-run shows preview
 */
async function testRemoveDryRunShowsPreview(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-dry-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'test-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package
    writePackageManifest(pkgDir, pkgName);

    // Add a file
    const testFile = path.join(pkgDir, 'commands', 'test.md');
    writeFile(testFile, '# Test');

    // Remove with --dry-run
    const result = await runRemoveFromSourcePipeline(pkgName, 'commands/test.md', { dryRun: true });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesRemoved, 1);

    // Verify file was NOT actually removed
    assert.ok(fs.existsSync(testFile), 'File should still exist after dry-run');

    console.log('✓ Remove --dry-run shows preview without deleting');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Remove cleans up empty directories
 */
async function testRemoveCleansUpEmptyDirectories(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-cleanup-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'test-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package
    writePackageManifest(pkgDir, pkgName);

    // Add a file in nested directory
    const nestedFile = path.join(pkgDir, 'deep', 'nested', 'dir', 'test.md');
    writeFile(nestedFile, '# Test');

    // Remove the only file in the nested structure
    const result = await runRemoveFromSourcePipeline(pkgName, 'deep/nested/dir/test.md', { force: true });
    assert.ok(result.success, result.error);

    // Verify empty parent directories were cleaned up
    assert.ok(!fs.existsSync(path.join(pkgDir, 'deep')), 'Empty parent directories should be removed');

    console.log('✓ Remove cleans up empty directories');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Remove fails when path not found
 */
async function testRemoveFailsWhenPathNotFound(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-notfound-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'test-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package
    writePackageManifest(pkgDir, pkgName);

    // Try to remove non-existent file
    const result = await runRemoveFromSourcePipeline(pkgName, 'nonexistent/file.md', { force: true });
    assert.ok(!result.success, 'Should fail when file not found');
    assert.ok(result.error?.includes('not found'), 'Should indicate file not found');

    console.log('✓ Remove fails gracefully when path not found');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Remove with empty directory fails
 */
async function testRemoveFailsWithEmptyDirectory(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-empty-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'test-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package with empty directory
    writePackageManifest(pkgDir, pkgName);
    ensureDir(path.join(pkgDir, 'empty-dir'));

    // Try to remove empty directory
    const result = await runRemoveFromSourcePipeline(pkgName, 'empty-dir/', { force: true });
    assert.ok(!result.success, 'Should fail when directory is empty');
    assert.ok(result.error?.includes('empty'), 'Should indicate directory is empty');

    console.log('✓ Remove fails with empty directory');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Run all tests
await testRemoveFromWorkspacePackageWithoutIndex();
await testRemoveFromGlobalPackageFromAnyDirectory();
await testRemoveApplyRequiresInstallation();
await testRemoveRejectsRegistryPackages();
await testRemoveDirectoryRemovesAllFiles();
await testRemoveDryRunShowsPreview();
await testRemoveCleansUpEmptyDirectories();
await testRemoveFailsWhenPathNotFound();
await testRemoveFailsWithEmptyDirectory();

console.log('\n✓ All remove-from-source tests passed');
