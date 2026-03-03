/**
 * Tests for save-group-builder.ts
 * 
 * Covers:
 * - Grouping candidates by registry path
 * - Handling multiple workspace candidates per group
 * - Handling missing local candidates
 * - Filtering groups by workspace candidates
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCandidateGroups,
  filterGroupsWithWorkspace
} from '../../../packages/core/src/core/save/save-group-builder.js';
import type { SaveCandidate, LocalSourceRef } from '../../../packages/core/src/core/save/save-types.js';

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

      assert.strictEqual(groups.length, 2);
      
      const group1 = groups.find(g => g.registryPath === 'file1.md');
      assert.notStrictEqual(group1, undefined);
      assert.notStrictEqual(group1!.localRef, undefined);
      assert.strictEqual(group1!.workspace.length, 1);
      
      const group2 = groups.find(g => g.registryPath === 'file2.md');
      assert.notStrictEqual(group2, undefined);
      assert.notStrictEqual(group2!.localRef, undefined);
      assert.strictEqual(group2!.workspace.length, 1);
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

      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].registryPath, 'tools/search.md');
      assert.notStrictEqual(groups[0].localRef, undefined);
      assert.strictEqual(groups[0].workspace.length, 3);
      
      const platforms = groups[0].workspace.map(c => c.platform).sort();
      assert.deepStrictEqual(platforms, ['claude', 'cursor', 'windsurf']);
    });

    it('should handle missing local candidates', () => {
      const localRefs: LocalSourceRef[] = [];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'new-file.md', 'hash1', 'cursor')
      ];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].registryPath, 'new-file.md');
      assert.strictEqual(groups[0].localRef, undefined);
      assert.strictEqual(groups[0].workspace.length, 1);
    });

    it('should handle missing workspace candidates', () => {
      const localRefs: LocalSourceRef[] = [
        createRef('old-file.md')
      ];

      const workspaceCandidates: SaveCandidate[] = [];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      assert.strictEqual(groups.length, 1);
      assert.strictEqual(groups[0].registryPath, 'old-file.md');
      assert.notStrictEqual(groups[0].localRef, undefined);
      assert.strictEqual(groups[0].workspace.length, 0);
    });

    it('should handle empty inputs', () => {
      const localRefs: LocalSourceRef[] = [];
      const workspaceCandidates: SaveCandidate[] = [];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      assert.strictEqual(groups.length, 0);
    });

    it('should create separate groups for new skill files not in source', () => {
      // Setup: 1 local ref (SKILL.md), 3 workspace candidates including 2 new files
      const localRefs: LocalSourceRef[] = [
        createRef('skills/my-skill/SKILL.md')
      ];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'skills/my-skill/SKILL.md', 'hash1', 'claude', '.claude/skills/my-skill/SKILL.md'),
        createCandidate('workspace', 'skills/my-skill/evals.json', 'hash2', 'claude', '.claude/skills/my-skill/evals.json'),
        createCandidate('workspace', 'skills/my-skill/helper.ts', 'hash3', 'claude', '.claude/skills/my-skill/helper.ts')
      ];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      // Should produce 3 separate groups — NOT merge evals.json and helper.ts into SKILL.md's group
      const groupsWithWorkspace = groups.filter(g => g.workspace.length > 0);
      assert.strictEqual(groupsWithWorkspace.length, 3, 'Expected 3 groups with workspace candidates');

      for (const group of groupsWithWorkspace) {
        assert.strictEqual(group.workspace.length, 1, `Group ${group.registryPath} should have exactly 1 workspace candidate`);
      }

      // SKILL.md group should have the local ref
      const skillGroup = groupsWithWorkspace.find(g => g.registryPath === 'skills/my-skill/SKILL.md');
      assert.notStrictEqual(skillGroup, undefined);
      assert.notStrictEqual(skillGroup!.localRef, undefined);

      // New file groups should NOT have a local ref
      const evalsGroup = groupsWithWorkspace.find(g => g.registryPath === 'skills/my-skill/evals.json');
      assert.notStrictEqual(evalsGroup, undefined);
      assert.strictEqual(evalsGroup!.localRef, undefined);

      const helperGroup = groupsWithWorkspace.find(g => g.registryPath === 'skills/my-skill/helper.ts');
      assert.notStrictEqual(helperGroup, undefined);
      assert.strictEqual(helperGroup!.localRef, undefined);
    });

    it('should match cross-extension files via export flow (e.g., mcp.json → mcp.jsonc)', () => {
      // Setup: source has mcp.jsonc, workspace has .cursor/mcp.json
      const localRefs: LocalSourceRef[] = [
        createRef('mcp.jsonc')
      ];

      const workspaceCandidates: SaveCandidate[] = [
        createCandidate('workspace', 'mcp.json', 'hash1', 'cursor', '.cursor/mcp.json')
      ];

      const groups = buildCandidateGroups(localRefs, workspaceCandidates);

      // Should match mcp.json to mcp.jsonc via export flow + cross-extension match
      const groupsWithWorkspace = groups.filter(g => g.workspace.length > 0);
      assert.strictEqual(groupsWithWorkspace.length, 1);
      assert.strictEqual(groupsWithWorkspace[0].registryPath, 'mcp.jsonc');
      assert.strictEqual(groupsWithWorkspace[0].workspace.length, 1);
      assert.notStrictEqual(groupsWithWorkspace[0].localRef, undefined);
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

      assert.strictEqual(groups.length, 4);
      
      const group1 = groups.find(g => g.registryPath === 'file1.md');
      assert.notStrictEqual(group1?.localRef, undefined);
      assert.strictEqual(group1?.workspace.length, 1);
      
      const group2 = groups.find(g => g.registryPath === 'file2.md');
      assert.notStrictEqual(group2?.localRef, undefined);
      assert.strictEqual(group2?.workspace.length, 0);
      
      const group3 = groups.find(g => g.registryPath === 'file3.md');
      assert.notStrictEqual(group3?.localRef, undefined);
      assert.strictEqual(group3?.workspace.length, 0);
      
      const group4 = groups.find(g => g.registryPath === 'file4.md');
      assert.strictEqual(group4?.localRef, undefined);
      assert.strictEqual(group4?.workspace.length, 1);
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
      assert.strictEqual(filtered.length, 2);
      assert.deepStrictEqual(filtered.map(g => g.registryPath).sort(), ['file1.md', 'file3.md']);
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
      assert.strictEqual(filtered.length, 0);
    });

    it('should handle empty input', () => {
      // Setup
      const groups: any[] = [];

      // Execute
      const filtered = filterGroupsWithWorkspace(groups);

      // Verify
      assert.strictEqual(filtered.length, 0);
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
  platform?: string,
  displayPath?: string
): SaveCandidate {
  return {
    source,
    registryPath,
    fullPath: `/test/${registryPath}`,
    content: `content for ${registryPath}`,
    contentHash,
    mtime: Date.now(),
    displayPath: displayPath ?? registryPath,
    platform: platform as any
  };
}
