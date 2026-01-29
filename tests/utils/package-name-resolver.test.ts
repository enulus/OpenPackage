import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  resolvePackageNameFromContext,
  createSkillResolutionContext,
  createPluginResolutionContext,
  createPackageResolutionContext
} from '../../src/utils/package-name-resolver.js';

describe('Package Name Resolver', () => {
  describe('resolvePackageNameFromContext', () => {
    it('should generate skill name with full path', () => {
      const context = createSkillResolutionContext({
        gitUrl: 'https://github.com/user/repo.git',
        path: 'plugins/ui-design/skills/mobile-ios-design',
        skillName: 'mobile-ios-design',
        skillPath: 'plugins/ui-design/skills/mobile-ios-design'
      });
      
      const name = resolvePackageNameFromContext(context);
      assert.equal(name, 'gh@user/repo/plugins/ui-design/skills/mobile-ios-design');
    });
    
    it('should generate plugin name with path', () => {
      const context = createPluginResolutionContext({
        gitUrl: 'https://github.com/user/repo.git',
        path: 'plugins/ui-design',
        packageName: 'ui-design'
      });
      
      const name = resolvePackageNameFromContext(context);
      assert.equal(name, 'gh@user/repo/plugins/ui-design');
    });
    
    it('should generate package name at repo root', () => {
      const context = createPackageResolutionContext({
        gitUrl: 'https://github.com/user/repo.git',
        packageName: 'my-package'
      });
      
      const name = resolvePackageNameFromContext(context);
      assert.equal(name, 'gh@user/repo');
    });
    
    it('should handle non-GitHub URLs', () => {
      const context = createPluginResolutionContext({
        gitUrl: 'https://gitlab.com/user/repo.git',
        packageName: 'my-plugin'
      });
      
      const name = resolvePackageNameFromContext(context);
      assert.equal(name, 'my-plugin');
    });
    
    it('should use packageName fallback without Git URL', () => {
      const context = createPackageResolutionContext({
        packageName: 'local-package'
      });
      
      const name = resolvePackageNameFromContext(context);
      assert.equal(name, 'local-package');
    });
    
    it('should throw error on duplicate skill paths', () => {
      const context = createSkillResolutionContext({
        gitUrl: 'https://github.com/user/repo.git',
        path: 'plugins/ui-design/skills/mobile/skills/mobile',
        skillName: 'mobile',
        skillPath: 'skills/mobile'
      });
      
      assert.throws(
        () => resolvePackageNameFromContext(context),
        /Duplicate skill path segment detected/
      );
    });
    
    it('should throw error on multiple /skills/ segments', () => {
      const context = createSkillResolutionContext({
        gitUrl: 'https://github.com/user/repo.git',
        path: 'plugins/ui/skills/a/skills/b',
        skillName: 'test',
        skillPath: 'skills/b'
      });
      
      assert.throws(
        () => resolvePackageNameFromContext(context),
        /Duplicate skill path segment/
      );
    });
  });
  
  describe('Helper functions', () => {
    it('should create skill resolution context with correct type', () => {
      const context = createSkillResolutionContext({
        gitUrl: 'https://github.com/user/repo.git',
        path: 'skills/test',
        skillName: 'test',
        skillPath: 'skills/test'
      });
      
      assert.equal(context.type, 'skill');
      assert.equal(context.skillMetadata?.name, 'test');
      assert.equal(context.skillMetadata?.skillPath, 'skills/test');
    });
    
    it('should create plugin resolution context with correct type', () => {
      const context = createPluginResolutionContext({
        gitUrl: 'https://github.com/user/repo.git',
        path: 'plugins/test',
        packageName: 'test'
      });
      
      assert.equal(context.type, 'plugin');
      assert.equal(context.packageName, 'test');
    });
    
    it('should create package resolution context with correct type', () => {
      const context = createPackageResolutionContext({
        gitUrl: 'https://github.com/user/repo.git',
        packageName: 'test'
      });
      
      assert.equal(context.type, 'package');
      assert.equal(context.packageName, 'test');
    });
  });
  
  describe('Edge cases', () => {
    it('should handle skill with dot path', () => {
      const context = createSkillResolutionContext({
        skillName: 'single-skill',
        skillPath: '.',
        path: '.'
      });
      
      const name = resolvePackageNameFromContext(context);
      assert.equal(name, 'single-skill');
    });
    
    it('should normalize path to lowercase', () => {
      const context = createPluginResolutionContext({
        gitUrl: 'https://github.com/User/Repo.git',
        path: 'Plugins/MyPlugin',
        packageName: 'MyPlugin'
      });
      
      const name = resolvePackageNameFromContext(context);
      assert.equal(name, 'gh@user/repo/plugins/myplugin');
    });
  });
  
  describe('Validation', () => {
    it('should validate duplicate skill paths in different formats', () => {
      const testCases = [
        'plugins/ui/skills/mobile/skills/mobile',
        'skills/test/skills/test',
        'collections/skills/abc/skills/abc'
      ];
      
      for (const path of testCases) {
        const context = createSkillResolutionContext({
          gitUrl: 'https://github.com/user/repo.git',
          path,
          skillName: 'test',
          skillPath: 'skills/test'
        });
        
        assert.throws(
          () => resolvePackageNameFromContext(context),
          /Duplicate skill path segment detected/,
          `Should detect duplicate in: ${path}`
        );
      }
    });
    
    it('should allow valid nested paths without duplication', () => {
      const validPaths = [
        'plugins/ui-design/skills/mobile',
        'skills/git',
        'collections/skills-bundle/skills/advanced',
        'plugins/feature/skills/helper'
      ];
      
      for (const path of validPaths) {
        const context = createSkillResolutionContext({
          gitUrl: 'https://github.com/user/repo.git',
          path,
          skillName: 'test',
          skillPath: path
        });
        
        // Should not throw
        const name = resolvePackageNameFromContext(context);
        assert.ok(name, `Should generate valid name for: ${path}`);
      }
    });
  });
});

console.log('✅ All package name resolver tests passed');
