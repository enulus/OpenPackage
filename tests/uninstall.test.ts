import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

import { runCli } from './test-helpers.js';

async function setupWorkspace(): Promise<{ cwd: string; home: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-uninstall-home-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-uninstall-ws-'));

  const openpkgDir = path.join(workspace, '.openpackage');
  const pkgDir = path.join(openpkgDir, 'packages', 'my-pkg');
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.mkdir(path.join(workspace, '.claude', 'rules'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'docs'), { recursive: true });

  await fs.writeFile(
    path.join(openpkgDir, 'openpackage.yml'),
    ['name: workspace', 'packages:', '  - name: my-pkg', '    path: ./.openpackage/packages/my-pkg/', ''].join('\n'),
    'utf8'
  );

  await fs.writeFile(path.join(pkgDir, 'openpackage.yml'), ['name: my-pkg', 'version: 1.0.0', ''].join('\n'), 'utf8');

  await fs.writeFile(path.join(pkgDir, 'rules.md'), '# rules\n', 'utf8');

  await fs.writeFile(path.join(workspace, '.claude', 'rules', 'rules.md'), '# rules\n', 'utf8');
  await fs.writeFile(path.join(workspace, 'docs', 'guide.md'), '# guide\n', 'utf8');
  await fs.writeFile(
    path.join(workspace, 'AGENTS.md'),
    ['<!-- package: my-pkg -->', 'owned', '<!-- -->', ''].join('\n'),
    'utf8'
  );

  await fs.writeFile(
    path.join(openpkgDir, 'openpackage.index.yml'),
    [
      '# This file is managed by OpenPackage. Do not edit manually.',
      '',
      'packages:',
      '  my-pkg:',
      '    path: ./.openpackage/packages/my-pkg/',
      '    version: 1.0.0',
      '    files:',
      '      rules/:',
      '        - .claude/rules/',
      '      root/docs/guide.md:',
      '        - docs/guide.md',
      '      AGENTS.md:',
      '        - AGENTS.md',
      ''
    ].join('\n'),
    'utf8'
  );

  return { cwd: workspace, home };
}

async function cleanup(paths: string[]) {
  await Promise.all(paths.map(p => fs.rm(p, { recursive: true, force: true })));
}

{
  const { cwd, home } = await setupWorkspace();
  try {
    const res = runCli(['uninstall', 'my-pkg'], cwd, { HOME: home });
    assert.equal(res.code, 0, `uninstall should succeed: ${res.stderr}`);

    const ruleExists = await fs.stat(path.join(cwd, '.claude', 'rules', 'rules.md')).then(() => true).catch(() => false);
    const docsExists = await fs.stat(path.join(cwd, 'docs', 'guide.md')).then(() => true).catch(() => false);
    assert.equal(ruleExists, false, 'platform file should be removed');
    assert.equal(docsExists, false, 'root copy file should be removed');

    const agentsContent = await fs.readFile(path.join(cwd, 'AGENTS.md'), 'utf8');
    assert.ok(!agentsContent.includes('owned'), 'root file section should be removed');

    const indexContent = await fs.readFile(path.join(cwd, '.openpackage', 'openpackage.index.yml'), 'utf8');
    assert.ok(!indexContent.includes('my-pkg'), 'workspace index should remove package entry');

    const manifestContent = await fs.readFile(path.join(cwd, '.openpackage', 'openpackage.yml'), 'utf8');
    assert.ok(!manifestContent.includes('my-pkg'), 'workspace manifest should remove dependency entry');

    console.log('uninstall tests passed');
  } finally {
    await cleanup([cwd, home]);
  }
}

