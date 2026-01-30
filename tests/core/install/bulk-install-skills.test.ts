/**
 * Bulk Install Skills Test
 * 
 * Tests that skills are correctly detected and installed during bulk manifest installation.
 * This addresses the bug where skills from manifest dependencies had empty files: {}.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseSkillPath, isSkillPath, getSkillFilterPath } from '../../../src/core/install/skill-path-parser.js';

describe('Bulk Install Skills', () => {
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
  });
  
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
  
  describe('Skill Path Detection', () => {
    it('should detect skill path with plugin parent', () => {
      const result = parseSkillPath('plugins/ui-design/skills/mobile-ios-design');
      
      assert.equal(result.isSkill, true);
      assert.equal(result.parentPath, 'plugins/ui-design');
      assert.equal(result.skillRelativePath, 'skills/mobile-ios-design');
      assert.equal(result.skillName, 'mobile-ios-design');
      assert.equal(result.fullPath, 'plugins/ui-design/skills/mobile-ios-design');
    });
    
    it('should detect root-level skill path', () => {
      const result = parseSkillPath('skills/git');
      
      assert.equal(result.isSkill, true);
      assert.equal(result.parentPath, undefined); // Root level has no parent
      assert.equal(result.skillRelativePath, 'skills/git');
      assert.equal(result.skillName, 'git');
    });
    
    it('should not detect plugin path without skills', () => {
      const result = parseSkillPath('plugins/ui-design');
      
      assert.equal(result.isSkill, false);
      assert.equal(result.parentPath, undefined);
      assert.equal(result.skillRelativePath, undefined);
    });
    
    it('should not detect package path', () => {
      const result = parseSkillPath('packages/example');
      
      assert.equal(result.isSkill, false);
    });
    
    it('should handle undefined path', () => {
      const result = parseSkillPath(undefined);
      
      assert.equal(result.isSkill, false);
    });
    
    it('should handle empty string path', () => {
      const result = parseSkillPath('');
      
      assert.equal(result.isSkill, false);
    });
    
    it('should normalize paths with leading/trailing slashes', () => {
      const result = parseSkillPath('/plugins/ui-design/skills/mobile-ios-design/');
      
      assert.equal(result.isSkill, true);
      assert.equal(result.parentPath, 'plugins/ui-design');
      assert.equal(result.skillRelativePath, 'skills/mobile-ios-design');
      assert.equal(result.fullPath, 'plugins/ui-design/skills/mobile-ios-design');
    });
  });
  
  describe('Skill Path Convenience Functions', () => {
    it('isSkillPath should return true for skill paths', () => {
      assert.equal(isSkillPath('plugins/ui-design/skills/mobile-ios-design'), true);
      assert.equal(isSkillPath('skills/git'), true);
    });
    
    it('isSkillPath should return false for non-skill paths', () => {
      assert.equal(isSkillPath('plugins/ui-design'), false);
      assert.equal(isSkillPath('packages/example'), false);
      assert.equal(isSkillPath(undefined), false);
    });
    
    it('getSkillFilterPath should return filter path for skills', () => {
      const skillInfo = parseSkillPath('plugins/ui-design/skills/mobile-ios-design');
      const filterPath = getSkillFilterPath(skillInfo);
      
      assert.equal(filterPath, 'skills/mobile-ios-design');
    });
    
    it('getSkillFilterPath should return undefined for non-skills', () => {
      const skillInfo = parseSkillPath('plugins/ui-design');
      const filterPath = getSkillFilterPath(skillInfo);
      
      assert.equal(filterPath, undefined);
    });
  });
  
  describe('Nested Skills Paths', () => {
    it('should detect deeply nested skill', () => {
      const result = parseSkillPath('monorepo/packages/plugin-a/skills/feature-x');
      
      assert.equal(result.isSkill, true);
      assert.equal(result.parentPath, 'monorepo/packages/plugin-a');
      assert.equal(result.skillRelativePath, 'skills/feature-x');
      assert.equal(result.skillName, 'feature-x');
    });
    
    it('should detect multiple levels after skills', () => {
      const result = parseSkillPath('plugins/ui/skills/mobile/ios');
      
      assert.equal(result.isSkill, true);
      assert.equal(result.parentPath, 'plugins/ui');
      assert.equal(result.skillRelativePath, 'skills/mobile/ios');
      assert.equal(result.skillName, 'ios');
    });
  });
  
  describe('Context Builder Integration', () => {
    it('should set skillFilter when building path context with skill path', async () => {
      const { buildPathInstallContext } = await import(
        '../../../src/core/install/unified/context-builders.js'
      );
      
      // Build context for a path that contains "/skills/"
      const skillPath = join(tempDir, 'cache/plugins/ui-design/skills/mobile-ios-design');
      const context = await buildPathInstallContext(tempDir, skillPath, {
        sourceType: 'directory' as const
      });
      
      // Should auto-detect and set skillFilter
      assert.equal(context.source.type, 'path');
      if (context.source.type === 'path') {
        assert.equal(
          context.source.skillFilter,
          'skills/mobile-ios-design',
          'Should auto-detect skillFilter from path'
        );
      }
    });
    
    it('should set skillFilter in git source context', async () => {
      const { buildInstallContext } = await import(
        '../../../src/core/install/unified/context-builders.js'
      );
      const { writeFile: writeTextFile, mkdir: mkdirAsync } = await import('fs/promises');
      
      // Create .openpackage directory
      const openpackageDir = join(tempDir, '.openpackage');
      await mkdirAsync(openpackageDir, { recursive: true });
      
      // Create a minimal manifest with a skill dependency
      const manifestPath = join(openpackageDir, 'openpackage.yml');
      await writeTextFile(manifestPath, `
name: test-workspace
version: 1.0.0
dependencies:
  - name: ghwshobson/agents/plugins/ui-design/skills/mobile-ios-design
    url: https://github.com/wshobson/agents.git
    path: plugins/ui-design/skills/mobile-ios-design
`);
      
      // Build contexts (should create array for bulk install)
      const contexts = await buildInstallContext(tempDir, undefined, {});
      
      // Should have at least one context (workspace + dependency)
      assert.ok(Array.isArray(contexts));
      assert.ok(contexts.length >= 2); // workspace + skill dependency
      
      // Find the skill dependency context
      // Note: GitHub packages get scoped with gh@ prefix
      const skillContext = contexts.find(
        ctx => ctx.source.packageName === 'gh@wshobson/agents/plugins/ui-design/skills/mobile-ios-design'
      );
      
      assert.ok(skillContext, 'Should have context for skill dependency');
      assert.equal(skillContext.source.type, 'git');
      
      if (skillContext.source.type === 'git') {
        assert.equal(
          skillContext.source.gitPath,
          'plugins/ui-design/skills/mobile-ios-design',
          'Should preserve original gitPath'
        );
        assert.equal(
          skillContext.source.skillFilter,
          'skills/mobile-ios-design',
          'Should set skillFilter for file discovery'
        );
      }
    });
  });
});
