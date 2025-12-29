import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

import { runStatusPipeline } from '../../src/core/status/status-pipeline.js';

async function setupWorkspace(): Promise<{ cwd: string; home: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-status-home-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-status-ws-'));

  const openpkgDir = path.join(workspace, '.openpackage');
  const pkgDir = path.join(openpkgDir, 'packages', 'my-pkg');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.mkdir(path.join(workspace, '.claude', 'rules'), { recursive: true });

  // workspace manifest
  await fs.writeFile(
    path.join(openpkgDir, 'openpackage.yml'),
    ['name: workspace', 'packages:', '  - name: my-pkg', '    path: ./packages/my-pkg/', ''].join('\n'),
    'utf8'
  );

  // package source + content
  await fs.writeFile(path.join(pkgDir, 'openpackage.yml'), ['name: my-pkg', 'version: 1.0.0', ''].join('\n'), 'utf8');
  await fs.mkdir(path.join(pkgDir, 'rules'), { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'rules', 'hello.md'), '# hi\n', 'utf8');

  // workspace installed copy
  await fs.writeFile(path.join(workspace, '.claude', 'rules', 'hello.md'), '# hi\n', 'utf8');

  // workspace index mapping
  await fs.writeFile(
    path.join(openpkgDir, 'openpackage.index.yml'),
    [
      '# This file is managed by OpenPackage. Do not edit manually.',
      '',
      'packages:',
      '  my-pkg:',
      '    path: ./packages/my-pkg/',
      '    version: 1.0.0',
      '    files:',
      '      rules/:',
      '        - .claude/rules/',
      ''
    ].join('\n'),
    'utf8'
  );

  return { cwd: workspace, home };
}

async function cleanup(paths: string[]) {
  await Promise.all(paths.map(p => fs.rm(p, { recursive: true, force: true })));
}

// Synced state
{
  const { cwd, home } = await setupWorkspace();
  const originalCwd = process.cwd();
  try {
    process.env.HOME = home;
    process.chdir(cwd);
    const res = await runStatusPipeline();
    assert.equal(res.success, true);
    const report = res.data?.packages?.find(p => p.name === 'my-pkg');
    assert.ok(report, 'status should include my-pkg report');
    assert.equal(
      report.state,
      'synced',
      `expected synced, got ${report.state}; diffs=${JSON.stringify(report.diffs)}`
    );
  } finally {
    process.chdir(originalCwd);
    await cleanup([cwd, home]);
  }
}

// Modified state when workspace differs
{
  const { cwd, home } = await setupWorkspace();
  const originalCwd = process.cwd();
  try {
    await fs.writeFile(path.join(cwd, '.claude', 'rules', 'hello.md'), '# hi edited\n', 'utf8');
    process.env.HOME = home;
    process.chdir(cwd);
    const res = await runStatusPipeline();
    assert.equal(res.success, true);
    const report = res.data?.packages?.find(p => p.name === 'my-pkg');
    assert.ok(report, 'status should include my-pkg report');
    assert.equal(
      report.state,
      'modified',
      `expected modified, got ${report.state}; diffs=${JSON.stringify(report.diffs)}`
    );
  } finally {
    process.chdir(originalCwd);
    await cleanup([cwd, home]);
  }
}

console.log('status tests passed');

