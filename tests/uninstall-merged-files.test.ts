/**
 * Tests for uninstalling packages with merged files
 * Verifies that key tracking enables precise removal
 */

import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { removeKeysFromMergedFile } from '../src/core/uninstall/flow-aware-uninstaller.js';
import { extractAllKeys, deleteNestedKey, isEffectivelyEmpty } from '../src/core/flows/flow-key-extractor.js';

describe('Key Extraction', () => {
  test('extracts top-level keys', () => {
    const data = {
      mcp: {
        server1: { url: 'http://localhost' },
        server2: { url: 'http://example.com' }
      }
    };

    const keys = extractAllKeys(data);
    expect(keys).toEqual(['mcp.server1.url', 'mcp.server2.url']);
  });

  test('handles arrays as leaf nodes', () => {
    const data = {
      mcp: {
        servers: ['server1', 'server2']
      }
    };

    const keys = extractAllKeys(data);
    expect(keys).toEqual(['mcp.servers']);
  });

  test('handles primitives', () => {
    const data = {
      name: 'test',
      version: '1.0.0'
    };

    const keys = extractAllKeys(data);
    expect(keys).toEqual(['name', 'version']);
  });
});

describe('Key Deletion', () => {
  test('deletes nested key', () => {
    const data = {
      mcp: {
        server1: { url: 'http://localhost' },
        server2: { url: 'http://example.com' }
      }
    };

    deleteNestedKey(data, 'mcp.server1');
    expect(data).toEqual({
      mcp: {
        server2: { url: 'http://example.com' }
      }
    });
  });

  test('cleans up empty parent objects', () => {
    const data = {
      mcp: {
        server1: { url: 'http://localhost' }
      }
    };

    deleteNestedKey(data, 'mcp.server1.url');
    // Should remove server1 and mcp since they're now empty
    expect(data).toEqual({});
  });

  test('preserves other keys', () => {
    const data = {
      mcp: {
        server1: { url: 'http://localhost' },
        server2: { url: 'http://example.com' }
      },
      other: {
        config: 'value'
      }
    };

    deleteNestedKey(data, 'mcp.server1.url');
    expect(data).toEqual({
      mcp: {
        server2: { url: 'http://example.com' }
      },
      other: {
        config: 'value'
      }
    });
  });
});

describe('Empty Detection', () => {
  test('detects empty object', () => {
    expect(isEffectivelyEmpty({})).toBe(true);
  });

  test('detects empty array', () => {
    expect(isEffectivelyEmpty([])).toBe(true);
  });

  test('detects nested empty objects', () => {
    expect(isEffectivelyEmpty({ a: {}, b: { c: {} } })).toBe(true);
  });

  test('detects non-empty objects', () => {
    expect(isEffectivelyEmpty({ a: 'value' })).toBe(false);
  });

  test('detects primitives as non-empty', () => {
    expect(isEffectivelyEmpty('string')).toBe(false);
    expect(isEffectivelyEmpty(123)).toBe(false);
    expect(isEffectivelyEmpty(true)).toBe(false);
  });
});

describe('File-based Key Removal', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `opkg-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  test('removes keys from JSON file', async () => {
    const filePath = '.opencode/opencode.json';
    const absPath = join(testDir, filePath);
    await fs.mkdir(join(testDir, '.opencode'), { recursive: true });

    // Create initial file with two packages' content
    const initialContent = {
      mcp: {
        server1: { url: 'http://localhost:3000' },
        server2: { url: 'http://localhost:4000' },
        server3: { url: 'http://localhost:5000' }
      }
    };

    await fs.writeFile(absPath, JSON.stringify(initialContent, null, 2));

    // Remove server1 and server2 (simulating package A uninstall)
    const result = await removeKeysFromMergedFile(
      testDir,
      filePath,
      ['mcp.server1', 'mcp.server2']
    );

    expect(result.deleted).toBe(false);
    expect(result.updated).toBe(true);

    // Verify file was updated correctly
    const updatedContent = JSON.parse(await fs.readFile(absPath, 'utf-8'));
    expect(updatedContent).toEqual({
      mcp: {
        server3: { url: 'http://localhost:5000' }
      }
    });
  });

  test('deletes file when all keys removed', async () => {
    const filePath = '.opencode/opencode.json';
    const absPath = join(testDir, filePath);
    await fs.mkdir(join(testDir, '.opencode'), { recursive: true });

    const initialContent = {
      mcp: {
        server1: { url: 'http://localhost:3000' }
      }
    };

    await fs.writeFile(absPath, JSON.stringify(initialContent, null, 2));

    // Remove all keys
    const result = await removeKeysFromMergedFile(
      testDir,
      filePath,
      ['mcp.server1']
    );

    expect(result.deleted).toBe(true);
    expect(result.updated).toBe(false);

    // Verify file was deleted
    try {
      await fs.access(absPath);
      fail('File should have been deleted');
    } catch (error) {
      // Expected - file should not exist
      expect(error).toBeDefined();
    }
  });

  test('handles YAML files', async () => {
    const filePath = '.config/config.yaml';
    const absPath = join(testDir, filePath);
    await fs.mkdir(join(testDir, '.config'), { recursive: true });

    const initialContent = `
mcp:
  server1:
    url: http://localhost:3000
  server2:
    url: http://localhost:4000
`;

    await fs.writeFile(absPath, initialContent);

    const result = await removeKeysFromMergedFile(
      testDir,
      filePath,
      ['mcp.server1']
    );

    expect(result.updated).toBe(true);

    const updatedContent = await fs.readFile(absPath, 'utf-8');
    expect(updatedContent).toContain('server2');
    expect(updatedContent).not.toContain('server1');
  });
});

describe('Workspace Index Integration', () => {
  test('example workspace index with key tracking', () => {
    // This demonstrates the expected structure
    const workspaceIndex = {
      packages: {
        'my-mcp-package': {
          path: '~/.openpackage/packages/my-mcp-package/1.0.0/',
          version: '1.0.0',
          files: {
            'mcp.jsonc': [
              {
                target: '.opencode/opencode.json',
                merge: 'deep',
                keys: ['mcp.server1', 'mcp.server2']
              }
            ],
            'rules/typescript.md': [
              '.opencode/rules/typescript.md'
            ]
          }
        }
      }
    };

    // Verify structure
    const pkg = workspaceIndex.packages['my-mcp-package'];
    expect(pkg.files['mcp.jsonc']).toHaveLength(1);

    const mcpMapping = pkg.files['mcp.jsonc'][0];
    if (typeof mcpMapping !== 'string') {
      expect(mcpMapping.keys).toEqual(['mcp.server1', 'mcp.server2']);
      expect(mcpMapping.merge).toBe('deep');
    }
  });
});
