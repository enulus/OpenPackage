import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';
import { runPackPipeline } from '../../../src/core/pack/pack-pipeline.js';
import { exists } from '../../../src/utils/fs.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'pack-name-resolution-test');

async function setupTestEnvironment() {
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });

  // Create test package structure
  const packageDir = join(TEST_DIR, 'test-package');
  await mkdir(packageDir, { recursive: true });
  
  await writeFile(
    join(packageDir, 'openpackage.yml'),
    'name: test-package\nversion: 1.0.0\n'
  );
  
  await writeFile(
    join(packageDir, 'README.md'),
    '# Test Package\n'
  );

  // Create workspace with .openpackage/packages/
  const workspaceDir = join(TEST_DIR, 'workspace');
  const workspacePackagesDir = join(workspaceDir, '.openpackage', 'packages', 'workspace-pkg');
  await mkdir(workspacePackagesDir, { recursive: true });
  
  await writeFile(
    join(workspacePackagesDir, 'openpackage.yml'),
    'name: workspace-pkg\nversion: 2.0.0\n'
  );
  
  await writeFile(
    join(workspacePackagesDir, 'README.md'),
    '# Workspace Package\n'
  );

  return { packageDir, workspaceDir, workspacePackagesDir };
}

async function testCwdPack() {
  console.log('\n--- Test 1: Pack from CWD (no name argument) ---');
  const { packageDir } = await setupTestEnvironment();
  
  // Change to package directory
  const originalCwd = process.cwd();
  process.chdir(packageDir);
  
  try {
    const result = await runPackPipeline(undefined, { dryRun: true });
    
    if (result.success && result.data) {
      console.log('✓ CWD pack succeeded');
      console.log(`  Destination: ${result.data.destination}`);
      console.log(`  Files: ${result.data.files}`);
    } else {
      throw new Error(`Pack failed: ${result.error}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
}

async function testCwdPackWithName() {
  console.log('\n--- Test 2: Pack from CWD with matching name ---');
  const { packageDir } = await setupTestEnvironment();
  
  const originalCwd = process.cwd();
  process.chdir(packageDir);
  
  try {
    const result = await runPackPipeline('test-package', { dryRun: true });
    
    if (result.success && result.data) {
      console.log('✓ CWD pack with name succeeded');
      console.log(`  Destination: ${result.data.destination}`);
      console.log(`  Files: ${result.data.files}`);
    } else {
      throw new Error(`Pack failed: ${result.error}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
}

async function testWorkspacePackFromOutside() {
  console.log('\n--- Test 3: Pack workspace package from outside ---');
  const { workspaceDir } = await setupTestEnvironment();
  
  const originalCwd = process.cwd();
  process.chdir(workspaceDir);
  
  try {
    const result = await runPackPipeline('workspace-pkg', { dryRun: true });
    
    if (result.success && result.data) {
      console.log('✓ Workspace package pack succeeded');
      console.log(`  Destination: ${result.data.destination}`);
      console.log(`  Files: ${result.data.files}`);
    } else {
      throw new Error(`Pack failed: ${result.error}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
}

async function testPackNonExistentPackage() {
  console.log('\n--- Test 4: Pack non-existent package (should fail) ---');
  const { workspaceDir } = await setupTestEnvironment();
  
  const originalCwd = process.cwd();
  process.chdir(workspaceDir);
  
  try {
    const result = await runPackPipeline('non-existent-pkg', { dryRun: true });
    
    if (!result.success) {
      console.log('✓ Pack correctly failed for non-existent package');
      console.log(`  Error: ${result.error}`);
    } else {
      throw new Error('Pack should have failed but succeeded');
    }
  } finally {
    process.chdir(originalCwd);
  }
}

async function testCwdPriorityOverWorkspace() {
  console.log('\n--- Test 5: CWD priority over workspace package ---');
  const { workspaceDir, workspacePackagesDir } = await setupTestEnvironment();
  
  // Create a package in CWD with same name as workspace package
  const cwdPackage = join(workspaceDir, 'cwd-test');
  await mkdir(cwdPackage, { recursive: true });
  await writeFile(
    join(cwdPackage, 'openpackage.yml'),
    'name: workspace-pkg\nversion: 3.0.0\n'
  );
  await writeFile(
    join(cwdPackage, 'README.md'),
    '# CWD Override Package\n'
  );
  
  const originalCwd = process.cwd();
  process.chdir(cwdPackage);
  
  try {
    const result = await runPackPipeline('workspace-pkg', { dryRun: true });
    
    if (result.success && result.data) {
      console.log('✓ CWD package correctly took priority');
      console.log(`  Destination: ${result.data.destination}`);
      // Should be version 3.0.0 from CWD, not 2.0.0 from workspace
      if (result.data.destination.includes('3.0.0')) {
        console.log('✓ Correct version (3.0.0 from CWD)');
      } else if (result.data.destination.includes('2.0.0')) {
        throw new Error('Wrong version selected (2.0.0 from workspace instead of 3.0.0 from CWD)');
      }
    } else {
      throw new Error(`Pack failed: ${result.error}`);
    }
  } finally {
    process.chdir(originalCwd);
  }
}

async function cleanup() {
  await rm(TEST_DIR, { recursive: true, force: true });
}

async function runTests() {
  try {
    await testCwdPack();
    await testCwdPackWithName();
    await testWorkspacePackFromOutside();
    await testPackNonExistentPackage();
    await testCwdPriorityOverWorkspace();
    
    console.log('\n✅ All pack name resolution tests passed');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

runTests();
