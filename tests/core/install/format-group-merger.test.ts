/**
 * Format Group Merger Tests
 * 
 * Tests for Phase 3: Format Group Merging
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeFormatGroups,
  deduplicatePaths,
  validateMergedPackage,
  getMergedPackageStats
} from '../../../src/core/install/format-group-merger.js';
import type { PackageFile } from '../../../src/core/install/detection-types.js';

describe('Format Group Merger', () => {
  describe('mergeFormatGroups', () => {
    it('should merge multiple format groups', () => {
      const groups = new Map<string, PackageFile[]>([
        ['claude', [
          { path: 'agents/claude-agent.md', content: 'Claude agent' },
          { path: 'rules/claude-rule.md', content: 'Claude rule' }
        ]],
        ['opencode', [
          { path: 'agents/opencode-agent.md', content: 'OpenCode agent' }
        ]],
        ['universal', [
          { path: 'commands/build.md', content: 'Build command' }
        ]]
      ]);

      const merged = mergeFormatGroups(groups);

      assert.strictEqual(merged.length, 4);
      assert.strictEqual(merged.some(f => f.path === 'agents/claude-agent.md'), true);
      assert.strictEqual(merged.some(f => f.path === 'agents/opencode-agent.md'), true);
      assert.strictEqual(merged.some(f => f.path === 'rules/claude-rule.md'), true);
      assert.strictEqual(merged.some(f => f.path === 'commands/build.md'), true);
    });

    it('should handle empty groups', () => {
      const groups = new Map<string, PackageFile[]>([
        ['claude', []],
        ['universal', [
          { path: 'agents/agent.md', content: 'Agent' }
        ]]
      ]);

      const merged = mergeFormatGroups(groups);

      assert.strictEqual(merged.length, 1);
      assert.strictEqual(merged[0].path, 'agents/agent.md');
    });

    it('should handle single group', () => {
      const groups = new Map<string, PackageFile[]>([
        ['universal', [
          { path: 'agents/agent1.md', content: 'Agent 1' },
          { path: 'agents/agent2.md', content: 'Agent 2' }
        ]]
      ]);

      const merged = mergeFormatGroups(groups);

      assert.strictEqual(merged.length, 2);
    });
  });

  describe('deduplicatePaths', () => {
    it('should keep first occurrence for duplicate paths', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent.md', content: 'First', frontmatter: { version: 1 } },
        { path: 'agents/agent.md', content: 'Second', frontmatter: { version: 2 } },
        { path: 'rules/rule.md', content: 'Rule' }
      ];

      const deduplicated = deduplicatePaths(files);

      assert.strictEqual(deduplicated.length, 2);
      assert.strictEqual(deduplicated.find(f => f.path === 'agents/agent.md')?.frontmatter?.version, 1);
      assert.ok(deduplicated.find(f => f.path === 'rules/rule.md'));
    });

    it('should prioritize universal format over platform-specific', () => {
      const files: PackageFile[] = [
        // Platform-specific (Claude format)
        {
          path: 'agents/agent.md',
          content: 'Claude version',
          frontmatter: {
            tools: 'Read, Write',  // String format (Claude)
            permissionMode: 'default'
          }
        },
        // Universal format
        {
          path: 'agents/agent.md',
          content: 'Universal version',
          frontmatter: {
            tools: ['read', 'write'],  // Array format (Universal)
            permissions: { edit: 'ask' }
          }
        }
      ];

      const deduplicated = deduplicatePaths(files);

      assert.strictEqual(deduplicated.length, 1);
      // Should keep universal format (array tools)
      assert.strictEqual(Array.isArray(deduplicated[0].frontmatter?.tools), true);
    });

    it('should handle files with no frontmatter', () => {
      const files: PackageFile[] = [
        { path: 'skills/typescript/SKILL.md', content: 'First' },
        { path: 'skills/typescript/SKILL.md', content: 'Second' },
        { path: 'skills/python/SKILL.md', content: 'Python' }
      ];

      const deduplicated = deduplicatePaths(files);

      assert.strictEqual(deduplicated.length, 2);
      assert.strictEqual(deduplicated.find(f => f.path === 'skills/typescript/SKILL.md')?.content, 'First');
    });

    it('should handle no duplicates', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent1.md', content: 'Agent 1' },
        { path: 'agents/agent2.md', content: 'Agent 2' },
        { path: 'rules/rule1.md', content: 'Rule 1' }
      ];

      const deduplicated = deduplicatePaths(files);

      assert.strictEqual(deduplicated.length, 3);
      assert.deepStrictEqual(deduplicated, files);
    });

    it('should handle multiple duplicates of same path', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent.md', content: 'v1', frontmatter: { version: 1 } },
        { path: 'agents/agent.md', content: 'v2', frontmatter: { version: 2 } },
        { path: 'agents/agent.md', content: 'v3', frontmatter: { version: 3 } }
      ];

      const deduplicated = deduplicatePaths(files);

      assert.strictEqual(deduplicated.length, 1);
      assert.strictEqual(deduplicated[0].frontmatter?.version, 1);
    });
  });

  describe('validateMergedPackage', () => {
    it('should validate a valid merged package', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent1.md', content: 'Agent 1' },
        { path: 'agents/agent2.md', content: 'Agent 2' },
        { path: 'rules/rule1.md', content: 'Rule 1' }
      ];

      const result = validateMergedPackage(files);

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.errors, []);
    });

    it('should detect duplicate paths', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent.md', content: 'First' },
        { path: 'agents/agent.md', content: 'Second' }
      ];

      const result = validateMergedPackage(files);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.includes('Duplicate path after merge: agents/agent.md'));
    });

    it('should detect empty paths', () => {
      const files: PackageFile[] = [
        { path: '', content: 'Invalid' },
        { path: 'agents/valid.md', content: 'Valid' }
      ];

      const result = validateMergedPackage(files);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.some(e => e.includes('empty path')), true);
    });

    it('should warn about files with no content', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent.md', content: '' },
        { path: 'rules/rule.md', content: 'Rule' }
      ];

      const result = validateMergedPackage(files);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.warnings.some(w => w.includes('no content')), true);
    });

    it('should warn about absolute paths', () => {
      const files: PackageFile[] = [
        { path: '/absolute/path/agent.md', content: 'Agent' },
        { path: 'relative/rule.md', content: 'Rule' }
      ];

      const result = validateMergedPackage(files);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.warnings.some(w => w.includes('absolute path')), true);
    });
  });

  describe('getMergedPackageStats', () => {
    it('should calculate statistics correctly', () => {
      const files: PackageFile[] = [
        {
          path: 'agents/agent1.md',
          content: 'Agent 1',
          frontmatter: { tools: ['read'] }
        },
        {
          path: 'agents/agent2.md',
          content: 'Agent 2',
          frontmatter: {}
        },
        {
          path: 'skills/typescript/SKILL.md',
          content: 'TypeScript skill'
          // No frontmatter
        },
        {
          path: 'empty.md',
          content: ''
          // Empty content
        }
      ];

      const stats = getMergedPackageStats(files);

      assert.strictEqual(stats.totalFiles, 4);
      assert.strictEqual(stats.filesWithFrontmatter, 1); // Only agent1 has non-empty frontmatter
      assert.strictEqual(stats.filesWithContent, 3); // agent1, agent2, typescript (empty.md excluded)
      assert.strictEqual(stats.uniquePaths, 4);
    });

    it('should handle empty file array', () => {
      const files: PackageFile[] = [];

      const stats = getMergedPackageStats(files);

      assert.strictEqual(stats.totalFiles, 0);
      assert.strictEqual(stats.filesWithFrontmatter, 0);
      assert.strictEqual(stats.filesWithContent, 0);
      assert.strictEqual(stats.uniquePaths, 0);
    });

    it('should detect duplicate paths in stats', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent.md', content: 'First' },
        { path: 'agents/agent.md', content: 'Second' },
        { path: 'rules/rule.md', content: 'Rule' }
      ];

      const stats = getMergedPackageStats(files);

      assert.strictEqual(stats.totalFiles, 3);
      assert.strictEqual(stats.uniquePaths, 2); // Only 2 unique paths
    });
  });

  describe('Integration: Merge and validate', () => {
    it('should merge groups and validate successfully', () => {
      const groups = new Map<string, PackageFile[]>([
        ['claude', [
          { path: 'agents/claude.md', content: 'Claude agent', frontmatter: { tools: ['read'] } }
        ]],
        ['universal', [
          { path: 'agents/universal.md', content: 'Universal agent', frontmatter: { tools: ['write'] } }
        ]]
      ]);

      const merged = mergeFormatGroups(groups);
      const validation = validateMergedPackage(merged);

      assert.strictEqual(validation.valid, true);
      assert.strictEqual(merged.length, 2);
    });

    it('should handle conflicts during merge', () => {
      const groups = new Map<string, PackageFile[]>([
        ['claude', [
          { path: 'agents/agent.md', content: 'Claude version', frontmatter: { tools: 'Read' } }
        ]],
        ['universal', [
          { path: 'agents/agent.md', content: 'Universal version', frontmatter: { tools: ['read'] } }
        ]]
      ]);

      const merged = mergeFormatGroups(groups);
      const validation = validateMergedPackage(merged);

      // Should deduplicate automatically
      assert.strictEqual(validation.valid, true);
      assert.strictEqual(merged.length, 1);
      
      // Should prefer universal format
      assert.strictEqual(Array.isArray(merged[0].frontmatter?.tools), true);
    });
  });
});
