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
import type { SaveCandidate, LocalSourceRef } from '../../../src/core/save/save-types.js';

describe('save-group-builder', () => {
  describe('buildCandidateGroups', () => {
    it('should group candidates by registry path', () => {
      const localRefs: LocalSourceRef[] = [
        createRef('file1.md'),
        createRef('file2.md')
      ];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'file1.md', 'hash3', 'cursor'),
        createCandidate('workspace', 'file2.md', 'hash4', 'cursor')
      ];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      expect(groups).toHaveLength(2);
      
      const group1 = groups.find(g => g.registryPath === 'file1.md');
      expect(group1).toBeDefined();
      expect(group1!.localRef).toBeDefined();
      expect(group1!.workspace).toHaveLength(1);
      
      const group2 = groups.find(g => g.registryPath === 'file2.md');
      expect(group2).toBeDefined();
      expect(group2!.localRef).toBeDefined();
      expect(group2!.workspace).toHaveLength(1);
    });

    it('should handle multiple workspace candidates per group', () => {
      const localRefs: LocalSourceRef[] = [
        createRef('tools/search.md')
      ];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'tools/search.md', 'hash2', 'cursor'),
        createCandidate('workspace', 'tools/search.md', 'hash3', 'claude'),
        createCandidate('workspace', 'tools/search.md', 'hash4', 'windsurf')
      ];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      expect(groups).toHaveLength(1);
      expect(groups[0].registryPath).toBe('tools/search.md');
      expect(groups[0].localRef).toBeDefined();
      expect(groups[0].workspace).toHaveLength(3);
      
      const platforms = groups[0].workspace.map(c => c.platform).sort();
      expect(platforms).toEqual(['claude', 'cursor', 'windsurf']);
    });

    it('should handle missing local candidates', () => {
      const localRefs: LocalSourceRef[] = [];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'new-file.md', 'hash1', 'cursor')
      ];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      expect(groups).toHaveLength(1);
      expect(groups[0].registryPath).toBe('new-file.md');
      expect(groups[0].localRef).toBeUndefined();
      expect(groups[0].workspace).toHaveLength(1);
    });

    it('should handle missing workspace candidates', () => {
      const localRefs: LocalSourceRef[] = [
        createRef('old-file.md')
      ];

      const workspaceCandidates: SaveCandidate[] = [];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      expect(groups).toHaveLength(1);
      expect(groups[0].registryPath).toBe('old-file.md');
      expect(groups[0].localRef).toBeDefined();
      expect(groups[0].workspace).toHaveLength(0);
    });

    it('should handle empty inputs', () => {
      const localRefs: LocalSourceRef[] = [];
      const workspaceCandidates: SaveCandidate[] = [];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      expect(groups).toHaveLength(0);
    });

    it('should organize mixed scenarios', () => {
      const localRefs: LocalSourceRef[] = [
        createRef('file1.md'),
        createRef('file2.md'),
        createRef('file3.md')
      ];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'file1.md', 'hash4', 'cursor'),
        createCandidate('workspace', 'file4.md', 'hash5', 'cursor')
      ];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      expect(groups).toHaveLength(4);
      
      const group1 = groups.find(g => g.registryPath === 'file1.md');
      expect(group1?.localRef).toBeDefined();
      expect(group1?.workspace).toHaveLength(1);
      
      const group2 = groups.find(g => g.registryPath === 'file2.md');
      expect(group2?.localRef).toBeDefined();
      expect(group2?.workspace).toHaveLength(0);
      
      const group3 = groups.find(g => g.registryPath === 'file3.md');
      expect(group3?.localRef).toBeDefined();
      expect(group3?.workspace).toHaveLength(0);
      
      const group4 = groups.find(g => g.registryPath === 'file4.md');
      expect(group4?.localRef).toBeUndefined();
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

function createRef(registryPath: string): LocalSourceRef {
  return {
    registryPath,
    fullPath: `/test/${registryPath}`
  };
}

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
