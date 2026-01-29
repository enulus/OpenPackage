/**
 * Integration tests for loader + skills detection flow
 * 
 * These tests verify that the loader integration properly exposes skills detection
 * information through the sourceMetadata field.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectSkillsInDirectory } from '../../../src/core/install/skills-detector.js';

describe('Loader Skills Integration', () => {
  let tempDir: string;
  let mockRepoPath: string;
  
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-integration-test-'));
    mockRepoPath = join(tempDir, 'repo');
    await mkdir(mockRepoPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Skills Detection Result Structure', () => {
    it('should provide complete skills detection information', async () => {
      // Setup: Create package with skills
      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: test-package
version: 1.0.0`
      );

      const skillDir = join(mockRepoPath, 'skills', 'coding');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: coding-skill
version: 1.0.0
---
Coding skill`
      );

      // Execute - this simulates what the loader does
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert - verify result structure matches what LoadedPackage.sourceMetadata expects
      assert.ok(skillsDetection, 'Skills detection should be present');
      assert.strictEqual(typeof skillsDetection.hasSkills, 'boolean');
      assert.ok(Array.isArray(skillsDetection.collectionTypes));
      assert.ok(Array.isArray(skillsDetection.discoveredSkills));
      
      // Verify skills data
      assert.strictEqual(skillsDetection.hasSkills, true);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 1);
      assert.strictEqual(skillsDetection.discoveredSkills[0].name, 'coding-skill');
      
      // Verify each skill has required fields
      const skill = skillsDetection.discoveredSkills[0];
      assert.ok(skill.name);
      assert.ok(skill.skillPath);
      assert.ok(skill.manifestPath);
      assert.ok(skill.directoryName);
      assert.ok(skill.frontmatter);
    });

    it('should handle sources without skills gracefully', async () => {
      // Setup: Create package without skills
      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: regular-package
version: 1.0.0`
      );

      // Execute
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert - should have valid structure even with no skills
      assert.ok(skillsDetection);
      assert.strictEqual(skillsDetection.hasSkills, false);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 0);
      assert.ok(Array.isArray(skillsDetection.collectionTypes));
    });
  });

  describe('Skills Metadata Flow', () => {
    it('should provide all required metadata for skill transformation', async () => {
      // Setup: Create package with multiple skills
      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: multi-skill-package
version: 1.0.0`
      );

      const skill1Dir = join(mockRepoPath, 'skills', 'skill1');
      await mkdir(skill1Dir, { recursive: true });
      await writeFile(
        join(skill1Dir, 'SKILL.md'),
        `---
name: skill-one
version: 1.0.0
---
Skill 1`
      );

      const skill2Dir = join(mockRepoPath, 'skills', 'skill2');
      await mkdir(skill2Dir, { recursive: true });
      await writeFile(
        join(skill2Dir, 'SKILL.md'),
        `---
name: skill-two
version: 2.0.0
---
Skill 2`
      );

      // Execute
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert - all skills should be discovered with complete metadata
      assert.strictEqual(skillsDetection.hasSkills, true);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 2);
      
      const skillNames = skillsDetection.discoveredSkills.map(s => s.name).sort();
      assert.deepStrictEqual(skillNames, ['skill-one', 'skill-two']);
      
      // Verify each skill has the metadata needed for transformation
      for (const skill of skillsDetection.discoveredSkills) {
        assert.ok(skill.name, 'Skill should have name');
        assert.ok(skill.skillPath, 'Skill should have skillPath');
        assert.ok(skill.manifestPath, 'Skill should have manifestPath');
        assert.ok(skill.version, 'Skill should have version from frontmatter');
        assert.strictEqual(typeof skill.frontmatter, 'object', 'Skill should have frontmatter');
      }
    });

    it('should include collection types for proper handling', async () => {
      // Setup: Create plugin with skills
      const pluginDir = join(mockRepoPath, '.claude-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({ name: 'test-plugin', version: '1.0.0' })
      );

      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: test-plugin
version: 1.0.0`
      );

      const skillDir = join(mockRepoPath, 'skills', 'test');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
---
Test`
      );

      // Execute
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert - should identify as both plugin and package
      assert.deepStrictEqual(
        skillsDetection.collectionTypes,
        ['plugin', 'package']
      );
    });
  });

  describe('Error Resilience', () => {
    it('should return empty result for invalid skills structure', async () => {
      // Setup: Create valid package
      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: test-package
version: 1.0.0`
      );

      // Create invalid skills structure (file instead of directory)
      await writeFile(join(mockRepoPath, 'skills'), 'not a directory');

      // Execute - should not throw
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert - should return safe empty result
      assert.strictEqual(skillsDetection.hasSkills, false);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 0);
    });
  });

  describe('Marketplace Skills', () => {
    it('should detect skills in marketplace structure', async () => {
      // Setup: Create marketplace with skills
      const pluginDir = join(mockRepoPath, '.claude-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'marketplace.json'),
        JSON.stringify({ version: '1.0.0', plugins: [] })
      );

      // Marketplace typically has plugin.json at root too
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({ name: 'marketplace', version: '1.0.0' })
      );

      const skillDir = join(mockRepoPath, 'skills', 'workflow');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: workflow-skill
---
Workflow skill`
      );

      // Execute
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert
      assert.strictEqual(skillsDetection.hasSkills, true);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 1);
      // Should be detected as plugin since it has .claude-plugin/plugin.json
      assert.ok(skillsDetection.collectionTypes.includes('plugin'));
    });
  });
});
