/**
 * Tests for marketplace-defined plugins (strict: false)
 * 
 * Verifies that plugins without plugin.json can be defined entirely
 * in the marketplace.json file when strict:false is set.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePluginMetadata } from '../../../src/core/install/plugin-metadata-resolver.js';
import { detectPluginWithMarketplace } from '../../../src/core/install/plugin-detector.js';
import { join } from 'path';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import type { MarketplacePluginEntry } from '../../../src/core/install/marketplace-handler.js';

test('Plugin Metadata Resolver - use plugin.json when present', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
  try {
    // Create plugin with plugin.json
    const pluginDir = join(tempDir, 'plugin1');
    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(pluginDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'test-plugin',
        version: '1.0.0',
        description: 'From plugin.json'
      })
    );

    const result = await resolvePluginMetadata(pluginDir);

    assert.equal(result.source, 'plugin.json');
    assert.equal(result.manifest.name, 'test-plugin');
    assert.equal(result.manifest.description, 'From plugin.json');
    
    console.log('✅ Plugin metadata resolved from plugin.json');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Plugin Metadata Resolver - merge plugin.json with marketplace entry', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
  try {
    // Create plugin with plugin.json
    const pluginDir = join(tempDir, 'plugin2');
    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(pluginDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'test-plugin',
        version: '1.0.0',
        description: 'From plugin.json'
      })
    );

    const marketplaceEntry: MarketplacePluginEntry = {
      name: 'test-plugin',
      source: './plugins/test',
      description: 'From marketplace',
      license: 'MIT',
      homepage: 'https://example.com'
    };

    const result = await resolvePluginMetadata(pluginDir, marketplaceEntry);

    assert.equal(result.source, 'merged');
    assert.equal(result.manifest.name, 'test-plugin');
    assert.equal(result.manifest.description, 'From plugin.json'); // plugin.json wins
    assert.equal(result.manifest.license, 'MIT'); // marketplace fills gaps
    assert.equal(result.manifest.homepage, 'https://example.com'); // marketplace fills gaps
    
    console.log('✅ Plugin metadata merged correctly');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Plugin Metadata Resolver - use marketplace entry when strict:false', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
  try {
    // Create plugin directory without plugin.json
    const pluginDir = join(tempDir, 'plugin3');
    await mkdir(join(pluginDir, 'commands'), { recursive: true });
    await writeFile(join(pluginDir, 'commands/test.md'), '# Test command');

    const marketplaceEntry: MarketplacePluginEntry = {
      name: 'marketplace-plugin',
      source: './plugins/test',
      strict: false,
      version: '2.0.0',
      description: 'Defined in marketplace',
      commands: ['./commands']
    };

    const result = await resolvePluginMetadata(pluginDir, marketplaceEntry);

    assert.equal(result.source, 'marketplace');
    assert.equal(result.manifest.name, 'marketplace-plugin');
    assert.equal(result.manifest.version, '2.0.0');
    assert.equal(result.manifest.description, 'Defined in marketplace');
    assert.deepEqual(result.manifest.commands, ['./commands']);
    
    console.log('✅ Plugin metadata resolved from marketplace (strict:false)');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Plugin Metadata Resolver - error when no plugin.json and strict is not false', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
  try {
    // Create plugin directory without plugin.json
    const pluginDir = join(tempDir, 'plugin4');
    await mkdir(pluginDir, { recursive: true });

    const marketplaceEntry: MarketplacePluginEntry = {
      name: 'test-plugin',
      source: './plugins/test',
      strict: true
    };

    await assert.rejects(
      async () => resolvePluginMetadata(pluginDir, marketplaceEntry),
      /missing plugin.json/i
    );
    
    console.log('✅ Error thrown correctly for missing plugin.json');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Plugin Detection - detect marketplace-defined plugin', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
  try {
    // Create plugin directory with content but no plugin.json
    const pluginDir = join(tempDir, 'plugin6');
    await mkdir(join(pluginDir, 'commands'), { recursive: true });
    await writeFile(join(pluginDir, 'commands/test.md'), '# Test command');

    const marketplaceEntry: MarketplacePluginEntry = {
      name: 'test-plugin',
      source: './plugins/test',
      strict: false
    };

    const result = await detectPluginWithMarketplace(pluginDir, marketplaceEntry);

    assert.equal(result.isPlugin, true);
    assert.equal(result.type, 'marketplace-defined');
    
    console.log('✅ Marketplace-defined plugin detected correctly');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Plugin Detection - detect individual plugin with plugin.json', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
  try {
    // Create plugin with plugin.json
    const pluginDir = join(tempDir, 'plugin7');
    await mkdir(join(pluginDir, '.claude-plugin'), { recursive: true });
    await writeFile(
      join(pluginDir, '.claude-plugin/plugin.json'),
      JSON.stringify({ name: 'test-plugin' })
    );

    const result = await detectPluginWithMarketplace(pluginDir);

    assert.equal(result.isPlugin, true);
    assert.equal(result.type, 'individual');
    
    console.log('✅ Individual plugin detected correctly');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('Plugin Detection - not a plugin when no content and no plugin.json', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
  try {
    // Empty directory
    const pluginDir = join(tempDir, 'plugin8');
    await mkdir(pluginDir, { recursive: true });

    const marketplaceEntry: MarketplacePluginEntry = {
      name: 'test-plugin',
      source: './plugins/test',
      strict: false
    };

    const result = await detectPluginWithMarketplace(pluginDir, marketplaceEntry);

    assert.equal(result.isPlugin, false);
    
    console.log('✅ Empty directory correctly not detected as plugin');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

console.log('\n✅ All marketplace-defined plugin tests passed!');
