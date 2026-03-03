/**
 * Tests for add command with flow-based mapping
 * 
 * Validates that the add command correctly uses IMPORT flows (workspace → package)
 * to map workspace files to their universal package paths.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { runAddToSourcePipeline } from '../../../packages/core/src/core/add/add-to-source-pipeline.js';

const UTF8 = 'utf-8';

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p: string, content: string) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, { encoding: UTF8 });
}

function readFile(p: string): string {
  return fs.readFileSync(p, { encoding: UTF8 });
}

function fileExists(p: string): boolean {
  return fs.existsSync(p);
}

function writeWorkspacePackageManifest(workspaceDir: string, pkgName = 'workspace-test') {
  const pkgDir = path.join(workspaceDir, '.openpackage');
  const manifest = [`name: ${pkgName}`, 'version: 1.0.0', ''].join('\n');
  writeFile(path.join(pkgDir, 'openpackage.yml'), manifest);
}

/**
 * Test: .cursor/commands/*.md → commands/*.md using import flows
 */
async function testCursorCommandsMapping(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
  const originalCwd = process.cwd();
  
  try {
    process.chdir(tmp);

    // Setup workspace structure
    writeWorkspacePackageManifest(tmp);
    
    // Create platform detection marker for Cursor
    ensureDir(path.join(tmp, '.cursor'));

    // Create a workspace file in .cursor/commands/
    const workspaceFile = path.join(tmp, '.cursor', 'commands', 'test-command.md');
    writeFile(workspaceFile, '# Test Command\n\nThis is a test command.');

    // Run add to workspace root package
    const result = await runAddToSourcePipeline(undefined, workspaceFile, {});

    // Verify success
    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);

    // Verify the file was added to the correct location
    // Should be: .openpackage/commands/test-command.md
    const expectedPath = path.join(tmp, '.openpackage', 'commands', 'test-command.md');
    assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

    // Verify content was preserved
    const savedContent = readFile(expectedPath);
    assert.equal(savedContent, '# Test Command\n\nThis is a test command.');

    // Verify it's NOT in the wrong location
    const wrongPath = path.join(tmp, '.openpackage', 'root', '.cursor', 'commands', 'test-command.md');
    assert.ok(!fileExists(wrongPath), `File should not exist at wrong location: ${wrongPath}`);

    console.log('✓ .cursor/commands/*.md → commands/*.md mapping test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: .cursor/rules/*.mdc → rules/*.md with extension transformation
 */
async function testCursorRulesMapping(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
  const originalCwd = process.cwd();
  
  try {
    process.chdir(tmp);

    writeWorkspacePackageManifest(tmp);
    ensureDir(path.join(tmp, '.cursor'));

    // Create a workspace rule file with .mdc extension
    const workspaceFile = path.join(tmp, '.cursor', 'rules', 'test-rule.mdc');
    writeFile(workspaceFile, '# Test Rule\n\nThis is a test rule.');

    const result = await runAddToSourcePipeline(undefined, workspaceFile, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);

    // Verify the file was added with extension transformation
    // .cursor/rules/test-rule.mdc → rules/test-rule.md
    const expectedPath = path.join(tmp, '.openpackage', 'rules', 'test-rule.md');
    assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

    const savedContent = readFile(expectedPath);
    assert.equal(savedContent, '# Test Rule\n\nThis is a test rule.');

    console.log('✓ .cursor/rules/*.mdc → rules/*.md with extension transformation test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: .cursor/agents/*.md → agents/*.md
 */
async function testCursorAgentsMapping(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
  const originalCwd = process.cwd();
  
  try {
    process.chdir(tmp);

    writeWorkspacePackageManifest(tmp);
    ensureDir(path.join(tmp, '.cursor'));

    const workspaceFile = path.join(tmp, '.cursor', 'agents', 'developer.md');
    writeFile(workspaceFile, '# Developer Agent\n\nThis is a developer agent.');

    const result = await runAddToSourcePipeline(undefined, workspaceFile, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);

    const expectedPath = path.join(tmp, '.openpackage', 'agents', 'developer.md');
    assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

    const savedContent = readFile(expectedPath);
    assert.equal(savedContent, '# Developer Agent\n\nThis is a developer agent.');

    console.log('✓ .cursor/agents/*.md → agents/*.md mapping test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Nested directory structures are preserved
 */
async function testNestedDirectoryMapping(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
  const originalCwd = process.cwd();
  
  try {
    process.chdir(tmp);

    writeWorkspacePackageManifest(tmp);
    ensureDir(path.join(tmp, '.cursor'));

    const workspaceFile = path.join(tmp, '.cursor', 'commands', 'utilities', 'helper.md');
    writeFile(workspaceFile, '# Helper Utility\n\nThis is a helper command.');

    const result = await runAddToSourcePipeline(undefined, workspaceFile, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);

    // .cursor/commands/utilities/helper.md → commands/utilities/helper.md
    const expectedPath = path.join(tmp, '.openpackage', 'commands', 'utilities', 'helper.md');
    assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

    const savedContent = readFile(expectedPath);
    assert.equal(savedContent, '# Helper Utility\n\nThis is a helper command.');

    console.log('✓ Nested directory structure preservation test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Root files (AGENTS.md) are handled correctly
 */
async function testRootFileMapping(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
  const originalCwd = process.cwd();
  
  try {
    process.chdir(tmp);

    writeWorkspacePackageManifest(tmp);
    ensureDir(path.join(tmp, '.cursor'));

    const workspaceFile = path.join(tmp, 'AGENTS.md');
    writeFile(workspaceFile, '# Agents\n\nAgent documentation.');

    const result = await runAddToSourcePipeline(undefined, workspaceFile, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);

    // Root files should be stored at package root (not under a subdir)
    const expectedPath = path.join(tmp, '.openpackage', 'AGENTS.md');
    assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

    const savedContent = readFile(expectedPath);
    assert.equal(savedContent, '# Agents\n\nAgent documentation.');

    console.log('✓ Root file (AGENTS.md) mapping test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Non-platform-specific files are stored under root/
 */
async function testNonPlatformFileMapping(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
  const originalCwd = process.cwd();
  
  try {
    process.chdir(tmp);

    writeWorkspacePackageManifest(tmp);
    ensureDir(path.join(tmp, '.cursor'));

    const customFile = path.join(tmp, 'custom-config.json');
    writeFile(customFile, '{"key": "value"}');

    const result = await runAddToSourcePipeline(undefined, customFile, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);

    // Non-platform files should be stored under root/
    const expectedPath = path.join(tmp, '.openpackage', 'root', 'custom-config.json');
    assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

    const savedContent = readFile(expectedPath);
    assert.equal(savedContent, '{"key": "value"}');

    console.log('✓ Non-platform file mapping to root/ test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Multiple files from the same directory
 */
async function testMultipleFilesMapping(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
  const originalCwd = process.cwd();
  
  try {
    process.chdir(tmp);

    writeWorkspacePackageManifest(tmp);
    ensureDir(path.join(tmp, '.cursor'));

    const commandsDir = path.join(tmp, '.cursor', 'commands');
    writeFile(path.join(commandsDir, 'cmd1.md'), '# Command 1');
    writeFile(path.join(commandsDir, 'cmd2.md'), '# Command 2');
    writeFile(path.join(commandsDir, 'cmd3.md'), '# Command 3');

    // Run add with directory path
    const result = await runAddToSourcePipeline(undefined, commandsDir, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 3);

    // Verify all files were added correctly
    const targetDir = path.join(tmp, '.openpackage', 'commands');
    assert.ok(fileExists(path.join(targetDir, 'cmd1.md')), 'cmd1.md not found');
    assert.ok(fileExists(path.join(targetDir, 'cmd2.md')), 'cmd2.md not found');
    assert.ok(fileExists(path.join(targetDir, 'cmd3.md')), 'cmd3.md not found');

    console.log('✓ Multiple files mapping test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Added file paths are reported correctly
 */
async function testReportedPaths(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
  const originalCwd = process.cwd();
  
  try {
    process.chdir(tmp);

    writeWorkspacePackageManifest(tmp);
    ensureDir(path.join(tmp, '.cursor'));

    const workspaceFile = path.join(tmp, '.cursor', 'commands', 'test.md');
    writeFile(workspaceFile, '# Test');

    const result = await runAddToSourcePipeline(undefined, workspaceFile, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);
    
    // Check that addedFilePaths contains the correct path
    assert.ok(result.data?.addedFilePaths, 'addedFilePaths should be defined');
    assert.equal(result.data?.addedFilePaths.length, 1);
    
    const addedPath = result.data?.addedFilePaths[0];
    assert.ok(addedPath.includes('commands/test.md'), `Path should contain commands/test.md, got: ${addedPath}`);
    assert.ok(!addedPath.includes('.cursor'), `Path should not contain .cursor, got: ${addedPath}`);
    assert.ok(!addedPath.includes('/root/'), `Path should not contain /root/, got: ${addedPath}`);

    console.log('✓ Reported paths test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Test: Out-of-workspace absolute path with platform structure maps via flow
 * Simulates: opkg add ~/.claude/skills/commits --to openpackage (from a different workspace)
 */
async function testOutOfWorkspaceAbsolutePathMapping(): Promise<void> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-ws-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-ext-'));
  const originalCwd = process.cwd();

  try {
    process.chdir(workspace);

    // Setup workspace package
    writeWorkspacePackageManifest(workspace);

    // Create files outside the workspace in a .claude/skills/ structure
    const skillFile = path.join(external, '.claude', 'skills', 'commits', 'SKILL.md');
    writeFile(skillFile, '# Commit Skill');

    // Add the out-of-workspace file
    const result = await runAddToSourcePipeline(undefined, skillFile, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);

    // Should land under skills/ (platform flow match), not root/../../...
    const expectedPath = path.join(workspace, '.openpackage', 'skills', 'commits', 'SKILL.md');
    assert.ok(fileExists(expectedPath), `Expected file at: ${expectedPath}`);

    const savedContent = readFile(expectedPath);
    assert.equal(savedContent, '# Commit Skill');

    // Should NOT be under root/ with path traversal
    const wrongPath = path.join(workspace, '.openpackage', 'root');
    const wrongExists = fs.existsSync(wrongPath);
    assert.ok(!wrongExists, `Should not create root/ directory for platform-matched files`);

    console.log('✓ Out-of-workspace absolute path mapping test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
}

/**
 * Test: Out-of-workspace directory with multiple files maps correctly
 */
async function testOutOfWorkspaceDirectoryMapping(): Promise<void> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-dir-ws-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-dir-ext-'));
  const originalCwd = process.cwd();

  try {
    process.chdir(workspace);

    writeWorkspacePackageManifest(workspace);

    // Create multiple files in an external .claude/skills/ directory
    const skillsDir = path.join(external, '.claude', 'skills', 'commits');
    writeFile(path.join(skillsDir, 'SKILL.md'), '# Skill');
    writeFile(path.join(skillsDir, 'evals.json'), '{"evals": []}');

    // Add the entire directory
    const result = await runAddToSourcePipeline(undefined, skillsDir, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 2);

    // Both files should be under skills/commits/
    const skill = path.join(workspace, '.openpackage', 'skills', 'commits', 'SKILL.md');
    const evals = path.join(workspace, '.openpackage', 'skills', 'commits', 'evals.json');
    assert.ok(fileExists(skill), `Expected SKILL.md at: ${skill}`);
    assert.ok(fileExists(evals), `Expected evals.json at: ${evals}`);

    console.log('✓ Out-of-workspace directory mapping test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
}

/**
 * Test: Out-of-workspace file with no platform structure falls back to root/filename
 */
async function testOutOfWorkspaceNonPlatformFallback(): Promise<void> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-np-ws-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-np-ext-'));
  const originalCwd = process.cwd();

  try {
    process.chdir(workspace);

    writeWorkspacePackageManifest(workspace);

    // Create a plain file outside workspace with no platform structure
    const plainFile = path.join(external, 'notes.txt');
    writeFile(plainFile, 'Some notes');

    const result = await runAddToSourcePipeline(undefined, plainFile, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);

    // Should be root/notes.txt (not root/../../.../notes.txt)
    const expectedPath = path.join(workspace, '.openpackage', 'root', 'notes.txt');
    assert.ok(fileExists(expectedPath), `Expected file at: ${expectedPath}`);

    const savedContent = readFile(expectedPath);
    assert.equal(savedContent, 'Some notes');

    console.log('✓ Out-of-workspace non-platform fallback test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
}

/**
 * Test: Out-of-workspace paths do not escape the package directory (path traversal guard)
 */
async function testOutOfWorkspaceNoPathTraversal(): Promise<void> {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-sec-ws-'));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-sec-ext-'));
  const originalCwd = process.cwd();

  try {
    process.chdir(workspace);

    writeWorkspacePackageManifest(workspace);

    // Create a file that's deeply outside the workspace
    const deepFile = path.join(external, 'deep', 'nested', 'config.yml');
    writeFile(deepFile, 'key: value');

    const result = await runAddToSourcePipeline(undefined, deepFile, {});

    assert.ok(result.success, result.error);
    assert.equal(result.data?.filesAdded, 1);

    // Verify the file is within the package directory
    const addedPath = result.data?.addedFilePaths[0];
    assert.ok(addedPath, 'addedFilePaths should have an entry');

    // Use realpathSync to handle macOS /tmp → /private/var/folders symlinks
    const packageRoot = fs.realpathSync(path.join(workspace, '.openpackage'));
    assert.ok(
      addedPath.startsWith(packageRoot),
      `File path should be inside package dir. Got: ${addedPath}`
    );

    // Verify the registry path doesn't contain '..'
    assert.ok(
      !addedPath.includes('..'),
      `File path should not contain '..'. Got: ${addedPath}`
    );

    console.log('✓ Out-of-workspace no path traversal test passed');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
}

// Run all tests
async function runTests() {
  console.log('\n🧪 Running flow-based mapping tests...\n');

  await testCursorCommandsMapping();
  await testCursorRulesMapping();
  await testCursorAgentsMapping();
  await testNestedDirectoryMapping();
  await testRootFileMapping();
  await testNonPlatformFileMapping();
  await testMultipleFilesMapping();
  await testReportedPaths();
  await testOutOfWorkspaceAbsolutePathMapping();
  await testOutOfWorkspaceDirectoryMapping();
  await testOutOfWorkspaceNonPlatformFallback();
  await testOutOfWorkspaceNoPathTraversal();

  console.log('\n✅ All flow-based mapping tests passed!\n');
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
