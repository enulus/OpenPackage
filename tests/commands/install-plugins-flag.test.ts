import assert from 'node:assert/strict';
import type { InstallOptions } from '../../src/types/index.js';

// Test: InstallOptions accepts plugins array
{
  const options: InstallOptions = {
    plugins: ['plugin-1', 'plugin-2']
  };
  assert.deepEqual(options.plugins, ['plugin-1', 'plugin-2']);
}

// Test: plugins is optional
{
  const options: InstallOptions = {};
  assert.equal(options.plugins, undefined);
}

console.log('install-plugins-flag type tests passed');

// Test: normalizePluginsOption handles array input
import { normalizePluginsOption } from '../../src/commands/install.js';

{
  const result = normalizePluginsOption(['plugin-1', 'plugin-2', 'plugin-3']);
  assert.deepEqual(result, ['plugin-1', 'plugin-2', 'plugin-3']);
}

// Test: normalizePluginsOption handles single plugin
{
  const result = normalizePluginsOption(['single-plugin']);
  assert.deepEqual(result, ['single-plugin']);
}

// Test: normalizePluginsOption returns undefined for empty array
{
  const result = normalizePluginsOption([]);
  assert.equal(result, undefined);
}

// Test: normalizePluginsOption returns undefined for undefined input
{
  const result = normalizePluginsOption(undefined);
  assert.equal(result, undefined);
}

// Test: normalizePluginsOption deduplicates plugin names
{
  const result = normalizePluginsOption(['plugin-a', 'plugin-b', 'plugin-a', 'plugin-c', 'plugin-b']);
  assert.deepEqual(result, ['plugin-a', 'plugin-b', 'plugin-c']);
}

console.log('normalizePluginsOption tests passed');

import { validatePluginNames } from '../../src/core/install/marketplace-handler.js';
import type { MarketplaceManifest } from '../../src/core/install/marketplace-handler.js';

// Test: validatePluginNames returns valid plugins
{
  const marketplace: MarketplaceManifest = {
    name: 'test-marketplace',
    plugins: [
      { name: 'plugin-1', source: './plugin-1' },
      { name: 'plugin-2', source: './plugin-2' },
      { name: 'plugin-3', source: './plugin-3' }
    ]
  };

  const result = validatePluginNames(marketplace, ['plugin-1', 'plugin-3']);
  assert.deepEqual(result.valid, ['plugin-1', 'plugin-3']);
  assert.deepEqual(result.invalid, []);
}

// Test: validatePluginNames identifies invalid plugins
{
  const marketplace: MarketplaceManifest = {
    name: 'test-marketplace',
    plugins: [
      { name: 'plugin-1', source: './plugin-1' }
    ]
  };

  const result = validatePluginNames(marketplace, ['plugin-1', 'nonexistent', 'also-missing']);
  assert.deepEqual(result.valid, ['plugin-1']);
  assert.deepEqual(result.invalid, ['nonexistent', 'also-missing']);
}

// Test: validatePluginNames handles all invalid plugins
{
  const marketplace: MarketplaceManifest = {
    name: 'test-marketplace',
    plugins: [
      { name: 'plugin-1', source: './plugin-1' }
    ]
  };

  const result = validatePluginNames(marketplace, ['nonexistent']);
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.invalid, ['nonexistent']);
}

// Test: validatePluginNames handles empty requested list
{
  const marketplace: MarketplaceManifest = {
    name: 'test-marketplace',
    plugins: [
      { name: 'plugin-1', source: './plugin-1' }
    ]
  };

  const result = validatePluginNames(marketplace, []);
  assert.deepEqual(result.valid, []);
  assert.deepEqual(result.invalid, []);
}

console.log('validatePluginNames tests passed');
