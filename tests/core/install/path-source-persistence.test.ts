import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';

import { findExistingPathOrGitSource } from '../../../src/utils/install-helpers.js';
import type { PackageYml } from '../../../src/types/index.js';

const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'opkg-install-path-'));

function setupWorkspace(name: string, deps: PackageYml['dependencies']): string {
  const workspaceDir = path.join(tmpBase, name);
  const opkgDir = path.join(workspaceDir, '.openpackage');
  mkdirSync(opkgDir, { recursive: true });

  const manifest: PackageYml = {
    name: 'test-workspace',
    dependencies: deps || []
  };

  const manifestPath = path.join(opkgDir, 'openpackage.yml');
  writeFileSync(manifestPath, yaml.dump(manifest));

  return workspaceDir;
}

async function testFindPathSource(): Promise<void> {
  const workspace = setupWorkspace('path-test', [
    { name: 'my-package', path: '/absolute/path/to/package' },
    { name: 'registry-package', version: '^1.0.0' }
  ]);

  const pathSource = await findExistingPathOrGitSource(workspace, 'my-package');
  assert.ok(pathSource, 'Should find path source');
  assert.equal(pathSource?.type, 'path');
  assert.equal(pathSource?.type === 'path' && pathSource.path, '/absolute/path/to/package');

  const registrySource = await findExistingPathOrGitSource(workspace, 'registry-package');
  assert.equal(registrySource, null, 'Should return null for registry-based dependency');

  const nonExistent = await findExistingPathOrGitSource(workspace, 'non-existent');
  assert.equal(nonExistent, null, 'Should return null for non-existent package');
}

async function testFindGitSource(): Promise<void> {
  const workspace = setupWorkspace('git-test', [
    { 
      name: 'git-package', 
      url: 'https://gitlab.com/user/repo.git#main'
    } as any
  ]);

  const gitSource = await findExistingPathOrGitSource(workspace, 'git-package');
  assert.ok(gitSource, 'Should find git source');
  assert.equal(gitSource?.type, 'git');
  if (gitSource?.type === 'git') {
    assert.equal(gitSource.url, 'https://gitlab.com/user/repo.git');
    assert.equal(gitSource.ref, 'main');
  }
}

async function testDevPackagesChecked(): Promise<void> {
  const workspaceDir = path.join(tmpBase, 'dev-test');
  const opkgDir = path.join(workspaceDir, '.openpackage');
  mkdirSync(opkgDir, { recursive: true });

  const manifest: PackageYml = {
    name: 'test-workspace',
    dependencies: [{ name: 'prod-pkg', version: '^1.0.0' }],
    'dev-dependencies': [{ name: 'dev-pkg', path: './local/dev-pkg' }]
  };

  const manifestPath = path.join(opkgDir, 'openpackage.yml');
  writeFileSync(manifestPath, yaml.dump(manifest));

  const devSource = await findExistingPathOrGitSource(workspaceDir, 'dev-pkg');
  assert.ok(devSource, 'Should find path source in dev-packages');
  assert.equal(devSource?.type, 'path');
  assert.equal(devSource?.type === 'path' && devSource.path, './local/dev-pkg');
}

async function testRelativePaths(): Promise<void> {
  const workspace = setupWorkspace('relative-test', [
    { name: 'relative-pkg', path: './packages/my-pkg' },
    { name: 'parent-pkg', path: '../shared/pkg' },
    { name: 'tilde-pkg', path: '~/.openpackage/packages/pkg' }
  ]);

  const relative = await findExistingPathOrGitSource(workspace, 'relative-pkg');
  assert.equal(relative?.type, 'path');
  assert.equal(relative?.type === 'path' && relative.path, './packages/my-pkg');

  const parent = await findExistingPathOrGitSource(workspace, 'parent-pkg');
  assert.equal(parent?.type, 'path');
  assert.equal(parent?.type === 'path' && parent.path, '../shared/pkg');

  const tilde = await findExistingPathOrGitSource(workspace, 'tilde-pkg');
  assert.equal(tilde?.type, 'path');
  assert.equal(tilde?.type === 'path' && tilde.path, '~/.openpackage/packages/pkg');
}

async function testGitWithoutRef(): Promise<void> {
  const workspace = setupWorkspace('git-no-ref', [
    { 
      name: 'git-no-ref-package', 
      url: 'https://gitlab.com/user/repo.git'
    } as any
  ]);

  const gitSource = await findExistingPathOrGitSource(workspace, 'git-no-ref-package');
  assert.ok(gitSource, 'Should find git source without ref');
  assert.equal(gitSource?.type, 'git');
  if (gitSource?.type === 'git') {
    assert.equal(gitSource.url, 'https://gitlab.com/user/repo.git');
    assert.equal(gitSource.ref, undefined);
  }
}

async function run(): Promise<void> {
  try {
    await testFindPathSource();
    await testFindGitSource();
    await testDevPackagesChecked();
    await testRelativePaths();
    await testGitWithoutRef();
    console.log('install-path-source-persistence tests passed');
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
