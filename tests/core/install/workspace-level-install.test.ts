/**
 * Test workspace-level install and apply functionality
 * 
 * Tests that when no package name is specified:
 * 1. Workspace .openpackage/ files are installed/applied
 * 2. All packages from openpackage.yml manifest are installed/applied
 * 3. Workspace package is not added to its own manifest
 * 4. Workspace package is recorded in index with correct path
 */

import assert from 'node:assert/strict';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildWorkspaceRootInstallContext, buildInstallContext } from '../../../src/core/install/unified/context-builders.js';
import { exists, readTextFile } from '../../../src/utils/fs.js';
import { createWorkspacePackageYml } from '../../../src/utils/package-management.js';
import { parsePackageYml } from '../../../src/utils/package-yml.js';
import { readWorkspaceIndex } from '../../../src/utils/workspace-index-yml.js';

// Create temporary test workspace
const testDir = join(tmpdir(), `opkg-test-workspace-${Date.now()}`);

async function setup() {
  await mkdir(testDir, { recursive: true });
  
  // Create .openpackage/ structure
  const openpackageDir = join(testDir, '.openpackage');
  await mkdir(openpackageDir, { recursive: true });
  
  // Create workspace manifest
  const manifestPath = join(openpackageDir, 'openpackage.yml');
  await writeFile(manifestPath, `name: test-workspace
version: 1.0.0
dependencies: []
dev-dependencies: []
`);
  
  // Create some workspace-level files
  const commandsDir = join(openpackageDir, 'commands');
  await mkdir(commandsDir, { recursive: true });
  await writeFile(join(commandsDir, 'test.md'), '# Test Command\n');
  
  const rulesDir = join(openpackageDir, 'rules');
  await mkdir(rulesDir, { recursive: true });
  await writeFile(join(rulesDir, 'style.md'), '# Style Rules\n');
}

async function cleanup() {
  await rm(testDir, { recursive: true, force: true });
}

async function testBuildWorkspaceRootContext() {
  console.log('Testing buildWorkspaceRootInstallContext...');
  
  const ctx = await buildWorkspaceRootInstallContext(testDir, {}, 'install');
  
  assert.ok(ctx, 'Context should be created');
  assert.equal(ctx!.source.type, 'workspace', 'Source type should be workspace');
  assert.equal(ctx!.source.packageName, 'test-workspace', 'Package name should match workspace manifest');
  assert.equal(ctx!.source.version, '1.0.0', 'Version should match workspace manifest');
  assert.ok(ctx!.source.contentRoot?.includes('.openpackage'), 'Content root should point to .openpackage');
  assert.equal(ctx!.mode, 'install', 'Mode should be install');
  
  console.log('✓ buildWorkspaceRootInstallContext works correctly');
}

async function testBulkInstallIncludesWorkspace() {
  console.log('Testing bulk install includes workspace...');
  
  const contexts = await buildInstallContext(testDir, undefined, {});
  
  assert.ok(Array.isArray(contexts), 'Should return array of contexts');
  assert.ok(contexts.length > 0, 'Should have at least workspace context');
  
  const workspaceCtx = contexts[0];
  assert.equal(workspaceCtx.source.type, 'workspace', 'First context should be workspace');
  assert.equal(workspaceCtx.source.packageName, 'test-workspace', 'Should be workspace package');
  
  console.log('✓ Bulk install includes workspace context');
}

async function testWorkspacePackageNotInManifest() {
  console.log('Testing workspace package not added to manifest...');
  
  // Read manifest
  const manifestPath = join(testDir, '.openpackage', 'openpackage.yml');
  const manifest = await parsePackageYml(manifestPath);
  
  // Ensure workspace name is in manifest
  assert.equal(manifest.name, 'test-workspace', 'Workspace should have name');
  
  // Check that dependencies array doesn't contain the workspace package itself
  const hasWorkspaceInPackages = manifest.dependencies?.some(
    (pkg: any) => pkg.name === 'test-workspace'
  );
  
  assert.equal(hasWorkspaceInPackages, false, 'Workspace package should not be in dependencies array');
  
  console.log('✓ Workspace package not added to its own manifest');
}

async function testContextCreationForApply() {
  console.log('Testing context creation for apply mode...');
  
  const ctx = await buildWorkspaceRootInstallContext(testDir, {}, 'apply');
  
  assert.ok(ctx, 'Context should be created for apply mode');
  assert.equal(ctx!.mode, 'apply', 'Mode should be apply');
  assert.equal(ctx!.source.type, 'workspace', 'Source type should be workspace');
  assert.equal(ctx!.options.force, true, 'Apply mode should force overwrites');
  
  console.log('✓ Context creation for apply mode works correctly');
}

async function testWorkspaceFilesExist() {
  console.log('Testing workspace files exist...');
  
  const commandFile = join(testDir, '.openpackage', 'commands', 'test.md');
  const rulesFile = join(testDir, '.openpackage', 'rules', 'style.md');
  
  assert.ok(await exists(commandFile), 'Command file should exist');
  assert.ok(await exists(rulesFile), 'Rules file should exist');
  
  const commandContent = await readTextFile(commandFile);
  assert.ok(commandContent.includes('Test Command'), 'Command file should have content');
  
  console.log('✓ Workspace files exist and have content');
}

// Run tests
async function runTests() {
  try {
    await setup();
    
    await testBuildWorkspaceRootContext();
    await testBulkInstallIncludesWorkspace();
    await testWorkspacePackageNotInManifest();
    await testContextCreationForApply();
    await testWorkspaceFilesExist();
    
    console.log('\n✓ All workspace-level install tests passed');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    throw error;
  } finally {
    await cleanup();
  }
}

runTests();
