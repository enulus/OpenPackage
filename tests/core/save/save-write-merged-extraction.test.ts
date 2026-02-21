/**
 * Tests for save-write-coordinator with merged file extraction
 * 
 * Verifies that when writing merged files, only the package's contribution
 * is extracted and written to the source, not the entire merged file.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { ensureDir, writeTextFile, readTextFile } from '../../../src/utils/fs.js';
import { writeResolution } from '../../../src/core/save/save-write-coordinator.js';
import type { SaveCandidate, ResolutionResult } from '../../../src/core/save/save-types.js';

describe('save-write-merged-extraction', () => {
  let tempDir: string | null = null;
  
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });
  
  /**
   * Helper to create a SaveCandidate
   */
  function createCandidate(overrides: Partial<SaveCandidate>): SaveCandidate {
    return {
      source: 'workspace',
      registryPath: 'mcp.json',
      fullPath: '/workspace/.opencode/opencode.json',
      content: '{}',
      contentHash: 'abc123',
      mtime: Date.now(),
      displayPath: '.opencode/opencode.json',
      ...overrides
    };
  }
  
  it('should extract package contribution when writing merged file as universal', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-write-merge-test-'));
    const packageRoot = tempDir;
    
    // Create merged workspace file content (contains keys from multiple packages)
    const mergedContent = JSON.stringify({
      mcp: {
        existing: {
          type: 'http',
          url: 'https://api.example.com/mcp/'
        },
        github: {
          type: 'http',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: {
            Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}'
          }
        }
      }
    }, null, 2);
    
    // Create candidate with merge metadata
    const candidate = createCandidate({
      content: mergedContent,
      contentHash: 'merged-hash',
      mergeStrategy: 'deep',
      mergeKeys: ['mcp.github']
    });
    
    // Create resolution result selecting this candidate as universal
    const resolution: ResolutionResult = {
      selection: candidate,
      platformSpecific: [],
      strategy: 'write-single',
      wasInteractive: false
    };
    
    // Write resolution
    const results = await writeResolution(
      packageRoot,
      'mcp.json',
      resolution
    );
    
    // Verify write succeeded
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[0].operation.operation, 'create');
    
    // Read written file
    const writtenContent = await readTextFile(join(packageRoot, 'mcp.json'));
    const writtenData = JSON.parse(writtenContent);
    
    // Should only contain the github key, not existing
    assert.deepStrictEqual(writtenData, {
      mcp: {
        github: {
          type: 'http',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: {
            Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}'
          }
        }
      }
    });
    
    // Should NOT contain the existing key
    assert.strictEqual(writtenData.mcp.existing, undefined);
  });
  
  it('should extract multiple keys correctly', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-write-merge-test-'));
    const packageRoot = tempDir;
    
    // Merged content with three keys
    const mergedContent = JSON.stringify({
      mcp: {
        existing: { url: 'https://example.com' },
        github: { url: 'https://github.com' },
        gitlab: { url: 'https://gitlab.com' }
      }
    }, null, 2);
    
    const candidate = createCandidate({
      content: mergedContent,
      mergeStrategy: 'deep',
      mergeKeys: ['mcp.github', 'mcp.gitlab']
    });
    
    const resolution: ResolutionResult = {
      selection: candidate,
      platformSpecific: [],
      strategy: 'write-single',
      wasInteractive: false
    };
    
    await writeResolution(packageRoot, 'mcp.json', resolution);
    
    const writtenContent = await readTextFile(join(packageRoot, 'mcp.json'));
    const writtenData = JSON.parse(writtenContent);
    
    // Should contain both github and gitlab, but not existing
    assert.deepStrictEqual(writtenData.mcp.github, { url: 'https://github.com' });
    assert.deepStrictEqual(writtenData.mcp.gitlab, { url: 'https://gitlab.com' });
    assert.strictEqual(writtenData.mcp.existing, undefined);
  });
  
  it('should use full content as fallback if extraction fails', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-write-merge-test-'));
    const packageRoot = tempDir;
    
    // Invalid JSON content (extraction will fail)
    const invalidContent = 'not valid json';
    
    const candidate = createCandidate({
      content: invalidContent,
      mergeStrategy: 'deep',
      mergeKeys: ['mcp.github']
    });
    
    const resolution: ResolutionResult = {
      selection: candidate,
      platformSpecific: [],
      strategy: 'write-single',
      wasInteractive: false
    };
    
    await writeResolution(packageRoot, 'mcp.json', resolution);
    
    // Should write full content as fallback
    const writtenContent = await readTextFile(join(packageRoot, 'mcp.json'));
    assert.strictEqual(writtenContent, invalidContent);
  });
  
  it('should write non-merged files normally', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-write-merge-test-'));
    const packageRoot = tempDir;
    
    const normalContent = '# README\n\nThis is a normal file.';
    
    // No merge metadata
    const candidate = createCandidate({
      content: normalContent,
      registryPath: 'README.md'
    });
    
    const resolution: ResolutionResult = {
      selection: candidate,
      platformSpecific: [],
      strategy: 'write-single',
      wasInteractive: false
    };
    
    await writeResolution(packageRoot, 'README.md', resolution);
    
    // Should write full content
    const writtenContent = await readTextFile(join(packageRoot, 'README.md'));
    assert.strictEqual(writtenContent, normalContent);
  });
  
  it('should extract from platform-specific merged files', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-write-merge-test-'));
    const packageRoot = tempDir;
    
    const mergedContent = JSON.stringify({
      servers: {
        base: { url: 'https://base.com' },
        package: { url: 'https://package.com' }
      }
    }, null, 2);
    
    // Use a nested path since root-level files have special platform handling
    const candidate = createCandidate({
      content: mergedContent,
      platform: 'cursor',
      registryPath: 'config/servers.json',
      mergeStrategy: 'deep',
      mergeKeys: ['servers.package']
    });
    
    const resolution: ResolutionResult = {
      selection: null,
      platformSpecific: [candidate],
      strategy: 'interactive',
      wasInteractive: true
    };
    
    const results = await writeResolution(packageRoot, 'config/servers.json', resolution);
    
    // Debug: check what was written
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, true);
    
    // Platform-specific file should be created with extracted content
    const writtenContent = await readTextFile(join(packageRoot, 'config/servers.cursor.json'));
    const writtenData = JSON.parse(writtenContent);
    
    assert.deepStrictEqual(writtenData.servers.package, { url: 'https://package.com' });
    assert.strictEqual(writtenData.servers.base, undefined);
  });
  
  it('should skip write when extracted content matches existing source', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-write-merge-test-'));
    const packageRoot = tempDir;
    
    // Create existing source file with just github key
    const sourceContent = JSON.stringify({
      mcp: {
        github: { url: 'https://github.com' }
      }
    }, null, 2) + '\n';
    
    await writeTextFile(join(packageRoot, 'mcp.json'), sourceContent);
    
    // Merged workspace file with github + other keys
    const mergedContent = JSON.stringify({
      mcp: {
        existing: { url: 'https://example.com' },
        github: { url: 'https://github.com' }
      }
    }, null, 2);
    
    const workspaceCandidate = createCandidate({
      content: mergedContent,
      mergeStrategy: 'deep',
      mergeKeys: ['mcp.github']
    });
    
    const localCandidate = createCandidate({
      source: 'local',
      content: sourceContent,
      contentHash: 'source-hash'
    });
    
    const resolution: ResolutionResult = {
      selection: workspaceCandidate,
      platformSpecific: [],
      strategy: 'write-single',
      wasInteractive: false
    };
    
    const results = await writeResolution(
      packageRoot,
      'mcp.json',
      resolution,
      localCandidate
    );
    
    // Should skip write since extracted content matches source
    assert.strictEqual(results[0].success, true);
    assert.strictEqual(results[0].operation.operation, 'skip');
  });
  
  it('should handle composite merge strategy gracefully', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-write-merge-test-'));
    const packageRoot = tempDir;
    
    const compositeContent = '# Header\n\nBase content\n\n<!-- package-start -->\nPackage content\n<!-- package-end -->';
    
    const candidate = createCandidate({
      content: compositeContent,
      mergeStrategy: 'composite',
      mergeKeys: ['package-marker']
    });
    
    const resolution: ResolutionResult = {
      selection: candidate,
      platformSpecific: [],
      strategy: 'write-single',
      wasInteractive: false
    };
    
    await writeResolution(packageRoot, 'README.md', resolution);
    
    // Composite extraction not implemented - should write full content as fallback
    const writtenContent = await readTextFile(join(packageRoot, 'README.md'));
    assert.strictEqual(writtenContent, compositeContent);
  });
  
  it('should apply import transformation for OpenCode platform (mcp → mcpServers)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-write-merge-test-'));
    const packageRoot = tempDir;
    const workspaceRoot = tempDir;
    
    // Setup: Create .opencode directory structure for platform detection
    await ensureDir(join(workspaceRoot, '.opencode'));
    
    // Merged content in OpenCode format (uses "mcp" key)
    const mergedContent = JSON.stringify({
      mcp: {
        existing: { url: 'https://example.com' },
        github: {
          type: 'http',
          url: 'https://api.githubcopilot.com/mcp/',
          headers: {
            Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}'
          }
        }
      }
    }, null, 2);
    
    const candidate = createCandidate({
      content: mergedContent,
      platform: 'opencode',
      registryPath: 'mcp.jsonc',
      displayPath: '.opencode/opencode.json',
      mergeStrategy: 'deep',
      mergeKeys: ['mcp.github']  // Keys tracked in workspace format
    });
    
    const resolution: ResolutionResult = {
      selection: candidate,
      platformSpecific: [],
      strategy: 'write-single',
      wasInteractive: false
    };
    
    await writeResolution(packageRoot, 'mcp.jsonc', resolution, undefined, workspaceRoot);
    
    // Read written file - should have "mcpServers" not "mcp"
    const writtenContent = await readTextFile(join(packageRoot, 'mcp.jsonc'));
    const writtenData = JSON.parse(writtenContent);
    
    // Key assertion: should be "mcpServers" (universal format), not "mcp" (OpenCode format)
    assert.notStrictEqual(writtenData.mcpServers, undefined);
    assert.strictEqual(writtenData.mcp, undefined);
    assert.deepStrictEqual(writtenData.mcpServers.github, {
      type: 'http',
      url: 'https://api.githubcopilot.com/mcp/',
      headers: {
        Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}'
      }
    });
  });
});
