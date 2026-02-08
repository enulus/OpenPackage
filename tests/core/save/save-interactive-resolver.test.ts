/**
 * Tests for save-interactive-resolver
 * 
 * Verifies interactive prompting, parity checking, and user action handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveInteractively } from '../../../src/core/save/save-interactive-resolver.js';
import type { 
  InteractiveResolutionInput,
  InteractiveResolutionOutput 
} from '../../../src/core/save/save-interactive-resolver.js';
import type { SaveCandidate, SaveCandidateGroup } from '../../../src/core/save/save-types.js';

// Mock dependencies
vi.mock('../../../src/utils/prompts.js', () => ({
  safePrompts: vi.fn()
}));

vi.mock('../../../src/utils/fs.js', () => ({
  exists: vi.fn(),
  readTextFile: vi.fn()
}));

vi.mock('../../../src/utils/hash-utils.js', () => ({
  calculateFileHash: vi.fn()
}));

import { safePrompts } from '../../../src/utils/prompts.js';
import { exists, readTextFile } from '../../../src/utils/fs.js';
import { calculateFileHash } from '../../../src/utils/hash-utils.js';

const mockSafePrompts = vi.mocked(safePrompts);
const mockExists = vi.mocked(exists);
const mockReadTextFile = vi.mocked(readTextFile);
const mockCalculateFileHash = vi.mocked(calculateFileHash);

describe('save-interactive-resolver', () => {
  const packageRoot = '/package/source';
  
  // Suppress console output during tests
  const originalLog = console.log;
  
  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
    console.log = originalLog;
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
   * Helper to create InteractiveResolutionInput
   */
  function createInput(
    overrides: Partial<InteractiveResolutionInput>
  ): InteractiveResolutionInput {
    return {
      registryPath: 'tools/search.md',
      workspaceCandidates: [],
      isRootFile: false,
      group: createGroup('tools/search.md', undefined, []),
      packageRoot,
      ...overrides
    };
  }
  
  describe('resolveInteractively', () => {
    it('should prompt for universal selection when no universal selected yet', async () => {
      const candidate = createCandidate({
        contentHash: 'hash1',
        displayPath: '.cursor/tools/search.md'
      });
      
      const input = createInput({
        workspaceCandidates: [candidate],
        group: createGroup('tools/search.md', undefined, [candidate])
      });
      
      // Mock user selecting universal
      mockSafePrompts.mockResolvedValue({ action: 'universal' });
      
      const result = await resolveInteractively(input);
      
      expect(mockSafePrompts).toHaveBeenCalledWith({
        type: 'select',
        name: 'action',
        message: expect.stringContaining('.cursor/tools/search.md'),
        choices: [
          { title: 'Set as universal', value: 'universal' },
          { title: 'Mark as platform-specific', value: 'platform-specific' },
          { title: 'Skip', value: 'skip' }
        ],
        hint: 'Arrow keys to navigate, Enter to select'
      });
      
      expect(result.selectedCandidate).toBe(candidate);
      expect(result.platformSpecificCandidates).toEqual([]);
    });
    
    it('should prompt for platform-specific or skip after universal selected', async () => {
      const candidate1 = createCandidate({
        contentHash: 'hash1',
        mtime: 2000,
        displayPath: '.cursor/tools/search.md'
      });
      const candidate2 = createCandidate({
        contentHash: 'hash2',
        mtime: 1000,
        displayPath: '.claude/tools/search.md',
        platform: 'claude'
      });
      
      const input = createInput({
        workspaceCandidates: [candidate1, candidate2],
        group: createGroup('tools/search.md', undefined, [candidate1, candidate2])
      });
      
      // Mock user selections: first as universal, second as platform-specific
      mockSafePrompts
        .mockResolvedValueOnce({ action: 'universal' })
        .mockResolvedValueOnce({ action: 'platform-specific' });
      
      const result = await resolveInteractively(input);
      
      // Second prompt should have only platform-specific and skip options
      expect(mockSafePrompts).toHaveBeenNthCalledWith(2, {
        type: 'select',
        name: 'action',
        message: expect.any(String),
        choices: [
          { title: 'Mark as platform-specific', value: 'platform-specific' },
          { title: 'Skip', value: 'skip' }
        ],
        hint: 'Arrow keys to navigate, Enter to select'
      });
      
      expect(result.selectedCandidate).toBe(candidate1);
      expect(result.platformSpecificCandidates).toEqual([candidate2]);
    });
    
    it('should auto-skip candidates at parity with universal source', async () => {
      const localCandidate = createCandidate({
        source: 'local',
        contentHash: 'same-hash',
        platform: undefined
      });
      const workspaceCandidate = createCandidate({
        source: 'workspace',
        contentHash: 'same-hash',
        displayPath: '.cursor/tools/search.md'
      });
      
      const input = createInput({
        workspaceCandidates: [workspaceCandidate],
        group: createGroup('tools/search.md', localCandidate, [workspaceCandidate])
      });
      
      const result = await resolveInteractively(input);
      
      // Should not prompt (auto-skip due to parity)
      expect(mockSafePrompts).not.toHaveBeenCalled();
      expect(result.selectedCandidate).toBeNull();
      expect(result.platformSpecificCandidates).toEqual([]);
    });
    
    it('should auto-skip candidates at parity with platform-specific source', async () => {
      const workspaceCandidate = createCandidate({
        source: 'workspace',
        contentHash: 'platform-hash',
        displayPath: '.cursor/tools/search.md',
        platform: 'cursor'
      });
      
      const input = createInput({
        workspaceCandidates: [workspaceCandidate],
        group: createGroup('tools/search.md', undefined, [workspaceCandidate])
      });
      
      // Mock platform file exists and matches
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockResolvedValue('platform content');
      mockCalculateFileHash.mockResolvedValue('platform-hash');
      
      const result = await resolveInteractively(input);
      
      // Should not prompt (auto-skip due to platform parity)
      expect(mockSafePrompts).not.toHaveBeenCalled();
      expect(mockExists).toHaveBeenCalled();
      expect(result.selectedCandidate).toBeNull();
      expect(result.platformSpecificCandidates).toEqual([]);
    });
    
    it('should auto-skip candidates identical to selected universal', async () => {
      const candidate1 = createCandidate({
        contentHash: 'same-hash',
        mtime: 2000,
        displayPath: '.cursor/tools/search.md'
      });
      const candidate2 = createCandidate({
        contentHash: 'same-hash', // Identical
        mtime: 1000,
        displayPath: '.claude/tools/search.md'
      });
      
      const input = createInput({
        workspaceCandidates: [candidate1, candidate2],
        group: createGroup('tools/search.md', undefined, [candidate1, candidate2])
      });
      
      // Mock user selecting first as universal
      mockSafePrompts.mockResolvedValueOnce({ action: 'universal' });
      
      const result = await resolveInteractively(input);
      
      // Should only prompt once (second auto-skipped)
      expect(mockSafePrompts).toHaveBeenCalledTimes(1);
      expect(result.selectedCandidate).toBe(candidate1);
      expect(result.platformSpecificCandidates).toEqual([]);
    });
    
    it('should handle user skipping all candidates', async () => {
      const candidate1 = createCandidate({
        contentHash: 'hash1',
        displayPath: '.cursor/tools/search.md'
      });
      const candidate2 = createCandidate({
        contentHash: 'hash2',
        displayPath: '.claude/tools/search.md'
      });
      
      const input = createInput({
        workspaceCandidates: [candidate1, candidate2],
        group: createGroup('tools/search.md', undefined, [candidate1, candidate2])
      });
      
      // Mock user skipping both
      mockSafePrompts
        .mockResolvedValueOnce({ action: 'skip' })
        .mockResolvedValueOnce({ action: 'skip' });
      
      const result = await resolveInteractively(input);
      
      expect(result.selectedCandidate).toBeNull();
      expect(result.platformSpecificCandidates).toEqual([]);
    });
    
    it('should handle all platform-specific selections (no universal)', async () => {
      const candidate1 = createCandidate({
        contentHash: 'hash1',
        mtime: 2000,
        displayPath: '.cursor/tools/search.md',
        platform: 'cursor'
      });
      const candidate2 = createCandidate({
        contentHash: 'hash2',
        mtime: 1000,
        displayPath: '.claude/tools/search.md',
        platform: 'claude'
      });
      
      const input = createInput({
        workspaceCandidates: [candidate1, candidate2],
        group: createGroup('tools/search.md', undefined, [candidate1, candidate2])
      });
      
      // Mock user marking both as platform-specific
      mockSafePrompts
        .mockResolvedValueOnce({ action: 'platform-specific' })
        .mockResolvedValueOnce({ action: 'platform-specific' });
      
      const result = await resolveInteractively(input);
      
      expect(result.selectedCandidate).toBeNull();
      // Should be in order they were prompted (sorted by mtime, newest first)
      expect(result.platformSpecificCandidates).toEqual([candidate1, candidate2]);
    });
    
    it('should sort candidates by mtime before presenting', async () => {
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
      
      const input = createInput({
        workspaceCandidates: [candidate1, candidate2], // Not sorted
        group: createGroup('tools/search.md', undefined, [candidate1, candidate2])
      });
      
      mockSafePrompts
        .mockResolvedValueOnce({ action: 'skip' })
        .mockResolvedValueOnce({ action: 'skip' });
      
      await resolveInteractively(input);
      
      // First prompt should be for newest (candidate2)
      expect(mockSafePrompts).toHaveBeenNthCalledWith(1, expect.objectContaining({
        message: expect.stringContaining('.claude/tools/search.md')
      }));
      
      // Second prompt should be for older (candidate1)
      expect(mockSafePrompts).toHaveBeenNthCalledWith(2, expect.objectContaining({
        message: expect.stringContaining('.cursor/tools/search.md')
      }));
    });
    
    it('should handle platform file read errors gracefully', async () => {
      const workspaceCandidate = createCandidate({
        source: 'workspace',
        contentHash: 'workspace-hash',
        displayPath: '.cursor/tools/search.md',
        platform: 'cursor'
      });
      
      const input = createInput({
        workspaceCandidates: [workspaceCandidate],
        group: createGroup('tools/search.md', undefined, [workspaceCandidate])
      });
      
      // Mock platform file exists but read fails
      mockExists.mockResolvedValue(true);
      mockReadTextFile.mockRejectedValue(new Error('Read error'));
      
      // User should be prompted (not at parity due to error)
      mockSafePrompts.mockResolvedValue({ action: 'skip' });
      
      const result = await resolveInteractively(input);
      
      // Should prompt user (error treated as not at parity)
      expect(mockSafePrompts).toHaveBeenCalled();
      expect(result.selectedCandidate).toBeNull();
    });
    
    it('should include timestamps in candidate labels', async () => {
      const mtime = 1704556800000; // 2024-01-06 12:00:00
      const candidate = createCandidate({
        contentHash: 'hash1',
        mtime,
        displayPath: '.cursor/tools/search.md',
        platform: 'cursor'
      });
      
      const input = createInput({
        workspaceCandidates: [candidate],
        group: createGroup('tools/search.md', undefined, [candidate])
      });
      
      mockSafePrompts.mockResolvedValue({ action: 'skip' });
      
      await resolveInteractively(input);
      
      // Message should contain formatted timestamp
      expect(mockSafePrompts).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringMatching(/\[.*\]/) // Contains timestamp in brackets
        })
      );
    });
  });
});
