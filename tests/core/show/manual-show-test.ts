/**
 * Manual test for scope hints in show command
 */

import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';
import { runShowPipeline } from '../src/core/show/show-pipeline.js';
import { packageManager } from '../src/core/package.js';
import { getOpenPackageDirectories } from '../src/core/directory.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'manual-show-test');

async function test() {
  console.log('Setting up test environment...');
  await rm(TEST_DIR, { recursive: true, force: true });
  await mkdir(TEST_DIR, { recursive: true });

  const workspaceDir = join(TEST_DIR, 'workspace');
  
  // Create the same package in workspace scope
  const workspacePackageDir = join(workspaceDir, '.openpackage', 'packages', 'demo-pkg');
  await mkdir(workspacePackageDir, { recursive: true });
  await writeFile(
    join(workspacePackageDir, 'openpackage.yml'),
    `name: demo-pkg
version: 2.0.0
description: Workspace version
`
  );

  // Create the same package in global scope
  const openPackageDirs = getOpenPackageDirectories();
  const globalPackageDir = join(openPackageDirs.data, 'packages', 'demo-pkg');
  await mkdir(globalPackageDir, { recursive: true });
  await writeFile(
    join(globalPackageDir, 'openpackage.yml'),
    `name: demo-pkg
version: 1.5.0
description: Global version
`
  );

  // Create the same package in registry scope
  await packageManager.savePackage({
    metadata: {
      name: 'demo-pkg',
      version: '1.8.0',
      description: 'Registry version'
    } as any,
    files: [
      {
        path: 'openpackage.yml',
        content: 'name: demo-pkg\nversion: 1.8.0\n'
      }
    ]
  });

  console.log('\n=== Running opkg show demo-pkg ===\n');
  
  // First, let's test scope discovery directly
  const { discoverPackagesAcrossScopes } = await import('../src/core/show/scope-discovery.js');
  const discovery = await discoverPackagesAcrossScopes('demo-pkg', workspaceDir);
  console.log('\nScope Discovery Debug:');
  console.log(`Found ${discovery.packagesInScopes.length} packages:`);
  for (const pkg of discovery.packagesInScopes) {
    console.log(`  - ${pkg.scope}: ${pkg.path} (v${pkg.version})`);
  }
  console.log('');
  
  // Check what the package input will be classified as
  const { classifyPackageInput } = await import('../src/utils/package-input.js');
  const classification = await classifyPackageInput('demo-pkg', workspaceDir);
  console.log('Package Classification:');
  console.log(`  Type: ${classification.type}`);
  console.log('');
  
  const result = await runShowPipeline('demo-pkg', workspaceDir);

  if (!result.success) {
    console.error('Show command failed:', result.error);
    process.exit(1);
  }

  console.log('\n=== Test completed successfully ===');
  console.log('The output above should include scope hints showing global and registry versions.');

  // Cleanup
  await rm(TEST_DIR, { recursive: true, force: true });
  await rm(globalPackageDir, { recursive: true, force: true });
}

test().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});
