/**
 * Test suite for the show command
 */

import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';
import { runShowPipeline } from '../../src/core/show/show-pipeline.js';
import { packageManager } from '../../src/core/package.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'show-command-test');

async function setupTestEnvironment() {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });

  // Create a test package in workspace
  const workspaceDir = join(TEST_DIR, 'workspace');
  const workspacePackageDir = join(workspaceDir, '.openpackage', 'packages', 'test-package');
  await mkdir(workspacePackageDir, { recursive: true });

  await writeFile(
    join(workspacePackageDir, 'openpackage.yml'),
    `name: test-package
version: 1.2.3
description: A test package for show command
keywords:
  - test
  - example
author: Test Author
license: MIT
homepage: https://example.com
repository:
  type: git
  url: https://github.com/test/test-package.git
private: false
packages:
  - name: dependency-one
    version: ^1.0.0
dev-packages:
  - name: dev-dependency
    version: ^2.0.0
`
  );

  await writeFile(
    join(workspacePackageDir, 'README.md'),
    '# Test Package\n\nThis is a test package.\n'
  );

  await mkdir(join(workspacePackageDir, 'commands'), { recursive: true });
  await writeFile(
    join(workspacePackageDir, 'commands', 'test.md'),
    '# Test Command\n'
  );

  // Create a package in CWD
  const cwdPackageDir = join(TEST_DIR, 'cwd-package');
  await mkdir(cwdPackageDir, { recursive: true });

  await writeFile(
    join(cwdPackageDir, 'openpackage.yml'),
    `name: cwd-package
version: 0.1.0
description: Package in current directory
`
  );

  await writeFile(
    join(cwdPackageDir, 'README.md'),
    '# CWD Package\n'
  );

  // Create a registry package
  await packageManager.savePackage({
    metadata: {
      name: 'registry-package',
      version: '2.0.0',
      description: 'Package in registry',
      keywords: ['registry', 'test']
    } as any,
    files: [
      {
        path: 'openpackage.yml',
        content: 'name: registry-package\nversion: 2.0.0\n'
      },
      {
        path: 'README.md',
        content: '# Registry Package\n'
      }
    ]
  });

  return { workspaceDir, cwdPackageDir, workspacePackageDir };
}

async function testShowWorkspacePackage() {
  console.log('\n--- Test 1: Show workspace package by name ---');
  const { workspaceDir } = await setupTestEnvironment();

  const result = await runShowPipeline('test-package', workspaceDir);

  if (!result.success) {
    throw new Error(`Show failed: ${result.error}`);
  }

  const metadata = result.data as any;
  if (metadata.name !== 'test-package') {
    throw new Error(`Expected name 'test-package', got '${metadata.name}'`);
  }
  if (metadata.version !== '1.2.3') {
    throw new Error(`Expected version '1.2.3', got '${metadata.version}'`);
  }

  console.log('✓ Workspace package shown successfully');
}

async function testShowByPath() {
  console.log('\n--- Test 2: Show package by path ---');
  const { workspacePackageDir, workspaceDir } = await setupTestEnvironment();

  const relativePath = '.openpackage/packages/test-package';
  const result = await runShowPipeline(relativePath, workspaceDir);

  if (!result.success) {
    throw new Error(`Show by path failed: ${result.error}`);
  }

  const metadata = result.data as any;
  if (metadata.name !== 'test-package') {
    throw new Error(`Expected name 'test-package', got '${metadata.name}'`);
  }

  console.log('✓ Package shown by path successfully');
}

async function testShowCwdPackage() {
  console.log('\n--- Test 3: Show package from CWD ---');
  const { cwdPackageDir } = await setupTestEnvironment();

  const result = await runShowPipeline('.', cwdPackageDir);

  if (!result.success) {
    throw new Error(`Show CWD package failed: ${result.error}`);
  }

  const metadata = result.data as any;
  if (metadata.name !== 'cwd-package') {
    throw new Error(`Expected name 'cwd-package', got '${metadata.name}'`);
  }

  console.log('✓ CWD package shown successfully');
}

async function testShowRegistryPackage() {
  console.log('\n--- Test 4: Show registry package ---');
  const { workspaceDir } = await setupTestEnvironment();

  const result = await runShowPipeline('registry-package', workspaceDir);

  if (!result.success) {
    throw new Error(`Show registry package failed: ${result.error}`);
  }

  const metadata = result.data as any;
  if (metadata.name !== 'registry-package') {
    throw new Error(`Expected name 'registry-package', got '${metadata.name}'`);
  }
  if (metadata.version !== '2.0.0') {
    throw new Error(`Expected version '2.0.0', got '${metadata.version}'`);
  }

  console.log('✓ Registry package shown successfully');
}

async function testShowNonExistentPackage() {
  console.log('\n--- Test 5: Show non-existent package (should fail) ---');
  const { workspaceDir } = await setupTestEnvironment();

  const result = await runShowPipeline('non-existent-package', workspaceDir);

  if (result.success) {
    throw new Error('Show should have failed for non-existent package');
  }

  if (!result.error || !result.error.includes('not found')) {
    throw new Error(`Expected 'not found' error, got: ${result.error}`);
  }

  console.log('✓ Non-existent package handled correctly');
}

async function testShowWithVersion() {
  console.log('\n--- Test 6: Show package with version ---');
  const { workspaceDir } = await setupTestEnvironment();

  const result = await runShowPipeline('registry-package@2.0.0', workspaceDir);

  if (!result.success) {
    throw new Error(`Show with version failed: ${result.error}`);
  }

  const metadata = result.data as any;
  if (metadata.version !== '2.0.0') {
    throw new Error(`Expected version '2.0.0', got '${metadata.version}'`);
  }

  console.log('✓ Package with version shown successfully');
}

async function testMultiScopeDetection() {
  console.log('\n--- Test 7: Multi-scope detection and hint display ---');
  
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });

  const workspaceDir = join(TEST_DIR, 'workspace');
  
  // Create the same package in workspace scope
  const workspacePackageDir = join(workspaceDir, '.openpackage', 'packages', 'multi-scope-pkg');
  await mkdir(workspacePackageDir, { recursive: true });
  await writeFile(
    join(workspacePackageDir, 'openpackage.yml'),
    `name: multi-scope-pkg
version: 2.0.0
description: Workspace version
`
  );
  await writeFile(join(workspacePackageDir, 'README.md'), '# Workspace version\n');

  // Create the same package in global scope
  const dirs = await import('../src/core/directory.js');
  const openPackageDirs = dirs.getOpenPackageDirectories();
  const globalPackageDir = join(openPackageDirs.data, 'packages', 'multi-scope-pkg');
  await mkdir(globalPackageDir, { recursive: true });
  await writeFile(
    join(globalPackageDir, 'openpackage.yml'),
    `name: multi-scope-pkg
version: 1.5.0
description: Global version
`
  );
  await writeFile(join(globalPackageDir, 'README.md'), '# Global version\n');

  // Create the same package in registry scope
  await packageManager.savePackage({
    metadata: {
      name: 'multi-scope-pkg',
      version: '1.8.0',
      description: 'Registry version'
    } as any,
    files: [
      {
        path: 'openpackage.yml',
        content: 'name: multi-scope-pkg\nversion: 1.8.0\n'
      },
      {
        path: 'README.md',
        content: '# Registry version\n'
      }
    ]
  });

  // Now run show command - should show workspace version with hints about other scopes
  const result = await runShowPipeline('multi-scope-pkg', workspaceDir);

  if (!result.success) {
    throw new Error(`Multi-scope show failed: ${result.error}`);
  }

  const metadata = result.data as any;
  
  // Should resolve to workspace version (highest priority)
  if (metadata.name !== 'multi-scope-pkg') {
    throw new Error(`Expected name 'multi-scope-pkg', got '${metadata.name}'`);
  }
  if (metadata.version !== '2.0.0') {
    throw new Error(`Expected workspace version '2.0.0', got '${metadata.version}'`);
  }
  if (metadata.description !== 'Workspace version') {
    throw new Error(`Expected workspace description, got '${metadata.description}'`);
  }

  console.log('✓ Multi-scope package shown with workspace priority');
  console.log('✓ Scope hints should be displayed in output (visual verification required)');

  // Cleanup global package
  await rm(globalPackageDir, { recursive: true, force: true });
}

async function cleanup() {
  await rm(TEST_DIR, { recursive: true, force: true });
}

async function runTests() {
  try {
    await testShowWorkspacePackage();
    await testShowByPath();
    await testShowCwdPackage();
    await testShowRegistryPackage();
    await testShowNonExistentPackage();
    await testShowWithVersion();
    await testMultiScopeDetection();

    console.log('\n✅ All show command tests passed');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

runTests();
