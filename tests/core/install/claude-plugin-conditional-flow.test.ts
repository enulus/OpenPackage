import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../../test-helpers.js';
import { exists, readTextFile } from '../../../src/utils/fs.js';
import { DIR_PATTERNS, CLAUDE_PLUGIN_PATHS } from '../../../src/constants/index.js';

describe('Claude Plugin Conditional Flow Bug Fix', () => {
  let testDir: string;
  let pluginDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'opkg-conditional-test-'));
    pluginDir = join(testDir, 'test-plugin');
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  /**
   * Helper to create a Claude plugin with agent files
   */
  async function createClaudePluginWithAgent() {
    await mkdir(join(pluginDir, DIR_PATTERNS.CLAUDE_PLUGIN), { recursive: true });
    await mkdir(join(pluginDir, 'agents'), { recursive: true });

    // Create plugin manifest
    const pluginManifest = {
      name: 'test-agent-plugin',
      version: '1.0.0',
      description: 'Test plugin with agents'
    };
    await writeFile(
      join(pluginDir, CLAUDE_PLUGIN_PATHS.PLUGIN_MANIFEST),
      JSON.stringify(pluginManifest, null, 2)
    );

    // Create an agent with universal format (OpenPackage format)
    // This has tools as object and model with anthropic/ prefix
    const agentContent = `---
model: anthropic/claude-sonnet-4.20250514
tools:
  bash: true
  read: true
  write: true
---

# Test Agent

This agent should NOT be transformed when installing to claude platform.
`;
    await writeFile(join(pluginDir, 'agents', 'test-agent.md'), agentContent);
  }

  it('should apply claude format transformations when installing claude-plugin to claude platform', async () => {
    await createClaudePluginWithAgent();

    // Create a workspace to install into
    const workspaceDir = join(testDir, 'workspace');
    await mkdir(workspaceDir);

    // Install plugin to CLAUDE platform
    // transformPluginToPackage strips .claude-plugin/ dir, so the package is detected as
    // universal format → $$source = "openpackage" → transformation branch runs
    const { stdout, stderr, code } = runCli(
      ['install', pluginDir, '--platforms', 'claude'],
      workspaceDir
    );

    console.log('Install output:', stdout);
    if (stderr) console.error('Install stderr:', stderr);

    assert.strictEqual(code, 0, 'Install should succeed');

    // Verify agent was installed
    const agentFile = join(workspaceDir, '.claude', 'agents', 'test-agent.md');
    assert.ok(await exists(agentFile), 'Agent should be installed to .claude/agents/');

    // Read the installed agent file and verify transformations were applied
    const installedContent = await readTextFile(agentFile);
    
    console.log('Installed agent content:', installedContent);

    // The plugin is loaded via transformPluginToPackage which strips .claude-plugin/ files,
    // so detectPackageFormat sees only agents/**/*.md → classifies as "universal" format.
    // This means $$source = "openpackage" (not "claude-plugin"), so the transformation
    // branch ($ne: ["$$source", "claude-plugin"]) runs and applies Claude format transforms.
    //
    // Expected transformed output:
    // - model: anthropic/ prefix stripped, version dots converted to hyphens
    // - name: injected from filename
    // - tools: remain as object (transform expects array, no-op on object)
    
    assert.ok(
      installedContent.includes('claude-sonnet-4-20250514'),
      'Model should be transformed to Claude format (anthropic/ stripped, dots to hyphens)'
    );
    
    assert.ok(
      !installedContent.includes('anthropic/'),
      'Model should NOT retain anthropic/ prefix after transformation'
    );
    
    assert.ok(
      installedContent.includes('bash: true'),
      'Tools should remain as object format (transform is a no-op on object input)'
    );
  });

  it('should apply transformations when installing claude-plugin to cursor platform', async () => {
    await createClaudePluginWithAgent();

    // Create a workspace to install into
    const workspaceDir = join(testDir, 'workspace');
    await mkdir(workspaceDir);

    // Install plugin to CURSOR platform (different from source)
    // The conditional flow should check: $$platform != "claude" → apply transformations
    const { stdout, stderr, code } = runCli(
      ['install', pluginDir, '--platforms', 'cursor'],
      workspaceDir
    );

    console.log('Install output:', stdout);
    if (stderr) console.error('Install stderr:', stderr);

    assert.strictEqual(code, 0, 'Install should succeed');

    // Verify agent was installed to cursor
    const agentFile = join(workspaceDir, '.cursor', 'agents', 'test-agent.md');
    assert.ok(await exists(agentFile), 'Agent should be installed to .cursor/agents/');

    // Read the installed agent file
    const installedContent = await readTextFile(agentFile);
    
    console.log('Installed agent content:', installedContent);

    // Since cursor platform doesn't have conditional transformations,
    // the agent should be in universal format (same as source)
    assert.ok(
      installedContent.includes('anthropic/claude-sonnet-4.20250514'),
      'Model should retain universal format'
    );
    
    assert.ok(
      installedContent.includes('bash: true'),
      'Tools should remain as object format'
    );
  });

  it('should apply transformations exactly once (not double-transform) in export flows', async () => {
    await createClaudePluginWithAgent();

    // Create a workspace
    const workspaceDir = join(testDir, 'workspace');
    await mkdir(workspaceDir);

    // Install to claude platform
    const { code } = runCli(
      ['install', pluginDir, '--platforms', 'claude'],
      workspaceDir
    );

    assert.strictEqual(code, 0, 'Install should succeed');

    const agentFile = join(workspaceDir, '.claude', 'agents', 'test-agent.md');
    const installedContent = await readTextFile(agentFile);

    // The plugin is detected as universal format (transformPluginToPackage strips .claude-plugin/),
    // so $$source = "openpackage" and the transformation branch runs exactly once.
    // Verify single transformation: model has claude- format, no anthropic/ prefix.
    assert.ok(
      installedContent.includes('claude-sonnet-4-20250514'),
      'Model should be transformed exactly once to Claude format'
    );
    
    assert.ok(
      !installedContent.includes('anthropic/'),
      'Content should not retain anthropic/ prefix after single transformation'
    );
  });
});
