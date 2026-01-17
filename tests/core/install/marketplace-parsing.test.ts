/**
 * Tests for marketplace manifest parsing and validation.
 */

import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseMarketplace } from '../../../src/core/install/marketplace-handler.js';

// Helper to create a temp directory
async function createTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'marketplace-test-'));
}

// Test: parse valid marketplace with relative path source
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'test-marketplace',
    description: 'Test marketplace',
    plugins: [
      {
        name: 'plugin-1',
        source: './plugins/plugin-1',
        description: 'Test plugin 1'
      }
    ]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  const parsed = await parseMarketplace(manifestPath);
  assert.equal(parsed.name, 'test-marketplace');
  assert.equal(parsed.description, 'Test marketplace');
  assert.equal(parsed.plugins.length, 1);
  assert.equal(parsed.plugins[0].name, 'plugin-1');
  assert.equal(parsed.plugins[0].source, './plugins/plugin-1');
  
  await rm(tempDir, { recursive: true });
}

// Test: parse marketplace with GitHub source
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'github-marketplace',
    plugins: [
      {
        name: 'github-plugin',
        source: {
          source: 'github',
          repo: 'owner/repo',
          ref: 'v1.0.0'
        }
      }
    ]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  const parsed = await parseMarketplace(manifestPath);
  assert.equal(parsed.plugins[0].name, 'github-plugin');
  assert.deepEqual(parsed.plugins[0].source, {
    source: 'github',
    repo: 'owner/repo',
    ref: 'v1.0.0'
  });
  
  await rm(tempDir, { recursive: true });
}

// Test: parse marketplace with Git URL source
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'git-marketplace',
    plugins: [
      {
        name: 'git-plugin',
        source: {
          source: 'url',
          url: 'https://gitlab.com/team/plugin.git',
          path: 'src/plugin'
        }
      }
    ]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  const parsed = await parseMarketplace(manifestPath);
  assert.equal(parsed.plugins[0].name, 'git-plugin');
  assert.deepEqual(parsed.plugins[0].source, {
    source: 'url',
    url: 'https://gitlab.com/team/plugin.git',
    path: 'src/plugin'
  });
  
  await rm(tempDir, { recursive: true });
}

// Test: parse marketplace with mixed source types
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'mixed-marketplace',
    plugins: [
      {
        name: 'local-plugin',
        source: './plugins/local'
      },
      {
        name: 'github-plugin',
        source: {
          source: 'github',
          repo: 'owner/repo'
        }
      },
      {
        name: 'gitlab-plugin',
        source: {
          source: 'url',
          url: 'https://gitlab.com/team/plugin.git'
        }
      }
    ]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  const parsed = await parseMarketplace(manifestPath);
  assert.equal(parsed.plugins.length, 3);
  assert.equal(parsed.plugins[0].source, './plugins/local');
  assert.deepEqual(parsed.plugins[1].source, { source: 'github', repo: 'owner/repo' });
  assert.deepEqual(parsed.plugins[2].source, { 
    source: 'url', 
    url: 'https://gitlab.com/team/plugin.git' 
  });
  
  await rm(tempDir, { recursive: true });
}

// Test: reject marketplace without name
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    plugins: [{ name: 'plugin-1', source: './plugin-1' }]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  try {
    await parseMarketplace(manifestPath);
    assert.fail('Should have thrown error for missing name');
  } catch (error: any) {
    assert.match(error.message, /missing required field: name/);
  }
  
  await rm(tempDir, { recursive: true });
}

// Test: reject marketplace without plugins
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'empty-marketplace'
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  try {
    await parseMarketplace(manifestPath);
    assert.fail('Should have thrown error for missing plugins');
  } catch (error: any) {
    assert.match(error.message, /missing or invalid plugins array/);
  }
  
  await rm(tempDir, { recursive: true });
}

// Test: reject marketplace with empty plugins array
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'empty-marketplace',
    plugins: []
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  try {
    await parseMarketplace(manifestPath);
    assert.fail('Should have thrown error for empty plugins');
  } catch (error: any) {
    assert.match(error.message, /contains no plugins/);
  }
  
  await rm(tempDir, { recursive: true });
}

// Test: reject plugin without name
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'bad-marketplace',
    plugins: [
      { source: './plugin-1' }
    ]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  try {
    await parseMarketplace(manifestPath);
    assert.fail('Should have thrown error for plugin without name');
  } catch (error: any) {
    assert.match(error.message, /missing required field: name/);
  }
  
  await rm(tempDir, { recursive: true });
}

// Test: reject plugin without source
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'bad-marketplace',
    plugins: [
      { name: 'plugin-1' }
    ]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  try {
    await parseMarketplace(manifestPath);
    assert.fail('Should have thrown error for plugin without source');
  } catch (error: any) {
    assert.match(error.message, /missing required field: source/);
  }
  
  await rm(tempDir, { recursive: true });
}

// Test: reject plugin with invalid GitHub source
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'bad-marketplace',
    plugins: [
      {
        name: 'bad-plugin',
        source: {
          source: 'github',
          repo: 'invalid-format'
        }
      }
    ]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  try {
    await parseMarketplace(manifestPath);
    assert.fail('Should have thrown error for invalid GitHub repo');
  } catch (error: any) {
    assert.match(error.message, /has invalid source/);
    assert.match(error.message, /must be in 'owner\/repo' format/);
  }
  
  await rm(tempDir, { recursive: true });
}

// Test: reject plugin with invalid Git URL
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    name: 'bad-marketplace',
    plugins: [
      {
        name: 'bad-plugin',
        source: {
          source: 'url',
          url: 'not-a-git-url'
        }
      }
    ]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  try {
    await parseMarketplace(manifestPath);
    assert.fail('Should have thrown error for invalid Git URL');
  } catch (error: any) {
    assert.match(error.message, /has invalid source/);
    assert.match(error.message, /has invalid Git URL/);
  }
  
  await rm(tempDir, { recursive: true });
}

// Test: use fallback name from context if missing
{
  const tempDir = await createTempDir();
  const manifestPath = join(tempDir, 'marketplace.json');
  
  const manifest = {
    plugins: [
      { name: 'plugin-1', source: './plugin-1' }
    ]
  };
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  
  const parsed = await parseMarketplace(manifestPath, {
    repoPath: '/path/to/my-marketplace'
  });
  
  assert.equal(parsed.name, 'my-marketplace');
  
  await rm(tempDir, { recursive: true });
}

console.log('✅ All marketplace-parsing tests passed');
