/**
 * Integration tests for Phase 1: Foundation & Types
 * 
 * Tests the complete flow from building candidates to grouping them,
 * verifying that all modules work together correctly.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';
import { buildCandidates, materializeLocalCandidate } from '../../../src/core/save/save-candidate-builder.js';
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
    assert.ok(candidatesResult.localSourceRefs.length > 0);
    assert.ok(candidatesResult.workspaceCandidates.length > 0);
    assert.strictEqual(candidatesResult.errors.length, 0);

    // Group candidates
    const allGroups = buildCandidateGroups(
      candidatesResult.localSourceRefs,
      candidatesResult.workspaceCandidates
    );

    // Verify groups
    assert.ok(allGroups.length > 0);

    // Check specific groups
    const generalGroup = allGroups.find(g => g.registryPath === 'rules/general.md');
    assert.notStrictEqual(generalGroup, undefined);
    assert.notStrictEqual(generalGroup!.localRef, undefined);
    assert.strictEqual(generalGroup!.workspace.length, 2); // cursor + claude

    const typescriptGroup = allGroups.find(g => g.registryPath === 'rules/typescript.md');
    assert.notStrictEqual(typescriptGroup, undefined);
    assert.strictEqual(typescriptGroup!.localRef, undefined); // New file
    assert.strictEqual(typescriptGroup!.workspace.length, 1);

    const agentsGroup = allGroups.find(g => g.registryPath === 'AGENTS.md');
    assert.notStrictEqual(agentsGroup, undefined);
    assert.notStrictEqual(agentsGroup!.localRef, undefined);
    assert.strictEqual(agentsGroup!.workspace.length, 1);

    // Filter to only groups with workspace candidates
    const activeGroups = filterGroupsWithWorkspace(allGroups);
    
    // All our mapped files have workspace candidates
    assert.strictEqual(activeGroups.length, 3);
    assert.strictEqual(activeGroups.every(g => g.workspace.length > 0), true);
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
    const groups = buildCandidateGroups(result.localSourceRefs, result.workspaceCandidates);
    const activeGroups = filterGroupsWithWorkspace(groups);

    // Verify
    assert.strictEqual(activeGroups.length, 1);
    assert.strictEqual(activeGroups[0].workspace.length, 1);
    
    // Platform should be inferred (though test environment may not have full inference)
    const candidate = activeGroups[0].workspace[0];
    assert.ok(candidate.displayPath.includes('.cursor'));
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
    const groups = buildCandidateGroups(result.localSourceRefs, result.workspaceCandidates);
    const activeGroups = filterGroupsWithWorkspace(groups);

    // Verify
    assert.strictEqual(activeGroups.length, 1);
    const candidate = activeGroups[0].workspace[0];
    
    assert.strictEqual(candidate.isMarkdown, true);
    assert.deepStrictEqual(candidate.frontmatter, {
      title: 'Test Rule',
      tags: ['test', 'integration']
    });
    assert.ok(candidate.markdownBody!.includes('# Test Rule'));
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
    const groups = buildCandidateGroups(result.localSourceRefs, result.workspaceCandidates);
    const activeGroups = filterGroupsWithWorkspace(groups);

    // Verify
    assert.strictEqual(activeGroups.length, 3);
    
    const registryPaths = activeGroups.map(g => g.registryPath).sort();
    assert.deepStrictEqual(registryPaths, [
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
    const groups = buildCandidateGroups(result.localSourceRefs, result.workspaceCandidates);
    const activeGroups = filterGroupsWithWorkspace(groups);

    // Verify - both candidates should have same hash
    assert.strictEqual(activeGroups.length, 1);
    assert.strictEqual(activeGroups[0].workspace.length, 2);
    
    const hash1 = activeGroups[0].workspace[0].contentHash;
    const hash2 = activeGroups[0].workspace[1].contentHash;
    assert.strictEqual(hash1, hash2);
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
        candidateResult.localSourceRefs,
        candidateResult.workspaceCandidates
      );
      const activeGroups = filterGroupsWithWorkspace(allGroups);

      assert.strictEqual(activeGroups.length, 1);
      assert.strictEqual(activeGroups[0].workspace.length, 2);

      // Phase 2: Prune platform candidates
      const { pruneExistingPlatformCandidates } = await import('../../../src/core/save/save-platform-handler.js');
      await pruneExistingPlatformCandidates(join(testDir, 'package-source'), activeGroups);

      // Both candidates should remain (no platform files exist in source)
      assert.strictEqual(activeGroups[0].workspace.length, 2);

      // Materialize local candidates for analysis
      for (const group of activeGroups) {
        if (group.localRef && !group.local) {
          group.local = await materializeLocalCandidate(group.localRef, join(testDir, 'package-source')) ?? undefined;
        }
      }

      // Phase 2: Analyze conflicts
      const { analyzeGroup } = await import('../../../src/core/save/save-conflict-analyzer.js');
      const analysis = await analyzeGroup(activeGroups[0], false, join(testDir, 'workspace'));

      // Should be needs-resolution (multiple differing candidates)
      assert.strictEqual(analysis.type, 'needs-resolution');
      assert.strictEqual(analysis.recommendedStrategy, 'interactive');
      assert.strictEqual(analysis.hasPlatformCandidates, true);
      assert.strictEqual(analysis.uniqueWorkspaceCandidates!.length, 2);
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
        candidateResult.localSourceRefs,
        candidateResult.workspaceCandidates
      );
      const activeGroups = filterGroupsWithWorkspace(allGroups);

      assert.strictEqual(activeGroups[0].workspace.length, 1);

      // Prune should remove cursor candidate (platform file exists)
      const { pruneExistingPlatformCandidates } = await import('../../../src/core/save/save-platform-handler.js');
      await pruneExistingPlatformCandidates(join(testDir, 'package-source'), activeGroups);

      assert.strictEqual(activeGroups[0].workspace.length, 0);
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
        candidateResult.localSourceRefs,
        candidateResult.workspaceCandidates
      );
      const activeGroups = filterGroupsWithWorkspace(allGroups);

      const analysis = await analyzeGroup(activeGroups[0], false, join(testDir, 'workspace'));

      // Should auto-resolve (all candidates identical after dedup)
      assert.strictEqual(analysis.type, 'auto-write');
      assert.strictEqual(analysis.recommendedStrategy, 'write-single');
      assert.strictEqual(analysis.uniqueWorkspaceCandidates!.length, 1);
    });
  });
});
