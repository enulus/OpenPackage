/**
 * Platform-Specific Files Test
 * 
 * Tests that files with platform suffixes (e.g., commands/foo.claude.md) are:
 * 1. Only installed for the specific platform
 * 2. Have the platform suffix stripped in the target path
 * 3. Correctly recorded in openpackage.index.yml
 */

import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';

const { installPackageWithFlows } = await import(
  new URL('../src/core/install/flow-based-installer.js', import.meta.url).href
);

const { installPackageByIndexWithFlows } = await import(
  new URL('../src/utils/flow-index-installer.js', import.meta.url).href
);

console.log('platform-specific-files tests starting');

let testDir: string;
let packageRoot: string;
let workspaceRoot: string;

async function setupTest() {
  testDir = join(tmpdir(), `opkg-test-platform-${Date.now()}`);
  packageRoot = join(testDir, 'package');
  workspaceRoot = join(testDir, 'workspace');

  // Setup package with platform-specific files
  await fs.mkdir(join(packageRoot, 'commands'), { recursive: true });
  await fs.writeFile(
    join(packageRoot, 'commands', 'read-specs.claude.md'),
    '# Read Specs (Claude-specific)'
  );
  await fs.writeFile(
    join(packageRoot, 'commands', 'universal.md'),
    '# Universal Command'
  );

  // Setup workspace
  await fs.mkdir(workspaceRoot, { recursive: true });
  
  // Create platforms.jsonc
  await fs.writeFile(
    join(workspaceRoot, 'platforms.jsonc'),
    JSON.stringify({
      claude: {
        name: 'Claude',
        rootDir: '.claude',
        flows: [{ from: 'commands/**/*.md', to: '.claude/commands/**/*.md' }]
      },
      cursor: {
        name: 'Cursor',
        rootDir: '.cursor',
        flows: [{ from: 'commands/**/*.md', to: '.cursor/commands/**/*.md' }]
      }
    })
  );
}

async function cleanupTest() {
  await fs.rm(testDir, { recursive: true, force: true }).catch(() => {});
}

async function testInstallsPlatformSpecificFileForMatchingPlatform() {
  await setupTest();
  
  try {
    const context = {
      packageName: 'test-pkg',
      packageRoot,
      workspaceRoot,
      platform: 'claude',
      packageVersion: '1.0.0',
      priority: 0,
      dryRun: false
    };

    const result = await installPackageWithFlows(context);

    // Should process both files (platform-specific and universal)
    assert.equal(result.filesProcessed, 2, 'should process 2 files');
    assert.equal(result.filesWritten, 2, 'should write 2 files');

    // Check file mapping
    assert.ok(result.fileMapping['commands/read-specs.claude.md'], 'should have mapping for platform-specific file');
    assert.ok(result.fileMapping['commands/universal.md'], 'should have mapping for universal file');
    
    console.log('✓ Installs platform-specific file for matching platform');
  } finally {
    await cleanupTest();
  }
}

async function testStripsPlatformSuffixFromTargetPath() {
  await setupTest();
  
  try {
    const context = {
      packageName: 'test-pkg',
      packageRoot,
      workspaceRoot,
      platform: 'claude',
      packageVersion: '1.0.0',
      priority: 0,
      dryRun: false
    };

    const result = await installPackageWithFlows(context);

    // Target should have suffix stripped
    const targets = result.fileMapping['commands/read-specs.claude.md'];
    assert.ok(targets, 'should have targets');
    assert.equal(targets.length, 1, 'should have 1 target');
    
    const targetPath = typeof targets[0] === 'string' ? targets[0] : targets[0].target;
    assert.equal(targetPath, '.claude/commands/read-specs.md', 'target should have suffix stripped');
    assert.ok(!targetPath.includes('.claude.md'), 'target should not contain .claude.md');

    // Verify file exists at target path
    const expectedPath = join(workspaceRoot, '.claude/commands/read-specs.md');
    await fs.access(expectedPath); // Should not throw

    // Verify file does NOT exist with suffix in name
    const wrongPath = join(workspaceRoot, '.claude/commands/read-specs.claude.md');
    let wrongExists = false;
    try {
      await fs.access(wrongPath);
      wrongExists = true;
    } catch {}
    
    assert.ok(!wrongExists, 'file should not exist with suffix in name');
    
    console.log('✓ Strips platform suffix from target path');
  } finally {
    await cleanupTest();
  }
}

async function testSkipsPlatformSpecificFileForNonMatchingPlatform() {
  await setupTest();
  
  try {
    const context = {
      packageName: 'test-pkg',
      packageRoot,
      workspaceRoot,
      platform: 'cursor',
      packageVersion: '1.0.0',
      priority: 0,
      dryRun: false
    };

    const result = await installPackageWithFlows(context);

    // Should only process universal file
    assert.equal(result.filesProcessed, 1, 'should only process 1 file');
    
    // Should not have mapping for .claude.md file
    assert.ok(!result.fileMapping['commands/read-specs.claude.md'], 'should not have mapping for .claude.md file');
    
    // Should have mapping for universal file
    assert.ok(result.fileMapping['commands/universal.md'], 'should have mapping for universal file');

    // Verify .claude.md file was NOT installed for cursor
    const claudeFile = join(workspaceRoot, '.cursor/commands/read-specs.md');
    let claudeExists = false;
    try {
      await fs.access(claudeFile);
      claudeExists = true;
    } catch {}
    
    assert.ok(!claudeExists, '.claude.md file should not be installed for cursor');
    
    console.log('✓ Skips platform-specific file for non-matching platform');
  } finally {
    await cleanupTest();
  }
}

async function testRecordsPlatformSpecificFilesCorrectlyInWorkspaceIndex() {
  await setupTest();
  
  try {
    await installPackageByIndexWithFlows(
      workspaceRoot,
      'test-pkg',
      '1.0.0',
      ['claude'],
      { dryRun: false },
      undefined,
      packageRoot
    );

    // Read workspace index
    const indexPath = join(workspaceRoot, '.openpackage', 'openpackage.index.yml');
    const indexContent = await fs.readFile(indexPath, 'utf8');

    // Should have source key with platform suffix
    assert.ok(indexContent.includes('commands/read-specs.claude.md:'), 'index should have source key with platform suffix');
    
    // Should have target without platform suffix
    assert.ok(indexContent.includes('.claude/commands/read-specs.md'), 'index should have target without platform suffix');
    
    // Should NOT have target with platform suffix
    assert.ok(!indexContent.includes('.claude/commands/read-specs.claude.md'), 'index should not have target with platform suffix');
    
    console.log('✓ Records platform-specific files correctly in workspace index');
  } finally {
    await cleanupTest();
  }
}

async function testHandlesMultiplePlatformSpecificVariantsCorrectly() {
  await setupTest();
  
  try {
    // Add more platform-specific variants
    await fs.writeFile(
      join(packageRoot, 'commands', 'read-specs.cursor.md'),
      '# Read Specs (Cursor-specific)'
    );

    // Install for both platforms
    await installPackageByIndexWithFlows(
      workspaceRoot,
      'test-pkg',
      '1.0.0',
      ['claude', 'cursor'],
      { dryRun: false },
      undefined,
      packageRoot
    );

    // Read workspace index
    const indexPath = join(workspaceRoot, '.openpackage', 'openpackage.index.yml');
    const indexContent = await fs.readFile(indexPath, 'utf8');

    // Should have both platform-specific files with correct mappings
    assert.ok(indexContent.includes('commands/read-specs.claude.md:'), 'should have claude variant');
    assert.ok(indexContent.includes('.claude/commands/read-specs.md'), 'should have claude target');
    
    assert.ok(indexContent.includes('commands/read-specs.cursor.md:'), 'should have cursor variant');
    assert.ok(indexContent.includes('.cursor/commands/read-specs.md'), 'should have cursor target');

    // Verify files exist at correct paths
    await fs.access(join(workspaceRoot, '.claude/commands/read-specs.md'));
    await fs.access(join(workspaceRoot, '.cursor/commands/read-specs.md'));
    
    console.log('✓ Handles multiple platform-specific variants correctly');
  } finally {
    await cleanupTest();
  }
}

async function testPreservesPlatformSuffixInSourceKeyButStripsInTarget() {
  await setupTest();
  
  try {
    const context = {
      packageName: 'test-pkg',
      packageRoot,
      workspaceRoot,
      platform: 'claude',
      packageVersion: '1.0.0',
      priority: 0,
      dryRun: false
    };

    const result = await installPackageWithFlows(context);

    // Source key should have platform suffix (as stored in package)
    assert.ok(result.fileMapping['commands/read-specs.claude.md'], 'source key should have platform suffix');
    
    // Target should NOT have platform suffix
    const targets = result.fileMapping['commands/read-specs.claude.md'];
    const targetPath = typeof targets[0] === 'string' ? targets[0] : targets[0].target;
    assert.equal(targetPath, '.claude/commands/read-specs.md', 'target should not have platform suffix');
    assert.ok(!targetPath.match(/\.claude\.md$/), 'target should not end with .claude.md');
    
    console.log('✓ Preserves platform suffix in source key but strips in target');
  } finally {
    await cleanupTest();
  }
}

async function testPlatformSpecificFileOverridesUniversalFile() {
  await setupTest();
  
  try {
    // Add universal file that should be overridden by the platform-specific file for claude
    await fs.writeFile(
      join(packageRoot, 'commands', 'read-specs.md'),
      '# Read Specs (Universal)'
    );
    
    // The .claude.md file already exists from setup
    // Also add another platform-specific variant for cursor
    await fs.writeFile(
      join(packageRoot, 'commands', 'read-specs.cursor.md'),
      '# Read Specs (Cursor-specific)'
    );
    
    // Update platforms.jsonc to include opencode
    await fs.writeFile(
      join(workspaceRoot, 'platforms.jsonc'),
      JSON.stringify({
        claude: {
          name: 'Claude',
          rootDir: '.claude',
          flows: [{ from: 'commands/**/*.md', to: '.claude/commands/**/*.md' }]
        },
        cursor: {
          name: 'Cursor',
          rootDir: '.cursor',
          flows: [{ from: 'commands/**/*.md', to: '.cursor/commands/**/*.md' }]
        },
        opencode: {
          name: 'OpenCode',
          rootDir: '.opencode',
          flows: [{ from: 'commands/**/*.md', to: '.opencode/command/**/*.md' }]
        }
      })
    );

    // Install for all three platforms
    await installPackageByIndexWithFlows(
      workspaceRoot,
      'test-pkg',
      '1.0.0',
      ['claude', 'cursor', 'opencode'],
      { dryRun: false },
      undefined,
      packageRoot
    );

    // Read workspace index
    const indexPath = join(workspaceRoot, '.openpackage', 'openpackage.index.yml');
    const indexContent = await fs.readFile(indexPath, 'utf8');

    // Verify override behavior in index
    assert.ok(indexContent.includes('commands/read-specs.claude.md:'), 'should have claude override key');
    assert.ok(indexContent.includes('commands/read-specs.cursor.md:'), 'should have cursor override key');
    assert.ok(indexContent.includes('commands/read-specs.md:'), 'should have universal file key');
    
    // Universal file should NOT be mapped to claude (overridden)
    const lines = indexContent.split('\n');
    let inUniversalSection = false;
    let universalMappedToClaudeWrong = false;
    
    for (const line of lines) {
      if (line.includes('commands/read-specs.md:') && !line.includes('.claude.md:') && !line.includes('.cursor.md:')) {
        inUniversalSection = true;
        continue;
      }
      if (inUniversalSection) {
        if (line.trim().startsWith('- .claude/')) {
          universalMappedToClaudeWrong = true;
          break;
        }
        if (line.includes('commands/') && line.includes(':')) {
          // Next file section
          break;
        }
      }
    }
    
    assert.ok(!universalMappedToClaudeWrong, 'universal file should NOT be mapped to .claude/ (should be overridden)');
    
    // Universal file SHOULD be mapped to opencode (no override for opencode)
    assert.ok(indexContent.includes('.opencode/command/read-specs.md'), 'universal file should be mapped to opencode');
    
    // Verify actual files
    const claudeFile = join(workspaceRoot, '.claude/commands/read-specs.md');
    const cursorFile = join(workspaceRoot, '.cursor/commands/read-specs.md');
    const opencodeFile = join(workspaceRoot, '.opencode/command/read-specs.md');
    
    await fs.access(claudeFile); // Should exist
    await fs.access(cursorFile); // Should exist
    await fs.access(opencodeFile); // Should exist
    
    // Verify claude file has override content, not universal
    const claudeContent = await fs.readFile(claudeFile, 'utf8');
    assert.ok(claudeContent.includes('Claude-specific'), 'claude file should have override content');
    assert.ok(!claudeContent.includes('Universal'), 'claude file should not have universal content');
    
    // Verify opencode file has universal content
    const opencodeContent = await fs.readFile(opencodeFile, 'utf8');
    assert.ok(opencodeContent.includes('Universal'), 'opencode file should have universal content');
    
    console.log('✓ Platform-specific file correctly overrides universal file');
  } finally {
    await cleanupTest();
  }
}

// Run all tests
async function runTests() {
  try {
    await testInstallsPlatformSpecificFileForMatchingPlatform();
    await testStripsPlatformSuffixFromTargetPath();
    await testSkipsPlatformSpecificFileForNonMatchingPlatform();
    await testRecordsPlatformSpecificFilesCorrectlyInWorkspaceIndex();
    await testHandlesMultiplePlatformSpecificVariantsCorrectly();
    await testPreservesPlatformSuffixInSourceKeyButStripsInTarget();
    await testPlatformSpecificFileOverridesUniversalFile();
    
    console.log('✅ All platform-specific-files tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTests();
