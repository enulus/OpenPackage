import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseSkillsFromMarketplace,
  validateSkillSelections,
  type SkillsCollectionMap
} from '../../../src/core/install/skills-marketplace-handler.js';
import type { MarketplaceManifest } from '../../../src/core/install/marketplace-handler.js';

describe('Skills Marketplace Handler', () => {
  let testDir: string;
  
  before(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'opkg-skills-marketplace-test-'));
  });
  
  after(async () => {
    await rm(testDir, { recursive: true, force: true });
  });
  
  describe('parseSkillsFromMarketplace', () => {
    it('should discover skills in a single plugin', async () => {
      // Create marketplace structure
      const marketplaceDir = join(testDir, 'marketplace-single');
      const pluginDir = join(marketplaceDir, 'plugins', 'essentials');
      const skillDir = join(pluginDir, 'skills', 'git');
      
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: git\nversion: 1.0.0\ndescription: Git workflow automation\n---\n# Git Skill'
      );
      await writeFile(join(skillDir, 'helper.sh'), '#!/bin/bash\necho "git helper"');
      
      const marketplace: MarketplaceManifest = {
        name: 'Test Marketplace',
        plugins: [
          {
            name: 'essentials',
            source: './plugins/essentials'
          }
        ]
      };
      
      const result = await parseSkillsFromMarketplace(
        marketplaceDir,
        marketplace,
        ['essentials']
      );
      
      assert.equal(result.pluginSkills.size, 1);
      assert.ok(result.pluginSkills.has('essentials'));
      
      const essentialsSkills = result.pluginSkills.get('essentials')!;
      assert.equal(essentialsSkills.length, 1);
      assert.equal(essentialsSkills[0].name, 'git');
      assert.equal(essentialsSkills[0].version, '1.0.0');
    });
    
    it('should discover skills in multiple plugins', async () => {
      // Create marketplace structure with multiple plugins
      const marketplaceDir = join(testDir, 'marketplace-multiple');
      
      // Plugin 1: essentials
      const plugin1Dir = join(marketplaceDir, 'plugins', 'essentials');
      const skill1Dir = join(plugin1Dir, 'skills', 'git');
      await mkdir(skill1Dir, { recursive: true });
      await writeFile(
        join(skill1Dir, 'SKILL.md'),
        '---\nname: git\ndescription: Git tools\n---\n'
      );
      
      // Plugin 2: utilities
      const plugin2Dir = join(marketplaceDir, 'plugins', 'utilities');
      const skill2Dir = join(plugin2Dir, 'skills', 'docker');
      await mkdir(skill2Dir, { recursive: true });
      await writeFile(
        join(skill2Dir, 'SKILL.md'),
        '---\nname: docker\ndescription: Docker tools\n---\n'
      );
      
      const marketplace: MarketplaceManifest = {
        name: 'Test Marketplace',
        plugins: [
          { name: 'essentials', source: './plugins/essentials' },
          { name: 'utilities', source: './plugins/utilities' }
        ]
      };
      
      const result = await parseSkillsFromMarketplace(
        marketplaceDir,
        marketplace,
        ['essentials', 'utilities']
      );
      
      assert.equal(result.pluginSkills.size, 2);
      assert.ok(result.pluginSkills.has('essentials'));
      assert.ok(result.pluginSkills.has('utilities'));
      
      assert.equal(result.pluginSkills.get('essentials')!.length, 1);
      assert.equal(result.pluginSkills.get('utilities')!.length, 1);
    });
    
    it('should handle plugin with no skills directory', async () => {
      const marketplaceDir = join(testDir, 'marketplace-no-skills');
      const pluginDir = join(marketplaceDir, 'plugins', 'empty');
      
      await mkdir(pluginDir, { recursive: true });
      await writeFile(join(pluginDir, 'README.md'), '# Empty plugin');
      
      const marketplace: MarketplaceManifest = {
        name: 'Test Marketplace',
        plugins: [
          { name: 'empty', source: './plugins/empty' }
        ]
      };
      
      const result = await parseSkillsFromMarketplace(
        marketplaceDir,
        marketplace,
        ['empty']
      );
      
      // Should not have entry for plugin with no skills
      assert.equal(result.pluginSkills.size, 0);
    });
    
    it('should handle plugin with empty skills directory', async () => {
      const marketplaceDir = join(testDir, 'marketplace-empty-skills');
      const pluginDir = join(marketplaceDir, 'plugins', 'empty-skills');
      const skillsDir = join(pluginDir, 'skills');
      
      await mkdir(skillsDir, { recursive: true });
      
      const marketplace: MarketplaceManifest = {
        name: 'Test Marketplace',
        plugins: [
          { name: 'empty-skills', source: './plugins/empty-skills' }
        ]
      };
      
      const result = await parseSkillsFromMarketplace(
        marketplaceDir,
        marketplace,
        ['empty-skills']
      );
      
      // Should not have entry for plugin with empty skills directory
      assert.equal(result.pluginSkills.size, 0);
    });
    
    it('should handle mix of plugins with and without skills', async () => {
      const marketplaceDir = join(testDir, 'marketplace-mixed');
      
      // Plugin with skills
      const plugin1Dir = join(marketplaceDir, 'plugins', 'with-skills');
      const skill1Dir = join(plugin1Dir, 'skills', 'test');
      await mkdir(skill1Dir, { recursive: true });
      await writeFile(
        join(skill1Dir, 'SKILL.md'),
        '---\nname: test\n---\n'
      );
      
      // Plugin without skills
      const plugin2Dir = join(marketplaceDir, 'plugins', 'without-skills');
      await mkdir(plugin2Dir, { recursive: true });
      await writeFile(join(plugin2Dir, 'README.md'), '# No skills');
      
      const marketplace: MarketplaceManifest = {
        name: 'Test Marketplace',
        plugins: [
          { name: 'with-skills', source: './plugins/with-skills' },
          { name: 'without-skills', source: './plugins/without-skills' }
        ]
      };
      
      const result = await parseSkillsFromMarketplace(
        marketplaceDir,
        marketplace,
        ['with-skills', 'without-skills']
      );
      
      assert.equal(result.pluginSkills.size, 1);
      assert.ok(result.pluginSkills.has('with-skills'));
      assert.ok(!result.pluginSkills.has('without-skills'));
    });
    
    it('should handle deeply nested skills', async () => {
      const marketplaceDir = join(testDir, 'marketplace-nested');
      const pluginDir = join(marketplaceDir, 'plugins', 'nested');
      const skillDir = join(pluginDir, 'skills', 'git', 'commit', 'advanced');
      
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: advanced-commit\n---\n'
      );
      
      const marketplace: MarketplaceManifest = {
        name: 'Test Marketplace',
        plugins: [
          { name: 'nested', source: './plugins/nested' }
        ]
      };
      
      const result = await parseSkillsFromMarketplace(
        marketplaceDir,
        marketplace,
        ['nested']
      );
      
      assert.equal(result.pluginSkills.size, 1);
      const skills = result.pluginSkills.get('nested')!;
      assert.equal(skills.length, 1);
      assert.equal(skills[0].name, 'advanced-commit');
      assert.ok(skills[0].skillPath.includes('skills/git/commit/advanced'));
    });
    
    it('should skip git source plugins', async () => {
      const marketplaceDir = join(testDir, 'marketplace-git-source');
      
      const marketplace: MarketplaceManifest = {
        name: 'Test Marketplace',
        plugins: [
          {
            name: 'git-plugin',
            source: {
              source: 'github',
              repo: 'user/repo'
            }
          }
        ]
      };
      
      const result = await parseSkillsFromMarketplace(
        marketplaceDir,
        marketplace,
        ['git-plugin']
      );
      
      // Git source plugins are skipped for skills discovery
      assert.equal(result.pluginSkills.size, 0);
    });
  });
  
  describe('validateSkillSelections', () => {
    let skillsCollection: SkillsCollectionMap;
    
    before(async () => {
      // Create test marketplace with skills
      const marketplaceDir = join(testDir, 'marketplace-validation');
      
      // Plugin 1: essentials
      const plugin1Dir = join(marketplaceDir, 'plugins', 'essentials');
      const skill1Dir = join(plugin1Dir, 'skills', 'git');
      const skill2Dir = join(plugin1Dir, 'skills', 'docker');
      await mkdir(skill1Dir, { recursive: true });
      await mkdir(skill2Dir, { recursive: true });
      await writeFile(join(skill1Dir, 'SKILL.md'), '---\nname: git\n---\n');
      await writeFile(join(skill2Dir, 'SKILL.md'), '---\nname: docker\n---\n');
      
      // Plugin 2: utilities
      const plugin2Dir = join(marketplaceDir, 'plugins', 'utilities');
      const skill3Dir = join(plugin2Dir, 'skills', 'linter');
      await mkdir(skill3Dir, { recursive: true });
      await writeFile(join(skill3Dir, 'SKILL.md'), '---\nname: linter\n---\n');
      
      const marketplace: MarketplaceManifest = {
        name: 'Test Marketplace',
        plugins: [
          { name: 'essentials', source: './plugins/essentials' },
          { name: 'utilities', source: './plugins/utilities' }
        ]
      };
      
      skillsCollection = await parseSkillsFromMarketplace(
        marketplaceDir,
        marketplace,
        ['essentials', 'utilities']
      );
    });
    
    it('should validate all requested skills found', () => {
      const result = validateSkillSelections(
        skillsCollection,
        ['git', 'docker']
      );
      
      assert.equal(result.valid.selections.length, 1);
      assert.equal(result.valid.selections[0].pluginName, 'essentials');
      assert.equal(result.valid.selections[0].skills.length, 2);
      assert.equal(result.invalid.length, 0);
    });
    
    it('should handle some found, some not found', () => {
      const result = validateSkillSelections(
        skillsCollection,
        ['git', 'nonexistent', 'linter']
      );
      
      assert.equal(result.valid.selections.length, 2);
      assert.equal(result.invalid.length, 1);
      assert.ok(result.invalid.includes('nonexistent'));
    });
    
    it('should handle no skills found', () => {
      const result = validateSkillSelections(
        skillsCollection,
        ['foo', 'bar']
      );
      
      assert.equal(result.valid.selections.length, 0);
      assert.equal(result.invalid.length, 2);
      assert.ok(result.invalid.includes('foo'));
      assert.ok(result.invalid.includes('bar'));
    });
    
    it('should handle empty requested array', () => {
      const result = validateSkillSelections(
        skillsCollection,
        []
      );
      
      assert.equal(result.valid.selections.length, 0);
      assert.equal(result.invalid.length, 0);
    });
    
    it('should match skills case-insensitively', () => {
      const result = validateSkillSelections(
        skillsCollection,
        ['GIT', 'Docker']
      );
      
      assert.equal(result.valid.selections.length, 1);
      assert.equal(result.valid.selections[0].skills.length, 2);
      assert.equal(result.invalid.length, 0);
    });
    
    it('should match skills from different plugins', () => {
      const result = validateSkillSelections(
        skillsCollection,
        ['git', 'linter']
      );
      
      // Should create selections for both plugins
      assert.equal(result.valid.selections.length, 2);
      
      const essentials = result.valid.selections.find(s => s.pluginName === 'essentials');
      const utilities = result.valid.selections.find(s => s.pluginName === 'utilities');
      
      assert.ok(essentials);
      assert.ok(utilities);
      assert.equal(essentials!.skills.length, 1);
      assert.equal(utilities!.skills.length, 1);
      assert.equal(essentials!.skills[0].name, 'git');
      assert.equal(utilities!.skills[0].name, 'linter');
    });
  });
});
