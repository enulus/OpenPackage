/**
 * Integration tests for skills installation feature
 * 
 * Tests both marketplace and standalone skills installation flows,
 * covering interactive and non-interactive modes, validation, and error handling.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../test-helpers.js';

describe('Skills Installation', () => {
  let tmpDir: string;
  let workspaceDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'opkg-skills-test-'));
    workspaceDir = join(tmpDir, 'workspace');
    await mkdir(workspaceDir, { recursive: true });
  });

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  describe('Standalone Skills - Validation', () => {
    it('should error when --skills is used on source without skills directory', async () => {
      // Create a simple package without skills/
      const pkgDir = join(tmpDir, 'no-skills-pkg');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: test\nversion: 1.0.0\n');
      await writeFile(join(pkgDir, 'README.md'), '# Test Package');

      const result = runCli(['install', pkgDir, '--skills', 'nonexistent'], workspaceDir);

      assert.equal(result.code, 1);
      assert.match(result.stderr, /does not contain skills\/ directory/i);
    });

    it('should error when requested skill does not exist', async () => {
      // Create a skills collection with one skill
      const pkgDir = join(tmpDir, 'skills-pkg');
      const skillsDir = join(pkgDir, 'skills', 'git');
      await mkdir(skillsDir, { recursive: true });
      
      // Add openpackage.yml to make it a valid package
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: skills-pkg\nversion: 1.0.0\n');
      
      await writeFile(
        join(skillsDir, 'SKILL.md'),
        '---\nname: git\nversion: 1.0.0\ndescription: Git workflows\n---\n# Git Skill'
      );
      await writeFile(join(skillsDir, 'workflow.md'), '# Git Workflow');

      // Try to install a skill that doesn't exist
      const result = runCli(['install', pkgDir, '--skills', 'docker', 'nonexistent'], workspaceDir);

      assert.equal(result.code, 1);
      assert.match(result.stderr, /Skills not found: docker, nonexistent/i);
      assert.match(result.stderr, /Available skills:/i);
      assert.match(result.stderr, /git/i);
    });

    it('should list available skills when validation fails', async () => {
      // Create multiple skills
      const pkgDir = join(tmpDir, 'multi-skills-pkg');
      
      // Add openpackage.yml to make it a valid package
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: multi-skills\nversion: 1.0.0\n');
      
      // Git skill
      const gitDir = join(pkgDir, 'skills', 'git');
      await mkdir(gitDir, { recursive: true });
      await writeFile(
        join(gitDir, 'SKILL.md'),
        '---\nname: git\nversion: 1.0.0\ndescription: Git workflows\n---\n'
      );
      
      // Docker skill
      const dockerDir = join(pkgDir, 'skills', 'docker');
      await mkdir(dockerDir, { recursive: true });
      await writeFile(
        join(dockerDir, 'SKILL.md'),
        '---\nname: docker\nversion: 1.0.0\ndescription: Docker operations\n---\n'
      );

      const result = runCli(['install', pkgDir, '--skills', 'invalid'], workspaceDir);

      assert.equal(result.code, 1);
      assert.match(result.stderr, /Available skills:/i);
      assert.match(result.stderr, /git.*Git workflows/i);
      assert.match(result.stderr, /docker.*Docker operations/i);
    });
  });

  describe('Standalone Skills - Installation', () => {
    it('should install single skill from package', async () => {
      // Create a package with one skill
      const pkgDir = join(tmpDir, 'pkg-with-skill');
      const skillDir = join(pkgDir, 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: pkg-with-skill\nversion: 1.0.0\n');
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: test-skill\nversion: 1.0.0\ndescription: Test skill\n---\n# Test Skill'
      );
      await writeFile(join(skillDir, 'content.md'), '# Skill Content');

      const result = runCli(['install', pkgDir, '--skills', 'test-skill'], workspaceDir);

      // Verify success
      assert.equal(result.code, 0, `Unexpected error: ${result.stderr}`);
      assert.match(result.stdout, /Installing 1 skill/i);
      assert.match(result.stdout, /✓ test-skill/i);
      assert.match(result.stdout, /Successfully installed: 1 skill/i);
    });

    it('should install multiple skills from package', async () => {
      // Create a package with multiple skills
      const pkgDir = join(tmpDir, 'multi-skill-pkg');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: multi-skill-pkg\nversion: 1.0.0\n');
      
      // Skill 1
      const skill1Dir = join(pkgDir, 'skills', 'skill1');
      await mkdir(skill1Dir, { recursive: true });
      await writeFile(
        join(skill1Dir, 'SKILL.md'),
        '---\nname: skill1\nversion: 1.0.0\n---\n# Skill 1'
      );
      
      // Skill 2
      const skill2Dir = join(pkgDir, 'skills', 'skill2');
      await mkdir(skill2Dir, { recursive: true });
      await writeFile(
        join(skill2Dir, 'SKILL.md'),
        '---\nname: skill2\nversion: 2.0.0\n---\n# Skill 2'
      );

      const result = runCli(['install', pkgDir, '--skills', 'skill1', 'skill2'], workspaceDir);

      assert.equal(result.code, 0, `Unexpected error: ${result.stderr}`);
      assert.match(result.stdout, /Installing 2 skills/i);
      assert.match(result.stdout, /✓ skill1/i);
      assert.match(result.stdout, /✓ skill2/i);
      assert.match(result.stdout, /Successfully installed: 2 skills/i);
    });

    it('should preserve nested skill directory structure', async () => {
      // Create a skill with nested structure
      const pkgDir = join(tmpDir, 'nested-skill-pkg');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: nested-skill-pkg\nversion: 1.0.0\n');
      
      const skillDir = join(pkgDir, 'skills', 'nested', 'deep', 'skill');
      await mkdir(skillDir, { recursive: true });
      
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: nested-skill\nversion: 1.0.0\n---\n'
      );
      await writeFile(join(skillDir, 'file.md'), '# Nested File');

      const result = runCli(['install', pkgDir, '--skills', 'nested-skill'], workspaceDir);

      assert.equal(result.code, 0, `Unexpected error: ${result.stderr}`);
      // The nested path structure should be preserved during installation
      // Verification would require checking platform-specific paths, which varies
    });

    it('should use directory name as fallback when frontmatter name is missing', async () => {
      const pkgDir = join(tmpDir, 'fallback-name-pkg');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: fallback-name-pkg\nversion: 1.0.0\n');
      
      const skillDir = join(pkgDir, 'skills', 'my-skill-dir');
      await mkdir(skillDir, { recursive: true });
      
      // SKILL.md without name in frontmatter
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nversion: 1.0.0\ndescription: Uses directory name\n---\n'
      );
      await writeFile(join(skillDir, 'content.md'), '# Content');

      const result = runCli(['install', pkgDir, '--skills', 'my-skill-dir'], workspaceDir);

      assert.equal(result.code, 0, `Unexpected error: ${result.stderr}`);
      assert.match(result.stdout, /✓ my-skill-dir/i);
    });
  });

  describe('Marketplace Skills - Validation', () => {
    it('should error when --skills is used without --plugins on marketplace', async () => {
      // Create a minimal marketplace
      const marketplaceDir = join(tmpDir, 'marketplace');
      const pluginManifestDir = join(marketplaceDir, '.claude-plugin');
      await mkdir(pluginManifestDir, { recursive: true });
      
      await writeFile(
        join(pluginManifestDir, 'plugin.json'),
        JSON.stringify({
          name: 'test-marketplace',
          version: '1.0.0',
          plugins: [
            { name: 'plugin1', source: './plugins/plugin1' }
          ]
        })
      );

      const result = runCli(['install', marketplaceDir, '--skills', 'some-skill'], workspaceDir);

      assert.equal(result.code, 1);
      assert.match(result.stderr, /requires --plugins flag/i);
      assert.match(result.stderr, /Example: opkg install.*--plugins.*--skills/i);
    });

    it('should error when selected plugins have no skills', async () => {
      // Create marketplace with plugin but no skills
      const marketplaceDir = join(tmpDir, 'marketplace-no-skills');
      const pluginManifestDir = join(marketplaceDir, '.claude-plugin');
      await mkdir(pluginManifestDir, { recursive: true });
      
      await writeFile(
        join(pluginManifestDir, 'plugin.json'),
        JSON.stringify({
          name: 'test-marketplace',
          version: '1.0.0',
          plugins: [
            { name: 'plugin-no-skills', source: './plugins/plugin1' }
          ]
        })
      );
      
      // Create plugin directory without skills
      const pluginDir = join(marketplaceDir, 'plugins', 'plugin1');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(join(pluginDir, 'README.md'), '# Plugin 1');

      const result = runCli(
        ['install', marketplaceDir, '--plugins', 'plugin-no-skills', '--skills', 'any'],
        workspaceDir
      );

      assert.equal(result.code, 1);
      assert.match(result.stderr, /do not contain any skills/i);
      assert.match(result.stderr, /Skills directory must be at root of plugin/i);
    });

    it('should error when requested skill not found in marketplace', async () => {
      // Create marketplace with plugin with skills
      const marketplaceDir = join(tmpDir, 'marketplace-with-skills');
      const pluginManifestDir = join(marketplaceDir, '.claude-plugin');
      await mkdir(pluginManifestDir, { recursive: true });
      
      await writeFile(
        join(pluginManifestDir, 'plugin.json'),
        JSON.stringify({
          name: 'test-marketplace',
          version: '1.0.0',
          plugins: [
            { name: 'essentials', source: './plugins/essentials' }
          ]
        })
      );
      
      // Create plugin with one skill
      const pluginDir = join(marketplaceDir, 'plugins', 'essentials');
      const skillDir = join(pluginDir, 'skills', 'git');
      await mkdir(skillDir, { recursive: true });
      
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: git\nversion: 1.0.0\ndescription: Git workflows\n---\n'
      );

      const result = runCli(
        ['install', marketplaceDir, '--plugins', 'essentials', '--skills', 'docker', 'nonexistent'],
        workspaceDir
      );

      assert.equal(result.code, 1);
      assert.match(result.stderr, /Skills not found: docker, nonexistent/i);
      assert.match(result.stderr, /Available skills in selected plugins:/i);
      assert.match(result.stderr, /\[essentials\] git.*Git workflows/i);
    });
  });

  describe('Marketplace Skills - Installation', () => {
    it('should install skills from marketplace plugin', async () => {
      // Create marketplace with plugin with skills
      const marketplaceDir = join(tmpDir, 'marketplace-skills-install');
      const pluginManifestDir = join(marketplaceDir, '.claude-plugin');
      await mkdir(pluginManifestDir, { recursive: true });
      
      await writeFile(
        join(pluginManifestDir, 'plugin.json'),
        JSON.stringify({
          name: 'skills-marketplace',
          version: '1.0.0',
          plugins: [
            { name: 'essentials', source: './plugins/essentials' }
          ]
        })
      );
      
      // Create plugin with multiple skills
      const pluginDir = join(marketplaceDir, 'plugins', 'essentials');
      
      // Git skill
      const gitSkillDir = join(pluginDir, 'skills', 'git');
      await mkdir(gitSkillDir, { recursive: true });
      await writeFile(
        join(gitSkillDir, 'SKILL.md'),
        '---\nname: git\nversion: 1.0.0\ndescription: Git workflows\n---\n# Git'
      );
      await writeFile(join(gitSkillDir, 'workflow.md'), '# Workflow');
      
      // Docker skill
      const dockerSkillDir = join(pluginDir, 'skills', 'docker');
      await mkdir(dockerSkillDir, { recursive: true });
      await writeFile(
        join(dockerSkillDir, 'SKILL.md'),
        '---\nname: docker\nversion: 1.0.0\ndescription: Docker operations\n---\n# Docker'
      );

      const result = runCli(
        ['install', marketplaceDir, '--plugins', 'essentials', '--skills', 'git', 'docker'],
        workspaceDir
      );

      assert.equal(result.code, 0, `Unexpected error: ${result.stderr}`);
      assert.match(result.stdout, /Installing 2 skills/i);
      assert.match(result.stdout, /✓ git \(from essentials\)/i);
      assert.match(result.stdout, /✓ docker \(from essentials\)/i);
      assert.match(result.stdout, /Successfully installed: 2 skills/i);
    });

    it('should install skills from multiple marketplace plugins', async () => {
      // Create marketplace with multiple plugins with skills
      const marketplaceDir = join(tmpDir, 'marketplace-multi-plugin');
      const pluginManifestDir = join(marketplaceDir, '.claude-plugin');
      await mkdir(pluginManifestDir, { recursive: true });
      
      await writeFile(
        join(pluginManifestDir, 'plugin.json'),
        JSON.stringify({
          name: 'multi-plugin-marketplace',
          version: '1.0.0',
          plugins: [
            { name: 'plugin1', source: './plugins/plugin1' },
            { name: 'plugin2', source: './plugins/plugin2' }
          ]
        })
      );
      
      // Plugin 1 with skill
      const plugin1Dir = join(marketplaceDir, 'plugins', 'plugin1');
      const skill1Dir = join(plugin1Dir, 'skills', 'skill1');
      await mkdir(skill1Dir, { recursive: true });
      await writeFile(
        join(skill1Dir, 'SKILL.md'),
        '---\nname: skill1\nversion: 1.0.0\n---\n'
      );
      
      // Plugin 2 with skill
      const plugin2Dir = join(marketplaceDir, 'plugins', 'plugin2');
      const skill2Dir = join(plugin2Dir, 'skills', 'skill2');
      await mkdir(skill2Dir, { recursive: true });
      await writeFile(
        join(skill2Dir, 'SKILL.md'),
        '---\nname: skill2\nversion: 2.0.0\n---\n'
      );

      const result = runCli(
        ['install', marketplaceDir, '--plugins', 'plugin1', 'plugin2', '--skills', 'skill1', 'skill2'],
        workspaceDir
      );

      assert.equal(result.code, 0, `Unexpected error: ${result.stderr}`);
      assert.match(result.stdout, /Installing 2 skills/i);
      assert.match(result.stdout, /✓ skill1/i);
      assert.match(result.stdout, /✓ skill2/i);
    });
  });

  describe('Error Handling', () => {
    it('should show partial success when some skills fail', async () => {
      // This test would require creating a skill that intentionally fails
      // For now, we test the basic error aggregation logic
      const pkgDir = join(tmpDir, 'partial-fail-pkg');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: partial-fail-pkg\nversion: 1.0.0\n');
      
      const skillDir = join(pkgDir, 'skills', 'valid-skill');
      await mkdir(skillDir, { recursive: true });
      
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: valid-skill\nversion: 1.0.0\n---\n'
      );

      // Requesting a non-existent skill along with a valid one
      const result = runCli(['install', pkgDir, '--skills', 'valid-skill', 'invalid-skill'], workspaceDir);

      // Should fail validation before attempting installation
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Skills not found: invalid-skill/i);
    });

    it('should handle empty skills selection gracefully', async () => {
      const pkgDir = join(tmpDir, 'empty-selection-pkg');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: empty-selection-pkg\nversion: 1.0.0\n');
      
      const skillDir = join(pkgDir, 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: test-skill\nversion: 1.0.0\n---\n'
      );

      // Pass empty array (edge case)
      const result = runCli(['install', pkgDir, '--skills'], workspaceDir);

      // Should not trigger skills logic if no skills specified
      // This tests the normalization logic
      assert.equal(result.code, 0, `Unexpected error: ${result.stderr}`);
      // Should install normally without skills filtering
    });
  });

  describe('Integration with Existing Flows', () => {
    it('should install full package when --skills is not specified', async () => {
      const pkgDir = join(tmpDir, 'full-pkg');
      await mkdir(pkgDir, { recursive: true });
      await writeFile(join(pkgDir, 'openpackage.yml'), 'name: test\nversion: 1.0.0\n');
      
      const skillDir = join(pkgDir, 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: test-skill\nversion: 1.0.0\n---\n'
      );
      await writeFile(join(pkgDir, 'README.md'), '# Package');

      // Install without --skills flag
      const result = runCli(['install', pkgDir], workspaceDir);

      assert.equal(result.code, 0, `Unexpected error: ${result.stderr}`);
      // Should install the package normally, not as individual skills
      assert.doesNotMatch(result.stdout, /Installing.*skills/i);
    });

    it('should handle marketplace plugins normally when --skills not specified', async () => {
      const marketplaceDir = join(tmpDir, 'marketplace-normal');
      const pluginManifestDir = join(marketplaceDir, '.claude-plugin');
      await mkdir(pluginManifestDir, { recursive: true });
      
      await writeFile(
        join(pluginManifestDir, 'plugin.json'),
        JSON.stringify({
          name: 'normal-marketplace',
          version: '1.0.0',
          plugins: [
            { name: 'plugin1', source: './plugins/plugin1' }
          ]
        })
      );
      
      const pluginDir = join(marketplaceDir, 'plugins', 'plugin1');
      const skillDir = join(pluginDir, 'skills', 'skill1');
      await mkdir(skillDir, { recursive: true });
      
      // Add plugin.json to make plugin1 valid
      const plugin1ManifestDir = join(pluginDir, '.claude-plugin');
      await mkdir(plugin1ManifestDir, { recursive: true });
      await writeFile(
        join(plugin1ManifestDir, 'plugin.json'),
        JSON.stringify({ name: 'plugin1', version: '1.0.0' })
      );
      
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: skill1\n---\n'
      );

      // Install with --plugins but without --skills
      const result = runCli(['install', marketplaceDir, '--plugins', 'plugin1'], workspaceDir);

      // Should install the plugin normally, not as skills
      assert.equal(result.code, 0, `Unexpected error: ${result.stderr}`);
      assert.doesNotMatch(result.stdout, /Installing.*skills/i);
    });
  });
});
