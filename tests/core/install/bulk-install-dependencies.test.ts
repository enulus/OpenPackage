/**
 * Test bulk installation reads from dependencies and dev-dependencies fields
 * 
 * This test verifies the fix for the regression where bulk install was reading
 * from the old 'packages' field instead of the new 'dependencies' field.
 */

import assert from 'node:assert/strict';
import { rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildInstallContext } from '../../../src/core/install/unified/context-builders.js';
import { writeTextFile } from '../../../src/utils/fs.js';

// Create temporary test workspace
const testDir = join(tmpdir(), `opkg-test-dependencies-${Date.now()}`);

async function setup() {
  await mkdir(testDir, { recursive: true });
  
  // Create .openpackage/ structure
  const openpackageDir = join(testDir, '.openpackage');
  await mkdir(openpackageDir, { recursive: true });
  
  // Create workspace manifest with dependencies (new format)
  const manifestPath = join(openpackageDir, 'openpackage.yml');
  await writeTextFile(manifestPath, `name: test-workspace
version: 1.0.0
dependencies:
  - name: gh@anthropics/claude-plugins-official/plugins/feature-dev
    url: https://github.com/anthropics/claude-plugins-official.git
    path: plugins/feature-dev
  - name: gh@wshobson/agents/plugins/ui-design/skills/mobile-ios-design
    url: https://github.com/wshobson/agents.git
    path: plugins/ui-design/skills/mobile-ios-design
dev-dependencies:
  - name: test-dev-package
    version: 1.0.0
`);
}

async function cleanup() {
  await rm(testDir, { recursive: true, force: true });
}

async function testBulkInstallReadsDependencies() {
  console.log('Testing bulk install reads from dependencies field...');
  
  const contexts = await buildInstallContext(testDir, undefined, {});
  
  assert.ok(Array.isArray(contexts), 'Should return array of contexts');
  
  // Debug: log what we got
  console.log(`  Total contexts: ${contexts.length}`);
  for (const ctx of contexts) {
    console.log(`  - ${ctx.source.type}: ${ctx.source.packageName}`);
  }
  
  // Should have: 1 workspace context + 2 dependencies + 1 dev-dependency = 4 total
  assert.ok(contexts.length >= 3, `Should have at least 3 contexts (workspace + deps), got ${contexts.length}`);
  
  // Find the git source contexts
  const gitContexts = contexts.filter(ctx => ctx.source.type === 'git');
  
  console.log(`  Git contexts: ${gitContexts.length}`);
  
  assert.ok(gitContexts.length >= 2, `Should have at least 2 git contexts, got ${gitContexts.length}`);
  
  // Verify first dependency
  const featureDevCtx = gitContexts.find(ctx => 
    ctx.source.packageName === 'gh@anthropics/claude-plugins-official/plugins/feature-dev'
  );
  assert.ok(featureDevCtx, 'Should have context for feature-dev plugin');
  assert.equal(featureDevCtx?.source.type, 'git');
  assert.equal(featureDevCtx?.source.gitUrl, 'https://github.com/anthropics/claude-plugins-official.git');
  assert.equal(featureDevCtx?.source.gitPath, 'plugins/feature-dev');
  
  // Verify second dependency
  const skillCtx = gitContexts.find(ctx => 
    ctx.source.packageName === 'gh@wshobson/agents/plugins/ui-design/skills/mobile-ios-design'
  );
  assert.ok(skillCtx, 'Should have context for mobile-ios-design skill');
  assert.equal(skillCtx?.source.type, 'git');
  assert.equal(skillCtx?.source.gitUrl, 'https://github.com/wshobson/agents.git');
  assert.equal(skillCtx?.source.gitPath, 'plugins/ui-design/skills/mobile-ios-design');
  
  console.log('✓ Bulk install correctly reads dependencies field');
}

async function testBulkInstallReadsDevDependencies() {
  console.log('Testing bulk install reads from dev-dependencies field...');
  
  const contexts = await buildInstallContext(testDir, undefined, {});
  
  // Find the registry source contexts
  const registryContexts = contexts.filter(ctx => ctx.source.type === 'registry');
  
  assert.ok(registryContexts.length >= 1, `Should have at least 1 registry context, got ${registryContexts.length}`);
  
  // Verify dev-dependency
  const devCtx = registryContexts.find(ctx => 
    ctx.source.packageName === 'test-dev-package'
  );
  assert.ok(devCtx, 'Should have context for dev package');
  assert.equal(devCtx?.source.type, 'registry');
  assert.equal(devCtx?.source.version, '1.0.0');
  
  console.log('✓ Bulk install correctly reads dev-dependencies field');
}

async function testBulkInstallContextStructure() {
  console.log('Testing bulk install context structure...');
  
  const contexts = await buildInstallContext(testDir, undefined, {});
  
  // Verify all contexts have required fields
  for (const ctx of contexts) {
    assert.ok(ctx.source, 'Context should have source');
    assert.ok(ctx.source.type, 'Source should have type');
    assert.ok(ctx.source.packageName, 'Source should have packageName');
    assert.equal(ctx.mode, 'install', 'Mode should be install');
    assert.ok(Array.isArray(ctx.platforms), 'Platforms should be array');
    assert.equal(ctx.cwd, testDir, 'CWD should match');
    assert.equal(ctx.targetDir, '.', 'Target dir should be .');
  }
  
  console.log('✓ All contexts have correct structure');
}

// Run tests
async function runTests() {
  try {
    await setup();
    
    await testBulkInstallReadsDependencies();
    await testBulkInstallReadsDevDependencies();
    await testBulkInstallContextStructure();
    
    console.log('\n✓ All bulk install dependency tests passed');
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    throw error;
  } finally {
    await cleanup();
  }
}

runTests();
