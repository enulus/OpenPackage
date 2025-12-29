import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolvePackageSource } from '../../src/core/source-resolution/resolve-package-source.js';
import { resolveDependencyGraph } from '../../src/core/source-resolution/dependency-graph.js';

async function setupWorkspaceWithPathDependency(): Promise<{
  workspace: string;
  openpackageDir: string;
  pkgDir: string;
}> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-source-res-'));
  const openpackageDir = path.join(workspace, '.openpackage');
  const pkgDir = path.join(openpackageDir, 'packages', 'pkg-a');

  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(
    path.join(openpackageDir, 'openpackage.yml'),
    // Note: relative paths are resolved relative to the manifest directory (.openpackage/)
    ['name: root', 'packages:', '  - name: pkg-a', '    path: ./packages/pkg-a/', ''].join('\n'),
    'utf8'
  );

  return { workspace, openpackageDir, pkgDir };
}

// resolvePackageSource: path dependency
{
  const { workspace, pkgDir } = await setupWorkspaceWithPathDependency();
  try {
    const result = await resolvePackageSource(workspace, 'pkg-a');
    assert.equal(result.packageName, 'pkg-a');
    assert.equal(result.declaredPath, './packages/pkg-a/');
    assert.equal(result.absolutePath, path.join(pkgDir, path.sep));
    assert.equal(result.mutability, 'mutable');
    assert.equal(result.sourceType, 'path');
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

// resolveDependencyGraph: walks manifests without workspace index cache
{
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-dep-graph-'));
  const openpackageDir = path.join(workspace, '.openpackage');
  await fs.mkdir(openpackageDir, { recursive: true });

  // Root declares pkg-a as a relative path (resolved relative to .openpackage/)
  await fs.writeFile(
    path.join(openpackageDir, 'openpackage.yml'),
    ['name: root', 'packages:', '  - name: pkg-a', '    path: ./packages/pkg-a/', ''].join('\n'),
    'utf8'
  );

  // pkg-a depends on pkg-b
  const pkgADir = path.join(openpackageDir, 'packages', 'pkg-a');
  await fs.mkdir(pkgADir, { recursive: true });
  await fs.writeFile(
    path.join(pkgADir, 'openpackage.yml'),
    ['name: pkg-a', 'packages:', '  - name: pkg-b', '    path: ../pkg-b/', ''].join('\n'),
    'utf8'
  );

  // pkg-b has no deps
  const pkgBDir = path.join(openpackageDir, 'packages', 'pkg-b');
  await fs.mkdir(pkgBDir, { recursive: true });
  await fs.writeFile(path.join(pkgBDir, 'openpackage.yml'), ['name: pkg-b', 'packages: []', ''].join('\n'), 'utf8');

  try {
    const graph = await resolveDependencyGraph(workspace, 'pkg-a');
    const names = graph.map(n => n.name).sort();
    assert.deepEqual(names, ['pkg-a', 'pkg-b']);
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

console.log('source-resolution tests passed');

