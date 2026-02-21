/**
 * Tests for save-conflict-analyzer
 * 
 * These tests verify conflict detection, deduplication, and resolution strategy logic.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
  // Dummy workspace root for analyzeGroup (required third parameter)
  const dummyWorkspaceRoot = '/tmp/test-workspace';

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
    it('should return no-action-needed when no workspace candidates', async () => {
      const group = createGroup('tools/search.md', undefined, []);
      const analysis = await analyzeGroup(group, false, dummyWorkspaceRoot);

      assert.strictEqual(analysis.type, 'no-action-needed');
      assert.strictEqual(analysis.workspaceCandidateCount, 0);
      assert.strictEqual(analysis.recommendedStrategy, 'skip');
    });

    it('should return no-change-needed when workspace matches local', async () => {
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

      const analysis = await analyzeGroup(group, false, dummyWorkspaceRoot);

      assert.strictEqual(analysis.type, 'no-change-needed');
      assert.strictEqual(analysis.localMatchesWorkspace, true);
      assert.strictEqual(analysis.recommendedStrategy, 'skip');
    });

    it('should return auto-write for single workspace candidate', async () => {
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

      const analysis = await analyzeGroup(group, false, dummyWorkspaceRoot);

      assert.strictEqual(analysis.type, 'auto-write');
      assert.strictEqual(analysis.workspaceCandidateCount, 1);
      assert.strictEqual(analysis.recommendedStrategy, 'write-single');
    });

    it('should return auto-write for multiple identical workspace candidates', async () => {
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
      const analysis = await analyzeGroup(group, false, dummyWorkspaceRoot);

      assert.strictEqual(analysis.type, 'auto-write');
      assert.strictEqual(analysis.workspaceCandidateCount, 3);
      assert.strictEqual(analysis.uniqueWorkspaceCandidates!.length, 1);
      assert.strictEqual(analysis.recommendedStrategy, 'write-single');
    });

    it('should return needs-resolution for multiple differing candidates (interactive)', async () => {
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
      const analysis = await analyzeGroup(group, false, dummyWorkspaceRoot); // force = false

      assert.strictEqual(analysis.type, 'needs-resolution');
      assert.strictEqual(analysis.workspaceCandidateCount, 2);
      assert.strictEqual(analysis.uniqueWorkspaceCandidates!.length, 2);
      assert.strictEqual(analysis.recommendedStrategy, 'interactive');
    });

    it('should return needs-resolution with force-newest for multiple differing (force)', async () => {
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
      const analysis = await analyzeGroup(group, true, dummyWorkspaceRoot); // force = true

      assert.strictEqual(analysis.type, 'needs-resolution');
      assert.strictEqual(analysis.recommendedStrategy, 'force-newest');
    });

    it('should detect root files', async () => {
      const candidate = createCandidate({
        registryPath: 'AGENTS.md',
        isRootFile: true
      });

      const group = createGroup('AGENTS.md', undefined, [candidate]);
      const analysis = await analyzeGroup(group, false, dummyWorkspaceRoot);

      assert.strictEqual(analysis.isRootFile, true);
    });

    it('should detect platform candidates', async () => {
      const candidates = [
        createCandidate({
          platform: 'cursor'
        }),
        createCandidate({
          platform: 'claude'
        })
      ];

      const group = createGroup('tools/search.md', undefined, candidates);
      const analysis = await analyzeGroup(group, false, dummyWorkspaceRoot);

      assert.strictEqual(analysis.hasPlatformCandidates, true);
    });

    it('should not consider "ai" as platform candidate', async () => {
      const candidate = createCandidate({
        platform: 'ai'
      });

      const group = createGroup('tools/search.md', undefined, [candidate]);
      const analysis = await analyzeGroup(group, false, dummyWorkspaceRoot);

      assert.strictEqual(analysis.hasPlatformCandidates, false);
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

      assert.strictEqual(unique.length, 2);
      assert.strictEqual(unique[0].contentHash, 'hash-a');
      assert.strictEqual(unique[0].displayPath, 'path1'); // First occurrence
      assert.strictEqual(unique[1].contentHash, 'hash-b');
    });

    it('should preserve order of first occurrence', () => {
      const candidates = [
        createCandidate({ contentHash: 'a', displayPath: 'first' }),
        createCandidate({ contentHash: 'b', displayPath: 'second' }),
        createCandidate({ contentHash: 'a', displayPath: 'duplicate' }),
        createCandidate({ contentHash: 'c', displayPath: 'third' })
      ];

      const unique = deduplicateCandidates(candidates);

      assert.strictEqual(unique.length, 3);
      assert.strictEqual(unique[0].displayPath, 'first');
      assert.strictEqual(unique[1].displayPath, 'second');
      assert.strictEqual(unique[2].displayPath, 'third');
    });

    it('should handle empty array', () => {
      const unique = deduplicateCandidates([]);
      assert.strictEqual(unique.length, 0);
    });

    it('should handle all unique candidates', () => {
      const candidates = [
        createCandidate({ contentHash: 'a' }),
        createCandidate({ contentHash: 'b' }),
        createCandidate({ contentHash: 'c' })
      ];

      const unique = deduplicateCandidates(candidates);
      assert.strictEqual(unique.length, 3);
    });

    it('should handle all identical candidates', () => {
      const candidates = [
        createCandidate({ contentHash: 'same', displayPath: 'a' }),
        createCandidate({ contentHash: 'same', displayPath: 'b' }),
        createCandidate({ contentHash: 'same', displayPath: 'c' })
      ];

      const unique = deduplicateCandidates(candidates);
      assert.strictEqual(unique.length, 1);
      assert.strictEqual(unique[0].displayPath, 'a'); // First one
    });
  });

  describe('hasContentDifference', () => {
    it('should return true when no local candidate', () => {
      const workspace = [createCandidate({ contentHash: 'abc' })];
      assert.strictEqual(hasContentDifference(undefined, workspace), true);
    });

    it('should return false when no workspace candidates', () => {
      const local = createCandidate({ contentHash: 'abc' });
      assert.strictEqual(hasContentDifference(local, []), false);
    });

    it('should return true when workspace differs from local', () => {
      const local = createCandidate({ contentHash: 'local-hash' });
      const workspace = [createCandidate({ contentHash: 'workspace-hash' })];
      assert.strictEqual(hasContentDifference(local, workspace), true);
    });

    it('should return false when workspace matches local', () => {
      const local = createCandidate({ contentHash: 'same-hash' });
      const workspace = [createCandidate({ contentHash: 'same-hash' })];
      assert.strictEqual(hasContentDifference(local, workspace), false);
    });

    it('should return true when any workspace candidate differs', () => {
      const local = createCandidate({ contentHash: 'local-hash' });
      const workspace = [
        createCandidate({ contentHash: 'local-hash' }), // matches
        createCandidate({ contentHash: 'different-hash' }) // differs
      ];
      assert.strictEqual(hasContentDifference(local, workspace), true);
    });
  });

  describe('getNewestCandidate', () => {
    it('should return single candidate', () => {
      const candidate = createCandidate({ mtime: 1000 });
      const newest = getNewestCandidate([candidate]);
      assert.strictEqual(newest, candidate);
    });

    it('should return candidate with highest mtime', () => {
      const candidates = [
        createCandidate({ mtime: 1000, displayPath: 'old' }),
        createCandidate({ mtime: 3000, displayPath: 'newest' }),
        createCandidate({ mtime: 2000, displayPath: 'middle' })
      ];

      const newest = getNewestCandidate(candidates);
      assert.strictEqual(newest.displayPath, 'newest');
      assert.strictEqual(newest.mtime, 3000);
    });

    it('should use displayPath as tie-breaker when mtime equal', () => {
      const candidates = [
        createCandidate({ mtime: 1000, displayPath: 'z-last' }),
        createCandidate({ mtime: 1000, displayPath: 'a-first' }),
        createCandidate({ mtime: 1000, displayPath: 'm-middle' })
      ];

      const newest = getNewestCandidate(candidates);
      assert.strictEqual(newest.displayPath, 'a-first'); // Alphabetically first
    });

    it('should throw error for empty array', () => {
      assert.throws(() => getNewestCandidate([]), { message: 'Cannot get newest candidate from empty array' });
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

      assert.strictEqual(sorted[0].mtime, 3000);
      assert.strictEqual(sorted[1].mtime, 2000);
      assert.strictEqual(sorted[2].mtime, 1000);
    });

    it('should use displayPath as tie-breaker', () => {
      const candidates = [
        createCandidate({ mtime: 1000, displayPath: 'z' }),
        createCandidate({ mtime: 1000, displayPath: 'a' }),
        createCandidate({ mtime: 1000, displayPath: 'm' })
      ];

      const sorted = sortCandidatesByMtime(candidates);

      assert.strictEqual(sorted[0].displayPath, 'a');
      assert.strictEqual(sorted[1].displayPath, 'm');
      assert.strictEqual(sorted[2].displayPath, 'z');
    });

    it('should not mutate original array', () => {
      const candidates = [
        createCandidate({ mtime: 1000, displayPath: 'a' }),
        createCandidate({ mtime: 2000, displayPath: 'b' })
      ];

      const original = [...candidates];
      sortCandidatesByMtime(candidates);

      // Original should be unchanged
      assert.strictEqual(candidates[0].mtime, 1000);
      assert.strictEqual(candidates[1].mtime, 2000);
    });

    it('should handle empty array', () => {
      const sorted = sortCandidatesByMtime([]);
      assert.strictEqual(sorted.length, 0);
    });

    it('should handle single candidate', () => {
      const candidate = createCandidate({ mtime: 1000 });
      const sorted = sortCandidatesByMtime([candidate]);
      assert.strictEqual(sorted.length, 1);
      assert.strictEqual(sorted[0], candidate);
    });
  });

  describe('integration: full analysis workflow', () => {
    it('should handle complex scenario with multiple groups', async () => {
      // Scenario 1: No workspace candidates
      const group1 = createGroup('file1.md', undefined, []);
      const analysis1 = await analyzeGroup(group1, false, dummyWorkspaceRoot);
      assert.strictEqual(analysis1.type, 'no-action-needed');

      // Scenario 2: Workspace matches local
      const group2 = createGroup(
        'file2.md',
        createCandidate({ contentHash: 'same' }),
        [createCandidate({ contentHash: 'same' })]
      );
      const analysis2 = await analyzeGroup(group2, false, dummyWorkspaceRoot);
      assert.strictEqual(analysis2.type, 'no-change-needed');

      // Scenario 3: Multiple identical workspace
      const group3 = createGroup(
        'file3.md',
        undefined,
        [
          createCandidate({ contentHash: 'same', platform: 'cursor' }),
          createCandidate({ contentHash: 'same', platform: 'claude' })
        ]
      );
      const analysis3 = await analyzeGroup(group3, false, dummyWorkspaceRoot);
      assert.strictEqual(analysis3.type, 'auto-write');
      assert.strictEqual(analysis3.uniqueWorkspaceCandidates!.length, 1);

      // Scenario 4: Multiple differing workspace
      const group4 = createGroup(
        'file4.md',
        undefined,
        [
          createCandidate({ contentHash: 'hash-a', mtime: 1000 }),
          createCandidate({ contentHash: 'hash-b', mtime: 2000 })
        ]
      );
      const analysis4 = await analyzeGroup(group4, false, dummyWorkspaceRoot);
      assert.strictEqual(analysis4.type, 'needs-resolution');
      assert.strictEqual(analysis4.recommendedStrategy, 'interactive');

      // Same scenario with force mode
      const analysis4Force = await analyzeGroup(group4, true, dummyWorkspaceRoot);
      assert.strictEqual(analysis4Force.recommendedStrategy, 'force-newest');
    });
  });
});
