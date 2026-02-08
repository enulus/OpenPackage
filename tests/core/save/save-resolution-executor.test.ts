/**
 * Tests for save-resolution-executor
 * 
 * Verifies resolution strategy execution and dispatching logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeResolution } from '../../../src/core/save/save-resolution-executor.js';
import type { SaveCandidate, SaveCandidateGroup } from '../../../src/core/save/save-types.js';
import type { ConflictAnalysis } from '../../../src/core/save/save-conflict-analyzer.js';

// Mock the interactive resolver to avoid actual prompts in tests
vi.mock('../../../src/core/save/save-interactive-resolver.js', () => ({
  resolveInteractively: vi.fn()
}));

import { resolveInteractively } from '../../../src/core/save/save-interactive-resolver.js';
const mockResolveInteractively = vi.mocked(resolveInteractively);

describe('save-resolution-executor', () => {
  const packageRoot = '/package/source';
  
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
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
  
  /**
   * Helper to create a mock ConflictAnalysis
   */
  function createAnalysis(
    overrides: Partial<ConflictAnalysis>
  ): ConflictAnalysis {
    return {
      registryPath: 'tools/search.md',
      type: 'auto-write',
      workspaceCandidateCount: 1,
      uniqueWorkspaceCandidates: [],
      hasLocalCandidate: false,
      localMatchesWorkspace: false,
      isRootFile: false,
      hasPlatformCandidates: false,
      recommendedStrategy: 'write-single',
      ...overrides
    };
  }
  
  describe('executeResolution', () => {
    it('should return null for skip strategy', async () => {
      const candidate = createCandidate({ contentHash: 'hash1' });
      const group = createGroup('tools/search.md', undefined, [candidate]);
      const analysis = createAnalysis({
        recommendedStrategy: 'skip',
        uniqueWorkspaceCandidates: []
      });
      
      const result = await executeResolution(group, analysis, packageRoot);
      
      expect(result).toBeNull();
    });
    
    it('should resolve single candidate with write-single strategy', async () => {
      const candidate = createCandidate({ contentHash: 'hash1' });
      const group = createGroup('tools/search.md', undefined, [candidate]);
      const analysis = createAnalysis({
        recommendedStrategy: 'write-single',
        uniqueWorkspaceCandidates: [candidate]
      });
      
      const result = await executeResolution(group, analysis, packageRoot);
      
      expect(result).not.toBeNull();
      expect(result!.selection).toBe(candidate);
      expect(result!.platformSpecific).toEqual([]);
      expect(result!.strategy).toBe('write-single');
      expect(result!.wasInteractive).toBe(false);
    });
    
    it('should resolve identical candidates with write-newest strategy', async () => {
      const candidate1 = createCandidate({
        contentHash: 'hash1',
        mtime: 1000,
        displayPath: '.cursor/tools/search.md'
      });
      const candidate2 = createCandidate({
        contentHash: 'hash1',
        mtime: 2000,
        displayPath: '.claude/tools/search.md'
      });
      
      const group = createGroup('tools/search.md', undefined, [candidate1, candidate2]);
      const analysis = createAnalysis({
        recommendedStrategy: 'write-newest',
        uniqueWorkspaceCandidates: [candidate1, candidate2]
      });
      
      const result = await executeResolution(group, analysis, packageRoot);
      
      expect(result).not.toBeNull();
      expect(result!.selection).toBe(candidate2); // Newest by mtime
      expect(result!.platformSpecific).toEqual([]);
      expect(result!.strategy).toBe('write-newest');
      expect(result!.wasInteractive).toBe(false);
    });
    
    it('should auto-select newest with force-newest strategy', async () => {
      const candidate1 = createCandidate({
        contentHash: 'hash1',
        mtime: 1000,
        displayPath: '.cursor/tools/search.md'
      });
      const candidate2 = createCandidate({
        contentHash: 'hash2',
        mtime: 2000,
        displayPath: '.claude/tools/search.md'
      });
      
      const group = createGroup('tools/search.md', undefined, [candidate1, candidate2]);
      const analysis = createAnalysis({
        recommendedStrategy: 'force-newest',
        uniqueWorkspaceCandidates: [candidate1, candidate2]
      });
      
      const result = await executeResolution(group, analysis, packageRoot);
      
      expect(result).not.toBeNull();
      expect(result!.selection).toBe(candidate2); // Newest
      expect(result!.platformSpecific).toEqual([]);
      expect(result!.strategy).toBe('force-newest');
      expect(result!.wasInteractive).toBe(false);
    });
    
    it('should handle ties in force mode (alphabetical fallback)', async () => {
      const sameMtime = 1000;
      const candidate1 = createCandidate({
        contentHash: 'hash1',
        mtime: sameMtime,
        displayPath: '.cursor/tools/search.md'
      });
      const candidate2 = createCandidate({
        contentHash: 'hash2',
        mtime: sameMtime,
        displayPath: '.claude/tools/search.md'
      });
      
      const group = createGroup('tools/search.md', undefined, [candidate1, candidate2]);
      const analysis = createAnalysis({
        recommendedStrategy: 'force-newest',
        uniqueWorkspaceCandidates: [candidate1, candidate2]
      });
      
      const result = await executeResolution(group, analysis, packageRoot);
      
      expect(result).not.toBeNull();
      // Should select .claude because it's alphabetically first
      expect(result!.selection).toBe(candidate2);
      expect(result!.strategy).toBe('force-newest');
    });
    
    it('should delegate to interactive resolver for interactive strategy', async () => {
      const candidate1 = createCandidate({
        contentHash: 'hash1',
        displayPath: '.cursor/tools/search.md'
      });
      const candidate2 = createCandidate({
        contentHash: 'hash2',
        displayPath: '.claude/tools/search.md'
      });
      
      const group = createGroup('tools/search.md', undefined, [candidate1, candidate2]);
      const analysis = createAnalysis({
        recommendedStrategy: 'interactive',
        uniqueWorkspaceCandidates: [candidate1, candidate2]
      });
      
      // Mock the interactive resolver
      mockResolveInteractively.mockResolvedValue({
        selectedCandidate: candidate1,
        platformSpecificCandidates: [candidate2]
      });
      
      const result = await executeResolution(group, analysis, packageRoot);
      
      expect(mockResolveInteractively).toHaveBeenCalledWith({
        registryPath: 'tools/search.md',
        workspaceCandidates: expect.any(Array),
        isRootFile: false,
        group,
        packageRoot
      });
      
      expect(result).not.toBeNull();
      expect(result!.selection).toBe(candidate1);
      expect(result!.platformSpecific).toEqual([candidate2]);
      expect(result!.strategy).toBe('interactive');
      expect(result!.wasInteractive).toBe(true);
    });
    
    it('should handle no universal selection in interactive mode', async () => {
      const candidate1 = createCandidate({
        contentHash: 'hash1',
        displayPath: '.cursor/tools/search.md',
        platform: 'cursor'
      });
      const candidate2 = createCandidate({
        contentHash: 'hash2',
        displayPath: '.claude/tools/search.md',
        platform: 'claude'
      });
      
      const group = createGroup('tools/search.md', undefined, [candidate1, candidate2]);
      const analysis = createAnalysis({
        recommendedStrategy: 'interactive',
        uniqueWorkspaceCandidates: [candidate1, candidate2]
      });
      
      // Mock user selecting both as platform-specific
      mockResolveInteractively.mockResolvedValue({
        selectedCandidate: null,
        platformSpecificCandidates: [candidate1, candidate2]
      });
      
      const result = await executeResolution(group, analysis, packageRoot);
      
      expect(result).not.toBeNull();
      expect(result!.selection).toBeNull();
      expect(result!.platformSpecific).toEqual([candidate1, candidate2]);
      expect(result!.wasInteractive).toBe(true);
    });
    
    it('should sort candidates by mtime before dispatching', async () => {
      const candidate1 = createCandidate({
        contentHash: 'hash1',
        mtime: 2000,
        displayPath: '.cursor/tools/search.md'
      });
      const candidate2 = createCandidate({
        contentHash: 'hash2',
        mtime: 1000,
        displayPath: '.claude/tools/search.md'
      });
      
      const group = createGroup('tools/search.md', undefined, [candidate2, candidate1]);
      const analysis = createAnalysis({
        recommendedStrategy: 'interactive',
        uniqueWorkspaceCandidates: [candidate2, candidate1] // Unsorted
      });
      
      mockResolveInteractively.mockResolvedValue({
        selectedCandidate: candidate1,
        platformSpecificCandidates: []
      });
      
      await executeResolution(group, analysis, packageRoot);
      
      // Verify that candidates were passed sorted (newest first)
      const call = mockResolveInteractively.mock.calls[0][0];
      const passedCandidates = call.workspaceCandidates;
      expect(passedCandidates[0]).toBe(candidate1); // Newest (2000)
      expect(passedCandidates[1]).toBe(candidate2); // Older (1000)
    });
  });
});
