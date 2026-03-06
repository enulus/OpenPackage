/**
 * Tests for save-interactive-resolver
 *
 * Verifies single-select prompting, parity filtering, and auto-selection.
 * Uses mock OutputPort and PromptPort injected directly.
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveInteractively,
  type InteractiveResolutionInput,
} from '../../../packages/core/src/core/save/save-interactive-resolver.js';
import type { SaveCandidate, SaveCandidateGroup } from '../../../packages/core/src/core/save/save-types.js';
import type { PromptPort, PromptChoice } from '../../../packages/core/src/core/ports/prompt.js';

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

function createGroup(
  registryPath: string,
  local: SaveCandidate | undefined,
  workspace: SaveCandidate[]
): SaveCandidateGroup {
  return { registryPath, local, workspace };
}

function createInput(overrides: Partial<InteractiveResolutionInput>): InteractiveResolutionInput {
  return {
    registryPath: 'tools/search.md',
    workspaceCandidates: [],
    group: createGroup('tools/search.md', undefined, []),
    packageRoot: '/package/source',
    workspaceRoot: '/workspace',
    ...overrides
  };
}

function createMockPrompt(selectReturn?: any): PromptPort {
  return {
    confirm: mock.fn(async () => true),
    select: mock.fn(async () => selectReturn ?? null),
    multiselect: mock.fn(async () => []),
    groupMultiselect: mock.fn(async () => []),
    text: mock.fn(async () => '')
  };
}

describe('save-interactive-resolver', () => {
  describe('resolveInteractively', () => {
    it('all at parity → returns null, no prompt', async () => {
      // When comparableHash matches the local contentHash, the candidate is at parity
      const local = createCandidate({
        source: 'local',
        contentHash: 'same-hash'
      });
      const c1 = createCandidate({
        contentHash: 'different-workspace-hash',
        comparableHash: 'same-hash',
        displayPath: '.cursor/tools/search.md',
        mtime: 2000
      });
      const c2 = createCandidate({
        contentHash: 'different-workspace-hash-2',
        comparableHash: 'same-hash',
        displayPath: '.claude/tools/search.md',
        platform: 'claude',
        mtime: 1000
      });

      const prm = createMockPrompt();

      const result = await resolveInteractively(
        createInput({
          workspaceCandidates: [c1, c2],
          group: createGroup('tools/search.md', local, [c1, c2])
        }),
        prm
      );

      assert.strictEqual(result.selectedCandidate, null);
      assert.deepStrictEqual(result.platformSpecificCandidates, []);
      assert.strictEqual((prm.select as any).mock.callCount(), 0);
    });

    it('1 after filtering → auto-select, no prompt', async () => {
      const local = createCandidate({
        source: 'local',
        contentHash: 'local-hash'
      });
      // c1 is at parity (comparableHash matches local)
      const c1 = createCandidate({
        contentHash: 'ws-hash-1',
        comparableHash: 'local-hash',
        displayPath: '.cursor/tools/search.md',
        mtime: 2000
      });
      // c2 is NOT at parity
      const c2 = createCandidate({
        contentHash: 'different-hash',
        comparableHash: 'different-hash',
        displayPath: '.claude/tools/search.md',
        platform: 'claude',
        mtime: 1000
      });

      const prm = createMockPrompt();

      const result = await resolveInteractively(
        createInput({
          workspaceCandidates: [c1, c2],
          group: createGroup('tools/search.md', local, [c1, c2])
        }),
        prm
      );

      assert.strictEqual(result.selectedCandidate, c2);
      assert.deepStrictEqual(result.platformSpecificCandidates, []);
      assert.strictEqual((prm.select as any).mock.callCount(), 0);
    });

    it('2+ after filtering → prm.select() called once, returns selection', async () => {
      // No local → no parity filtering possible
      const c1 = createCandidate({
        contentHash: 'hash-1',
        displayPath: '.cursor/tools/search.md',
        mtime: 2000
      });
      const c2 = createCandidate({
        contentHash: 'hash-2',
        displayPath: '.claude/tools/search.md',
        platform: 'claude',
        mtime: 1000
      });

      const prm = createMockPrompt(c1);

      const result = await resolveInteractively(
        createInput({
          workspaceCandidates: [c1, c2],
          group: createGroup('tools/search.md', undefined, [c1, c2])
        }),
        prm
      );

      assert.strictEqual(result.selectedCandidate, c1);
      assert.deepStrictEqual(result.platformSpecificCandidates, []);
      assert.strictEqual((prm.select as any).mock.callCount(), 1);
    });

    it('user selects Skip → returns null', async () => {
      const c1 = createCandidate({
        contentHash: 'hash-1',
        displayPath: '.cursor/tools/search.md',
        mtime: 2000
      });
      const c2 = createCandidate({
        contentHash: 'hash-2',
        displayPath: '.claude/tools/search.md',
        platform: 'claude',
        mtime: 1000
      });

      const prm = createMockPrompt(null); // null = Skip

      const result = await resolveInteractively(
        createInput({
          workspaceCandidates: [c1, c2],
          group: createGroup('tools/search.md', undefined, [c1, c2])
        }),
        prm
      );

      assert.strictEqual(result.selectedCandidate, null);
      assert.deepStrictEqual(result.platformSpecificCandidates, []);
    });

    it('platformSpecificCandidates always empty', async () => {
      const c1 = createCandidate({
        contentHash: 'hash-1',
        displayPath: '.cursor/tools/search.md',
        platform: 'cursor',
        mtime: 2000
      });

      const prm = createMockPrompt(c1);

      const result = await resolveInteractively(
        createInput({
          workspaceCandidates: [c1],
          group: createGroup('tools/search.md', undefined, [c1])
        }),
        prm
      );

      assert.deepStrictEqual(result.platformSpecificCandidates, []);
    });

    it('candidates sorted newest-first in prompt choices', async () => {
      const older = createCandidate({
        contentHash: 'hash-old',
        displayPath: '.claude/tools/search.md',
        platform: 'claude',
        mtime: 1000
      });
      const newer = createCandidate({
        contentHash: 'hash-new',
        displayPath: '.cursor/tools/search.md',
        platform: 'cursor',
        mtime: 2000
      });

      // Return the first candidate (should be the newer one)
      const prm = createMockPrompt(newer);

      await resolveInteractively(
        createInput({
          // Executor pre-sorts newest-first before dispatching
          workspaceCandidates: [newer, older],
          group: createGroup('tools/search.md', undefined, [newer, older])
        }),
        prm
      );

      // Verify select was called and first choice is the newer candidate
      assert.strictEqual((prm.select as any).mock.callCount(), 1);
      const call = (prm.select as any).mock.calls[0];
      const choices: PromptChoice<SaveCandidate | null>[] = call.arguments[1];

      // First choice should be the newer candidate, last should be Skip
      assert.strictEqual(choices[0].value, newer);
      assert.strictEqual(choices[1].value, older);
      assert.strictEqual(choices[2].value, null); // Skip
      assert.strictEqual(choices[2].title, 'Skip');
    });
  });
});
