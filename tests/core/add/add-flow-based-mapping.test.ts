/**
 * Tests for add command with flow-based mapping
 *
 * Validates that the add command correctly uses IMPORT flows (workspace → package)
 * to map workspace files to their universal package paths.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'path';
import { runAddToSourcePipeline } from '../../../packages/core/src/core/add/add-to-source-pipeline.js';
import { ensureDir, writeFile, readFile, fileExists, writeWorkspacePackageManifest } from './add-test-helpers.js';

describe('add flow-based mapping', { concurrency: 1 }, () => {
  test('.cursor/commands/*.md → commands/*.md', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
    const originalCwd = process.cwd();

    try {
      process.chdir(tmp);
      writeWorkspacePackageManifest(tmp);
      ensureDir(path.join(tmp, '.cursor'));

      const workspaceFile = path.join(tmp, '.cursor', 'commands', 'test-command.md');
      writeFile(workspaceFile, '# Test Command\n\nThis is a test command.');

      const result = await runAddToSourcePipeline(undefined, workspaceFile, {});

      assert.ok(result.success, result.error);
      assert.equal(result.data?.filesAdded, 1);

      const expectedPath = path.join(tmp, '.openpackage', 'commands', 'test-command.md');
      assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

      const savedContent = readFile(expectedPath);
      assert.equal(savedContent, '# Test Command\n\nThis is a test command.');

      const wrongPath = path.join(tmp, '.openpackage', 'root', '.cursor', 'commands', 'test-command.md');
      assert.ok(!fileExists(wrongPath), `File should not exist at wrong location: ${wrongPath}`);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('.cursor/rules/*.mdc → rules/*.md with extension transformation', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
    const originalCwd = process.cwd();

    try {
      process.chdir(tmp);
      writeWorkspacePackageManifest(tmp);
      ensureDir(path.join(tmp, '.cursor'));

      const workspaceFile = path.join(tmp, '.cursor', 'rules', 'test-rule.mdc');
      writeFile(workspaceFile, '# Test Rule\n\nThis is a test rule.');

      const result = await runAddToSourcePipeline(undefined, workspaceFile, {});

      assert.ok(result.success, result.error);
      assert.equal(result.data?.filesAdded, 1);

      const expectedPath = path.join(tmp, '.openpackage', 'rules', 'test-rule.md');
      assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

      const savedContent = readFile(expectedPath);
      assert.equal(savedContent, '# Test Rule\n\nThis is a test rule.');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  // Regression: GH #54 — FlowPattern.to was extracted as the literal "pattern".
  test('.claude/agents/*.md → agents/*.md (FlowPattern to)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-flow-test-'));
    const originalCwd = process.cwd();

    try {
      process.chdir(tmp);
      writeWorkspacePackageManifest(tmp);
      ensureDir(path.join(tmp, '.claude'));

      const workspaceFile = path.join(tmp, '.claude', 'agents', 'monorepo-navigator.md');
      writeFile(workspaceFile, '# Monorepo Navigator\n\nAgent body.');

      const result = await runAddToSourcePipeline(undefined, workspaceFile, {});

      assert.ok(result.success, result.error);
      assert.equal(result.data?.filesAdded, 1);

      const expectedPath = path.join(tmp, '.openpackage', 'agents', 'monorepo-navigator.md');
      assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

      const wrongPath = path.join(tmp, '.openpackage', 'pattern');
      assert.ok(!fileExists(wrongPath), `File should not be saved as literal "pattern": ${wrongPath}`);
      const wrongPathNested = path.join(tmp, '.openpackage', 'pattern', 'monorepo-navigator.md');
      assert.ok(!fileExists(wrongPathNested), `File should not be saved under "pattern/": ${wrongPathNested}`);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('.cursor/agents/*.md → agents/*.md', async () => {
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
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('preserves nested directory structures', async () => {
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

      const expectedPath = path.join(tmp, '.openpackage', 'commands', 'utilities', 'helper.md');
      assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

      const savedContent = readFile(expectedPath);
      assert.equal(savedContent, '# Helper Utility\n\nThis is a helper command.');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('root files (AGENTS.md) map to root/', async () => {
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

      const expectedPath = path.join(tmp, '.openpackage', 'root', 'AGENTS.md');
      assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

      const savedContent = readFile(expectedPath);
      assert.equal(savedContent, '# Agents\n\nAgent documentation.');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('non-platform files map to root/', async () => {
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

      const expectedPath = path.join(tmp, '.openpackage', 'root', 'custom-config.json');
      assert.ok(fileExists(expectedPath), `Expected file not found at: ${expectedPath}`);

      const savedContent = readFile(expectedPath);
      assert.equal(savedContent, '{"key": "value"}');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('maps multiple files from the same directory', async () => {
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

      const result = await runAddToSourcePipeline(undefined, commandsDir, {});

      assert.ok(result.success, result.error);
      assert.equal(result.data?.filesAdded, 3);

      const targetDir = path.join(tmp, '.openpackage', 'commands');
      assert.ok(fileExists(path.join(targetDir, 'cmd1.md')), 'cmd1.md not found');
      assert.ok(fileExists(path.join(targetDir, 'cmd2.md')), 'cmd2.md not found');
      assert.ok(fileExists(path.join(targetDir, 'cmd3.md')), 'cmd3.md not found');
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('reports added file paths correctly', async () => {
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

      assert.ok(result.data?.addedFilePaths, 'addedFilePaths should be defined');
      assert.equal(result.data?.addedFilePaths.length, 1);

      const addedPath = result.data?.addedFilePaths[0];
      assert.ok(addedPath.includes('commands/test.md'), `Path should contain commands/test.md, got: ${addedPath}`);
      assert.ok(!addedPath.includes('.cursor'), `Path should not contain .cursor, got: ${addedPath}`);
      assert.ok(!addedPath.includes('/root/'), `Path should not contain /root/, got: ${addedPath}`);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  describe('out-of-workspace absolute paths', { concurrency: 1 }, () => {
    test('maps external platform files via flow (not root/)', async () => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-ws-'));
      const external = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-ext-'));
      const originalCwd = process.cwd();

      try {
        process.chdir(workspace);
        writeWorkspacePackageManifest(workspace);

        const skillFile = path.join(external, '.claude', 'skills', 'commits', 'SKILL.md');
        writeFile(skillFile, '# Commit Skill');

        const result = await runAddToSourcePipeline(undefined, skillFile, {});

        assert.ok(result.success, result.error);
        assert.equal(result.data?.filesAdded, 1);

        const expectedPath = path.join(workspace, '.openpackage', 'skills', 'commits', 'SKILL.md');
        assert.ok(fileExists(expectedPath), `Expected file at: ${expectedPath}`);

        const wrongPath = path.join(workspace, '.openpackage', 'root', 'skills', 'commits', 'SKILL.md');
        assert.ok(!fileExists(wrongPath), `File should not be at root/ path: ${wrongPath}`);

        const savedContent = readFile(expectedPath);
        assert.equal(savedContent, '# Commit Skill');
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(external, { recursive: true, force: true });
      }
    });

    test('maps external directory with multiple files via flow (not root/)', async () => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-dir-ws-'));
      const external = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-dir-ext-'));
      const originalCwd = process.cwd();

      try {
        process.chdir(workspace);
        writeWorkspacePackageManifest(workspace);

        const skillsDir = path.join(external, '.claude', 'skills', 'commits');
        writeFile(path.join(skillsDir, 'SKILL.md'), '# Skill');
        writeFile(path.join(skillsDir, 'evals.json'), '{"evals": []}');

        const result = await runAddToSourcePipeline(undefined, skillsDir, {});

        assert.ok(result.success, result.error);
        assert.equal(result.data?.filesAdded, 2);

        const skill = path.join(workspace, '.openpackage', 'skills', 'commits', 'SKILL.md');
        const evals = path.join(workspace, '.openpackage', 'skills', 'commits', 'evals.json');
        assert.ok(fileExists(skill), `Expected SKILL.md at: ${skill}`);
        assert.ok(fileExists(evals), `Expected evals.json at: ${evals}`);

        const wrongSkill = path.join(workspace, '.openpackage', 'root', 'skills', 'commits', 'SKILL.md');
        assert.ok(!fileExists(wrongSkill), `File should not be at root/ path: ${wrongSkill}`);
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(external, { recursive: true, force: true });
      }
    });

    test('non-platform file falls back to root/filename', async () => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-np-ws-'));
      const external = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-np-ext-'));
      const originalCwd = process.cwd();

      try {
        process.chdir(workspace);
        writeWorkspacePackageManifest(workspace);

        const plainFile = path.join(external, 'notes.txt');
        writeFile(plainFile, 'Some notes');

        const result = await runAddToSourcePipeline(undefined, plainFile, {});

        assert.ok(result.success, result.error);
        assert.equal(result.data?.filesAdded, 1);

        const expectedPath = path.join(workspace, '.openpackage', 'root', 'notes.txt');
        assert.ok(fileExists(expectedPath), `Expected file at: ${expectedPath}`);

        const savedContent = readFile(expectedPath);
        assert.equal(savedContent, 'Some notes');
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(external, { recursive: true, force: true });
      }
    });

    test('does not escape package directory (path traversal guard)', async () => {
      const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-sec-ws-'));
      const external = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-oow-sec-ext-'));
      const originalCwd = process.cwd();

      try {
        process.chdir(workspace);
        writeWorkspacePackageManifest(workspace);

        const deepFile = path.join(external, 'deep', 'nested', 'config.yml');
        writeFile(deepFile, 'key: value');

        const result = await runAddToSourcePipeline(undefined, deepFile, {});

        assert.ok(result.success, result.error);
        assert.equal(result.data?.filesAdded, 1);

        const addedPath = result.data?.addedFilePaths[0];
        assert.ok(addedPath, 'addedFilePaths should have an entry');

        const packageRoot = fs.realpathSync(path.join(workspace, '.openpackage'));
        assert.ok(
          addedPath.startsWith(packageRoot),
          `File path should be inside package dir. Got: ${addedPath}`
        );

        assert.ok(
          !addedPath.includes('..'),
          `File path should not contain '..'. Got: ${addedPath}`
        );
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(workspace, { recursive: true, force: true });
        fs.rmSync(external, { recursive: true, force: true });
      }
    });
  });
});
