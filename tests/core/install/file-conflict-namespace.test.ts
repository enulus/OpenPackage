/**
 * File-Level Conflict Resolver — Namespace Tests
 *
 * Tests for the prefix-based namespace conflict resolution system.
 *
 * Covers:
 *  - generateNamespacedPath(): prefix-based namespace path derivation
 *  - resolveConflictsForTargets(): two-pass bulk namespacing logic
 *  - --namespace flag variants
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  generateNamespacedPath,
  resolveConflictsForTargets,
  buildOwnershipContext,
  type TargetEntry,
} from '../../../packages/core/src/core/install/conflicts/file-conflict-resolver.js';
import type { InstallOptions } from '../../../packages/core/src/types/index.js';

// ============================================================================
// generateNamespacedPath — prefix-based, pure function, no I/O
// ============================================================================

describe('generateNamespacedPath (prefix-based)', () => {
  it('prefixes leaf file under a ** glob pattern', () => {
    assert.equal(
      generateNamespacedPath('rules/foo.mdc', 'acme', 'rules/**'),
      'rules/acme-foo.mdc'
    );
  });

  it('prefixes leaf in nested path under ** glob', () => {
    assert.equal(
      generateNamespacedPath('rules/git/commits.md', 'acme', 'rules/**/*.md'),
      'rules/git/acme-commits.md'
    );
  });

  it('prefixes leaf after cursor-prefixed base dir', () => {
    assert.equal(
      generateNamespacedPath('.cursor/rules/my-rule.mdc', 'corp', '.cursor/rules/**'),
      '.cursor/rules/corp-my-rule.mdc'
    );
  });

  it('prefixes leaf under a single-level * glob', () => {
    assert.equal(
      generateNamespacedPath('agents/helper.md', 'my-pkg', 'agents/*'),
      'agents/my-pkg-helper.md'
    );
  });

  it('handles a literal (no-glob) pattern', () => {
    assert.equal(
      generateNamespacedPath('rules/foo.mdc', 'acme', 'rules/foo.mdc'),
      'rules/acme-foo.mdc'
    );
  });

  it('falls back to prefixing leaf when flowToPattern is undefined', () => {
    assert.equal(
      generateNamespacedPath('rules/foo.mdc', 'acme', undefined),
      'rules/acme-foo.mdc'
    );
  });

  it('prefixes single-segment path with no parent dir', () => {
    const result = generateNamespacedPath('foo.mdc', 'acme', undefined);
    assert.equal(result, 'acme-foo.mdc');
  });

  it('prefixes only the leaf in deep sub-paths', () => {
    assert.equal(
      generateNamespacedPath('rules/a/b/c.md', 'pkg', 'rules/**'),
      'rules/a/b/pkg-c.md'
    );
  });

  it('applies dedup rule: skips prefix when leaf equals slug', () => {
    assert.equal(
      generateNamespacedPath('rules/code-review.md', 'code-review', 'rules/**'),
      'rules/code-review.md'
    );
  });

  it('prefixes parent dir for marker-based resource (SKILL.md)', () => {
    assert.equal(
      generateNamespacedPath('commands/review/SKILL.md', 'pkg-a', 'commands/**'),
      'commands/pkg-a-review/SKILL.md'
    );
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

  it('owned-by-other: both packages get prefix-based namespacing, owner file moved', async () => {
    const testDir = join(tmpDir, 'owned-conflict');
    await fs.mkdir(testDir, { recursive: true });

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

    // The incoming target should be prefix-namespaced
    assert.strictEqual(result.packageWasNamespaced, true);
    assert.strictEqual(result.namespaceDir, 'pkg-incoming');
    assert.strictEqual(result.allowedTargets.length, 1);
    assert.ok(
      result.allowedTargets[0].relPath.includes('pkg-incoming'),
      `Expected namespaced path but got: ${result.allowedTargets[0].relPath}`
    );
    // Prefix-based: the incoming path should be rules/pkg-incoming-foo.mdc
    assert.equal(result.allowedTargets[0].relPath, 'rules/pkg-incoming-foo.mdc');

    // Owner's file should have been moved to prefix-based path
    const ownerNamespacedExists = await pathExists('owned-conflict/rules/pkg-owner-foo.mdc');
    assert.strictEqual(ownerNamespacedExists, true, 'Owner file should be at prefix-based namespaced path');
  });

  it('exists-unowned: unowned file stays, incoming gets prefix-namespaced', async () => {
    const testDir = join(tmpDir, 'unowned-conflict');
    await fs.mkdir(testDir, { recursive: true });
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
    // Prefix-based output
    assert.equal(result.allowedTargets[0].relPath, 'rules/pkg-b-shared.mdc');
    // Original unowned file should still be untouched
    const unownedContent = await fs.readFile(join(testDir, 'rules/shared.mdc'), 'utf8');
    assert.strictEqual(unownedContent, 'user content');
  });

  it('merge flows are excluded from namespacing even when bulk is triggered', async () => {
    const testDir = join(tmpDir, 'merge-excluded');
    await fs.mkdir(testDir, { recursive: true });
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
    const mergeTarget = result.allowedTargets.find(t => t.relPath === '.cursor/mcp.json');
    assert.ok(mergeTarget, 'Merge flow target should be in allowedTargets');
    assert.strictEqual(mergeTarget.relPath, '.cursor/mcp.json');
    const nonMerge = result.allowedTargets.find(t => t.relPath !== '.cursor/mcp.json');
    assert.ok(nonMerge);
    assert.ok(nonMerge.relPath.includes('pkg-c'));
  });

  it('bulk: non-conflicting files also get prefix-namespaced when any file conflicts', async () => {
    const testDir = join(tmpDir, 'bulk-namespace');
    await fs.mkdir(testDir, { recursive: true });
    await write('bulk-namespace/rules/a.mdc', 'unowned a');

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
    assert.strictEqual(result.allowedTargets[0].relPath, 'rules/bar.mdc');
  });

  it('gh@ package names: namespaceDir uses derived slug, not full package name', async () => {
    const testDir = join(tmpDir, 'gh-slug-test');
    await fs.mkdir(testDir, { recursive: true });
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
    assert.strictEqual(result.namespaceDir, 'feature-dev');
    assert.ok(
      result.allowedTargets[0].relPath.includes('feature-dev'),
      `Expected slug-based path but got: ${result.allowedTargets[0].relPath}`
    );
    assert.ok(
      !result.allowedTargets[0].relPath.includes('gh@'),
      `Path should not contain gh@: ${result.allowedTargets[0].relPath}`
    );
  });

  it('resolveOutputContent claims identical transformed content', async () => {
    const testDir = join(tmpDir, 'resolve-output-identical');
    await fs.mkdir(testDir, { recursive: true });
    await write('resolve-output-identical/rules/skill.md', 'transformed content');

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-ro1', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/skill.md',
        absPath: join(testDir, 'rules/skill.md'),
        flowToPattern: 'rules/**',
        isMergeFlow: false,
        resolveOutputContent: async () => 'transformed content',
      }
    ];

    const options: InstallOptions = { conflictStrategy: 'namespace' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-ro1'
    );

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
    await write('resolve-output-fallback/rules/skill.md', sourceContent);
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

// ============================================================================
// --namespace flag variants
// ============================================================================

describe('resolveConflictsForTargets — --namespace flag', () => {
  it('namespace: true forces prefix even without conflict', async () => {
    const testDir = join(tmpDir, 'force-namespace');
    await fs.mkdir(testDir, { recursive: true });

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-force', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/foo.mdc',
        absPath: join(testDir, 'rules/foo.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false
      }
    ];

    const options: InstallOptions = { namespace: true };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-force'
    );

    assert.strictEqual(result.packageWasNamespaced, true);
    assert.strictEqual(result.allowedTargets.length, 1);
    assert.equal(result.allowedTargets[0].relPath, 'rules/pkg-force-foo.mdc');
  });

  it('namespace: "sd" uses custom slug', async () => {
    const testDir = join(tmpDir, 'custom-slug');
    await fs.mkdir(testDir, { recursive: true });

    const ownershipCtx = await buildOwnershipContext(testDir, 'my-package', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/foo.mdc',
        absPath: join(testDir, 'rules/foo.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false
      }
    ];

    const options: InstallOptions = { namespace: 'sd' };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'my-package'
    );

    assert.strictEqual(result.packageWasNamespaced, true);
    assert.strictEqual(result.namespaceDir, 'sd');
    assert.equal(result.allowedTargets[0].relPath, 'rules/sd-foo.mdc');
  });

  it('namespace: false skips namespacing, owned-by-other files are skipped', async () => {
    const testDir = join(tmpDir, 'no-namespace');
    await fs.mkdir(testDir, { recursive: true });

    const opkgDir = join(testDir, '.openpackage');
    await fs.mkdir(opkgDir, { recursive: true });
    await fs.writeFile(
      join(opkgDir, 'openpackage.index.yml'),
      [
        'packages:',
        '  other-pkg:',
        '    path: /fake/',
        '    version: "1.0.0"',
        '    files:',
        '      "rules/bar.mdc":',
        '        - "rules/bar.mdc"',
      ].join('\n') + '\n',
      'utf8'
    );

    const ownershipCtx = await buildOwnershipContext(testDir, 'pkg-no-ns', null);
    const targets: TargetEntry[] = [
      {
        relPath: 'rules/bar.mdc',
        absPath: join(testDir, 'rules/bar.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false
      },
      {
        relPath: 'rules/new.mdc',
        absPath: join(testDir, 'rules/new.mdc'),
        flowToPattern: 'rules/**',
        isMergeFlow: false
      }
    ];

    const options: InstallOptions = { namespace: false };
    const result = await resolveConflictsForTargets(
      testDir, targets, ownershipCtx, options, 'pkg-no-ns'
    );

    assert.strictEqual(result.packageWasNamespaced, false);
    // The owned-by-other file should be skipped, new file passes through
    assert.strictEqual(result.allowedTargets.length, 1);
    assert.strictEqual(result.allowedTargets[0].relPath, 'rules/new.mdc');
    assert.ok(result.warnings.some(w => w.includes('--no-namespace')));
  });
});
