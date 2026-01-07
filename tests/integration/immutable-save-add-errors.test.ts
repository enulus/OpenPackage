import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runCli } from '../../test-helpers.js';

async function setupWorkspace(): Promise<{ cwd: string; home: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-immutable-home-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-immutable-ws-'));

  const openpkgDir = path.join(workspace, '.openpackage');
  await fs.mkdir(openpkgDir, { recursive: true });

  await fs.writeFile(
    path.join(openpkgDir, 'openpackage.yml'),
    ['name: workspace', 'packages:', '  - name: imm-pkg', '    version: 1.0.0', ''].join('\n'),
    'utf8'
  );

  // Mark as immutable by pointing index path at a registry directory.
  const registryPkgPath = path.join(home, '.openpackage', 'registry', 'imm-pkg', '1.0.0') + path.sep;
  await fs.mkdir(registryPkgPath, { recursive: true });
  await fs.writeFile(path.join(registryPkgPath, 'openpackage.yml'), ['name: imm-pkg', 'version: 1.0.0', ''].join('\n'), 'utf8');

  await fs.writeFile(
    path.join(openpkgDir, 'openpackage.index.yml'),
    [
      '# This file is managed by OpenPackage. Do not edit manually.',
      '',
      'packages:',
      '  imm-pkg:',
      `    path: ${registryPkgPath.replace(home, '~')}`,
      '    version: 1.0.0',
      '    files:',
      '      rules/:',
      '        - .cursor/rules/',
      ''
    ].join('\n'),
    'utf8'
  );

  // Add a workspace file so add/save have something to do.
  await fs.mkdir(path.join(workspace, '.cursor', 'rules'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.cursor', 'rules', 'hello.md'), '# hi\n', 'utf8');

  return { cwd: workspace, home };
}

async function cleanup(paths: string[]) {
  await Promise.all(paths.map(p => fs.rm(p, { recursive: true, force: true })));
}

{
  const { cwd, home } = await setupWorkspace();
  try {
    const saveRes = runCli(['save', 'imm-pkg', '--force'], cwd, { HOME: home });
    assert.notEqual(saveRes.code, 0, 'save should fail for immutable sources');
    assert.ok(
      `${saveRes.stdout}\n${saveRes.stderr}`.toLowerCase().includes('immutable'),
      'save error should mention immutable'
    );

    const addRes = runCli(['add', 'imm-pkg', '.cursor/rules/hello.md'], cwd, { HOME: home });
    assert.notEqual(addRes.code, 0, 'add should fail for immutable sources');
    assert.ok(
      `${addRes.stdout}\n${addRes.stderr}`.toLowerCase().includes('immutable'),
      'add error should mention immutable'
    );

    console.log('immutable-save-add-errors tests passed');
  } finally {
    await cleanup([cwd, home]);
  }
}

