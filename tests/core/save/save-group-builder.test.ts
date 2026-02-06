/**
 * Tests for save-group-builder.ts
 * 
 * Covers:
 * - Grouping candidates by registry path
 * - Handling multiple workspace candidates per group
 * - Handling missing local candidates
 * - Filtering groups by workspace candidates
 */

import { describe, it, expect } from 'vitest';
import {
  buildCandidateGroups,
  filterGroupsWithWorkspace
} from '../../../src/core/save/save-group-builder.js';
import type { SaveCandidate } from '../../../src/core/save/save-types.js';

describe('save-group-builder', () => {
  describe('buildCandidateGroups', () => {
    it('should group candidates by registry path', () => {
      // Setup
      const localCandidates: SaveCandidate[] = [
        createCandidate('local', 'file1.md', 'hash1'),
        createCandidate('local', 'file2.md', 'hash2')
      ];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'file1.md', 'hash3', 'cursor'),
        createCandidate('workspace', 'file2.md', 'hash4', 'cursor')
      ];

      // Execute
      const groups = buildCandidateGroups(localCandidates, workspaceCandidates);

      // Verify
      expect(groups).toHaveLength(2);
      
      const group1 = groups.find(g => g.registryPath === 'file1.md');
      expect(group1).toBeDefined();
      expect(group1!.local).toBeDefined();
      expect(group1!.workspace).toHaveLength(1);
      
      const group2 = groups.find(g => g.registryPath === 'file2.md');
      expect(group2).toBeDefined();
      expect(group2!.local).toBeDefined();
      expect(group2!.workspace).toHaveLength(1);
    });

    it('should handle multiple workspace candidates per group', () => {
      // Setup
      const localCandidates: SaveCandidate[] = [
        createCandidate('local', 'tools/search.md', 'hash1')
      ];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'tools/search.md', 'hash2', 'cursor'),
        createCandidate('workspace', 'tools/search.md', 'hash3', 'claude'),
        createCandidate('workspace', 'tools/search.md', 'hash4', 'windsurf')
      ];

      // Execute
      const groups = buildCandidateGroups(localCandidates, workspaceCandidates);

      // Verify
      expect(groups).toHaveLength(1);
      expect(groups[0].registryPath).toBe('tools/search.md');
      expect(groups[0].local).toBeDefined();
      expect(groups[0].workspace).toHaveLength(3);
      
      const platforms = groups[0].workspace.map(c => c.platform).sort();
      expect(platforms).toEqual(['claude', 'cursor', 'windsurf']);
    });

    it('should handle missing local candidates', () => {
      // Setup - new file with no source version
      const localCandidates: SaveCandidate[] = [];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'new-file.md', 'hash1', 'cursor')
      ];

      // Execute
      const groups = buildCandidateGroups(localCandidates, workspaceCandidates);

      // Verify
      expect(groups).toHaveLength(1);
      expect(groups[0].registryPath).toBe('new-file.md');
      expect(groups[0].local).toBeUndefined();
      expect(groups[0].workspace).toHaveLength(1);
    });

    it('should handle missing workspace candidates', () => {
      // Setup - file exists in source but not workspace
      const localCandidates: SaveCandidate[] = [
        createCandidate('local', 'old-file.md', 'hash1')
      ];

      const workspaceCandidates: SaveCandidate[] = [];

      // Execute
      const groups = buildCandidateGroups(localCandidates, workspaceCandidates);

      // Verify
      expect(groups).toHaveLength(1);
      expect(groups[0].registryPath).toBe('old-file.md');
      expect(groups[0].local).toBeDefined();
      expect(groups[0].workspace).toHaveLength(0);
    });

    it('should handle empty inputs', () => {
      // Setup
      const localCandidates: SaveCandidate[] = [];
      const workspaceCandidates: SaveCandidate[] = [];

      // Execute
      const groups = buildCandidateGroups(localCandidates, workspaceCandidates);

      // Verify
      expect(groups).toHaveLength(0);
    });

    it('should organize mixed scenarios', () => {
      // Setup - some files in both, some only in workspace, some only in source
      const localCandidates: SaveCandidate[] = [
        createCandidate('local', 'file1.md', 'hash1'),
        createCandidate('local', 'file2.md', 'hash2'),
        createCandidate('local', 'file3.md', 'hash3')
      ];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'file1.md', 'hash4', 'cursor'),
        createCandidate('workspace', 'file4.md', 'hash5', 'cursor')
      ];

      // Execute
      const groups = buildCandidateGroups(localCandidates, workspaceCandidates);

      // Verify
      expect(groups).toHaveLength(4); // file1, file2, file3, file4
      
      const group1 = groups.find(g => g.registryPath === 'file1.md');
      expect(group1?.local).toBeDefined();
      expect(group1?.workspace).toHaveLength(1);
      
      const group2 = groups.find(g => g.registryPath === 'file2.md');
      expect(group2?.local).toBeDefined();
      expect(group2?.workspace).toHaveLength(0);
      
      const group3 = groups.find(g => g.registryPath === 'file3.md');
      expect(group3?.local).toBeDefined();
      expect(group3?.workspace).toHaveLength(0);
      
      const group4 = groups.find(g => g.registryPath === 'file4.md');
      expect(group4?.local).toBeUndefined();
      expect(group4?.workspace).toHaveLength(1);
    });
  });

  describe('filterGroupsWithWorkspace', () => {
    it('should keep only groups with workspace candidates', () => {
      // Setup
      const groups = [
        {
          registryPath: 'file1.md',
          local: createCandidate('local', 'file1.md', 'hash1'),
          workspace: [createCandidate('workspace', 'file1.md', 'hash2', 'cursor')]
        },
        {
          registryPath: 'file2.md',
          local: createCandidate('local', 'file2.md', 'hash3'),
          workspace: []
        },
        {
          registryPath: 'file3.md',
          workspace: [createCandidate('workspace', 'file3.md', 'hash4', 'cursor')]
        }
      ];

      // Execute
      const filtered = filterGroupsWithWorkspace(groups);

      // Verify
      expect(filtered).toHaveLength(2);
      expect(filtered.map(g => g.registryPath).sort()).toEqual(['file1.md', 'file3.md']);
    });

    it('should return empty array when no groups have workspace candidates', () => {
      // Setup
      const groups = [
        {
          registryPath: 'file1.md',
          local: createCandidate('local', 'file1.md', 'hash1'),
          workspace: []
        },
        {
          registryPath: 'file2.md',
          local: createCandidate('local', 'file2.md', 'hash2'),
          workspace: []
        }
      ];

      // Execute
      const filtered = filterGroupsWithWorkspace(groups);

      // Verify
      expect(filtered).toHaveLength(0);
    });

    it('should handle empty input', () => {
      // Setup
      const groups: any[] = [];

      // Execute
      const filtered = filterGroupsWithWorkspace(groups);

      // Verify
      expect(filtered).toHaveLength(0);
    });
  });
});

/**
 * Helper to create a test candidate
 */
function createCandidate(
  source: 'local' | 'workspace',
  registryPath: string,
  contentHash: string,
  platform?: string
): SaveCandidate {
  return {
    source,
    registryPath,
    fullPath: `/test/${registryPath}`,
    content: `content for ${registryPath}`,
    contentHash,
    mtime: Date.now(),
    displayPath: registryPath,
    platform: platform as any
  };
}
