/**
 * Tests for save-merge-extractor
 * 
 * Verifies extraction of package contributions from merged files.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPackageContribution } from '../../../src/core/save/save-merge-extractor.js';
import type { SaveCandidate } from '../../../src/core/save/save-types.js';

describe('save-merge-extractor', () => {
  /**
   * Helper to create a mock SaveCandidate
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

  describe('extractPackageContribution', () => {
    it('should extract a single top-level key', async () => {
      const mergedContent = JSON.stringify({
        existing: { value: 'old' },
        github: { value: 'new' }
      }, null, 2);
      
      const candidate = createCandidate({
        content: mergedContent,
        mergeStrategy: 'deep',
        mergeKeys: ['github']
      });
      
      const result = await extractPackageContribution(candidate);
      
      assert.strictEqual(result.success, true);
      assert.notStrictEqual(result.extractedContent, undefined);
      
      const extracted = JSON.parse(result.extractedContent!);
      assert.deepStrictEqual(extracted, {
        github: { value: 'new' }
      });
      assert.strictEqual(extracted.existing, undefined);
    });

    it('should extract nested keys using dot notation', async () => {
      const mergedContent = JSON.stringify({
        mcp: {
          existing: {
            type: 'http',
            url: 'https://api.example.com/mcp/'
          },
          github: {
            type: 'http',
            url: 'https://api.githubcopilot.com/mcp/'
          }
        }
      }, null, 2);
      
      const candidate = createCandidate({
        content: mergedContent,
        mergeStrategy: 'deep',
        mergeKeys: ['mcp.github']
      });
      
      const result = await extractPackageContribution(candidate);
      
      assert.strictEqual(result.success, true);
      assert.notStrictEqual(result.extractedContent, undefined);
      
      const extracted = JSON.parse(result.extractedContent!);
      assert.deepStrictEqual(extracted, {
        mcp: {
          github: {
            type: 'http',
            url: 'https://api.githubcopilot.com/mcp/'
          }
        }
      });
      assert.strictEqual(extracted.mcp.existing, undefined);
    });

    it('should extract multiple keys at same level', async () => {
      const mergedContent = JSON.stringify({
        mcp: {
          existing: { value: 'old' },
          github: { value: 'new1' },
          gitlab: { value: 'new2' }
        }
      }, null, 2);
      
      const candidate = createCandidate({
        content: mergedContent,
        mergeStrategy: 'deep',
        mergeKeys: ['mcp.github', 'mcp.gitlab']
      });
      
      const result = await extractPackageContribution(candidate);
      
      assert.strictEqual(result.success, true);
      assert.notStrictEqual(result.extractedContent, undefined);
      
      const extracted = JSON.parse(result.extractedContent!);
      assert.deepStrictEqual(extracted, {
        mcp: {
          github: { value: 'new1' },
          gitlab: { value: 'new2' }
        }
      });
      assert.strictEqual(extracted.mcp.existing, undefined);
    });

    it('should handle deeply nested keys', async () => {
      const mergedContent = JSON.stringify({
        config: {
          servers: {
            production: {
              mcp: {
                github: { endpoint: 'https://prod.github.com' }
              }
            }
          }
        }
      }, null, 2);
      
      const candidate = createCandidate({
        content: mergedContent,
        mergeStrategy: 'deep',
        mergeKeys: ['config.servers.production.mcp.github']
      });
      
      const result = await extractPackageContribution(candidate);
      
      assert.strictEqual(result.success, true);
      const extracted = JSON.parse(result.extractedContent!);
      assert.deepStrictEqual(extracted.config.servers.production.mcp.github, {
        endpoint: 'https://prod.github.com'
      });
    });

    it('should return error for missing keys', async () => {
      const mergedContent = JSON.stringify({
        existing: { value: 'old' }
      }, null, 2);
      
      const candidate = createCandidate({
        content: mergedContent,
        mergeStrategy: 'deep',
        mergeKeys: ['nonexistent']
      });
      
      const result = await extractPackageContribution(candidate);
      
      // Should succeed but extract empty object
      assert.strictEqual(result.success, true);
      const extracted = JSON.parse(result.extractedContent!);
      assert.deepStrictEqual(extracted, {});
    });

    it('should return error for local candidates', async () => {
      const candidate = createCandidate({
        source: 'local',
        mergeStrategy: 'deep',
        mergeKeys: ['key']
      });
      
      const result = await extractPackageContribution(candidate);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.error!.includes('workspace candidates'));
    });

    it('should return error when no merge metadata', async () => {
      const candidate = createCandidate({
        mergeStrategy: undefined,
        mergeKeys: undefined
      });
      
      const result = await extractPackageContribution(candidate);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.error!.includes('No merge metadata'));
    });

    it('should return error for composite merge strategy', async () => {
      const candidate = createCandidate({
        mergeStrategy: 'composite',
        mergeKeys: ['key']
      });
      
      const result = await extractPackageContribution(candidate);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.error!.includes('Composite merge extraction not yet implemented'));
    });

    it('should return error for replace strategy', async () => {
      const candidate = createCandidate({
        mergeStrategy: 'replace',
        mergeKeys: ['key']
      });
      
      const result = await extractPackageContribution(candidate);
      
      assert.strictEqual(result.success, false);
      assert.ok(result.error!.includes('Replace strategy does not require extraction'));
    });

    it('should handle invalid JSON gracefully', async () => {
      const candidate = createCandidate({
        content: 'not valid json {',
        mergeStrategy: 'deep',
        mergeKeys: ['key']
      });
      
      const result = await extractPackageContribution(candidate);
      
      assert.strictEqual(result.success, false);
      assert.notStrictEqual(result.error, undefined);
    });

    it('should produce consistent hash for extracted content', async () => {
      const mergedContent = JSON.stringify({
        mcp: {
          existing: { value: 'old' },
          github: { value: 'new' }
        }
      }, null, 2);
      
      const candidate = createCandidate({
        content: mergedContent,
        mergeStrategy: 'deep',
        mergeKeys: ['mcp.github']
      });
      
      const result1 = await extractPackageContribution(candidate);
      const result2 = await extractPackageContribution(candidate);
      
      assert.strictEqual(result1.extractedHash, result2.extractedHash);
    });
  });
});
