import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readWorkspaceIndex } from '../../src/utils/workspace-index-yml.js';
import { runCli } from '../../test-helpers.js';

async function setupWorkspace(): Promise<{ cwd: string; home: string }> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-apply-home-'));
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-apply-ws-'));

  const openpkgDir = path.join(workspace, '.openpackage');
  const pkgDir = path.join(openpkgDir, 'packages', 'my-pkg');
  await fs.mkdir(path.join(pkgDir, 'rules'), { recursive: true });
  // Use Claude to avoid Cursor's .md -> .mdc extension transformation.
  await fs.mkdir(path.join(workspace, '.claude'), { recursive: true });

  await fs.writeFile(
    path.join(openpkgDir, 'openpackage.yml'),
    ['name: workspace', 'packages:', '  - name: my-pkg', '    version: ^1.0.0', ''].join('\n'),
    'utf8'
  );

  // Create workspace index with my-pkg entry pointing to workspace-scoped package
  await fs.writeFile(
    path.join(openpkgDir, 'openpackage.index.yml'),
    ['packages:', '  my-pkg:', '    path: ./.openpackage/packages/my-pkg/', '    version: 1.0.0', '    files: {}', ''].join('\n'),
    'utf8'
  );

  await fs.writeFile(path.join(pkgDir, 'openpackage.yml'), ['name: my-pkg', 'version: 1.0.0', ''].join('\n'), 'utf8');
  await fs.writeFile(path.join(pkgDir, 'rules', 'hello.md'), '# hi\n', 'utf8');

  return { cwd: workspace, home };
}

async function cleanup(paths: string[]) {
  await Promise.all(paths.map(p => fs.rm(p, { recursive: true, force: true })));
}

{
  const { cwd, home } = await setupWorkspace();
  try {
    const res = runCli(['apply', 'my-pkg', '--force'], cwd, { HOME: home });
    assert.equal(res.code, 0, `apply should succeed: ${res.stderr}`);

    const installedPath = path.join(cwd, '.claude', 'rules', 'hello.md');
    const content = await fs.readFile(installedPath, 'utf8');
    assert.equal(content.trim(), '# hi');

    const index = await readWorkspaceIndex(cwd);
    const entry = index.index.packages['my-pkg'];
    assert.ok(entry, 'workspace index should include my-pkg after apply');
    assert.ok(entry.files, 'workspace index entry should include files mapping');
    assert.equal(entry.path, './.openpackage/packages/my-pkg/');
    assert.ok(
      entry.files['rules/hello.md']?.includes('.claude/rules/hello.md'),
      'mapping should include rules/hello.md -> .claude/rules/hello.md'
    );

    console.log('apply-mutable-source tests passed');
  } finally {
    await cleanup([cwd, home]);
  }
}

