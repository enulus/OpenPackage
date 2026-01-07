/**
 * Test suite for scope discovery functionality
 */

import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';
import { discoverPackagesAcrossScopes, hasMultipleScopes } from '../../../src/core/show/scope-discovery.js';
import { packageManager } from '../../../src/core/package.js';
import { getOpenPackageDirectories } from '../../../src/core/directory.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'scope-discovery-test');

async function setupMultiScopePackage() {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });

  const workspaceDir = join(TEST_DIR, 'workspace');
  
  // Create the same package in workspace scope
  const workspacePackageDir = join(workspaceDir, '.openpackage', 'packages', 'test-pkg');
  await mkdir(workspacePackageDir, { recursive: true });
  await writeFile(
    join(workspacePackageDir, 'openpackage.yml'),
    `name: test-pkg
version: 2.0.0
description: Workspace version
`
  );

  // Create the same package in global scope
  const openPackageDirs = getOpenPackageDirectories();
  const globalPackageDir = join(openPackageDirs.data, 'packages', 'test-pkg');
  await mkdir(globalPackageDir, { recursive: true });
  await writeFile(
    join(globalPackageDir, 'openpackage.yml'),
    `name: test-pkg
version: 1.5.0
description: Global version
`
  );

  // Create the same package in registry scope
  await packageManager.savePackage({
    metadata: {
      name: 'test-pkg',
      version: '1.8.0',
      description: 'Registry version'
    } as any,
    files: [
      {
        path: 'openpackage.yml',
        content: 'name: test-pkg\nversion: 1.8.0\n'
      }
    ]
  });

  return { workspaceDir, globalPackageDir };
}

async function testDiscoverAllScopes() {
  console.log('\n--- Test 1: Discover packages across all scopes ---');
  const { workspaceDir } = await setupMultiScopePackage();

  const result = await discoverPackagesAcrossScopes('test-pkg', workspaceDir);

  console.log(`Found ${result.packagesInScopes.length} packages with name '${result.packageName}':`);
  
  for (const pkg of result.packagesInScopes) {
    console.log(`  • ${pkg.scope}: v${pkg.version} at ${pkg.path}`);
    console.log(`    Command: ${pkg.showCommand}`);
  }

  if (result.packagesInScopes.length !== 3) {
    throw new Error(`Expected 3 scopes, found ${result.packagesInScopes.length}`);
  }

  const scopes = result.packagesInScopes.map(p => p.scope).sort();
  const expectedScopes = ['global', 'registry', 'workspace'];
  
  if (JSON.stringify(scopes) !== JSON.stringify(expectedScopes)) {
    throw new Error(`Expected scopes ${expectedScopes.join(', ')}, found ${scopes.join(', ')}`);
  }

  console.log('✓ All scopes discovered correctly');
}

async function testHasMultipleScopes() {
  console.log('\n--- Test 2: Check if package has multiple scopes ---');
  const { workspaceDir } = await setupMultiScopePackage();

  const hasMultiple = await hasMultipleScopes('test-pkg', workspaceDir);

  if (!hasMultiple) {
    throw new Error('Expected hasMultipleScopes to return true');
  }

  console.log('✓ hasMultipleScopes correctly detected multiple scopes');
}

async function testSingleScopePackage() {
  console.log('\n--- Test 3: Package in single scope only ---');
  
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });

  const workspaceDir = join(TEST_DIR, 'workspace');
  
  // Create package only in workspace
  const workspacePackageDir = join(workspaceDir, '.openpackage', 'packages', 'single-pkg');
  await mkdir(workspacePackageDir, { recursive: true });
  await writeFile(
    join(workspacePackageDir, 'openpackage.yml'),
    `name: single-pkg
version: 1.0.0
`
  );

  const result = await discoverPackagesAcrossScopes('single-pkg', workspaceDir);

  if (result.packagesInScopes.length !== 1) {
    throw new Error(`Expected 1 scope, found ${result.packagesInScopes.length}`);
  }

  if (result.packagesInScopes[0].scope !== 'workspace') {
    throw new Error(`Expected workspace scope, found ${result.packagesInScopes[0].scope}`);
  }

  const hasMultiple = await hasMultipleScopes('single-pkg', workspaceDir);
  if (hasMultiple) {
    throw new Error('Expected hasMultipleScopes to return false for single scope');
  }

  console.log('✓ Single scope package detected correctly');
}

async function testNonExistentPackage() {
  console.log('\n--- Test 4: Non-existent package ---');
  const { workspaceDir } = await setupMultiScopePackage();

  const result = await discoverPackagesAcrossScopes('non-existent-pkg', workspaceDir);

  if (result.packagesInScopes.length !== 0) {
    throw new Error(`Expected 0 scopes for non-existent package, found ${result.packagesInScopes.length}`);
  }

  const hasMultiple = await hasMultipleScopes('non-existent-pkg', workspaceDir);
  if (hasMultiple) {
    throw new Error('Expected hasMultipleScopes to return false for non-existent package');
  }

  console.log('✓ Non-existent package handled correctly');
}

async function cleanup() {
  await rm(TEST_DIR, { recursive: true, force: true });
  
  // Cleanup global package
  const openPackageDirs = getOpenPackageDirectories();
  const globalPackageDir = join(openPackageDirs.data, 'packages', 'test-pkg');
  await rm(globalPackageDir, { recursive: true, force: true }).catch(() => {});
}

async function runTests() {
  try {
    await testDiscoverAllScopes();
    await testHasMultipleScopes();
    await testSingleScopePackage();
    await testNonExistentPackage();

    console.log('\n✅ All scope discovery tests passed');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

runTests();
