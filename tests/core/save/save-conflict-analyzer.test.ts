/**
 * Tests for save-conflict-analyzer
 * 
 * These tests verify conflict detection, deduplication, and resolution strategy logic.
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeGroup,
  deduplicateCandidates,
  hasContentDifference,
  getNewestCandidate,
  sortCandidatesByMtime,
  type ConflictAnalysisType
} from '../../../src/core/save/save-conflict-analyzer.js';
import type { SaveCandidate, SaveCandidateGroup } from '../../../src/core/save/save-types.js';

describe('save-conflict-analyzer', () => {
  /**
   * Helper to create a mock SaveCandidate
   */
  function createCandidate(overrides: Partial<SaveCandidate>): SaveCandidate {
    return {
      source: 'workspace',
      registryPath: 'tools/search.md',
      fullPath: '/workspace/.cursor/tools/search.md',
      content: 'test content',
      contentHash: 'abc123',
      mtime: Date.now(),
      displayPath: '.cursor/tools/search.md',
      ...overrides
    };
  }

  /**
   * Helper to create a mock SaveCandidateGroup
   */
  function createGroup(
    registryPath: string,
    local: SaveCandidate | undefined,
    workspace: SaveCandidate[]
  ): SaveCandidateGroup {
    return {
      registryPath,
      local,
      workspace
    };
  }

  describe('analyzeGroup', () => {
    it('should return no-action-needed when no workspace candidates', () => {
      const group = createGroup('tools/search.md', undefined, []);
      const analysis = analyzeGroup(group, false);

      expect(analysis.type).toBe('no-action-needed');
      expect(analysis.workspaceCandidateCount).toBe(0);
      expect(analysis.recommendedStrategy).toBe('skip');
    });

    it('should return no-change-needed when workspace matches local', () => {
      const localCandidate = createCandidate({
        source: 'local',
        contentHash: 'same-hash',
        platform: undefined
      });
      const workspaceCandidate = createCandidate({
        source: 'workspace',
        contentHash: 'same-hash',
        platform: 'cursor'
      });

      const group = createGroup(
        'tools/search.md',
        localCandidate,
        [workspaceCandidate]
      );

      const analysis = analyzeGroup(group, false);

      expect(analysis.type).toBe('no-change-needed');
      expect(analysis.localMatchesWorkspace).toBe(true);
      expect(analysis.recommendedStrategy).toBe('skip');
    });

    it('should return auto-write for single workspace candidate', () => {
      const localCandidate = createCandidate({
        source: 'local',
        contentHash: 'local-hash',
        platform: undefined
      });
      const workspaceCandidate = createCandidate({
        source: 'workspace',
        contentHash: 'workspace-hash',
        platform: 'cursor'
      });

      const group = createGroup(
        'tools/search.md',
        localCandidate,
        [workspaceCandidate]
      );

      const analysis = analyzeGroup(group, false);

      expect(analysis.type).toBe('auto-write');
      expect(analysis.workspaceCandidateCount).toBe(1);
      expect(analysis.recommendedStrategy).toBe('write-single');
    });

    it('should return auto-write for multiple identical workspace candidates', () => {
      const candidates = [
        createCandidate({
          contentHash: 'same-hash',
          platform: 'cursor',
          displayPath: '.cursor/tools/search.md',
          mtime: 1000
        }),
        createCandidate({
          contentHash: 'same-hash',
          platform: 'claude',
          displayPath: '.claude/tools/search.md',
          mtime: 2000
        }),
        createCandidate({
          contentHash: 'same-hash',
          platform: 'windsurf',
          displayPath: '.windsurf/tools/search.md',
          mtime: 1500
        })
      ];

      const group = createGroup('tools/search.md', undefined, candidates);
      const analysis = analyzeGroup(group, false);

      expect(analysis.type).toBe('auto-write');
      expect(analysis.workspaceCandidateCount).toBe(3);
      expect(analysis.uniqueWorkspaceCandidates).toHaveLength(1);
      expect(analysis.recommendedStrategy).toBe('write-single');
    });

    it('should return needs-resolution for multiple differing candidates (interactive)', () => {
      const candidates = [
        createCandidate({
          contentHash: 'hash-a',
          platform: 'cursor',
          mtime: 1000
        }),
        createCandidate({
          contentHash: 'hash-b',
          platform: 'claude',
          mtime: 2000
        })
      ];

      const group = createGroup('tools/search.md', undefined, candidates);
      const analysis = analyzeGroup(group, false); // force = false

      expect(analysis.type).toBe('needs-resolution');
      expect(analysis.workspaceCandidateCount).toBe(2);
      expect(analysis.uniqueWorkspaceCandidates).toHaveLength(2);
      expect(analysis.recommendedStrategy).toBe('interactive');
    });

    it('should return needs-resolution with force-newest for multiple differing (force)', () => {
      const candidates = [
        createCandidate({
          contentHash: 'hash-a',
          platform: 'cursor',
          mtime: 1000
        }),
        createCandidate({
          contentHash: 'hash-b',
          platform: 'claude',
          mtime: 2000
        })
      ];

      const group = createGroup('tools/search.md', undefined, candidates);
      const analysis = analyzeGroup(group, true); // force = true

      expect(analysis.type).toBe('needs-resolution');
      expect(analysis.recommendedStrategy).toBe('force-newest');
    });

    it('should detect root files', () => {
      const candidate = createCandidate({
        registryPath: 'AGENTS.md',
        isRootFile: true
      });

      const group = createGroup('AGENTS.md', undefined, [candidate]);
      const analysis = analyzeGroup(group, false);

      expect(analysis.isRootFile).toBe(true);
    });

    it('should detect platform candidates', () => {
      const candidates = [
        createCandidate({
          platform: 'cursor'
        }),
        createCandidate({
          platform: 'claude'
        })
      ];

      const group = createGroup('tools/search.md', undefined, candidates);
      const analysis = analyzeGroup(group, false);

      expect(analysis.hasPlatformCandidates).toBe(true);
    });

    it('should not consider "ai" as platform candidate', () => {
      const candidate = createCandidate({
        platform: 'ai'
      });

      const group = createGroup('tools/search.md', undefined, [candidate]);
      const analysis = analyzeGroup(group, false);

      expect(analysis.hasPlatformCandidates).toBe(false);
    });
  });

  describe('deduplicateCandidates', () => {
    it('should remove duplicate content hashes', () => {
      const candidates = [
        createCandidate({
          contentHash: 'hash-a',
          displayPath: 'path1'
        }),
        createCandidate({
          contentHash: 'hash-a', // duplicate
          displayPath: 'path2'
        }),
        createCandidate({
          contentHash: 'hash-b',
          displayPath: 'path3'
        })
      ];

      const unique = deduplicateCandidates(candidates);

      expect(unique).toHaveLength(2);
      expect(unique[0].contentHash).toBe('hash-a');
      expect(unique[0].displayPath).toBe('path1'); // First occurrence
      expect(unique[1].contentHash).toBe('hash-b');
    });

    it('should preserve order of first occurrence', () => {
      const candidates = [
        createCandidate({ contentHash: 'a', displayPath: 'first' }),
        createCandidate({ contentHash: 'b', displayPath: 'second' }),
        createCandidate({ contentHash: 'a', displayPath: 'duplicate' }),
        createCandidate({ contentHash: 'c', displayPath: 'third' })
      ];

      const unique = deduplicateCandidates(candidates);

      expect(unique).toHaveLength(3);
      expect(unique[0].displayPath).toBe('first');
      expect(unique[1].displayPath).toBe('second');
      expect(unique[2].displayPath).toBe('third');
    });

    it('should handle empty array', () => {
      const unique = deduplicateCandidates([]);
      expect(unique).toHaveLength(0);
    });

    it('should handle all unique candidates', () => {
      const candidates = [
        createCandidate({ contentHash: 'a' }),
        createCandidate({ contentHash: 'b' }),
        createCandidate({ contentHash: 'c' })
      ];

      const unique = deduplicateCandidates(candidates);
      expect(unique).toHaveLength(3);
    });

    it('should handle all identical candidates', () => {
      const candidates = [
        createCandidate({ contentHash: 'same', displayPath: 'a' }),
        createCandidate({ contentHash: 'same', displayPath: 'b' }),
        createCandidate({ contentHash: 'same', displayPath: 'c' })
      ];

      const unique = deduplicateCandidates(candidates);
      expect(unique).toHaveLength(1);
      expect(unique[0].displayPath).toBe('a'); // First one
    });
  });

  describe('hasContentDifference', () => {
    it('should return true when no local candidate', () => {
      const workspace = [createCandidate({ contentHash: 'abc' })];
      expect(hasContentDifference(undefined, workspace)).toBe(true);
    });

    it('should return false when no workspace candidates', () => {
      const local = createCandidate({ contentHash: 'abc' });
      expect(hasContentDifference(local, [])).toBe(false);
    });

    it('should return true when workspace differs from local', () => {
      const local = createCandidate({ contentHash: 'local-hash' });
      const workspace = [createCandidate({ contentHash: 'workspace-hash' })];
      expect(hasContentDifference(local, workspace)).toBe(true);
    });

    it('should return false when workspace matches local', () => {
      const local = createCandidate({ contentHash: 'same-hash' });
      const workspace = [createCandidate({ contentHash: 'same-hash' })];
      expect(hasContentDifference(local, workspace)).toBe(false);
    });

    it('should return true when any workspace candidate differs', () => {
      const local = createCandidate({ contentHash: 'local-hash' });
      const workspace = [
        createCandidate({ contentHash: 'local-hash' }), // matches
        createCandidate({ contentHash: 'different-hash' }) // differs
      ];
      expect(hasContentDifference(local, workspace)).toBe(true);
    });
  });

  describe('getNewestCandidate', () => {
    it('should return single candidate', () => {
      const candidate = createCandidate({ mtime: 1000 });
      const newest = getNewestCandidate([candidate]);
      expect(newest).toBe(candidate);
    });

    it('should return candidate with highest mtime', () => {
      const candidates = [
        createCandidate({ mtime: 1000, displayPath: 'old' }),
        createCandidate({ mtime: 3000, displayPath: 'newest' }),
        createCandidate({ mtime: 2000, displayPath: 'middle' })
      ];

      const newest = getNewestCandidate(candidates);
      expect(newest.displayPath).toBe('newest');
      expect(newest.mtime).toBe(3000);
    });

    it('should use displayPath as tie-breaker when mtime equal', () => {
      const candidates = [
        createCandidate({ mtime: 1000, displayPath: 'z-last' }),
        createCandidate({ mtime: 1000, displayPath: 'a-first' }),
        createCandidate({ mtime: 1000, displayPath: 'm-middle' })
      ];

      const newest = getNewestCandidate(candidates);
      expect(newest.displayPath).toBe('a-first'); // Alphabetically first
    });

    it('should throw error for empty array', () => {
      expect(() => getNewestCandidate([])).toThrow('Cannot get newest candidate from empty array');
    });
  });

  describe('sortCandidatesByMtime', () => {
    it('should sort by mtime descending (newest first)', () => {
      const candidates = [
        createCandidate({ mtime: 1000, displayPath: 'old' }),
        createCandidate({ mtime: 3000, displayPath: 'newest' }),
        createCandidate({ mtime: 2000, displayPath: 'middle' })
      ];

      const sorted = sortCandidatesByMtime(candidates);

      expect(sorted[0].mtime).toBe(3000);
      expect(sorted[1].mtime).toBe(2000);
      expect(sorted[2].mtime).toBe(1000);
    });

    it('should use displayPath as tie-breaker', () => {
      const candidates = [
        createCandidate({ mtime: 1000, displayPath: 'z' }),
        createCandidate({ mtime: 1000, displayPath: 'a' }),
        createCandidate({ mtime: 1000, displayPath: 'm' })
      ];

      const sorted = sortCandidatesByMtime(candidates);

      expect(sorted[0].displayPath).toBe('a');
      expect(sorted[1].displayPath).toBe('m');
      expect(sorted[2].displayPath).toBe('z');
    });

    it('should not mutate original array', () => {
      const candidates = [
        createCandidate({ mtime: 1000, displayPath: 'a' }),
        createCandidate({ mtime: 2000, displayPath: 'b' })
      ];

      const original = [...candidates];
      sortCandidatesByMtime(candidates);

      // Original should be unchanged
      expect(candidates[0].mtime).toBe(1000);
      expect(candidates[1].mtime).toBe(2000);
    });

    it('should handle empty array', () => {
      const sorted = sortCandidatesByMtime([]);
      expect(sorted).toHaveLength(0);
    });

    it('should handle single candidate', () => {
      const candidate = createCandidate({ mtime: 1000 });
      const sorted = sortCandidatesByMtime([candidate]);
      expect(sorted).toHaveLength(1);
      expect(sorted[0]).toBe(candidate);
    });
  });

  describe('integration: full analysis workflow', () => {
    it('should handle complex scenario with multiple groups', () => {
      // Scenario 1: No workspace candidates
      const group1 = createGroup('file1.md', undefined, []);
      const analysis1 = analyzeGroup(group1, false);
      expect(analysis1.type).toBe('no-action-needed');

      // Scenario 2: Workspace matches local
      const group2 = createGroup(
        'file2.md',
        createCandidate({ contentHash: 'same' }),
        [createCandidate({ contentHash: 'same' })]
      );
      const analysis2 = analyzeGroup(group2, false);
      expect(analysis2.type).toBe('no-change-needed');

      // Scenario 3: Multiple identical workspace
      const group3 = createGroup(
        'file3.md',
        undefined,
        [
          createCandidate({ contentHash: 'same', platform: 'cursor' }),
          createCandidate({ contentHash: 'same', platform: 'claude' })
        ]
      );
      const analysis3 = analyzeGroup(group3, false);
      expect(analysis3.type).toBe('auto-write');
      expect(analysis3.uniqueWorkspaceCandidates).toHaveLength(1);

      // Scenario 4: Multiple differing workspace
      const group4 = createGroup(
        'file4.md',
        undefined,
        [
          createCandidate({ contentHash: 'hash-a', mtime: 1000 }),
          createCandidate({ contentHash: 'hash-b', mtime: 2000 })
        ]
      );
      const analysis4 = analyzeGroup(group4, false);
      expect(analysis4.type).toBe('needs-resolution');
      expect(analysis4.recommendedStrategy).toBe('interactive');

      // Same scenario with force mode
      const analysis4Force = analyzeGroup(group4, true);
      expect(analysis4Force.recommendedStrategy).toBe('force-newest');
    });
  });
});
