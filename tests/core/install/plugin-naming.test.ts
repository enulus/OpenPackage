import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generatePluginName,
  generateMarketplaceName,
  parseScopedPluginName,
  isScopedPluginName
} from '../../../src/utils/plugin-naming.js';

describe('Plugin Naming', () => {
  describe('generatePluginName', () => {
    it('should generate scoped name for GitHub plugin with subdirectory', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/claude-code.git',
        subdirectory: 'plugins/commit-commands',
        pluginManifestName: 'commit-commands',
        marketplaceName: 'claude-code'
      });
      
      assert.strictEqual(name, '@anthropics/claude-code/commit-commands');
    });
    
    it('should generate scoped name for GitHub plugin without subdirectory', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/my-plugin.git',
        pluginManifestName: 'my-plugin'
      });
      
      assert.strictEqual(name, '@anthropics/my-plugin');
    });
    
    it('should use repo name as fallback when plugin manifest name is undefined', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/user/awesome-plugin.git',
        pluginManifestName: undefined
      });
      
      assert.strictEqual(name, '@user/awesome-plugin');
    });
    
    it('should use subdirectory basename as fallback when plugin manifest name is undefined', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/user/marketplace.git',
        subdirectory: 'plugins/cool-plugin',
        pluginManifestName: undefined,
        marketplaceName: 'marketplace'
      });
      
      assert.strictEqual(name, '@user/marketplace/cool-plugin');
    });
    
    it('should use repo name as marketplace fallback when marketplace name is undefined', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/user/my-marketplace.git',
        subdirectory: 'plugins/plugin-a',
        pluginManifestName: 'plugin-a',
        marketplaceName: undefined
      });
      
      assert.strictEqual(name, '@user/my-marketplace/plugin-a');
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
    it('should generate scoped name for GitHub marketplace', () => {
      const name = generateMarketplaceName(
        'https://github.com/anthropics/claude-code.git',
        'claude-code'
      );
      
      assert.strictEqual(name, '@anthropics/claude-code');
    });
    
    it('should use repo name as fallback when marketplace name is undefined', () => {
      const name = generateMarketplaceName(
        'https://github.com/user/my-marketplace.git',
        undefined
      );
      
      assert.strictEqual(name, '@user/my-marketplace');
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
    it('should parse marketplace plugin name', () => {
      const parsed = parseScopedPluginName('@anthropics/claude-code/commit-commands');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.marketplace, 'claude-code');
      assert.strictEqual(parsed.plugin, 'commit-commands');
    });
    
    it('should parse standalone plugin name', () => {
      const parsed = parseScopedPluginName('@anthropics/my-plugin');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.marketplace, undefined);
      assert.strictEqual(parsed.plugin, 'my-plugin');
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
    it('should return true for scoped names', () => {
      assert.strictEqual(isScopedPluginName('@user/plugin'), true);
      assert.strictEqual(isScopedPluginName('@user/marketplace/plugin'), true);
    });
    
    it('should return false for non-scoped names', () => {
      assert.strictEqual(isScopedPluginName('plain-name'), false);
      assert.strictEqual(isScopedPluginName('@username'), false);
    });
  });
});
