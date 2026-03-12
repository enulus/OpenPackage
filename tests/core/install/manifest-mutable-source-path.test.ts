import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';

import { buildManifestFields } from '../../../packages/core/src/core/install/unified/phases/manifest.js';
import type { InstallationContext } from '../../../packages/core/src/core/install/unified/context.js';

const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'opkg-manifest-mutable-'));

function makeCtx(overrides: Partial<InstallationContext>): InstallationContext {
  return {
    source: { type: 'registry', packageName: 'test' },
    targetDir: '/tmp/test',
    ...overrides,
  } as InstallationContext;
}

// Test 1: Workspace mutable source → path: with ./ relative prefix
function testWorkspaceMutableSource(): void {
  const targetDir = path.join(tmpBase, 'workspace-test');
  mkdirSync(targetDir, { recursive: true });
  const pkgDir = path.join(targetDir, '.openpackage', 'packages', 'foo');
  mkdirSync(pkgDir, { recursive: true });

  const ctx = makeCtx({
    targetDir,
    source: {
      type: 'registry',
      packageName: 'foo',
      version: '1.0.0',
      mutableSourceOverride: {
        kind: 'workspaceMutable',
        packageRootDir: pkgDir,
      },
    },
  });

  const fields = buildManifestFields(ctx, {});
  assert.equal(fields.path, './.openpackage/packages/foo', 'Workspace mutable should produce ./ relative path');
  assert.equal(fields.range, undefined, 'Workspace mutable should not produce version range');
}

// Test 2: Global mutable source → path: with ~/ tilde prefix
function testGlobalMutableSource(): void {
  const targetDir = path.join(tmpBase, 'global-test');
  mkdirSync(targetDir, { recursive: true });
  const globalPkgDir = path.join(os.homedir(), '.openpackage', 'packages', 'bar');

  const ctx = makeCtx({
    targetDir,
    source: {
      type: 'registry',
      packageName: 'bar',
      version: '2.0.0',
      mutableSourceOverride: {
        kind: 'globalMutable',
        packageRootDir: globalPkgDir,
      },
    },
  });

  const fields = buildManifestFields(ctx, {});
  assert.equal(fields.path, '~/.openpackage/packages/bar', 'Global mutable should produce ~/ tilde path');
  assert.equal(fields.range, undefined, 'Global mutable should not produce version range');
}

// Test 3: Pure registry source → range: with version (unchanged behavior)
function testPureRegistrySource(): void {
  const ctx = makeCtx({
    source: {
      type: 'registry',
      packageName: 'baz',
      version: '3.0.0',
    },
  });

  const fields = buildManifestFields(ctx, {});
  assert.equal(fields.range, '3.0.0', 'Pure registry should produce version range');
  assert.equal(fields.path, undefined, 'Pure registry should not produce path');
}

// Test 4: gitSourceOverride takes precedence over mutableSourceOverride
function testGitOverridePrecedence(): void {
  const targetDir = path.join(tmpBase, 'precedence-test');
  mkdirSync(targetDir, { recursive: true });
  const pkgDir = path.join(targetDir, '.openpackage', 'packages', 'qux');

  const ctx = makeCtx({
    targetDir,
    source: {
      type: 'registry',
      packageName: 'qux',
      version: '1.0.0',
      gitSourceOverride: {
        gitUrl: 'https://github.com/user/repo.git',
        gitRef: 'main',
      },
      mutableSourceOverride: {
        kind: 'workspaceMutable',
        packageRootDir: pkgDir,
      },
    },
  });

  const fields = buildManifestFields(ctx, {});
  assert.equal(fields.gitUrl, 'https://github.com/user/repo.git', 'Git override should take precedence');
  assert.equal(fields.gitRef, 'main');
  assert.equal(fields.path, undefined, 'Mutable override should be ignored when git override is present');
}

try {
  testWorkspaceMutableSource();
  testGlobalMutableSource();
  testPureRegistrySource();
  testGitOverridePrecedence();
  console.log('manifest-mutable-source-path tests passed');
} finally {
  rmSync(tmpBase, { recursive: true, force: true });
}
