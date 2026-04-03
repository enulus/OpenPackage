import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverResources } from '../../../packages/core/src/core/install/resource-discoverer.js';
import { applyConvenienceFilters } from '../../../packages/core/src/core/install/convenience-matchers.js';

describe('nested resource discovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-nested-resource-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers nested skills under config/skills from the package root', async () => {
    const nestedSkillDir = join(tempDir, 'config', 'skills', 'langsmith-dataset');
    await mkdir(nestedSkillDir, { recursive: true });
    await writeFile(
      join(nestedSkillDir, 'SKILL.md'),
      '---\nname: langsmith-dataset\nversion: 1.2.3\n---\n# LangSmith Dataset\n'
    );

    const result = await discoverResources(tempDir, tempDir);
    const skills = result.all.filter(resource => resource.resourceType === 'skill');

    assert.equal(skills.length, 1);
    assert.equal(skills[0].displayName, 'langsmith-dataset');
    assert.equal(skills[0].resourcePath, 'config/skills/langsmith-dataset');
    assert.equal(skills[0].installKind, 'directory');
    assert.equal(skills[0].version, '1.2.3');
  });

  it('matches nested skills via --skills convenience filtering', async () => {
    const nestedSkillDir = join(tempDir, 'config', 'skills', 'langsmith-dataset');
    await mkdir(nestedSkillDir, { recursive: true });
    await writeFile(
      join(nestedSkillDir, 'SKILL.md'),
      '---\nname: langsmith-dataset\nversion: 2.0.0\n---\n# LangSmith Dataset\n'
    );

    const result = await applyConvenienceFilters(tempDir, tempDir, {
      skills: ['langsmith-dataset']
    });

    assert.equal(result.errors.length, 0);
    assert.equal(result.resources.length, 1);
    assert.equal(result.resources[0].resourceType, 'skill');
    assert.equal(result.resources[0].resourcePath, 'config/skills/langsmith-dataset');
    assert.equal(result.resources[0].matchedBy, 'frontmatter');
    assert.equal(result.resources[0].resourceVersion, '2.0.0');
  });

  it('keeps discovering top-level and nested skills together', async () => {
    const rootSkillDir = join(tempDir, 'skills', 'root-skill');
    const nestedSkillDir = join(tempDir, 'config', 'skills', 'nested-skill');

    await mkdir(rootSkillDir, { recursive: true });
    await mkdir(nestedSkillDir, { recursive: true });
    await writeFile(join(rootSkillDir, 'SKILL.md'), '---\nname: root-skill\n---\n# Root\n');
    await writeFile(join(nestedSkillDir, 'SKILL.md'), '---\nname: nested-skill\n---\n# Nested\n');

    const result = await discoverResources(tempDir, tempDir);
    const skillPaths = result.all
      .filter(resource => resource.resourceType === 'skill')
      .map(resource => resource.resourcePath)
      .sort();

    assert.deepEqual(skillPaths, [
      'config/skills/nested-skill',
      'skills/root-skill'
    ]);
  });

  it('skips excluded .openpackage paths while scanning for nested skills', async () => {
    const excludedSkillDir = join(tempDir, '.openpackage', 'config', 'skills', 'hidden-skill');
    await mkdir(excludedSkillDir, { recursive: true });
    await writeFile(join(excludedSkillDir, 'SKILL.md'), '---\nname: hidden-skill\n---\n# Hidden\n');

    const discoverResult = await discoverResources(tempDir, tempDir);
    const filterResult = await applyConvenienceFilters(tempDir, tempDir, {
      skills: ['hidden-skill']
    });

    assert.equal(discoverResult.all.filter(resource => resource.resourceType === 'skill').length, 0);
    assert.equal(filterResult.resources.length, 0);
    assert.equal(filterResult.errors.length, 1);
    assert.match(filterResult.errors[0], /Skill 'hidden-skill' not found/);
  });
});
