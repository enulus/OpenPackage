import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import * as yaml from 'js-yaml';

import { resolveWave } from '../../../packages/core/src/core/install/wave-resolver/wave-engine.js';
import type { PackageYml } from '../../../packages/core/src/types/index.js';

const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'opkg-wave-missing-'));

function createWorkspace(name: string, manifest: PackageYml): string {
  const dir = path.join(tmpBase, name);
  const opkgDir = path.join(dir, '.openpackage');
  mkdirSync(opkgDir, { recursive: true });
  writeFileSync(path.join(opkgDir, 'openpackage.yml'), yaml.dump(manifest));
  return dir;
}

// Test 1: Missing path dep → not in installOrder, warning in graph.warnings
async function testMissingPathDepSkipped(): Promise<void> {
  const workspace = createWorkspace('missing-path', {
    name: 'test-project',
    version: '1.0.0',
    dependencies: [
      { name: 'gone-pkg', path: './nonexistent/gone-pkg' },
    ],
  });

  const result = await resolveWave({
    workspaceRoot: workspace,
    resolutionMode: 'local-only',
  });

  // The missing path dep should not appear in installOrder
  const hasGonePkg = result.graph.installOrder.some(id => id.includes('gone-pkg'));
  assert.equal(hasGonePkg, false, 'Missing path dep should not be in installOrder');

  // A warning about the missing path should be present
  const pathWarning = result.graph.warnings.find(w => w.includes('gone-pkg') && w.includes('path not found'));
  assert.ok(pathWarning, 'Should have a warning about missing path dep');
  assert.ok(pathWarning!.includes('nonexistent/gone-pkg'), 'Warning should include declared path');
}

// Test 2: Valid deps alongside missing path dep → valid dep installs, missing one skipped
async function testValidDepsAlongsideMissing(): Promise<void> {
  const workspace = createWorkspace('mixed-deps', {
    name: 'test-project',
    version: '1.0.0',
    dependencies: [
      { name: 'gone-pkg', path: './does-not-exist' },
      { name: 'valid-pkg', path: './packages/valid-pkg' },
    ],
  });

  // Create the valid package on disk
  const validPkgDir = path.join(workspace, 'packages', 'valid-pkg');
  mkdirSync(validPkgDir, { recursive: true });
  writeFileSync(
    path.join(validPkgDir, 'openpackage.yml'),
    yaml.dump({ name: 'valid-pkg', version: '1.0.0' })
  );

  const result = await resolveWave({
    workspaceRoot: workspace,
    resolutionMode: 'local-only',
  });

  // Valid dep should be in installOrder
  const hasValidPkg = result.graph.installOrder.some(id => id.includes('valid-pkg'));
  assert.ok(hasValidPkg, 'Valid path dep should be in installOrder');

  // Missing dep should not be in installOrder
  const hasGonePkg = result.graph.installOrder.some(id => id.includes('gone-pkg'));
  assert.equal(hasGonePkg, false, 'Missing path dep should not be in installOrder');

  // Warning about missing dep
  const pathWarning = result.graph.warnings.find(w => w.includes('gone-pkg'));
  assert.ok(pathWarning, 'Should warn about missing path dep');
}

// Test 3: Warning message includes package name and declared path
async function testWarningMessageContent(): Promise<void> {
  const workspace = createWorkspace('warning-msg', {
    name: 'test-project',
    version: '1.0.0',
    dependencies: [
      { name: 'my-missing-lib', path: './libs/my-missing-lib' },
    ],
  });

  const result = await resolveWave({
    workspaceRoot: workspace,
    resolutionMode: 'local-only',
  });

  const warning = result.graph.warnings.find(w => w.includes('my-missing-lib'));
  assert.ok(warning, 'Warning should exist for missing dep');
  assert.ok(warning!.includes('my-missing-lib'), 'Warning should include package name');
  assert.ok(warning!.includes('path not found'), 'Warning should indicate path not found');
}

async function run(): Promise<void> {
  try {
    await testMissingPathDepSkipped();
    await testValidDepsAlongsideMissing();
    await testWarningMessageContent();
    console.log('wave-missing-path-skip tests passed');
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
