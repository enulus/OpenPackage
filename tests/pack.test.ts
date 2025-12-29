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
    ['name: workspace', 'packages:', '  - name: my-pkg', '    path: ./packages/my-pkg/', ''].join('\n'),
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

console.log('pack tests passed');

