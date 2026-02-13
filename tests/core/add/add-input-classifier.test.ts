import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { classifyAddInput } from '../../../src/core/add/add-input-classifier.js';

function ensureDir(p: string) { fs.mkdirSync(p, { recursive: true }); }
function writeFile(p: string, content: string) { ensureDir(path.dirname(p)); fs.writeFileSync(p, content, 'utf-8'); }

// 1. Registry package → dependency mode
async function testRegistryPackage(): Promise<void> {
  const result = await classifyAddInput('@hyericlee/essentials', '/tmp/any-cwd', {});
  assert.equal(result.mode, 'dependency');
  assert.equal(result.packageName, '@hyericlee/essentials');
  console.log('  ✓ testRegistryPackage');
}

// 2. Version preserved
async function testRegistryPackageWithVersion(): Promise<void> {
  const result = await classifyAddInput('my-package@1.0.0', '/tmp/any-cwd', {});
  assert.equal(result.mode, 'dependency');
  assert.equal(result.packageName, 'my-package');
  assert.equal(result.version, '1.0.0');
  console.log('  ✓ testRegistryPackageWithVersion');
}

// 3. Sub-path preserved
async function testRegistryPackageWithSubPath(): Promise<void> {
  const result = await classifyAddInput('@hyericlee/essentials/agents/designer', '/tmp/any-cwd', {});
  assert.equal(result.mode, 'dependency');
  assert.equal(result.packageName, '@hyericlee/essentials');
  assert.equal(result.resourcePath, 'agents/designer');
  console.log('  ✓ testRegistryPackageWithSubPath');
}

// 4. GitHub URL → dependency mode
async function testGitHubUrl(): Promise<void> {
  const result = await classifyAddInput('https://github.com/owner/repo', '/tmp/any-cwd', {});
  assert.equal(result.mode, 'dependency');
  assert.equal(result.packageName, 'owner/repo');
  assert.ok(result.gitUrl);
  console.log('  ✓ testGitHubUrl');
}

// 5. GitHub URL with tree/ref/path
async function testGitHubUrlWithTreeRefPath(): Promise<void> {
  const result = await classifyAddInput('https://github.com/owner/repo/tree/main/plugins/x', '/tmp/any-cwd', {});
  assert.equal(result.mode, 'dependency');
  assert.equal(result.packageName, 'owner/repo');
  assert.equal(result.gitRef, 'main');
  assert.equal(result.gitPath, 'plugins/x');
  console.log('  ✓ testGitHubUrlWithTreeRefPath');
}

// 6. gh@ shorthand → dependency mode
async function testGitHubShorthand(): Promise<void> {
  const result = await classifyAddInput('gh@anthropics/claude-code', '/tmp/any-cwd', {});
  assert.equal(result.mode, 'dependency');
  assert.equal(result.packageName, 'anthropics/claude-code');
  assert.ok(result.gitUrl);
  console.log('  ✓ testGitHubShorthand');
}

// 7. gh@ with sub-path
async function testGitHubShorthandWithPath(): Promise<void> {
  const result = await classifyAddInput('gh@user/repo/plugins/x', '/tmp/any-cwd', {});
  assert.equal(result.mode, 'dependency');
  assert.equal(result.packageName, 'user/repo');
  assert.equal(result.gitPath, 'plugins/x');
  console.log('  ✓ testGitHubShorthandWithPath');
}

// 8. Generic git URL → dependency mode
async function testGenericGitUrl(): Promise<void> {
  const result = await classifyAddInput('https://gitlab.com/user/repo.git', '/tmp/any-cwd', {});
  assert.equal(result.mode, 'dependency');
  assert.equal(result.packageName, 'repo');
  assert.ok(result.gitUrl);
  console.log('  ✓ testGenericGitUrl');
}

// 9. Directory with openpackage.yml → dependency mode
async function testLocalDirWithManifest(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-test-classifier-'));
  try {
    writeFile(path.join(tmpDir, 'openpackage.yml'), 'name: test-pkg\nversion: 1.0.0\n');
    const result = await classifyAddInput(tmpDir, tmpDir, {});
    assert.equal(result.mode, 'dependency');
    assert.equal(result.packageName, 'test-pkg');
    assert.equal(result.localPath, tmpDir);
    console.log('  ✓ testLocalDirWithManifest');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 10. Directory without manifest → copy mode
async function testLocalDirWithoutManifest(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-test-classifier-'));
  try {
    writeFile(path.join(tmpDir, 'somefile.txt'), 'hello');
    const result = await classifyAddInput(tmpDir, tmpDir, {});
    assert.equal(result.mode, 'copy');
    assert.equal(result.copySourcePath, tmpDir);
    console.log('  ✓ testLocalDirWithoutManifest');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 11. Single file → copy mode
async function testLocalFile(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-test-classifier-'));
  try {
    const tmpFilePath = path.join(tmpDir, 'myfile.txt');
    writeFile(tmpFilePath, 'content');
    const result = await classifyAddInput(tmpFilePath, path.dirname(tmpFilePath), {});
    assert.equal(result.mode, 'copy');
    assert.equal(result.copySourcePath, tmpFilePath);
    console.log('  ✓ testLocalFile');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 12. --copy forces copy even for package dir
async function testCopyFlagOverridesPackageDir(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-test-classifier-'));
  try {
    writeFile(path.join(tmpDir, 'openpackage.yml'), 'name: test-pkg\nversion: 1.0.0\n');
    const result = await classifyAddInput(tmpDir, tmpDir, { copy: true });
    assert.equal(result.mode, 'copy');
    assert.equal(result.copySourcePath, tmpDir);
    console.log('  ✓ testCopyFlagOverridesPackageDir');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 13. --copy with non-local input errors
async function testCopyFlagWithNonLocalErrors(): Promise<void> {
  await assert.rejects(
    () => classifyAddInput('@hyericlee/essentials', '/tmp/any-cwd', { copy: true }),
    /--copy can only be used with local paths/
  );
  console.log('  ✓ testCopyFlagWithNonLocalErrors');
}

// 14. --copy with nonexistent path errors
async function testCopyFlagWithNonexistentPathErrors(): Promise<void> {
  await assert.rejects(
    () => classifyAddInput('./nonexistent-dir-xyz', '/tmp/any-cwd', { copy: true }),
    /Path not found/
  );
  console.log('  ✓ testCopyFlagWithNonexistentPathErrors');
}

// 15. Tarball file → dependency mode
async function testTarball(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-test-classifier-'));
  try {
    const tarball = path.join(tmpDir, 'my-pkg.tgz');
    fs.writeFileSync(tarball, 'fake tarball');
    const result = await classifyAddInput(tarball, tmpDir, {});
    assert.equal(result.mode, 'dependency');
    assert.ok(result.localPath);
    console.log('  ✓ testTarball');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Run all tests
await testRegistryPackage();
await testRegistryPackageWithVersion();
await testRegistryPackageWithSubPath();
await testGitHubUrl();
await testGitHubUrlWithTreeRefPath();
await testGitHubShorthand();
await testGitHubShorthandWithPath();
await testGenericGitUrl();
await testLocalDirWithManifest();
await testLocalDirWithoutManifest();
await testLocalFile();
await testCopyFlagOverridesPackageDir();
await testCopyFlagWithNonLocalErrors();
await testCopyFlagWithNonexistentPathErrors();
await testTarball();

console.log('\n✓ All add-input-classifier tests passed');
