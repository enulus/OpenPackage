import { installPackagesWithFlows } from './src/core/install/flow-based-installer.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

async function test() {
  const testRoot = join(tmpdir(), 'opkg-flow-test-' + Date.now());
  const workspaceRoot = join(testRoot, 'workspace');
  const packageRootA = join(testRoot, 'packages', 'package-a');
  const packageRootB = join(testRoot, 'packages', 'package-b');
  
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(packageRootA, { recursive: true });
  await fs.mkdir(packageRootB, { recursive: true });
  
  // Create platform config
  const platformConfig = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      rootFile: 'TEST.md',
      flows: [
        {
          from: 'settings.json',
          to: '.test/settings.json',
          merge: 'deep'
        }
      ]
    }
  };
  
  const openpackageDir = join(workspaceRoot, '.openpackage');
  await fs.mkdir(openpackageDir, { recursive: true });
  await fs.writeFile(join(openpackageDir, 'platforms.jsonc'), JSON.stringify(platformConfig, null, 2));
  
  // Create package files
  await fs.writeFile(join(packageRootA, 'settings.json'), JSON.stringify({
    setting1: 'from-a',
    settingA: 'only-in-a'
  }, null, 2));
  
  await fs.writeFile(join(packageRootB, 'settings.json'), JSON.stringify({
    setting1: 'from-b',
    settingB: 'only-in-b'
  }, null, 2));
  
  // Install both packages
  console.log('Installing packages...');
  const result = await installPackagesWithFlows([
    {
      packageName: '@test/pkg-a',
      packageRoot: packageRootA,
      packageVersion: '1.0.0',
      priority: 100
    },
    {
      packageName: '@test/pkg-b',
      packageRoot: packageRootB,
      packageVersion: '1.0.0',
      priority: 50
    }
  ], workspaceRoot, 'test-platform', {
    dryRun: false
  });
  
  console.log('\n=== Result ===');
  console.log('Success:', result.success);
  console.log('Files processed:', result.filesProcessed);
  console.log('Files written:', result.filesWritten);
  console.log('Conflicts:', result.conflicts.length);
  console.log('Errors:', result.errors.length);
  
  if (result.conflicts.length > 0) {
    console.log('\nConflicts:');
    for (const conflict of result.conflicts) {
      console.log('  -', conflict.message);
    }
  }
  
  // Read merged file
  const content = await fs.readFile(join(workspaceRoot, '.test/settings.json'), 'utf8');
  console.log('\n=== Merged File Content ===');
  console.log(content);
  
  const parsed = JSON.parse(content);
  console.log('\n=== Parsed Content ===');
  console.log('setting1:', parsed.setting1, '(expected: from-a)');
  console.log('settingA:', parsed.settingA, '(expected: only-in-a)');
  console.log('settingB:', parsed.settingB, '(expected: only-in-b)');
  
  // Cleanup
  await fs.rm(testRoot, { recursive: true, force: true });
  
  // Verify
  if (parsed.setting1 === 'from-a' && parsed.settingA === 'only-in-a' && parsed.settingB === 'only-in-b') {
    console.log('\n✅ TEST PASSED!');
  } else {
    console.log('\n❌ TEST FAILED!');
    process.exit(1);
  }
}

test().catch(console.error);
