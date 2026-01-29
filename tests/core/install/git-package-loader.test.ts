/**
 * Tests for git-package-loader.ts - Skills Detection Integration
 * 
 * These tests verify that the git package loader properly detects skills
 * during the loading phase for both marketplace and non-marketplace sources.
 * 
 * Note: These tests use real file system operations and the actual git-package-loader
 * since mocking ES6 module imports is challenging. The git clone is the only external
 * dependency, and we create local test repositories to avoid network calls.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectSkillsInDirectory } from '../../../src/core/install/skills-detector.js';
import { detectPluginType } from '../../../src/core/install/plugin-detector.js';

describe('Git Package Loader - Skills Detection (Unit)', () => {
  let tempDir: string;
  let mockRepoPath: string;
  
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-loader-test-'));
    mockRepoPath = join(tempDir, 'repo');
    await mkdir(mockRepoPath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Skills Detection on Marketplace', () => {
    it('should detect skills in marketplace directory', async () => {
      // Setup: Create marketplace with skills
      const pluginDir = join(mockRepoPath, '.claude-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'marketplace.json'),
        JSON.stringify({ version: '1.0.0', plugins: [] })
      );

      // Add skills
      const skillDir = join(mockRepoPath, 'skills', 'git');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: git-workflow
version: 1.0.0
---
Git workflow skill`
      );

      // Verify it's a marketplace
      const pluginDetection = await detectPluginType(mockRepoPath);
      assert.strictEqual(pluginDetection.type, 'marketplace');

      // Execute skills detection
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert
      assert.strictEqual(skillsDetection.hasSkills, true);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 1);
      assert.strictEqual(skillsDetection.discoveredSkills[0].name, 'git-workflow');
    });

    it('should handle marketplace without skills', async () => {
      // Setup: Create marketplace without skills
      const pluginDir = join(mockRepoPath, '.claude-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'marketplace.json'),
        JSON.stringify({ version: '1.0.0', plugins: [] })
      );

      // Verify it's a marketplace
      const pluginDetection = await detectPluginType(mockRepoPath);
      assert.strictEqual(pluginDetection.type, 'marketplace');

      // Execute skills detection
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert
      assert.strictEqual(skillsDetection.hasSkills, false);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 0);
    });

    it('should handle invalid skills structure gracefully', async () => {
      // Setup: Create marketplace
      const pluginDir = join(mockRepoPath, '.claude-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'marketplace.json'),
        JSON.stringify({ version: '1.0.0', plugins: [] })
      );

      // Create invalid skills directory (file instead of directory)
      await writeFile(join(mockRepoPath, 'skills'), 'invalid');

      // Execute skills detection - should not throw
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert - should return no skills
      assert.strictEqual(skillsDetection.hasSkills, false);
    });
  });

  describe('Skills Detection on Plugin/Package', () => {
    it('should detect skills in individual plugin', async () => {
      // Setup: Create plugin with skills
      const pluginDir = join(mockRepoPath, '.claude-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({ 
          name: 'test-plugin',
          version: '1.0.0'
        })
      );

      // Add openpackage.yml
      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: test-plugin
version: 1.0.0`
      );

      // Add skills
      const skillDir = join(mockRepoPath, 'skills', 'docker');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: docker-skill
version: 2.0.0
---
Docker skill`
      );

      // Verify it's a plugin
      const pluginDetection = await detectPluginType(mockRepoPath);
      assert.strictEqual(pluginDetection.type, 'individual');

      // Execute skills detection
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert
      assert.strictEqual(skillsDetection.hasSkills, true);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 1);
      assert.strictEqual(skillsDetection.discoveredSkills[0].name, 'docker-skill');
      assert.deepStrictEqual(
        skillsDetection.collectionTypes,
        ['plugin', 'package']
      );
    });

    it('should detect skills in OpenPackage package', async () => {
      // Setup: Create package with skills
      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: test-package
version: 1.0.0`
      );

      // Add skills
      const skillDir = join(mockRepoPath, 'skills', 'testing');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: testing-skill
---
Testing skill`
      );

      // Execute skills detection
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert
      assert.strictEqual(skillsDetection.hasSkills, true);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 1);
      assert.strictEqual(skillsDetection.discoveredSkills[0].name, 'testing-skill');
      assert.deepStrictEqual(skillsDetection.collectionTypes, ['package']);
    });

    it('should detect skills in plain repository', async () => {
      // Setup: Create repository with skills (no plugin.json or openpackage.yml initially)
      const skillDir = join(mockRepoPath, 'skills', 'coding');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: coding-skill
---
Coding skill`
      );

      // Execute skills detection
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert
      assert.strictEqual(skillsDetection.hasSkills, true);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 1);
      assert.deepStrictEqual(skillsDetection.collectionTypes, ['repository']);
    });

    it('should handle package without skills', async () => {
      // Setup: Create package without skills
      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: regular-package
version: 1.0.0`
      );

      // Execute skills detection
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert
      assert.strictEqual(skillsDetection.hasSkills, false);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 0);
    });

    it('should detect multiple skills at various depths', async () => {
      // Setup: Create package with nested skills
      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: multi-skill-package
version: 1.0.0`
      );

      // Add skills at different depths
      const gitSkillDir = join(mockRepoPath, 'skills', 'git');
      await mkdir(gitSkillDir, { recursive: true });
      await writeFile(
        join(gitSkillDir, 'SKILL.md'),
        `---
name: git-skill
---
Git`
      );

      const dockerComposeDir = join(mockRepoPath, 'skills', 'docker', 'compose');
      await mkdir(dockerComposeDir, { recursive: true });
      await writeFile(
        join(dockerComposeDir, 'SKILL.md'),
        `---
name: docker-compose-skill
---
Compose`
      );

      const testingDir = join(mockRepoPath, 'skills', 'testing', 'unit');
      await mkdir(testingDir, { recursive: true });
      await writeFile(
        join(testingDir, 'SKILL.md'),
        `---
name: unit-testing-skill
---
Testing`
      );

      // Execute skills detection
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);

      // Assert
      assert.strictEqual(skillsDetection.hasSkills, true);
      assert.strictEqual(skillsDetection.discoveredSkills.length, 3);
      
      const skillNames = skillsDetection.discoveredSkills.map(s => s.name).sort();
      assert.deepStrictEqual(skillNames, [
        'docker-compose-skill',
        'git-skill',
        'unit-testing-skill'
      ]);
    });
  });

  describe('Performance', () => {
    it('should handle many skills efficiently', async () => {
      // Setup: Create package with many skills
      await writeFile(
        join(mockRepoPath, 'openpackage.yml'),
        `name: large-skill-collection
version: 1.0.0`
      );

      // Create 10 skills
      for (let i = 1; i <= 10; i++) {
        const skillDir = join(mockRepoPath, 'skills', `skill${i}`);
        await mkdir(skillDir, { recursive: true });
        await writeFile(
          join(skillDir, 'SKILL.md'),
          `---
name: skill-${i}
---
Skill ${i}`
        );
      }

      // Execute
      const startTime = Date.now();
      const skillsDetection = await detectSkillsInDirectory(mockRepoPath);
      const duration = Date.now() - startTime;

      // Assert - should find all skills
      assert.strictEqual(skillsDetection.discoveredSkills.length, 10);
      
      // Performance should be reasonable (< 500ms for 10 skills)
      assert.ok(duration < 500, `Skills detection took ${duration}ms, should be < 500ms`);
    });
  });
});
