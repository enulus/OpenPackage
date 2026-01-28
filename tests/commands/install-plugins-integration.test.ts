import assert from 'node:assert/strict';

// Test: --plugins flag should bypass interactive selection
// This is a unit test of the selection logic, not full e2e
{
  // Import after setup to ensure fresh module state
  const { validatePluginNames } = await import('../../src/core/install/marketplace-handler.js');

  const marketplace = {
    name: 'test-marketplace',
    plugins: [
      { name: 'plugin-a', source: './plugins/a' },
      { name: 'plugin-b', source: './plugins/b' },
      { name: 'plugin-c', source: './plugins/c' }
    ]
  };

  // Simulate --plugins flag with valid plugins
  const requestedPlugins = ['plugin-a', 'plugin-c'];
  const { valid, invalid } = validatePluginNames(marketplace, requestedPlugins);

  assert.deepEqual(valid, ['plugin-a', 'plugin-c']);
  assert.deepEqual(invalid, []);

  // The valid plugins would be passed directly to installMarketplacePlugins
  // instead of calling promptPluginSelection
}

// Test: --plugins flag with invalid plugin names should error
{
  const { validatePluginNames } = await import('../../src/core/install/marketplace-handler.js');

  const marketplace = {
    name: 'test-marketplace',
    plugins: [
      { name: 'plugin-a', source: './plugins/a' }
    ]
  };

  const requestedPlugins = ['plugin-a', 'nonexistent'];
  const { valid, invalid } = validatePluginNames(marketplace, requestedPlugins);

  assert.deepEqual(valid, ['plugin-a']);
  assert.deepEqual(invalid, ['nonexistent']);

  // When invalid.length > 0, the command should exit with error
}

console.log('install-plugins integration tests passed');
