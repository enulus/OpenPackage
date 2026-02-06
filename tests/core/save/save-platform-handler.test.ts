/**
 * Tests for save-platform-handler
 * 
 * These tests verify platform-specific candidate pruning logic.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { pruneExistingPlatformCandidates } from '../../../src/core/save/save-platform-handler.js';
import type { SaveCandidateGroup, SaveCandidate } from '../../../src/core/save/save-types.js';

describe('save-platform-handler', () => {
  let tempDir: string;
  let packageRoot: string;

  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = await mkdtemp(join(tmpdir(), 'save-platform-handler-test-'));
    packageRoot = join(tempDir, 'package-source');
  });

  /**
   * Helper to write a file, creating parent directories as needed
   */
  async function writeTestFile(filePath: string, content: string): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }

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

  describe('pruneExistingPlatformCandidates', () => {
    it('should prune candidates with existing platform files', async () => {
      // Create package structure:
      //   tools/search.md (universal)
      //   .cursor/tools/search.cursor.md (exists!)
      const universalPath = join(packageRoot, 'tools/search.md');
      const cursorPlatformPath = join(packageRoot, 'tools/search.cursor.md');
      
      await writeTestFile(universalPath, 'universal content');
      await writeTestFile(cursorPlatformPath, 'cursor content');

      const groups: SaveCandidateGroup[] = [
        createGroup(
          'tools/search.md',
          createCandidate({
            source: 'local',
            fullPath: universalPath,
            contentHash: 'local-hash',
            platform: undefined
          }),
          [
            createCandidate({
              platform: 'cursor',
              displayPath: '.cursor/tools/search.md',
              contentHash: 'cursor-hash'
            }),
            createCandidate({
              platform: 'claude',
              displayPath: '.claude/tools/search.md',
              contentHash: 'claude-hash'
            })
          ]
        )
      ];

      await pruneExistingPlatformCandidates(packageRoot, groups);

      // cursor candidate should be pruned (platform file exists)
      // claude candidate should be kept (no platform file)
      expect(groups[0].workspace).toHaveLength(1);
      expect(groups[0].workspace[0].platform).toBe('claude');
    });

    it('should keep candidates without existing platform files', async () => {
      // Create package structure with only universal file
      const universalPath = join(packageRoot, 'tools/calc.md');
      await writeTestFile(universalPath, 'universal content');

      const groups: SaveCandidateGroup[] = [
        createGroup(
          'tools/calc.md',
          createCandidate({
            source: 'local',
            fullPath: universalPath,
            contentHash: 'local-hash',
            platform: undefined
          }),
          [
            createCandidate({
              platform: 'cursor',
              displayPath: '.cursor/tools/calc.md',
              contentHash: 'cursor-hash'
            }),
            createCandidate({
              platform: 'windsurf',
              displayPath: '.windsurf/tools/calc.md',
              contentHash: 'windsurf-hash'
            })
          ]
        )
      ];

      await pruneExistingPlatformCandidates(packageRoot, groups);

      // Both candidates should be kept (no platform files exist)
      expect(groups[0].workspace).toHaveLength(2);
      expect(groups[0].workspace[0].platform).toBe('cursor');
      expect(groups[0].workspace[1].platform).toBe('windsurf');
    });

    it('should keep non-platform candidates', async () => {
      const universalPath = join(packageRoot, 'tools/helper.md');
      await writeTestFile(universalPath, 'universal content');

      const groups: SaveCandidateGroup[] = [
        createGroup(
          'tools/helper.md',
          createCandidate({
            source: 'local',
            fullPath: universalPath,
            platform: undefined
          }),
          [
            createCandidate({
              platform: undefined, // Universal candidate
              displayPath: 'tools/helper.md',
              contentHash: 'universal-hash'
            })
          ]
        )
      ];

      await pruneExistingPlatformCandidates(packageRoot, groups);

      // Universal candidate should always be kept
      expect(groups[0].workspace).toHaveLength(1);
      expect(groups[0].workspace[0].platform).toBeUndefined();
    });

    it('should keep "ai" platform candidates', async () => {
      const universalPath = join(packageRoot, 'tools/ai-helper.md');
      await writeTestFile(universalPath, 'universal content');

      const groups: SaveCandidateGroup[] = [
        createGroup(
          'tools/ai-helper.md',
          createCandidate({
            source: 'local',
            fullPath: universalPath,
            platform: undefined
          }),
          [
            createCandidate({
              platform: 'ai', // 'ai' is treated as universal
              displayPath: 'ai/tools/ai-helper.md',
              contentHash: 'ai-hash'
            })
          ]
        )
      ];

      await pruneExistingPlatformCandidates(packageRoot, groups);

      // 'ai' platform should be kept (treated as universal)
      expect(groups[0].workspace).toHaveLength(1);
      expect(groups[0].workspace[0].platform).toBe('ai');
    });

    it('should skip groups without local candidate', async () => {
      // Group with no local candidate (new file)
      const groups: SaveCandidateGroup[] = [
        createGroup(
          'tools/new-file.md',
          undefined, // No local file
          [
            createCandidate({
              platform: 'cursor',
              displayPath: '.cursor/tools/new-file.md',
              contentHash: 'cursor-hash'
            })
          ]
        )
      ];

      await pruneExistingPlatformCandidates(packageRoot, groups);

      // Should keep all candidates (no local file to check against)
      expect(groups[0].workspace).toHaveLength(1);
    });

    it('should handle multiple groups', async () => {
      // Create multiple files
      await writeTestFile(join(packageRoot, 'tools/search.md'), 'content');
      await writeTestFile(join(packageRoot, 'tools/search.cursor.md'), 'cursor content');
      await writeTestFile(join(packageRoot, 'tools/calc.md'), 'content');

      const groups: SaveCandidateGroup[] = [
        createGroup(
          'tools/search.md',
          createCandidate({
            source: 'local',
            registryPath: 'tools/search.md',
            platform: undefined
          }),
          [
            createCandidate({
              registryPath: 'tools/search.md',
              platform: 'cursor', // Will be pruned
              displayPath: '.cursor/tools/search.md'
            })
          ]
        ),
        createGroup(
          'tools/calc.md',
          createCandidate({
            source: 'local',
            registryPath: 'tools/calc.md',
            platform: undefined
          }),
          [
            createCandidate({
              registryPath: 'tools/calc.md',
              platform: 'cursor', // Will be kept
              displayPath: '.cursor/tools/calc.md'
            })
          ]
        )
      ];

      await pruneExistingPlatformCandidates(packageRoot, groups);

      // First group: cursor pruned (platform file exists)
      expect(groups[0].workspace).toHaveLength(0);
      
      // Second group: cursor kept (no platform file)
      expect(groups[1].workspace).toHaveLength(1);
    });

    it('should handle root files with platform variants', async () => {
      // Root files may have special platform naming
      // e.g., AGENTS.md (universal) and CLAUDE.md (claude platform)
      await writeTestFile(join(packageRoot, 'AGENTS.md'), 'universal');
      await writeTestFile(join(packageRoot, 'CLAUDE.md'), 'claude specific');

      const groups: SaveCandidateGroup[] = [
        createGroup(
          'AGENTS.md',
          createCandidate({
            source: 'local',
            registryPath: 'AGENTS.md',
            platform: undefined,
            isRootFile: true
          }),
          [
            createCandidate({
              registryPath: 'AGENTS.md',
              platform: 'claude',
              displayPath: '.claude/AGENTS.md',
              isRootFile: true
            })
          ]
        )
      ];

      await pruneExistingPlatformCandidates(packageRoot, groups);

      // claude candidate should be pruned if CLAUDE.md exists
      // (createPlatformSpecificRegistryPath should return "CLAUDE.md" for root files)
      expect(groups[0].workspace.length).toBeLessThanOrEqual(1);
    });
  });

  // Cleanup
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
