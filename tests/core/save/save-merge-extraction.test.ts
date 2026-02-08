/**
 * Tests for save-merge-extractor
 * 
 * Verifies extraction of package contributions from merged files.
 */

import { describe, it, expect } from 'vitest';
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
      
      expect(result.success).toBe(true);
      expect(result.extractedContent).toBeDefined();
      
      const extracted = JSON.parse(result.extractedContent!);
      expect(extracted).toEqual({
        github: { value: 'new' }
      });
      expect(extracted.existing).toBeUndefined();
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
      
      expect(result.success).toBe(true);
      expect(result.extractedContent).toBeDefined();
      
      const extracted = JSON.parse(result.extractedContent!);
      expect(extracted).toEqual({
        mcp: {
          github: {
            type: 'http',
            url: 'https://api.githubcopilot.com/mcp/'
          }
        }
      });
      expect(extracted.mcp.existing).toBeUndefined();
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
      
      expect(result.success).toBe(true);
      expect(result.extractedContent).toBeDefined();
      
      const extracted = JSON.parse(result.extractedContent!);
      expect(extracted).toEqual({
        mcp: {
          github: { value: 'new1' },
          gitlab: { value: 'new2' }
        }
      });
      expect(extracted.mcp.existing).toBeUndefined();
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
      
      expect(result.success).toBe(true);
      const extracted = JSON.parse(result.extractedContent!);
      expect(extracted.config.servers.production.mcp.github).toEqual({
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
      expect(result.success).toBe(true);
      const extracted = JSON.parse(result.extractedContent!);
      expect(extracted).toEqual({});
    });

    it('should return error for local candidates', async () => {
      const candidate = createCandidate({
        source: 'local',
        mergeStrategy: 'deep',
        mergeKeys: ['key']
      });
      
      const result = await extractPackageContribution(candidate);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('workspace candidates');
    });

    it('should return error when no merge metadata', async () => {
      const candidate = createCandidate({
        mergeStrategy: undefined,
        mergeKeys: undefined
      });
      
      const result = await extractPackageContribution(candidate);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('No merge metadata');
    });

    it('should return error for composite merge strategy', async () => {
      const candidate = createCandidate({
        mergeStrategy: 'composite',
        mergeKeys: ['key']
      });
      
      const result = await extractPackageContribution(candidate);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Composite merge extraction not yet implemented');
    });

    it('should return error for replace strategy', async () => {
      const candidate = createCandidate({
        mergeStrategy: 'replace',
        mergeKeys: ['key']
      });
      
      const result = await extractPackageContribution(candidate);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Replace strategy does not require extraction');
    });

    it('should handle invalid JSON gracefully', async () => {
      const candidate = createCandidate({
        content: 'not valid json {',
        mergeStrategy: 'deep',
        mergeKeys: ['key']
      });
      
      const result = await extractPackageContribution(candidate);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
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
      
      expect(result1.extractedHash).toBe(result2.extractedHash);
    });
  });
});
