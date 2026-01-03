import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-helpers.js';
import { exists } from '../src/utils/fs.js';

describe('Claude Code Plugin Installation', () => {
  let testDir: string;
  let pluginDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'opkg-plugin-test-'));
    pluginDir = join(testDir, 'test-plugin');
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper to create a minimal Claude Code plugin structure
   */
  async function createTestPlugin(name: string, version: string) {
    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await mkdir(join(pluginDir, 'commands'), { recursive: true });

    // Create plugin manifest
    const pluginManifest = {
      name,
      version,
      description: 'A test plugin',
      author: {
        name: 'Test Author'
      }
    };
    await writeFile(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify(pluginManifest, null, 2)
    );

    // Create a sample command
    const commandContent = `---
description: A test command
---

# Test Command

This is a test command.
`;
    await writeFile(join(pluginDir, 'commands', 'test.md'), commandContent);
  }

  it('should detect and install a Claude Code plugin from local path', async () => {
    await createTestPlugin('test-plugin', '1.0.0');

    // Create a workspace to install into
    const workspaceDir = join(testDir, 'workspace');
    await mkdir(workspaceDir);

    // Install plugin from local path with claude platform
    const { stdout, stderr, code } = runCli(
      ['install', pluginDir, '--platforms', 'claude'],
      workspaceDir
    );

    console.log('Install output:', stdout);
    if (stderr) console.error('Install stderr:', stderr);

    assert.strictEqual(code, 0, 'Install should succeed');

    // Verify command was installed to .claude/commands/ (universal subdir → platform dir)
    const commandFile = join(workspaceDir, '.claude', 'commands', 'test.md');
    assert.ok(
      await exists(commandFile),
      'Plugin command should be installed to .claude/commands/'
    );

    // Verify openpackage.yml was created with path dependency
    const packageYmlPath = join(workspaceDir, '.openpackage', 'openpackage.yml');
    assert.ok(
      await exists(packageYmlPath),
      'openpackage.yml should be created in .openpackage/'
    );

    // Check that dependency was added
    const { readFile } = await import('fs/promises');
    const packageYml = await readFile(packageYmlPath, 'utf-8');
    assert.ok(
      packageYml.includes('test-plugin'),
      'Plugin should be added to openpackage.yml'
    );
    assert.ok(
      packageYml.includes('path:'),
      'Plugin should be tracked as path dependency'
    );
  });

  it('should detect plugin manifest and transform to OpenPackage format', async () => {
    await createTestPlugin('my-plugin', '2.0.0');

    const { detectPluginType } = await import('../src/core/install/plugin-detector.js');
    const { transformPluginToPackage } = await import('../src/core/install/plugin-transformer.js');

    // Detect plugin
    const detection = await detectPluginType(pluginDir);
    assert.ok(detection.isPlugin, 'Should detect as plugin');
    assert.strictEqual(detection.type, 'individual', 'Should detect as individual plugin');

    // Transform to package
    const pkg = await transformPluginToPackage(pluginDir);
    assert.strictEqual(pkg.metadata.name, 'my-plugin');
    assert.strictEqual(pkg.metadata.version, '2.0.0');
    assert.strictEqual(pkg.metadata.description, 'A test plugin');
    assert.strictEqual(pkg.metadata.author, 'Test Author');

    // Verify files were extracted (with original paths, .claude-plugin excluded)
    assert.ok(pkg.files.length > 0, 'Should extract files');
    // Plugin manifest (.claude-plugin/plugin.json) should be excluded
    const manifestFile = pkg.files.find(f => f.path.includes('.claude-plugin'));
    assert.ok(!manifestFile, 'Should NOT include .claude-plugin directory');
    // Command files should be kept with original paths
    const commandFile = pkg.files.find(f => f.path === 'commands/test.md');
    assert.ok(commandFile, 'Should include command file');
  });

  it('should parse git spec with subdirectory syntax', async () => {
    const { parseGitSpec } = await import('../src/utils/git-spec.js');

    // Test subdirectory only
    const spec1 = parseGitSpec('git:https://github.com/user/repo.git#subdirectory=plugins/my-plugin');
    assert.ok(spec1);
    assert.strictEqual(spec1.url, 'https://github.com/user/repo.git');
    assert.strictEqual(spec1.subdirectory, 'plugins/my-plugin');
    assert.strictEqual(spec1.ref, undefined);

    // Test ref + subdirectory
    const spec2 = parseGitSpec('git:https://github.com/user/repo.git#main&subdirectory=plugins/my-plugin');
    assert.ok(spec2);
    assert.strictEqual(spec2.url, 'https://github.com/user/repo.git');
    assert.strictEqual(spec2.ref, 'main');
    assert.strictEqual(spec2.subdirectory, 'plugins/my-plugin');

    // Test github shorthand with subdirectory
    const spec3 = parseGitSpec('github:anthropics/claude-code#subdirectory=plugins/commit-commands');
    assert.ok(spec3);
    assert.strictEqual(spec3.url, 'https://github.com/anthropics/claude-code.git');
    assert.strictEqual(spec3.subdirectory, 'plugins/commit-commands');
  });
});
