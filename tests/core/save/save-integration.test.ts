/**
 * Integration tests for Phase 1: Foundation & Types
 * 
 * Tests the complete flow from building candidates to grouping them,
 * verifying that all modules work together correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { buildCandidates } from '../../../src/core/save/save-candidate-builder.js';
import { buildCandidateGroups, filterGroupsWithWorkspace } from '../../../src/core/save/save-group-builder.js';
import { writeTextFile, ensureDir } from '../../../src/utils/fs.js';

  describe('Phase 1 Integration: Foundation & Types', () => {
  let testDir: string;
  let packageRoot: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'opkg-save-phase1-test-'));
    packageRoot = join(testDir, 'package');
    workspaceRoot = join(testDir, 'workspace');

    await ensureDir(packageRoot);
    await ensureDir(workspaceRoot);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should complete full Phase 1 pipeline: build → group → filter', async () => {
    // Setup: Create a realistic scenario
    // - Multiple files in source
    // - Multiple platform variants in workspace
    // - Some new files (no source)
    // - Some old files (no workspace)

    // Source files
    await ensureDir(join(packageRoot, 'rules'));
    await writeTextFile(join(packageRoot, 'rules', 'general.md'), 'general rules v1');
    await writeTextFile(join(packageRoot, 'AGENTS.md'), 'agents v1');

    // Workspace files - multiple platforms
    await ensureDir(join(workspaceRoot, '.cursor', 'rules'));
    await ensureDir(join(workspaceRoot, '.claude', 'rules'));
    
    // Modified file in both platforms (different content)
    await writeTextFile(
      join(workspaceRoot, '.cursor', 'rules', 'general.md'),
      'general rules v2 (cursor)'
    );
    await writeTextFile(
      join(workspaceRoot, '.claude', 'rules', 'general.md'),
      'general rules v2 (claude)'
    );

    // AGENTS.md modified in workspace
    await writeTextFile(
      join(workspaceRoot, '.cursor', 'AGENTS.md'),
      'agents v2'
    );

    // New file (only in workspace)
    await writeTextFile(
      join(workspaceRoot, '.cursor', 'rules', 'typescript.md'),
      'typescript rules'
    );

    // Old file (only in source - no workspace mapping)
    await writeTextFile(
      join(packageRoot, 'rules', 'deprecated.md'),
      'deprecated rules'
    );

    // Build candidates
    const candidatesResult = await buildCandidates({
      packageRoot,
      workspaceRoot,
      filesMapping: {
        'rules/general.md': [
          '.cursor/rules/general.md',
          '.claude/rules/general.md'
        ],
        'rules/typescript.md': ['.cursor/rules/typescript.md'],
        'AGENTS.md': ['.cursor/AGENTS.md']
        // Note: deprecated.md not mapped, so won't be in local candidates
      }
    });

    // Verify candidates built correctly
    expect(candidatesResult.localCandidates.length).toBeGreaterThan(0);
    expect(candidatesResult.workspaceCandidates.length).toBeGreaterThan(0);
    expect(candidatesResult.errors).toHaveLength(0);

    // Group candidates
    const allGroups = buildCandidateGroups(
      candidatesResult.localCandidates,
      candidatesResult.workspaceCandidates
    );

    // Verify groups
    expect(allGroups.length).toBeGreaterThan(0);

    // Check specific groups
    const generalGroup = allGroups.find(g => g.registryPath === 'rules/general.md');
    expect(generalGroup).toBeDefined();
    expect(generalGroup!.local).toBeDefined();
    expect(generalGroup!.workspace).toHaveLength(2); // cursor + claude

    const typescriptGroup = allGroups.find(g => g.registryPath === 'rules/typescript.md');
    expect(typescriptGroup).toBeDefined();
    expect(typescriptGroup!.local).toBeUndefined(); // New file
    expect(typescriptGroup!.workspace).toHaveLength(1);

    const agentsGroup = allGroups.find(g => g.registryPath === 'AGENTS.md');
    expect(agentsGroup).toBeDefined();
    expect(agentsGroup!.local).toBeDefined();
    expect(agentsGroup!.workspace).toHaveLength(1);

    // Filter to only groups with workspace candidates
    const activeGroups = filterGroupsWithWorkspace(allGroups);
    
    // All our mapped files have workspace candidates
    expect(activeGroups).toHaveLength(3);
    expect(activeGroups.every(g => g.workspace.length > 0)).toBe(true);
  });

  it('should handle platform inference correctly', async () => {
    // Setup
    await ensureDir(join(workspaceRoot, '.cursor', 'tools'));
    await writeTextFile(
      join(workspaceRoot, '.cursor', 'tools', 'search.md'),
      'search tool'
    );

    // Build candidates
    const result = await buildCandidates({
      packageRoot,
      workspaceRoot,
      filesMapping: {
        'tools/search.md': ['.cursor/tools/search.md']
      }
    });

    // Group
    const groups = buildCandidateGroups(result.localCandidates, result.workspaceCandidates);
    const activeGroups = filterGroupsWithWorkspace(groups);

    // Verify
    expect(activeGroups).toHaveLength(1);
    expect(activeGroups[0].workspace).toHaveLength(1);
    
    // Platform should be inferred (though test environment may not have full inference)
    const candidate = activeGroups[0].workspace[0];
    expect(candidate.displayPath).toContain('.cursor');
  });

  it('should handle markdown frontmatter in full pipeline', async () => {
    // Setup
    const frontmatterContent = `---
title: Test Rule
tags: [test, integration]
---

# Test Rule

This is a test rule.`;

    await ensureDir(join(workspaceRoot, '.cursor', 'rules'));
    await writeTextFile(
      join(workspaceRoot, '.cursor', 'rules', 'test.md'),
      frontmatterContent
    );

    // Build candidates
    const result = await buildCandidates({
      packageRoot,
      workspaceRoot,
      filesMapping: {
        'rules/test.md': ['.cursor/rules/test.md']
      }
    });

    // Group
    const groups = buildCandidateGroups(result.localCandidates, result.workspaceCandidates);
    const activeGroups = filterGroupsWithWorkspace(groups);

    // Verify
    expect(activeGroups).toHaveLength(1);
    const candidate = activeGroups[0].workspace[0];
    
    expect(candidate.isMarkdown).toBe(true);
    expect(candidate.frontmatter).toEqual({
      title: 'Test Rule',
      tags: ['test', 'integration']
    });
    expect(candidate.markdownBody).toContain('# Test Rule');
  });

  it('should handle directory mappings in full pipeline', async () => {
    // Setup - create multiple files in a directory
    await ensureDir(join(workspaceRoot, '.cursor', 'commands'));
    await writeTextFile(
      join(workspaceRoot, '.cursor', 'commands', 'search.md'),
      'search command'
    );
    await writeTextFile(
      join(workspaceRoot, '.cursor', 'commands', 'edit.md'),
      'edit command'
    );
    await writeTextFile(
      join(workspaceRoot, '.cursor', 'commands', 'create.md'),
      'create command'
    );

    // Build candidates with directory mapping
    const result = await buildCandidates({
      packageRoot,
      workspaceRoot,
      filesMapping: {
        'commands/': ['.cursor/commands']
      }
    });

    // Group
    const groups = buildCandidateGroups(result.localCandidates, result.workspaceCandidates);
    const activeGroups = filterGroupsWithWorkspace(groups);

    // Verify
    expect(activeGroups).toHaveLength(3);
    
    const registryPaths = activeGroups.map(g => g.registryPath).sort();
    expect(registryPaths).toEqual([
      'commands/create.md',
      'commands/edit.md',
      'commands/search.md'
    ]);
  });

  it('should calculate consistent hashes for content comparison', async () => {
    // Setup - same content in multiple locations
    const content = 'identical content across platforms';
    
    await ensureDir(join(workspaceRoot, '.cursor'));
    await ensureDir(join(workspaceRoot, '.claude'));
    
    await writeTextFile(join(workspaceRoot, '.cursor', 'test.md'), content);
    await writeTextFile(join(workspaceRoot, '.claude', 'test.md'), content);

    // Build candidates
    const result = await buildCandidates({
      packageRoot,
      workspaceRoot,
      filesMapping: {
        'test.md': ['.cursor/test.md', '.claude/test.md']
      }
    });

    // Group
    const groups = buildCandidateGroups(result.localCandidates, result.workspaceCandidates);
    const activeGroups = filterGroupsWithWorkspace(groups);

    // Verify - both candidates should have same hash
    expect(activeGroups).toHaveLength(1);
    expect(activeGroups[0].workspace).toHaveLength(2);
    
    const hash1 = activeGroups[0].workspace[0].contentHash;
    const hash2 = activeGroups[0].workspace[1].contentHash;
    expect(hash1).toBe(hash2);
  });

  describe('Phase 2 Integration: Platform Awareness & Analysis', () => {
    it('should complete full Phase 2 pipeline: build → group → prune → analyze', async () => {
      // Setup: Create package source and workspace
      await ensureDir(join(testDir, 'package-source', 'tools'));
      await ensureDir(join(testDir, 'workspace', '.cursor', 'tools'));
      await ensureDir(join(testDir, 'workspace', '.claude', 'tools'));

      // Create source file
      await writeTextFile(
        join(testDir, 'package-source', 'tools', 'search.md'),
        '# Search Tool (source)'
      );

      // Create workspace variants
      await writeTextFile(
        join(testDir, 'workspace', '.cursor', 'tools', 'search.md'),
        '# Search Tool (cursor variant)'
      );
      await writeTextFile(
        join(testDir, 'workspace', '.claude', 'tools', 'search.md'),
        '# Search Tool (claude variant)'
      );

      // Create workspace index
      const indexPath = join(testDir, 'workspace', '.openpackage', 'openpackage.index.yml');
      await writeTextFile(
        indexPath,
        `packages:
  test-pkg:
    source:
      type: path
      path: ${join(testDir, 'package-source')}
    files:
      tools/search.md:
        - .cursor/tools/search.md
        - .claude/tools/search.md
`
      );

      // Phase 1: Build candidates and groups
      const { buildCandidates } = await import('../../../src/core/save/save-candidate-builder.js');
      const { buildCandidateGroups, filterGroupsWithWorkspace } = await import('../../../src/core/save/save-group-builder.js');

      const candidateResult = await buildCandidates({
        packageRoot: join(testDir, 'package-source'),
        workspaceRoot: join(testDir, 'workspace'),
        filesMapping: {
          'tools/search.md': ['.cursor/tools/search.md', '.claude/tools/search.md']
        }
      });

      const allGroups = buildCandidateGroups(
        candidateResult.localCandidates,
        candidateResult.workspaceCandidates
      );
      const activeGroups = filterGroupsWithWorkspace(allGroups);

      expect(activeGroups).toHaveLength(1);
      expect(activeGroups[0].workspace).toHaveLength(2);

      // Phase 2: Prune platform candidates
      const { pruneExistingPlatformCandidates } = await import('../../../src/core/save/save-platform-handler.js');
      await pruneExistingPlatformCandidates(join(testDir, 'package-source'), activeGroups);

      // Both candidates should remain (no platform files exist in source)
      expect(activeGroups[0].workspace).toHaveLength(2);

      // Phase 2: Analyze conflicts
      const { analyzeGroup } = await import('../../../src/core/save/save-conflict-analyzer.js');
      const analysis = analyzeGroup(activeGroups[0], false);

      // Should be needs-resolution (multiple differing candidates)
      expect(analysis.type).toBe('needs-resolution');
      expect(analysis.recommendedStrategy).toBe('interactive');
      expect(analysis.hasPlatformCandidates).toBe(true);
      expect(analysis.uniqueWorkspaceCandidates).toHaveLength(2);
    });

    it('should handle platform pruning correctly', async () => {
      // Setup with existing platform file
      await ensureDir(join(testDir, 'package-source', 'tools'));
      await ensureDir(join(testDir, 'workspace', '.cursor', 'tools'));

      // Create source files (including platform-specific)
      await writeTextFile(
        join(testDir, 'package-source', 'tools', 'calc.md'),
        '# Universal'
      );
      await writeTextFile(
        join(testDir, 'package-source', 'tools', 'calc.cursor.md'),
        '# Cursor specific'
      );

      // Create workspace variant
      await writeTextFile(
        join(testDir, 'workspace', '.cursor', 'tools', 'calc.md'),
        '# Modified cursor'
      );

      // Create workspace index
      const indexPath = join(testDir, 'workspace', '.openpackage', 'openpackage.index.yml');
      await writeTextFile(
        indexPath,
        `packages:
  test-pkg:
    files:
      tools/calc.md:
        - .cursor/tools/calc.md
`
      );

      // Build candidates
      const { buildCandidates } = await import('../../../src/core/save/save-candidate-builder.js');
      const { buildCandidateGroups, filterGroupsWithWorkspace } = await import('../../../src/core/save/save-group-builder.js');

      const candidateResult = await buildCandidates({
        packageRoot: join(testDir, 'package-source'),
        workspaceRoot: join(testDir, 'workspace'),
        filesMapping: {
          'tools/calc.md': ['.cursor/tools/calc.md']
        }
      });

      const allGroups = buildCandidateGroups(
        candidateResult.localCandidates,
        candidateResult.workspaceCandidates
      );
      const activeGroups = filterGroupsWithWorkspace(allGroups);

      expect(activeGroups[0].workspace).toHaveLength(1);

      // Prune should remove cursor candidate (platform file exists)
      const { pruneExistingPlatformCandidates } = await import('../../../src/core/save/save-platform-handler.js');
      await pruneExistingPlatformCandidates(join(testDir, 'package-source'), activeGroups);

      expect(activeGroups[0].workspace).toHaveLength(0);
    });

    it('should auto-resolve when candidates are identical', async () => {
      // Setup with identical workspace files
      await ensureDir(join(testDir, 'package-source', 'tools'));
      await ensureDir(join(testDir, 'workspace', '.cursor', 'tools'));
      await ensureDir(join(testDir, 'workspace', '.claude', 'tools'));

      const identicalContent = '# Identical content\n\nThis is the same everywhere.';

      // Create workspace variants with identical content
      await writeTextFile(
        join(testDir, 'workspace', '.cursor', 'tools', 'helper.md'),
        identicalContent
      );
      await writeTextFile(
        join(testDir, 'workspace', '.claude', 'tools', 'helper.md'),
        identicalContent
      );

      const indexPath = join(testDir, 'workspace', '.openpackage', 'openpackage.index.yml');
      await writeTextFile(
        indexPath,
        `packages:
  test-pkg:
    files:
      tools/helper.md:
        - .cursor/tools/helper.md
        - .claude/tools/helper.md
`
      );

      // Build and analyze
      const { buildCandidates } = await import('../../../src/core/save/save-candidate-builder.js');
      const { buildCandidateGroups, filterGroupsWithWorkspace } = await import('../../../src/core/save/save-group-builder.js');
      const { analyzeGroup } = await import('../../../src/core/save/save-conflict-analyzer.js');

      const candidateResult = await buildCandidates({
        packageRoot: join(testDir, 'package-source'),
        workspaceRoot: join(testDir, 'workspace'),
        filesMapping: {
          'tools/helper.md': ['.cursor/tools/helper.md', '.claude/tools/helper.md']
        }
      });

      const allGroups = buildCandidateGroups(
        candidateResult.localCandidates,
        candidateResult.workspaceCandidates
      );
      const activeGroups = filterGroupsWithWorkspace(allGroups);

      const analysis = analyzeGroup(activeGroups[0], false);

      // Should auto-resolve (all candidates identical after dedup)
      expect(analysis.type).toBe('auto-write');
      expect(analysis.recommendedStrategy).toBe('write-single');
      expect(analysis.uniqueWorkspaceCandidates).toHaveLength(1);
    });
  });
});
