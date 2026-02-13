import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runAddDependencyFlow } from '../../../src/core/add/add-dependency-flow.js';
import type { AddInputClassification } from '../../../src/core/add/add-input-classifier.js';
import { parsePackageYml } from '../../../src/utils/package-yml.js';

function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }
function writeFile(p: string, content: string) { ensureDir(path.dirname(p)); fs.writeFileSync(p, content, 'utf-8'); }

function createWorkspaceManifest(workspaceDir: string, name = 'test-workspace') {
  const manifest = `name: ${name}\ndependencies: []\ndev-dependencies: []\n`;
  writeFile(path.join(workspaceDir, '.openpackage', 'openpackage.yml'), manifest);
}

function createMutablePackage(workspaceDir: string, pkgName: string) {
  const pkgDir = path.join(workspaceDir, '.openpackage', 'packages', pkgName);
  const manifest = `name: ${pkgName}\nversion: 1.0.0\ndependencies: []\ndev-dependencies: []\n`;
  writeFile(path.join(pkgDir, 'openpackage.yml'), manifest);
  return pkgDir;
}

async function testAddRegistryDependency(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-reg-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    createWorkspaceManifest(tmpDir);

    const classification: AddInputClassification = {
      mode: 'dependency',
      packageName: '@hyericlee/essentials',
      version: '1.0.0',
    };
    const result = await runAddDependencyFlow(classification, {});
    assert.equal(result.packageName, '@hyericlee/essentials');
    assert.equal(result.section, 'dependencies');

    const config = await parsePackageYml(result.targetManifest);
    const dep = config.dependencies?.find(d => d.name === '@hyericlee/essentials');
    assert.ok(dep, 'Dependency should be in manifest');

    console.log('✓ testAddRegistryDependency');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testAddGitDependency(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-git-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    createWorkspaceManifest(tmpDir);

    const classification: AddInputClassification = {
      mode: 'dependency',
      packageName: 'owner/repo',
      gitUrl: 'https://github.com/owner/repo.git',
      gitRef: 'main',
    };
    const result = await runAddDependencyFlow(classification, {});
    assert.equal(result.section, 'dependencies');

    const config = await parsePackageYml(result.targetManifest);
    // parsePackageYml migrates GitHub-style names to gh@ prefix
    const dep = config.dependencies?.find(d => d.name === 'gh@owner/repo');
    assert.ok(dep, 'Git dependency should be in manifest');
    assert.ok(dep.url, 'Git dependency should have a url field');

    console.log('✓ testAddGitDependency');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testAddDevDependency(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-dev-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    createWorkspaceManifest(tmpDir);

    const classification: AddInputClassification = {
      mode: 'dependency',
      packageName: 'dev-pkg',
      version: '2.0.0',
    };
    const result = await runAddDependencyFlow(classification, { dev: true });
    assert.equal(result.section, 'dev-dependencies');

    const config = await parsePackageYml(result.targetManifest);
    const dep = config['dev-dependencies']?.find(d => d.name === 'dev-pkg');
    assert.ok(dep, 'Should be in dev-dependencies');
    const notInDeps = config.dependencies?.find(d => d.name === 'dev-pkg');
    assert.ok(!notInDeps, 'Should NOT be in dependencies');

    console.log('✓ testAddDevDependency');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testAddToMutablePackage(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-to-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    createWorkspaceManifest(tmpDir);
    const pkgDir = createMutablePackage(tmpDir, 'target-pkg');

    const classification: AddInputClassification = {
      mode: 'dependency',
      packageName: 'added-dep',
      version: '1.0.0',
    };
    const result = await runAddDependencyFlow(classification, { to: 'target-pkg' });
    assert.equal(result.section, 'dependencies');

    const targetConfig = await parsePackageYml(path.join(pkgDir, 'openpackage.yml'));
    const dep = targetConfig.dependencies?.find(d => d.name === 'added-dep');
    assert.ok(dep, 'Dependency should be in target package manifest');

    const wsConfig = await parsePackageYml(path.join(tmpDir, '.openpackage', 'openpackage.yml'));
    const wsNotModified = wsConfig.dependencies?.find(d => d.name === 'added-dep');
    assert.ok(!wsNotModified, 'Workspace manifest should NOT have the dependency');

    console.log('✓ testAddToMutablePackage');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testAddDuplicateUpdatesExisting(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-dupe-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    createWorkspaceManifest(tmpDir);

    const classification1: AddInputClassification = {
      mode: 'dependency',
      packageName: 'dupe-pkg',
      version: '1.0.0',
    };
    await runAddDependencyFlow(classification1, {});

    const classification2: AddInputClassification = {
      mode: 'dependency',
      packageName: 'dupe-pkg',
      version: '2.0.0',
    };
    await runAddDependencyFlow(classification2, {});

    const config = await parsePackageYml(path.join(tmpDir, '.openpackage', 'openpackage.yml'));
    const matches = config.dependencies?.filter(d => d.name === 'dupe-pkg');
    assert.equal(matches?.length, 1, 'Should have exactly one entry');

    console.log('✓ testAddDuplicateUpdatesExisting');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testAutoCreatesManifest(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-auto-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    // NO manifest created — the flow should auto-create it

    const classification: AddInputClassification = {
      mode: 'dependency',
      packageName: 'new-dep',
    };
    const result = await runAddDependencyFlow(classification, {});
    assert.ok(fs.existsSync(result.targetManifest), 'Manifest should be auto-created');

    const config = await parsePackageYml(result.targetManifest);
    const dep = config.dependencies?.find(d => d.name === 'new-dep');
    assert.ok(dep, 'Dependency should be in auto-created manifest');

    console.log('✓ testAutoCreatesManifest');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testLocalPathDependency(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-local-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    createWorkspaceManifest(tmpDir);

    const classification: AddInputClassification = {
      mode: 'dependency',
      packageName: 'local-pkg',
      localPath: path.join(tmpDir, 'my-local-pkg'),
    };
    const result = await runAddDependencyFlow(classification, {});
    assert.equal(result.isLocalPath, true);
    assert.equal(result.wasAutoDetected, true);

    console.log('✓ testLocalPathDependency');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function testResultFields(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-add-result-'));
  const originalCwd = process.cwd();
  try {
    process.chdir(tmpDir);
    createWorkspaceManifest(tmpDir);

    const classification: AddInputClassification = {
      mode: 'dependency',
      packageName: 'result-test',
      version: '1.0.0',
    };
    const result = await runAddDependencyFlow(classification, { dev: true });
    assert.equal(result.packageName, 'result-test');
    assert.equal(result.section, 'dev-dependencies');
    assert.equal(result.isLocalPath, false);
    assert.equal(result.wasAutoDetected, false);
    assert.ok(result.targetManifest.endsWith('openpackage.yml'));

    console.log('✓ testResultFields');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Run all tests
await testAddRegistryDependency();
await testAddGitDependency();
await testAddDevDependency();
await testAddToMutablePackage();
await testAddDuplicateUpdatesExisting();
await testAutoCreatesManifest();
await testLocalPathDependency();
await testResultFields();

console.log('\n✓ All add-dependency-flow tests passed');
