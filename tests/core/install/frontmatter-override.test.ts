/**
 * Test frontmatter override during install
 * 
 * Verifies that platform-specific frontmatter overrides are applied correctly
 * when installing packages.
 */

import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';

const { installPackageWithFlows } = await import(
  new URL('../../../src/core/install/flow-based-installer.js', import.meta.url).href
);
const { createUniversalContext } = await import(
  new URL('../../../src/core/conversion-context/creation.js', import.meta.url).href
);

console.log('Testing frontmatter override during install...');

let testDir: string;
let packageRoot: string;
let workspaceRoot: string;

async function setupTest() {
  testDir = join(tmpdir(), `opkg-test-frontmatter-${Date.now()}`);
  packageRoot = join(testDir, 'package');
  workspaceRoot = join(testDir, 'workspace');

  // Setup package with markdown file containing frontmatter overrides
  await fs.mkdir(join(packageRoot, 'commands'), { recursive: true });
  
  const markdownWithOverrides = `---
description: Spec updating
openpackage:
  claude:
    description: Spec updating for CLAUDE
---

# Test Command

This is a test command.
`;

  await fs.writeFile(
    join(packageRoot, 'commands', 'test.md'),
    markdownWithOverrides
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

async function testFrontmatterOverrideForClaude() {
  await setupTest();
  
  try {
    const context = {
      packageName: 'test-pkg',
      packageRoot,
      workspaceRoot,
      platform: 'claude' as any,
      packageVersion: '1.0.0',
      priority: 0,
      dryRun: false,
      conversionContext: createUniversalContext()
    };

    const result = await installPackageWithFlows(context);

    assert.equal(result.success, true, 'Installation should succeed');
    assert.equal(result.filesProcessed, 1, 'Should process 1 file');

    // Read the installed file for claude platform
    const claudeFile = join(workspaceRoot, '.claude/commands/test.md');
    const claudeContent = await fs.readFile(claudeFile, 'utf8');

    // Should have claude-specific description
    assert.ok(claudeContent.includes('Spec updating for CLAUDE'), 'Should have claude-specific description');
    
    // Should NOT have the base description
    assert.ok(!claudeContent.includes('description: Spec updating\n'), 'Should not have base description');
    
    // Should NOT have openpackage block in output
    assert.ok(!claudeContent.includes('openpackage:'), 'Should not have openpackage block in output');
    
    console.log('✓ Frontmatter override applied correctly for claude platform');
    console.log('\nClaude output:');
    console.log(claudeContent);
  } finally {
    await cleanupTest();
  }
}

async function testFrontmatterOverrideForCursor() {
  await setupTest();
  
  try {
    const context = {
      packageName: 'test-pkg',
      packageRoot,
      workspaceRoot,
      platform: 'cursor' as any,
      packageVersion: '1.0.0',
      priority: 0,
      dryRun: false,
      conversionContext: createUniversalContext()
    };

    const result = await installPackageWithFlows(context);

    assert.equal(result.success, true, 'Installation should succeed');
    assert.equal(result.filesProcessed, 1, 'Should process 1 file');

    // Read the installed file for cursor platform
    const cursorFile = join(workspaceRoot, '.cursor/commands/test.md');
    const cursorContent = await fs.readFile(cursorFile, 'utf8');

    // Should have base description (no override for cursor)
    assert.ok(cursorContent.includes('description: Spec updating'), 'Should have base description');
    
    // Should NOT have claude-specific description
    assert.ok(!cursorContent.includes('Spec updating for CLAUDE'), 'Should not have claude-specific description');
    
    // Should NOT have openpackage block in output
    assert.ok(!cursorContent.includes('openpackage:'), 'Should not have openpackage block in output');
    
    console.log('✓ Frontmatter override correctly skipped for cursor platform (uses base)');
    console.log('\nCursor output:');
    console.log(cursorContent);
  } finally {
    await cleanupTest();
  }
}

async function runTests() {
  try {
    await testFrontmatterOverrideForClaude();
    await testFrontmatterOverrideForCursor();
    
    console.log('\n✅ All frontmatter override tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

runTests();
