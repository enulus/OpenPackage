import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generatePluginName,
  generateMarketplaceName,
  parseScopedPluginName,
  isScopedPluginName,
  detectOldGitHubNaming
} from '../../../src/utils/plugin-naming.js';

describe('Plugin Naming', () => {
  describe('generatePluginName', () => {
    it('should generate scoped name for GitHub plugin with subdirectory', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/claude-code.git',
        subdirectory: 'plugins/commit-commands',
        pluginManifestName: 'commit-commands'
      });
      
      assert.strictEqual(name, 'gh@anthropics/claude-code/p/commit-commands');
    });
    
    it('should generate scoped name for GitHub plugin without subdirectory', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/my-plugin.git',
        pluginManifestName: 'my-plugin'
      });
      
      assert.strictEqual(name, 'gh@anthropics/my-plugin');
    });
    
    it('should generate scoped name using repo name for standalone plugin', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/awesome-plugin.git'
      });
      
      assert.strictEqual(name, 'gh@anthropics/awesome-plugin');
    });
    
    it('should use repo name as fallback when plugin manifest name is undefined', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/user/awesome-plugin.git',
        pluginManifestName: undefined
      });
      
      assert.strictEqual(name, 'gh@user/awesome-plugin');
    });
    
    it('should use subdirectory basename as fallback when plugin manifest name is undefined', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/user/repo-name.git',
        subdirectory: 'plugins/cool-plugin',
        pluginManifestName: undefined
      });
      
      assert.strictEqual(name, 'gh@user/repo-name/p/cool-plugin');
    });
    
    it('should always use repo name for marketplace plugins', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/user/actual-repo.git',
        subdirectory: 'plugins/plugin-a',
        pluginManifestName: 'plugin-a'
      });
      
      assert.strictEqual(name, 'gh@user/actual-repo/p/plugin-a');
    });
    
    it('should use repo name even when marketplace has different name', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/claude-code-plugins.git',
        subdirectory: 'packages/my-plugin',
        pluginManifestName: 'my-plugin'
      });
      
      assert.strictEqual(name, 'gh@anthropics/claude-code-plugins/p/my-plugin');
    });
    
    it('should return plain name for non-GitHub URLs', () => {
      const name = generatePluginName({
        gitUrl: 'https://gitlab.com/user/plugin.git',
        pluginManifestName: 'my-plugin'
      });
      
      assert.strictEqual(name, 'my-plugin');
    });
    
    it('should return plain name for local paths (no git URL)', () => {
      const name = generatePluginName({
        pluginManifestName: 'local-plugin'
      });
      
      assert.strictEqual(name, 'local-plugin');
    });
    
    it('should use subdirectory basename for local paths when manifest name is undefined', () => {
      const name = generatePluginName({
        subdirectory: 'path/to/my-plugin',
        pluginManifestName: undefined
      });
      
      assert.strictEqual(name, 'my-plugin');
    });
  });
  
  describe('generateMarketplaceName', () => {
    it('should generate scoped name using repo name for GitHub marketplace', () => {
      const name = generateMarketplaceName(
        'https://github.com/anthropics/claude-code.git',
        'claude-code'
      );
      
      assert.strictEqual(name, 'gh@anthropics/claude-code');
    });
    
    it('should always use repo name for GitHub marketplaces', () => {
      const name = generateMarketplaceName(
        'https://github.com/user/actual-repo-name.git',
        'different-marketplace-name'
      );
      
      assert.strictEqual(name, 'gh@user/actual-repo-name');
    });
    
    it('should use repo name as fallback when marketplace name is undefined', () => {
      const name = generateMarketplaceName(
        'https://github.com/user/my-marketplace.git',
        undefined
      );
      
      assert.strictEqual(name, 'gh@user/my-marketplace');
    });
    
    it('should return plain name for non-GitHub URLs', () => {
      const name = generateMarketplaceName(
        'https://gitlab.com/user/marketplace.git',
        'my-marketplace'
      );
      
      assert.strictEqual(name, 'my-marketplace');
    });
    
    it('should return plain name for local paths', () => {
      const name = generateMarketplaceName(
        undefined,
        'local-marketplace'
      );
      
      assert.strictEqual(name, 'local-marketplace');
    });
  });
  
  describe('parseScopedPluginName', () => {
    it('should parse plugin name with /p/ infix (new format)', () => {
      const parsed = parseScopedPluginName('gh@anthropics/claude-code/p/commit-commands');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.repo, 'claude-code');
      assert.strictEqual(parsed.plugin, 'commit-commands');
      assert.strictEqual(parsed.isGitHub, true);
    });
    
    it('should parse standalone repo name (new format)', () => {
      const parsed = parseScopedPluginName('gh@anthropics/my-plugin');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.repo, 'my-plugin');
      assert.strictEqual(parsed.plugin, undefined);
      assert.strictEqual(parsed.isGitHub, true);
    });
    
    it('should parse old format plugin name (3 segments)', () => {
      const parsed = parseScopedPluginName('@anthropics/claude-code/commit-commands');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.repo, 'claude-code');
      assert.strictEqual(parsed.plugin, 'commit-commands');
      assert.strictEqual(parsed.isGitHub, false);
    });
    
    it('should parse old format standalone (2 segments)', () => {
      const parsed = parseScopedPluginName('@anthropics/my-plugin');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.repo, 'my-plugin');
      assert.strictEqual(parsed.plugin, undefined);
      assert.strictEqual(parsed.isGitHub, false);
    });
    
    it('should return null for non-scoped names', () => {
      const parsed = parseScopedPluginName('plain-name');
      
      assert.strictEqual(parsed, null);
    });
    
    it('should return null for invalid scoped names', () => {
      const parsed = parseScopedPluginName('@username');
      
      assert.strictEqual(parsed, null);
    });
  });
  
  describe('isScopedPluginName', () => {
    it('should return true for new GitHub format', () => {
      assert.strictEqual(isScopedPluginName('gh@user/repo'), true);
      assert.strictEqual(isScopedPluginName('gh@user/repo/p/plugin'), true);
    });
    
    it('should return true for old scoped format', () => {
      assert.strictEqual(isScopedPluginName('@user/plugin'), true);
      assert.strictEqual(isScopedPluginName('@user/marketplace/plugin'), true);
    });
    
    it('should return false for non-scoped names', () => {
      assert.strictEqual(isScopedPluginName('plain-name'), false);
      assert.strictEqual(isScopedPluginName('@username'), false);
    });
  });
  
  describe('detectOldGitHubNaming', () => {
    it('should detect old GitHub format and return new format', () => {
      const newName = detectOldGitHubNaming({
        name: '@anthropics/claude-code',
        git: 'https://github.com/anthropics/claude-code.git'
      });
      
      assert.strictEqual(newName, 'gh@anthropics/claude-code');
    });
    
    it('should detect old plugin format and add /p/ infix', () => {
      const newName = detectOldGitHubNaming({
        name: '@anthropics/claude-code/commit-commands',
        git: 'https://github.com/anthropics/claude-code.git',
        subdirectory: 'plugins/commit-commands'
      });
      
      assert.strictEqual(newName, 'gh@anthropics/claude-code/p/commit-commands');
    });
    
    it('should return null for new format', () => {
      const newName = detectOldGitHubNaming({
        name: 'gh@anthropics/claude-code',
        git: 'https://github.com/anthropics/claude-code.git'
      });
      
      assert.strictEqual(newName, null);
    });
    
    it('should return null for non-GitHub sources', () => {
      const newName = detectOldGitHubNaming({
        name: '@user/plugin',
        git: 'https://gitlab.com/user/plugin.git'
      });
      
      assert.strictEqual(newName, null);
    });
    
    it('should return null for packages without git source', () => {
      const newName = detectOldGitHubNaming({
        name: '@user/plugin'
      });
      
      assert.strictEqual(newName, null);
    });
  });
});
