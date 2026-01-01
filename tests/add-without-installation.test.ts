import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runAddToSourcePipeline } from '../src/core/add/add-to-source-pipeline.js';
import { readWorkspaceIndex, getWorkspaceIndexPath } from '../src/utils/workspace-index-yml.js';

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
 * Test: Add can work on workspace packages without requiring installation in workspace index
 */
async function testAddToWorkspacePackageWithoutIndex(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-no-index-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'workspace-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package in workspace without adding to index
    writePackageManifest(pkgDir, pkgName);

    // Create file to add
    const fileToAdd = path.join(tmp, 'data', 'config.yml');
    writeFile(fileToAdd, 'config: value');

    // Add should work without package being in index
    const result = await runAddToSourcePipeline(pkgName, 'data/config.yml', { apply: false });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);
    assert.equal(result.data?.sourceType, 'workspace');

    // Verify file was added to package source
    const addedFile = path.join(pkgDir, 'root', 'data', 'config.yml');
    assert.ok(fs.existsSync(addedFile), 'File should exist in package source');
    assert.equal(fs.readFileSync(addedFile, UTF8), 'config: value');

    // Verify index was not created/updated
    const indexPath = getWorkspaceIndexPath(tmp);
    assert.ok(!fs.existsSync(indexPath), 'Workspace index should not be created by add');

    console.log('✓ Add works on workspace package without installation');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Add can work on global packages from any directory
 */
async function testAddToGlobalPackageFromAnyDirectory(): Promise<void> {
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

    // Create file to add (in workspace directory)
    const fileToAdd = path.join(tmpWorkspace, 'shared', 'utility.sh');
    writeFile(fileToAdd, '#!/bin/bash\necho "utility"');

    // Add from workspace to global package
    const result = await runAddToSourcePipeline(pkgName, 'shared/utility.sh', { apply: false });
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);
    assert.equal(result.data?.sourceType, 'global');

    // Verify file was added to global package source
    const addedFile = path.join(pkgDir, 'root', 'shared', 'utility.sh');
    assert.ok(fs.existsSync(addedFile), 'File should exist in global package source');
    assert.equal(fs.readFileSync(addedFile, UTF8), '#!/bin/bash\necho "utility"');

    // Verify workspace index was not affected
    const indexPath = getWorkspaceIndexPath(tmpWorkspace);
    assert.ok(!fs.existsSync(indexPath), 'Workspace index should not be created');

    console.log('✓ Add works on global package from any directory');
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
 * Test: Add --apply requires package to be installed in current workspace
 */
async function testAddApplyRequiresInstallation(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-apply-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmp);

    const pkgName = 'uninstalled-pkg';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', pkgName);

    // Create package without installing
    writePackageManifest(pkgDir, pkgName);

    const fileToAdd = path.join(tmp, 'test.md');
    writeFile(fileToAdd, '# Test');

    // Add with --apply should fail gracefully
    const result = await runAddToSourcePipeline(pkgName, 'test.md', { apply: true });
    assert.ok(!result.success, 'Should fail when --apply used with uninstalled package');
    assert.ok(result.error?.includes('not installed in this workspace'), 'Should explain why apply failed');
    assert.ok(result.error?.includes('opkg install'), 'Should suggest installation');

    // But file should still be added to source
    const addedFile = path.join(pkgDir, 'root', 'test.md');
    assert.ok(fs.existsSync(addedFile), 'File should still be added to source despite apply failure');

    console.log('✓ Add --apply correctly requires installation');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Add rejects registry packages (immutable)
 */
async function testAddRejectsRegistryPackages(): Promise<void> {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-home-registry-'));
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-workspace-'));
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  
  try {
    process.env.HOME = tmpHome;
    process.chdir(tmpWorkspace);

    const pkgName = 'registry-pkg';
    const pkgDir = path.join(tmpHome, '.openpackage', 'registry', pkgName, '1.0.0');

    // Create package in registry
    writePackageManifest(pkgDir, pkgName, '1.0.0');

    const fileToAdd = path.join(tmpWorkspace, 'test.md');
    writeFile(fileToAdd, '# Test');

    // Add should fail for registry packages
    const result = await runAddToSourcePipeline(pkgName, 'test.md', { apply: false });
    assert.ok(!result.success, 'Should fail for registry packages');
    assert.ok(result.error?.includes('not found in workspace or global packages'), 
      'Should indicate registry packages are not mutable');

    console.log('✓ Add correctly rejects registry packages');
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

// Run all tests
await testAddToWorkspacePackageWithoutIndex();
await testAddToGlobalPackageFromAnyDirectory();
await testAddApplyRequiresInstallation();
await testAddRejectsRegistryPackages();

console.log('\n✓ All add-without-installation tests passed');
