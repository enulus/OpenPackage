import { installPackageWithFlows } from './src/core/install/flow-based-installer.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

async function test() {
  const testRoot = join(tmpdir(), 'opkg-flow-test-' + Date.now());
  const workspaceRoot = join(testRoot, 'workspace');
  const packageRootA = join(testRoot, 'packages', 'package-a');
  
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(packageRootA, { recursive: true });
  
  // Create platform config
  const platformConfig = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      rootFile: 'TEST.md',
      flows: [
        {
          from: 'AGENTS.md',
          to: 'AGENTS.md'
        },
        {
          from: 'rules/{name}.md',
          to: '.test/rules/{name}.mdc'
        }
      ]
    }
  };
  
  const openpackageDir = join(workspaceRoot, '.openpackage');
  await fs.mkdir(openpackageDir, { recursive: true });
  await fs.writeFile(join(openpackageDir, 'platforms.jsonc'), JSON.stringify(platformConfig, null, 2));
  
  // Create only AGENTS.md
  await fs.writeFile(join(packageRootA, 'AGENTS.md'), '# Test Agent\n\nDescription');
  
  // Install package
  console.log('Installing package...');
  const result = await installPackageWithFlows({
    packageName: '@test/simple',
    packageRoot: packageRootA,
    workspaceRoot,
    platform: 'test-platform',
    packageVersion: '1.0.0',
    priority: 100,
    dryRun: false
  });
  
  console.log('\n=== Result ===');
  console.log('Success:', result.success);
  console.log('Files processed:', result.filesProcessed);
  console.log('Files written:', result.filesWritten);
  console.log('Errors:', result.errors.length);
  
  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const error of result.errors) {
      console.log('  -', error.message);
    }
  }
  
  // List files in package directory
  console.log('\n=== Files in package directory ===');
  const packageFiles = await fs.readdir(packageRootA);
  console.log(packageFiles);
  
  // Cleanup
  await fs.rm(testRoot, { recursive: true, force: true });
  
  // Verify
  if (result.filesProcessed === 1 && result.filesWritten === 1) {
    console.log('\n✅ TEST PASSED!');
  } else {
    console.log('\n❌ TEST FAILED!');
    console.log(`Expected: filesProcessed=1, filesWritten=1`);
    console.log(`Actual: filesProcessed=${result.filesProcessed}, filesWritten=${result.filesWritten}`);
    process.exit(1);
  }
}

test().catch(console.error);
