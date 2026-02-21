/**
 * Integration test for save operation with merged files
 * 
 * Verifies that after installing a package with merged files,
 * running save immediately should detect no conflicts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { ensureDir, writeTextFile, exists, readTextFile } from '../../../src/utils/fs.js';
import { buildCandidates, materializeLocalCandidate } from '../../../src/core/save/save-candidate-builder.js';
import { buildCandidateGroups } from '../../../src/core/save/save-group-builder.js';
import { analyzeGroup } from '../../../src/core/save/save-conflict-analyzer.js';
import type { WorkspaceIndexFileMapping } from '../../../src/types/workspace-index.js';

describe('save-merged-file-parity', () => {
  it('should detect no conflicts for freshly installed merged file', async () => {
    let tempDir: string | null = null;
    
    try {
      // Setup: Create temp directories
      tempDir = await mkdtemp(join(tmpdir(), 'opkg-save-merge-test-'));
      const packageRoot = join(tempDir, 'package');
      const workspaceRoot = join(tempDir, 'workspace');
      
      await ensureDir(packageRoot);
      await ensureDir(workspaceRoot);
      await ensureDir(join(workspaceRoot, '.opencode'));
      
      // Create source package file (mcp.json) with just github config
      // Must match the format that extractPackageContribution will produce
      const sourceContent = JSON.stringify({
        mcp: {
          github: {
            type: 'http',
            url: 'https://api.githubcopilot.com/mcp/',
            headers: {
              Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}'
            }
          }
        }
      }, null, 2) + '\n';  // Add trailing newline to match extraction format
      
      await writeTextFile(join(packageRoot, 'mcp.json'), sourceContent);
      
      // Simulate merged workspace file (has both existing and github)
      const mergedContent = JSON.stringify({
        mcp: {
          existing: {
            type: 'http',
            url: 'https://api.example.com/mcp/',
            headers: {
              Authorization: 'Bearer ${EXAMPLE_PERSONAL_ACCESS_TOKEN}'
            }
          },
          github: {
            type: 'http',
            url: 'https://api.githubcopilot.com/mcp/',
            headers: {
              Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}'
            }
          }
        }
      }, null, 2);
      
      await writeTextFile(join(workspaceRoot, '.opencode', 'opencode.json'), mergedContent);
      
      // Create file mapping with merge metadata
      const filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]> = {
        'mcp.json': [
          {
            target: '.opencode/opencode.json',
            merge: 'deep',
            keys: ['mcp.github']
          }
        ]
      };
      
      // Build candidates
      const candidateResult = await buildCandidates({
        packageRoot,
        workspaceRoot,
        filesMapping
      });
      
      assert.strictEqual(candidateResult.errors.length, 0);
      assert.strictEqual(candidateResult.localSourceRefs.length, 1);
      assert.strictEqual(candidateResult.workspaceCandidates.length, 1);
      
      // Verify merge metadata was extracted
      const workspaceCandidate = candidateResult.workspaceCandidates[0];
      assert.strictEqual(workspaceCandidate.mergeStrategy, 'deep');
      assert.deepStrictEqual(workspaceCandidate.mergeKeys, ['mcp.github']);
      
      // Build groups
      const groups = buildCandidateGroups(
        candidateResult.localSourceRefs,
        candidateResult.workspaceCandidates,
        workspaceRoot
      );
      
      assert.strictEqual(groups.length, 1);
      const group = groups[0];
      assert.strictEqual(group.registryPath, 'mcp.json');
      assert.notStrictEqual(group.localRef, undefined);
      assert.strictEqual(group.workspace.length, 1);
      
      // Materialize local candidate for analysis
      if (group.localRef) {
        group.local = await materializeLocalCandidate(group.localRef, packageRoot) ?? undefined;
      }
      
      // Analyze group - should detect no change needed
      const analysis = await analyzeGroup(group, false, workspaceRoot);
      
      // The key assertion: Should detect no change needed because
      // the extracted package contribution matches the source
      assert.strictEqual(analysis.type, 'no-change-needed');
      assert.strictEqual(analysis.localMatchesWorkspace, true);
      assert.strictEqual(analysis.recommendedStrategy, 'skip');
      
    } finally {
      // Cleanup
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('should detect conflicts when merged file has been modified', async () => {
    let tempDir: string | null = null;
    
    try {
      // Setup
      tempDir = await mkdtemp(join(tmpdir(), 'opkg-save-merge-test-'));
      const packageRoot = join(tempDir, 'package');
      const workspaceRoot = join(tempDir, 'workspace');
      
      await ensureDir(packageRoot);
      await ensureDir(workspaceRoot);
      await ensureDir(join(workspaceRoot, '.opencode'));
      
      // Create source package file
      const sourceContent = JSON.stringify({
        mcp: {
          github: {
            type: 'http',
            url: 'https://api.githubcopilot.com/mcp/'
          }
        }
      }, null, 2);
      
      await writeTextFile(join(packageRoot, 'mcp.json'), sourceContent);
      
      // Create merged workspace file with MODIFIED github config
      const mergedContent = JSON.stringify({
        mcp: {
          existing: {
            type: 'http',
            url: 'https://api.example.com/mcp/'
          },
          github: {
            type: 'http',
            url: 'https://MODIFIED.githubcopilot.com/mcp/',  // Changed!
            newField: 'added'  // Added!
          }
        }
      }, null, 2);
      
      await writeTextFile(join(workspaceRoot, '.opencode', 'opencode.json'), mergedContent);
      
      // Create file mapping with merge metadata
      const filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]> = {
        'mcp.json': [
          {
            target: '.opencode/opencode.json',
            merge: 'deep',
            keys: ['mcp.github']
          }
        ]
      };
      
      // Build candidates
      const candidateResult = await buildCandidates({
        packageRoot,
        workspaceRoot,
        filesMapping
      });
      
      // Build groups
      const groups = buildCandidateGroups(
        candidateResult.localSourceRefs,
        candidateResult.workspaceCandidates,
        workspaceRoot
      );
      
      const group = groups[0];
      
      // Materialize local candidate for analysis
      if (group.localRef) {
        group.local = await materializeLocalCandidate(group.localRef, packageRoot) ?? undefined;
      }
      
      // Analyze group - should detect change
      const analysis = await analyzeGroup(group, false, workspaceRoot);
      
      // Should detect that workspace has changes (auto-write single candidate)
      assert.strictEqual(analysis.type, 'auto-write');
      assert.strictEqual(analysis.localMatchesWorkspace, false);
      assert.strictEqual(analysis.recommendedStrategy, 'write-single');
      
    } finally {
      // Cleanup
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  });

  it('should handle multiple merged keys correctly', async () => {
    let tempDir: string | null = null;
    
    try {
      // Setup
      tempDir = await mkdtemp(join(tmpdir(), 'opkg-save-merge-test-'));
      const packageRoot = join(tempDir, 'package');
      const workspaceRoot = join(tempDir, 'workspace');
      
      await ensureDir(packageRoot);
      await ensureDir(workspaceRoot);
      await ensureDir(join(workspaceRoot, '.opencode'));
      
      // Create source with multiple keys
      const sourceContent = JSON.stringify({
        mcp: {
          github: { url: 'https://github.com' },
          gitlab: { url: 'https://gitlab.com' }
        }
      }, null, 2) + '\n';  // Add trailing newline to match extraction format
      
      await writeTextFile(join(packageRoot, 'mcp.json'), sourceContent);
      
      // Create merged workspace file
      const mergedContent = JSON.stringify({
        mcp: {
          existing: { url: 'https://example.com' },
          github: { url: 'https://github.com' },
          gitlab: { url: 'https://gitlab.com' }
        }
      }, null, 2);
      
      await writeTextFile(join(workspaceRoot, '.opencode', 'opencode.json'), mergedContent);
      
      // Create file mapping with multiple merge keys
      const filesMapping: Record<string, (string | WorkspaceIndexFileMapping)[]> = {
        'mcp.json': [
          {
            target: '.opencode/opencode.json',
            merge: 'deep',
            keys: ['mcp.github', 'mcp.gitlab']
          }
        ]
      };
      
      // Build candidates
      const candidateResult = await buildCandidates({
        packageRoot,
        workspaceRoot,
        filesMapping
      });
      
      // Build groups and analyze
      const groups = buildCandidateGroups(
        candidateResult.localSourceRefs,
        candidateResult.workspaceCandidates,
        workspaceRoot
      );
      
      // Materialize local candidate for analysis
      const group = groups[0];
      if (group.localRef) {
        group.local = await materializeLocalCandidate(group.localRef, packageRoot) ?? undefined;
      }
      
      const analysis = await analyzeGroup(group, false, workspaceRoot);
      
      // Should detect no change - both keys match
      assert.strictEqual(analysis.type, 'no-change-needed');
      assert.strictEqual(analysis.localMatchesWorkspace, true);
      
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  });
});
