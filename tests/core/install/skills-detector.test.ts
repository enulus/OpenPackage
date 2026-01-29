import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectSkillsInDirectory,
  isSkillsCollection,
  findSkillByName,
  validateSkillExists,
  type DiscoveredSkill
} from '../../../src/core/install/skills-detector.js';

describe('Skills Detector', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-skills-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('detectSkillsInDirectory', () => {
    it('should detect single skill at skills/git/SKILL.md', async () => {
      // Setup
      const skillDir = join(tempDir, 'skills', 'git');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: git-workflow
version: 1.0.0
---

# Git Workflow Skill
`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.strictEqual(result.discoveredSkills.length, 1);
      
      const skill = result.discoveredSkills[0];
      assert.strictEqual(skill.name, 'git-workflow');
      assert.strictEqual(skill.version, '1.0.0');
      assert.strictEqual(skill.skillPath, 'skills/git');
      assert.strictEqual(skill.manifestPath, 'skills/git/SKILL.md');
      assert.strictEqual(skill.directoryName, 'git');
    });

    it('should detect multiple skills at various depths', async () => {
      // Setup: Create nested structure
      // skills/git/SKILL.md
      const gitDir = join(tempDir, 'skills', 'git');
      await mkdir(gitDir, { recursive: true });
      await writeFile(
        join(gitDir, 'SKILL.md'),
        `---
name: git-workflow
---
Content`
      );

      // skills/docker/compose/SKILL.md
      const dockerDir = join(tempDir, 'skills', 'docker', 'compose');
      await mkdir(dockerDir, { recursive: true });
      await writeFile(
        join(dockerDir, 'SKILL.md'),
        `---
name: docker-compose
version: 2.0.0
---
Content`
      );

      // skills/testing/unit/SKILL.md
      const testingDir = join(tempDir, 'skills', 'testing', 'unit');
      await mkdir(testingDir, { recursive: true });
      await writeFile(
        join(testingDir, 'SKILL.md'),
        `---
name: unit-testing
---
Content`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.strictEqual(result.discoveredSkills.length, 3);
      
      const skillNames = result.discoveredSkills.map(s => s.name).sort();
      assert.deepStrictEqual(skillNames, ['docker-compose', 'git-workflow', 'unit-testing']);
    });

    it('should detect deeply nested skill', async () => {
      // Setup: skills/level1/level2/level3/deep-skill/SKILL.md
      const deepDir = join(tempDir, 'skills', 'level1', 'level2', 'level3', 'deep-skill');
      await mkdir(deepDir, { recursive: true });
      await writeFile(
        join(deepDir, 'SKILL.md'),
        `---
name: deeply-nested
---
Content`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.strictEqual(result.discoveredSkills.length, 1);
      assert.strictEqual(result.discoveredSkills[0].name, 'deeply-nested');
      assert.strictEqual(result.discoveredSkills[0].skillPath, 'skills/level1/level2/level3/deep-skill');
    });

    it('should return hasSkills:false when skills/ directory is empty', async () => {
      // Setup: Create empty skills/ directory
      await mkdir(join(tempDir, 'skills'), { recursive: true });

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, false);
      assert.strictEqual(result.discoveredSkills.length, 0);
    });

    it('should return hasSkills:false when no skills/ directory exists', async () => {
      // Execute (tempDir has no skills/ directory)
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, false);
      assert.strictEqual(result.discoveredSkills.length, 0);
    });

    it('should detect skill at root of skills/ directory', async () => {
      // Setup: skills/SKILL.md (skill directly in skills/)
      const skillsDir = join(tempDir, 'skills');
      await mkdir(skillsDir, { recursive: true });
      await writeFile(
        join(skillsDir, 'SKILL.md'),
        `---
name: root-skill
---
Content`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.strictEqual(result.discoveredSkills.length, 1);
      assert.strictEqual(result.discoveredSkills[0].name, 'root-skill');
      assert.strictEqual(result.discoveredSkills[0].skillPath, 'skills');
    });

    it('should use directory name as fallback when frontmatter name is missing', async () => {
      // Setup: SKILL.md with no name field
      const skillDir = join(tempDir, 'skills', 'my-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
version: 1.0.0
description: A skill without a name field
---
Content`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.strictEqual(result.discoveredSkills.length, 1);
      assert.strictEqual(result.discoveredSkills[0].name, 'my-skill');
      assert.strictEqual(result.discoveredSkills[0].directoryName, 'my-skill');
    });

    it('should handle SKILL.md with empty frontmatter', async () => {
      // Setup: SKILL.md with empty frontmatter
      const skillDir = join(tempDir, 'skills', 'empty-frontmatter');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
---

# Content without frontmatter fields
`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.strictEqual(result.discoveredSkills.length, 1);
      assert.strictEqual(result.discoveredSkills[0].name, 'empty-frontmatter');
      assert.strictEqual(result.discoveredSkills[0].version, undefined);
    });

    it('should handle SKILL.md with no frontmatter', async () => {
      // Setup: SKILL.md without frontmatter delimiters
      const skillDir = join(tempDir, 'skills', 'no-frontmatter');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '# Just plain markdown content'
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.strictEqual(result.discoveredSkills.length, 1);
      assert.strictEqual(result.discoveredSkills[0].name, 'no-frontmatter');
      assert.strictEqual(result.discoveredSkills[0].version, undefined);
    });

    it('should handle SKILL.md with invalid YAML frontmatter', async () => {
      // Setup: SKILL.md with unparseable frontmatter
      const skillDir = join(tempDir, 'skills', 'invalid-yaml');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: [invalid: yaml: structure:::
---
Content`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert: Should gracefully continue with directory name
      assert.strictEqual(result.hasSkills, true);
      assert.strictEqual(result.discoveredSkills.length, 1);
      assert.strictEqual(result.discoveredSkills[0].name, 'invalid-yaml');
    });

    it('should extract version from frontmatter.version', async () => {
      // Setup
      const skillDir = join(tempDir, 'skills', 'versioned');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: versioned-skill
version: 2.5.0
---
Content`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.discoveredSkills[0].version, '2.5.0');
    });

    it('should extract version from frontmatter.metadata.version', async () => {
      // Setup: Version in metadata field
      const skillDir = join(tempDir, 'skills', 'metadata-version');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: metadata-versioned
metadata:
  version: 3.0.0
---
Content`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.discoveredSkills[0].version, '3.0.0');
    });

    it('should prefer frontmatter.version over metadata.version', async () => {
      // Setup: Both version fields present
      const skillDir = join(tempDir, 'skills', 'dual-version');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---
name: dual-version-skill
version: 1.0.0
metadata:
  version: 2.0.0
---
Content`
      );

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert: Should prefer top-level version
      assert.strictEqual(result.discoveredSkills[0].version, '1.0.0');
    });

    it('should detect plugin collection type', async () => {
      // Setup: Create plugin manifest
      const pluginDir = join(tempDir, '.claude-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({ name: 'test-plugin' })
      );

      // Add a skill
      const skillDir = join(tempDir, 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Skill');

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.ok(result.collectionTypes.includes('plugin'));
    });

    it('should detect package collection type', async () => {
      // Setup: Create package manifest
      await writeFile(
        join(tempDir, 'openpackage.yml'),
        'name: test-package\nversion: 1.0.0'
      );

      // Add a skill
      const skillDir = join(tempDir, 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Skill');

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.ok(result.collectionTypes.includes('package'));
    });

    it('should detect repository collection type when no manifests present', async () => {
      // Setup: Just skills, no plugin or package manifests
      const skillDir = join(tempDir, 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Skill');

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.ok(result.collectionTypes.includes('repository'));
    });

    it('should detect both plugin and package types', async () => {
      // Setup: Create both manifests
      const pluginDir = join(tempDir, '.claude-plugin');
      await mkdir(pluginDir, { recursive: true });
      await writeFile(
        join(pluginDir, 'plugin.json'),
        JSON.stringify({ name: 'test-plugin' })
      );
      await writeFile(
        join(tempDir, 'openpackage.yml'),
        'name: test-package'
      );

      // Add a skill
      const skillDir = join(tempDir, 'skills', 'test-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Skill');

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert
      assert.strictEqual(result.hasSkills, true);
      assert.ok(result.collectionTypes.includes('plugin'));
      assert.ok(result.collectionTypes.includes('package'));
      assert.strictEqual(result.collectionTypes.length, 2);
    });

    it('should skip junk files and directories', async () => {
      // Setup: Create skills with junk files/dirs
      const skillDir = join(tempDir, 'skills', 'good-skill');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Good Skill');

      // Create junk items
      await mkdir(join(tempDir, 'skills', '.DS_Store'), { recursive: true });
      await mkdir(join(tempDir, 'skills', 'node_modules'), { recursive: true });
      await writeFile(join(tempDir, 'skills', 'Thumbs.db'), 'junk');

      // Execute
      const result = await detectSkillsInDirectory(tempDir);

      // Assert: Should only find the good skill
      assert.strictEqual(result.hasSkills, true);
      assert.strictEqual(result.discoveredSkills.length, 1);
      assert.strictEqual(result.discoveredSkills[0].name, 'good-skill');
    });
  });

  describe('isSkillsCollection', () => {
    it('should return true for directory with skills', async () => {
      // Setup
      const skillDir = join(tempDir, 'skills', 'test');
      await mkdir(skillDir, { recursive: true });
      await writeFile(join(skillDir, 'SKILL.md'), '# Test Skill');

      // Execute
      const result = await isSkillsCollection(tempDir);

      // Assert
      assert.strictEqual(result, true);
    });

    it('should return false for directory without skills', async () => {
      // Execute (tempDir has no skills)
      const result = await isSkillsCollection(tempDir);

      // Assert
      assert.strictEqual(result, false);
    });
  });

  describe('findSkillByName', () => {
    const mockSkills: DiscoveredSkill[] = [
      {
        name: 'git-workflow',
        version: '1.0.0',
        skillPath: 'skills/git',
        manifestPath: 'skills/git/SKILL.md',
        directoryName: 'git',
        frontmatter: { name: 'git-workflow' }
      },
      {
        name: 'docker-compose',
        version: '2.0.0',
        skillPath: 'skills/docker/compose',
        manifestPath: 'skills/docker/compose/SKILL.md',
        directoryName: 'compose',
        frontmatter: { name: 'docker-compose' }
      },
      {
        name: 'unit-test',
        version: undefined,
        skillPath: 'skills/testing',
        manifestPath: 'skills/testing/SKILL.md',
        directoryName: 'testing',
        frontmatter: { name: 'unit-test' }
      }
    ];

    it('should find skill by exact frontmatter name', () => {
      const result = findSkillByName(mockSkills, 'git-workflow');
      assert.ok(result);
      assert.strictEqual(result.name, 'git-workflow');
    });

    it('should find skill by directory name', () => {
      const result = findSkillByName(mockSkills, 'compose');
      assert.ok(result);
      assert.strictEqual(result.name, 'docker-compose');
    });

    it('should be case-insensitive', () => {
      const result = findSkillByName(mockSkills, 'GIT-WORKFLOW');
      assert.ok(result);
      assert.strictEqual(result.name, 'git-workflow');
    });

    it('should trim whitespace from search name', () => {
      const result = findSkillByName(mockSkills, '  git-workflow  ');
      assert.ok(result);
      assert.strictEqual(result.name, 'git-workflow');
    });

    it('should prefer frontmatter name over directory name', () => {
      // Both mockSkills[1] has directoryName 'compose' and name 'docker-compose'
      // If we search for 'compose', it should match via directory name
      const result = findSkillByName(mockSkills, 'docker-compose');
      assert.ok(result);
      assert.strictEqual(result.name, 'docker-compose');
      assert.strictEqual(result.directoryName, 'compose');
    });

    it('should return null for non-existent skill', () => {
      const result = findSkillByName(mockSkills, 'non-existent');
      assert.strictEqual(result, null);
    });

    it('should return null for empty array', () => {
      const result = findSkillByName([], 'any-name');
      assert.strictEqual(result, null);
    });
  });

  describe('validateSkillExists', () => {
    const mockSkills: DiscoveredSkill[] = [
      {
        name: 'git',
        version: '1.0.0',
        skillPath: 'skills/git',
        manifestPath: 'skills/git/SKILL.md',
        directoryName: 'git',
        frontmatter: { name: 'git' }
      },
      {
        name: 'docker',
        version: '2.0.0',
        skillPath: 'skills/docker',
        manifestPath: 'skills/docker/SKILL.md',
        directoryName: 'docker',
        frontmatter: { name: 'docker' }
      }
    ];

    it('should return all valid when all skills exist', () => {
      const result = validateSkillExists(mockSkills, ['git', 'docker']);
      
      assert.strictEqual(result.valid.length, 2);
      assert.strictEqual(result.invalid.length, 0);
      assert.strictEqual(result.valid[0].name, 'git');
      assert.strictEqual(result.valid[1].name, 'docker');
    });

    it('should return some valid, some invalid', () => {
      const result = validateSkillExists(mockSkills, ['git', 'non-existent', 'docker']);
      
      assert.strictEqual(result.valid.length, 2);
      assert.strictEqual(result.invalid.length, 1);
      assert.strictEqual(result.invalid[0], 'non-existent');
    });

    it('should return all invalid when no skills exist', () => {
      const result = validateSkillExists(mockSkills, ['missing1', 'missing2']);
      
      assert.strictEqual(result.valid.length, 0);
      assert.strictEqual(result.invalid.length, 2);
      assert.deepStrictEqual(result.invalid, ['missing1', 'missing2']);
    });

    it('should return empty arrays for empty input', () => {
      const result = validateSkillExists(mockSkills, []);
      
      assert.strictEqual(result.valid.length, 0);
      assert.strictEqual(result.invalid.length, 0);
    });

    it('should handle case-insensitive matching', () => {
      const result = validateSkillExists(mockSkills, ['GIT', 'DOCKER']);
      
      assert.strictEqual(result.valid.length, 2);
      assert.strictEqual(result.invalid.length, 0);
    });
  });
});
