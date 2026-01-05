import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

import { runCli } from './test-helpers.js';

async function setupWorkspace(): Promise<{ cwd: string; home: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-pack-home-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-pack-ws-'));

  // workspace/.openpackage/openpackage.yml declaring the package
  const openpkgDir = path.join(workspace, '.openpackage');
  const pkgDir = path.join(openpkgDir, 'packages', 'my-pkg');
  await fs.mkdir(pkgDir, { recursive: true });

  await fs.writeFile(
    path.join(openpkgDir, 'openpackage.yml'),
    ['name: workspace', 'packages:', '  - name: my-pkg', '    path: ./.openpackage/packages/my-pkg/', ''].join('\n'),
    'utf8'
  );

  await fs.writeFile(path.join(pkgDir, 'openpackage.yml'), ['name: my-pkg', 'version: 1.0.0', ''].join('\n'), 'utf8');

  await fs.mkdir(path.join(pkgDir, 'rules'), { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'rules', 'hello.md'), '# hi\n', 'utf8');

  return { cwd: workspace, home };
}

async function cleanup(paths: string[]) {
  await Promise.all(paths.map(p => fs.rm(p, { recursive: true, force: true })));
}

// Default pack to registry directory
{
  const { cwd, home } = await setupWorkspace();
  try {
    const res = runCli(['pack', 'my-pkg'], cwd, { HOME: home });
    assert.equal(res.code, 0, `pack should succeed: ${res.stderr}`);

    const registryPath = path.join(home, '.openpackage', 'registry', 'my-pkg', '1.0.0', 'rules', 'hello.md');
    const content = await fs.readFile(registryPath, 'utf8');
    assert.equal(content.trim(), '# hi', 'registry snapshot should contain package file');
  } finally {
    await cleanup([cwd, home]);
  }
}

// --output writes directly to the target directory
{
  const { cwd, home } = await setupWorkspace();
  const outputDir = path.join(cwd, 'snapshot');
  try {
    const res = runCli(['pack', 'my-pkg', '--output', outputDir], cwd, { HOME: home });
    assert.equal(res.code, 0, `pack --output should succeed: ${res.stderr}`);

    const snapshotFile = path.join(outputDir, 'rules', 'hello.md');
    const content = await fs.readFile(snapshotFile, 'utf8');
    assert.equal(content.trim(), '# hi', 'output snapshot should be written directly to target dir');
  } finally {
    await cleanup([cwd, home]);
  }
}

// --dry-run does not write files
{
  const { cwd, home } = await setupWorkspace();
  const outputDir = path.join(cwd, 'dry-run-out');
  try {
    const res = runCli(['pack', 'my-pkg', '--output', outputDir, '--dry-run'], cwd, { HOME: home });
    assert.equal(res.code, 0, `pack --dry-run should succeed: ${res.stderr}`);

    const exists = await fs.stat(outputDir).then(() => true).catch(() => false);
    assert.equal(exists, false, 'dry-run should not create output directory');
  } finally {
    await cleanup([cwd, home]);
  }
}

// Pack from absolute path
{
  const { cwd, home } = await setupWorkspace();
  try {
    const pkgDir = path.join(cwd, '.openpackage', 'packages', 'my-pkg');
    const res = runCli(['pack', pkgDir], cwd, { HOME: home });
    assert.equal(res.code, 0, `pack with absolute path should succeed: ${res.stderr}`);

    const registryPath = path.join(home, '.openpackage', 'registry', 'my-pkg', '1.0.0', 'rules', 'hello.md');
    const content = await fs.readFile(registryPath, 'utf8');
    assert.equal(content.trim(), '# hi', 'registry snapshot from path should contain package file');
  } finally {
    await cleanup([cwd, home]);
  }
}

// Pack from relative path
{
  const { cwd, home } = await setupWorkspace();
  try {
    const res = runCli(['pack', './.openpackage/packages/my-pkg'], cwd, { HOME: home });
    assert.equal(res.code, 0, `pack with relative path should succeed: ${res.stderr}`);

    const registryPath = path.join(home, '.openpackage', 'registry', 'my-pkg', '1.0.0', 'rules', 'hello.md');
    const content = await fs.readFile(registryPath, 'utf8');
    assert.equal(content.trim(), '# hi', 'registry snapshot from relative path should contain package file');
  } finally {
    await cleanup([cwd, home]);
  }
}

// Pack from path outside workspace
{
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-pack-home2-'));
  const externalPkg = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-external-pkg-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-pack-ws2-'));
  
  try {
    // Create a package in a completely separate location
    await fs.writeFile(
      path.join(externalPkg, 'openpackage.yml'),
      ['name: external-pkg', 'version: 2.5.0', ''].join('\n'),
      'utf8'
    );
    await fs.mkdir(path.join(externalPkg, 'src'), { recursive: true });
    await fs.writeFile(path.join(externalPkg, 'src', 'index.ts'), 'export const x = 1;\n', 'utf8');

    // Pack it from a different workspace using absolute path
    const res = runCli(['pack', externalPkg], workspace, { HOME: home });
    assert.equal(res.code, 0, `pack external path should succeed: ${res.stderr}`);

    const registryPath = path.join(home, '.openpackage', 'registry', 'external-pkg', '2.5.0', 'src', 'index.ts');
    const content = await fs.readFile(registryPath, 'utf8');
    assert.equal(content.trim(), 'export const x = 1;', 'registry should contain external package');
  } finally {
    await cleanup([home, externalPkg, workspace]);
  }
}

// Pack with overwrite (should fail without --force in non-interactive mode)
{
  const { cwd, home } = await setupWorkspace();
  try {
    // First pack
    const res1 = runCli(['pack', 'my-pkg'], cwd, { HOME: home });
    assert.equal(res1.code, 0, `first pack should succeed: ${res1.stderr}`);

    // Second pack without --force (should fail in CI/non-TTY)
    const res2 = runCli(['pack', 'my-pkg'], cwd, { HOME: home });
    // In non-interactive mode (which runCli simulates), it should prompt but prompts library will throw
    // So we expect it to fail with cancellation
    assert.notEqual(res2.code, 0, 'pack without --force should fail when destination exists');
    assert.match(res2.stderr, /(cancelled|exists)/i, 'error should mention cancellation or existing package');
  } finally {
    await cleanup([cwd, home]);
  }
}

// Pack with --force should overwrite without prompting
{
  const { cwd, home } = await setupWorkspace();
  try {
    // First pack
    const res1 = runCli(['pack', 'my-pkg'], cwd, { HOME: home });
    assert.equal(res1.code, 0, `first pack should succeed: ${res1.stderr}`);

    const registryPath = path.join(home, '.openpackage', 'registry', 'my-pkg', '1.0.0', 'rules', 'hello.md');
    const content1 = await fs.readFile(registryPath, 'utf8');
    assert.equal(content1.trim(), '# hi', 'first pack should create file');

    // Modify the source
    const pkgDir = path.join(cwd, '.openpackage', 'packages', 'my-pkg');
    await fs.writeFile(path.join(pkgDir, 'rules', 'hello.md'), '# updated\n', 'utf8');

    // Second pack with --force
    const res2 = runCli(['pack', 'my-pkg', '--force'], cwd, { HOME: home });
    assert.equal(res2.code, 0, `pack with --force should succeed: ${res2.stderr}`);
    assert.match(res2.stdout, /Force mode: Overwriting/i, 'should show force mode message');

    // Verify file was overwritten
    const content2 = await fs.readFile(registryPath, 'utf8');
    assert.equal(content2.trim(), '# updated', 'file should be overwritten with new content');
  } finally {
    await cleanup([cwd, home]);
  }
}

// Pack with --dry-run should show overwrite warning
{
  const { cwd, home } = await setupWorkspace();
  try {
    // First pack
    const res1 = runCli(['pack', 'my-pkg'], cwd, { HOME: home });
    assert.equal(res1.code, 0, `first pack should succeed: ${res1.stderr}`);

    // Dry-run pack on existing package
    const res2 = runCli(['pack', 'my-pkg', '--dry-run'], cwd, { HOME: home });
    assert.equal(res2.code, 0, `pack --dry-run should succeed: ${res2.stderr}`);
    assert.match(res2.stdout, /Would overwrite existing package/i, 'should show overwrite warning');
    assert.match(res2.stdout, /\d+ file/i, 'should show existing file count');
  } finally {
    await cleanup([cwd, home]);
  }
}

// Pack with --output to existing directory should also prompt
{
  const { cwd, home } = await setupWorkspace();
  const outputDir = path.join(cwd, 'snapshot');
  try {
    // First pack to output dir
    const res1 = runCli(['pack', 'my-pkg', '--output', outputDir], cwd, { HOME: home });
    assert.equal(res1.code, 0, `first pack --output should succeed: ${res1.stderr}`);

    // Second pack to same output dir without --force (should fail)
    const res2 = runCli(['pack', 'my-pkg', '--output', outputDir], cwd, { HOME: home });
    assert.notEqual(res2.code, 0, 'pack --output without --force should fail when destination exists');

    // Third pack with --force should succeed
    const res3 = runCli(['pack', 'my-pkg', '--output', outputDir, '--force'], cwd, { HOME: home });
    assert.equal(res3.code, 0, `pack --output with --force should succeed: ${res3.stderr}`);
  } finally {
    await cleanup([cwd, home]);
  }
}

console.log('pack tests passed');

