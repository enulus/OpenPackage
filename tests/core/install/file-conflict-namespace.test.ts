/**
 * File-Level Conflict Resolver — Namespace Tests
 *
 * Tests for the namespace-based conflict resolution system introduced to
 * replace the old keep-both (.local suffix) approach.
 *
 * Covers:
 *  - generateNamespacedPath(): namespace insertion point derivation
 *  - namespaceFlowToPattern(): flow `to` pattern rewriting
 *  - resolveConflictsForTargets(): two-pass bulk namespacing logic
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  generateNamespacedPath,
  namespaceFlowToPattern,
  resolveConflictsForTargets,
  buildOwnershipContext,
  type TargetEntry,
} from '../../../packages/core/src/core/install/conflicts/file-conflict-resolver.js';
import type { InstallOptions } from '../../../packages/core/src/types/index.js';

// ============================================================================
// generateNamespacedPath — pure function, no I/O
// ============================================================================

describe('generateNamespacedPath', () => {
  it('inserts namespace after base dir of a ** glob pattern', () => {
    assert.equal(
      generateNamespacedPath('rules/git/commits.md', 'acme', 'rules/**/*.md'),
      'rules/acme/git/commits.md'
    );
  });

  it('inserts namespace after base dir of a cursor-prefixed ** glob', () => {
    assert.equal(
      generateNamespacedPath('.cursor/rules/my-rule.mdc', 'corp', '.cursor/rules/**'),
      '.cursor/rules/corp/my-rule.mdc'
    );
  });

  it('inserts namespace after base dir of a single-level * glob', () => {
    assert.equal(
      generateNamespacedPath('agents/helper.md', 'my-pkg', 'agents/*'),
      'agents/my-pkg/helper.md'
    );
  });

  it('handles a literal (no-glob) pattern', () => {
    assert.equal(
      generateNamespacedPath('rules/foo.mdc', 'acme', 'rules/foo.mdc'),
      'rules/acme/foo.mdc'
    );
  });

  it('falls back to inserting after first segment when flowToPattern is undefined', () => {
    assert.equal(
      generateNamespacedPath('rules/foo.mdc', 'acme', undefined),
      'rules/acme/foo.mdc'
    );
  });

  it('handles a single-segment path with no parent dir', () => {
    const result = generateNamespacedPath('foo.mdc', 'acme', undefined);
    assert.equal(result, 'acme/foo.mdc');
  });

  it('preserves deep sub-paths after namespace insertion', () => {
    assert.equal(
      generateNamespacedPath('rules/a/b/c.md', 'pkg', 'rules/**'),
      'rules/pkg/a/b/c.md'
    );
  });
});

// ============================================================================
// namespaceFlowToPattern — pure function, no I/O
// ============================================================================

describe('namespaceFlowToPattern', () => {
  it('rewrites a ** glob pattern', () => {
    assert.equal(
      namespaceFlowToPattern('rules/**/*.md', 'acme'),
      'rules/acme/**/*.md'
    );
  });

  it('rewrites a single-level * glob pattern', () => {
    assert.equal(
      namespaceFlowToPattern('agents/*', 'my-pkg'),
      'agents/my-pkg/*'
    );
  });

  it('rewrites a cursor-prefixed ** pattern', () => {
    assert.equal(
      namespaceFlowToPattern('.cursor/rules/**', 'corp'),
      '.cursor/rules/corp/**'
    );
  });

  it('rewrites a literal path (no glob)', () => {
    assert.equal(
      namespaceFlowToPattern('.cursor/rules/foo.mdc', 'pkg'),
      '.cursor/rules/pkg/foo.mdc'
    );
  });

  it('handles a root-level * glob with no base dir', () => {
    const result = namespaceFlowToPattern('*.md', 'pkg');
    assert.equal(result, 'pkg/*.md');
  });
});

// ============================================================================
// resolveConflictsForTargets — integration (uses tmp filesystem)
// ============================================================================

let tmpDir: string;

before(async () => {
  tmpDir = join(tmpdir(), `opkg-conflict-ns-test-${Date.now()}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/** Write a file relative to tmpDir */
async function write(rel: string, content: string): Promise<void> {
  const abs = join(tmpDir, rel);
  await fs.mkdir(join(abs, '..'), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

/** Check whether a path exists relative to tmpDir */
async function pathExists(rel: string): Promise<boolean> {
  try { await fs.access(join(tmpDir, rel)); return true; } catch { return false; }
}

describe('resolveConflictsForTargets — namespace strategy', () => {
  it('no conflict: targets pass through unchanged', async () => {
    const testDir = join(tmpDir, 'no-conflict');
    await fs.mkdir(testDir, { recursive: true });

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-a', null);
    const targets: TargetEntry[] = [
      { relPath: 'rules/foo.mdc', absPath: join(testDir, 'rules/foo.mdc'), flowToPattern: 'rules/**' }
    ];

    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, {}, 'pkg-a'
    );

    assert.strictEqual(result.allowedTargets.length, 1);
    assert.strictEqual(result.allowedTargets[0].relPath, 'rules/foo.mdc');
    assert.strictEqual(result.packageWasNamespaced, false);
  });

  it('owned-by-other: both packages namespaced, owner file moved', async () => {
    const testDir = join(tmpDir, 'owned-conflict');
    await fs.mkdir(testDir, { recursive: true });

    // Write the workspace index to register pkg-owner as owning rules/foo.mdc.
    // The schema root is just `packages:` — no wrapping `index:` or `version:` key.
    const opkgDir = join(testDir, '.openpackage');
    await fs.mkdir(opkgDir, { recursive: true });
    await fs.writeFile(
      join(opkgDir, 'openpackage.index.yml'),
      [
        'packages:',
        '  pkg-owner:',
        '    path: /fake/path/',
        '    version: "1.0.0"',
        '    files:',
        '      "rules/foo.mdc":',
        '        - "rules/foo.mdc"',
      ].join('\n') + '\n',
      'utf8'
    );

    // Put the existing file on disk
    await write('owned-conflict/rules/foo.mdc', 'original content');

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-incoming', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/foo.mdc',
        absPath: join(testDir, 'rules/foo.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-incoming'
    );

    // The incoming target should be rewritten to the namespaced path
    assert.strictEqual(result.packageWasNamespaced, true);
    assert.strictEqual(result.namespaceDir, 'pkg-incoming');
    assert.strictEqual(result.allowedTargets.length, 1);
    assert.ok(
      result.allowedTargets[0].relPath.includes('pkg-incoming'),
      `Expected namespaced path but got: ${result.allowedTargets[0].relPath}`
    );
    // Owner's file should have been moved (won't exist at original path on disk)
    const originalExists = await pathExists('owned-conflict/rules/foo.mdc');
    const ownerNamespacedExists = await pathExists('owned-conflict/rules/pkg-owner/foo.mdc');
    assert.strictEqual(originalExists, false, 'Original file should have been moved');
    assert.strictEqual(ownerNamespacedExists, true, 'Owner file should be at namespaced path');
  });

  it('exists-unowned: unowned file stays, incoming gets namespaced', async () => {
    const testDir = join(tmpDir, 'unowned-conflict');
    await fs.mkdir(testDir, { recursive: true });
    // No workspace index — file is unowned
    await write('unowned-conflict/rules/shared.mdc', 'user content');

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-b', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/shared.mdc',
        absPath: join(testDir, 'rules/shared.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        content: 'different content from package'
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-b'
    );

    assert.strictEqual(result.packageWasNamespaced, true);
    assert.strictEqual(result.allowedTargets.length, 1);
    assert.ok(
      result.allowedTargets[0].relPath.includes('pkg-b'),
      `Expected namespaced path but got: ${result.allowedTargets[0].relPath}`
    );
    // Original unowned file should still be untouched
    const unownedContent = await fs.readFile(join(testDir, 'rules/shared.mdc'), 'utf8');
    assert.strictEqual(unownedContent, 'user content');
  });

  it('merge flows are excluded from namespacing even when bulk is triggered', async () => {
    const testDir = join(tmpDir, 'merge-excluded');
    await fs.mkdir(testDir, { recursive: true });
    // Existing unowned file to trigger bulk namespacing
    await write('merge-excluded/rules/conflict.mdc', 'unowned');

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-c', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/conflict.mdc',
        absPath: join(testDir, 'rules/conflict.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        content: 'different'
      },
      {
        // Merge flow target: should NOT be namespaced
        relPath: '.cursor/mcp.json',
        absPath: join(testDir, '.cursor/mcp.json'),
        flowToPattern: '.cursor/mcp.json',
        isMergeFlow: true
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-c'
    );

    assert.strictEqual(result.packageWasNamespaced, true);
    // Merge flow target must be at its original path
    const mergeTarget = result.allowedTargets.find(t => t.relPath === '.cursor/mcp.json');
    assert.ok(mergeTarget, 'Merge flow target should be in allowedTargets');
    assert.strictEqual(mergeTarget.relPath, '.cursor/mcp.json');
    // Non-merge target should be namespaced
    const nonMerge = result.allowedTargets.find(t => t.relPath !== '.cursor/mcp.json');
    assert.ok(nonMerge);
    assert.ok(nonMerge.relPath.includes('pkg-c'));
  });

  it('bulk: non-conflicting files also get namespaced when any file conflicts', async () => {
    const testDir = join(tmpDir, 'bulk-namespace');
    await fs.mkdir(testDir, { recursive: true });
    // Only rules/a.mdc conflicts (unowned existing file)
    await write('bulk-namespace/rules/a.mdc', 'unowned a');
    // rules/b.mdc does NOT conflict (fresh)

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-d', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/a.mdc',
        absPath: join(testDir, 'rules/a.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        content: 'new a'
      },
      {
        relPath: 'rules/b.mdc',
        absPath: join(testDir, 'rules/b.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-d'
    );

    assert.strictEqual(result.packageWasNamespaced, true);
    assert.strictEqual(result.allowedTargets.length, 2);
    // Both targets should be namespaced under pkg-d
    for (const t of result.allowedTargets) {
      assert.ok(
        t.relPath.includes('pkg-d'),
        `Expected namespaced path for ${t.relPath}`
      );
    }
  });

  it('--conflicts skip: no namespacing, conflicting file is skipped', async () => {
    const testDir = join(tmpDir, 'skip-strategy');
    await fs.mkdir(testDir, { recursive: true });
    await write('skip-strategy/rules/foo.mdc', 'unowned');

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-e', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/foo.mdc',
        absPath: join(testDir, 'rules/foo.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        content: 'different'
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'skip' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-e'
    );

    assert.strictEqual(result.packageWasNamespaced, false);
    assert.strictEqual(result.allowedTargets.length, 0, 'Skip strategy should exclude the target');
  });

  it('--conflicts overwrite: no namespacing, file is overwritten', async () => {
    const testDir = join(tmpDir, 'overwrite-strategy');
    await fs.mkdir(testDir, { recursive: true });
    await write('overwrite-strategy/rules/bar.mdc', 'original');

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-f', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/bar.mdc',
        absPath: join(testDir, 'rules/bar.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        content: 'new content'
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'overwrite' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-f'
    );

    assert.strictEqual(result.packageWasNamespaced, false);
    assert.strictEqual(result.allowedTargets.length, 1);
    // Path should be unchanged (not namespaced)
    assert.strictEqual(result.allowedTargets[0].relPath, 'rules/bar.mdc');
  });

  it('gh@ package names: namespaceDir uses derived slug, not full package name', async () => {
    const testDir = join(tmpDir, 'gh-slug-test');
    await fs.mkdir(testDir, { recursive: true });
    // Existing unowned file to trigger namespacing
    await write('gh-slug-test/rules/conflict.mdc', 'unowned');

    const ghPackageName = 'gh@anthropics/claude-plugins-official/plugins/feature-dev/agents/code-reviewer.md';
    const ownershipCtx = await buildOwnershipContext(testDir, ghPackageName, null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/conflict.mdc',
        absPath: join(testDir, 'rules/conflict.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        content: 'different'
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, ghPackageName
    );

    assert.strictEqual(result.packageWasNamespaced, true);
    // The namespace dir should be the short slug, not the full gh@ name
    assert.strictEqual(result.namespaceDir, 'feature-dev');
    assert.ok(
      result.allowedTargets[0].relPath.includes('feature-dev'),
      `Expected slug-based path but got: ${result.allowedTargets[0].relPath}`
    );
    // Must NOT contain the full package name or gh@
    assert.ok(
      !result.allowedTargets[0].relPath.includes('gh@'),
      `Path should not contain gh@: ${result.allowedTargets[0].relPath}`
    );
    assert.ok(
      !result.allowedTargets[0].relPath.includes('claude-plugins-official'),
      `Path should not contain full repo name: ${result.allowedTargets[0].relPath}`
    );
  });

  it('resolveOutputContent claims identical transformed content', async () => {
    const testDir = join(tmpDir, 'resolve-output-identical');
    await fs.mkdir(testDir, { recursive: true });
    // Existing file on disk matches what the callback will return
    await write('resolve-output-identical/rules/skill.md', 'transformed content');

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-ro1', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/skill.md',
        absPath: join(testDir, 'rules/skill.md'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        // No `content` — forces the resolver to call resolveOutputContent
        resolveOutputContent: async () => 'transformed content',
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-ro1'
    );

    // Content matches → claimed, no namespacing
    assert.strictEqual(result.packageWasNamespaced, false);
    assert.strictEqual(result.claimedFiles.length, 1);
    assert.strictEqual(result.claimedFiles[0], 'rules/skill.md');
    assert.strictEqual(result.allowedTargets.length, 1);
    assert.strictEqual(result.allowedTargets[0].relPath, 'rules/skill.md');
  });

  it('resolveOutputContent detects different content', async () => {
    const testDir = join(tmpDir, 'resolve-output-different');
    await fs.mkdir(testDir, { recursive: true });
    await write('resolve-output-different/rules/skill.md', 'existing on disk');

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-ro2', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/skill.md',
        absPath: join(testDir, 'rules/skill.md'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        resolveOutputContent: async () => 'different transformed output',
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-ro2'
    );

    // Content differs → conflict, triggers namespacing
    assert.strictEqual(result.packageWasNamespaced, true);
    assert.strictEqual(result.allowedTargets.length, 1);
    assert.ok(
      result.allowedTargets[0].relPath.includes('pkg-ro2'),
      `Expected namespaced path but got: ${result.allowedTargets[0].relPath}`
    );
  });

  it('resolveOutputContent failure falls back to sourceAbsPath', async () => {
    const testDir = join(tmpDir, 'resolve-output-fallback');
    await fs.mkdir(testDir, { recursive: true });
    const sourceContent = 'source file content';
    // Existing file on disk matches raw source
    await write('resolve-output-fallback/rules/skill.md', sourceContent);
    // Write a source file to read via sourceAbsPath fallback
    const sourceFile = join(testDir, '.source-skill.md');
    await fs.writeFile(sourceFile, sourceContent, 'utf8');

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-ro3', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/skill.md',
        absPath: join(testDir, 'rules/skill.md'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        resolveOutputContent: async () => { throw new Error('callback failure'); },
        sourceAbsPath: sourceFile,
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-ro3'
    );

    // Callback failed but sourceAbsPath read succeeds → content matches → claimed
    assert.strictEqual(result.packageWasNamespaced, false);
    assert.strictEqual(result.claimedFiles.length, 1);
    assert.strictEqual(result.claimedFiles[0], 'rules/skill.md');
  });

  it('content field takes priority over resolveOutputContent', async () => {
    const testDir = join(tmpDir, 'content-priority');
    await fs.mkdir(testDir, { recursive: true });
    await write('content-priority/rules/skill.md', 'matching content');

    let callbackInvoked = false;
    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-ro4', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/skill.md',
        absPath: join(testDir, 'rules/skill.md'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        content: 'matching content',
        resolveOutputContent: async () => { callbackInvoked = true; return 'should not be used'; },
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-ro4'
    );

    // content field matches → claimed, callback never invoked
    assert.strictEqual(result.packageWasNamespaced, false);
    assert.strictEqual(result.claimedFiles.length, 1);
    assert.strictEqual(callbackInvoked, false, 'resolveOutputContent should not be called when content is set');
  });

  it('gh@ repo-level package: namespaceDir uses repo name', async () => {
    const testDir = join(tmpDir, 'gh-repo-slug-test');
    await fs.mkdir(testDir, { recursive: true });
    await write('gh-repo-slug-test/rules/conflict.mdc', 'unowned');

    const ghPackageName = 'gh@anthropics/essentials';
    const ownershipCtx = await buildOwnershipContext(testDir, ghPackageName, null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/conflict.mdc',
        absPath: join(testDir, 'rules/conflict.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        content: 'different'
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, ghPackageName
    );

    assert.strictEqual(result.packageWasNamespaced, true);
    assert.strictEqual(result.namespaceDir, 'essentials');
    assert.ok(
      result.allowedTargets[0].relPath.includes('essentials'),
      `Expected slug-based path but got: ${result.allowedTargets[0].relPath}`
    );
  });
});
