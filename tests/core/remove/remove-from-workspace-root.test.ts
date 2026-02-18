import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runRemoveFromSourcePipeline } from '../../../src/core/remove/remove-from-source-pipeline.js';
import { getWorkspaceIndexPath } from '../../../src/utils/workspace-index-yml.js';

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
 * Test: Remove can work on workspace root with path-only syntax
 */
async function testRemoveFromWorkspaceRootPathOnly(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-root-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const openpackageDir = path.join(tmp, '.openpackage');
    
    // Create workspace manifest
    writePackageManifest(openpackageDir, 'my-workspace');

    // Create test files in workspace root
    const testFile1 = path.join(openpackageDir, 'commands', 'test.md');
    const testFile2 = path.join(openpackageDir, 'rules', 'example.md');
    writeFile(testFile1, '# Test Command');
    writeFile(testFile2, '# Example Rule');

    // Remove using path-only syntax (no package name)
    const result = await runRemoveFromSourcePipeline(undefined, 'commands/test.md', { force: true });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesRemoved, 1);
    assert.equal(result.data?.sourceType, 'workspace');

    // Verify file was removed
    assert.ok(!fs.existsSync(testFile1), 'File should be removed from workspace root');
    assert.ok(fs.existsSync(testFile2), 'Other file should remain');

    // Verify index was not created
    const indexPath = getWorkspaceIndexPath(tmp);
    assert.ok(!fs.existsSync(indexPath), 'Workspace index should not be created by remove');

    console.log('✓ Remove works on workspace root with path-only syntax');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Remove directory from workspace root
 */
async function testRemoveDirectoryFromWorkspaceRoot(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-dir-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const openpackageDir = path.join(tmp, '.openpackage');
    
    // Create workspace manifest
    writePackageManifest(openpackageDir, 'my-workspace');

    // Create directory with multiple files
    const file1 = path.join(openpackageDir, 'deprecated', 'old1.md');
    const file2 = path.join(openpackageDir, 'deprecated', 'old2.md');
    const keepFile = path.join(openpackageDir, 'keep.md');
    writeFile(file1, 'old content 1');
    writeFile(file2, 'old content 2');
    writeFile(keepFile, 'keep this');

    // Remove entire directory
    const result = await runRemoveFromSourcePipeline(undefined, 'deprecated/', { force: true });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesRemoved, 2);

    // Verify directory and files removed
    assert.ok(!fs.existsSync(file1), 'File 1 should be removed');
    assert.ok(!fs.existsSync(file2), 'File 2 should be removed');
    assert.ok(!fs.existsSync(path.dirname(file1)), 'Empty directory should be cleaned up');
    assert.ok(fs.existsSync(keepFile), 'Other file should remain');

    console.log('✓ Remove directory from workspace root works correctly');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Two-arg syntax still works (backward compatibility)
 */
async function testRemoveWithTwoArgSyntax(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-two-arg-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'test-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package
    writePackageManifest(pkgDir, pkgName);

    // Create test file
    const testFile = path.join(pkgDir, 'commands', 'test.md');
    writeFile(testFile, '# Test');

    // Remove using two-arg syntax
    const result = await runRemoveFromSourcePipeline(pkgName, 'commands/test.md', { force: true });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesRemoved, 1);
    assert.equal(result.data?.sourceType, 'workspace');

    // Verify file removed
    assert.ok(!fs.existsSync(testFile), 'File should be removed');

    console.log('✓ Two-arg syntax still works (backward compatible)');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Error when single arg is not a valid path
 */
async function testErrorOnInvalidPath(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-invalid-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const openpackageDir = path.join(tmp, '.openpackage');
    writePackageManifest(openpackageDir, 'my-workspace');

    // Try to remove with non-existent path (neither file nor dependency)
    const result = await runRemoveFromSourcePipeline(undefined, 'non-existent-path', { force: true });
    assert.ok(!result.success, 'Should fail with non-existent path');
    assert.ok(result.error?.includes('not found'), 'Should indicate path not found');

    console.log('✓ Error handling for invalid path works correctly');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Remove from global package using two-arg syntax
 */
async function testRemoveFromGlobalPackage(): Promise<void> {
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

    // Create test file in global package
    const testFile = path.join(pkgDir, 'utils', 'helper.sh');
    writeFile(testFile, '#!/bin/bash');

    // Remove from global package
    const result = await runRemoveFromSourcePipeline(pkgName, 'utils/helper.sh', { force: true });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesRemoved, 1);
    assert.equal(result.data?.sourceType, 'global');

    // Verify file removed
    assert.ok(!fs.existsSync(testFile), 'File should be removed from global package');

    console.log('✓ Remove from global package works correctly');
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
 * Test: Dry-run mode with workspace root
 */
async function testDryRunWithWorkspaceRoot(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-dryrun-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const openpackageDir = path.join(tmp, '.openpackage');
    
    // Create workspace manifest
    writePackageManifest(openpackageDir, 'my-workspace');

    // Create test file
    const testFile = path.join(openpackageDir, 'test.md');
    writeFile(testFile, '# Test');

    // Dry-run should preview without removing
    const result = await runRemoveFromSourcePipeline(undefined, 'test.md', { dryRun: true });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesRemoved, 1);

    // Verify file NOT removed
    assert.ok(fs.existsSync(testFile), 'File should still exist after dry-run');

    console.log('✓ Dry-run mode works with workspace root');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Empty directory cleanup in workspace root
 */
async function testEmptyDirectoryCleanupWorkspaceRoot(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-remove-cleanup-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const openpackageDir = path.join(tmp, '.openpackage');
    
    // Create workspace manifest
    writePackageManifest(openpackageDir, 'my-workspace');

    // Create nested file structure
    const deepFile = path.join(openpackageDir, 'deep', 'nested', 'dir', 'file.md');
    writeFile(deepFile, '# Deep');

    // Remove the only file
    const result = await runRemoveFromSourcePipeline(undefined, 'deep/nested/dir/file.md', { force: true });
    assert.ok(result.success, result.error);

    // Verify entire directory structure cleaned up
    assert.ok(!fs.existsSync(path.join(openpackageDir, 'deep')), 'Empty parent directories should be cleaned up');

    console.log('✓ Empty directory cleanup works in workspace root');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Run all tests
async function runTests() {
  try {
    await testRemoveFromWorkspaceRootPathOnly();
    await testRemoveDirectoryFromWorkspaceRoot();
    await testRemoveWithTwoArgSyntax();
    await testErrorOnInvalidPath();
    await testRemoveFromGlobalPackage();
    await testDryRunWithWorkspaceRoot();
    await testEmptyDirectoryCleanupWorkspaceRoot();

    console.log('\n✓ All remove-from-workspace-root tests passed');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

runTests();
