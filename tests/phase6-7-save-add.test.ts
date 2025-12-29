import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runSaveToSourcePipeline } from '../src/core/save/save-to-source-pipeline.js';
import { runAddToSourcePipeline } from '../src/core/add/add-to-source-pipeline.js';
import { writeWorkspaceIndex, readWorkspaceIndex, getWorkspaceIndexPath } from '../src/utils/workspace-index-yml.js';

const UTF8 = 'utf-8';

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p: string, content: string) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, { encoding: UTF8 });
}

function writeWorkspaceManifest(cwd: string, pkgName: string, pkgPath: string) {
  const manifest = [
    `name: workspace`,
    `version: 0.0.0`,
    `packages:`,
    `  - name: ${pkgName}`,
    `    path: ${pkgPath}`
  ].join('\n');
  writeFile(path.join(cwd, '.openpackage', 'openpackage.yml'), manifest);
}

function writePackageManifest(pkgDir: string, pkgName: string) {
  const manifest = [`name: ${pkgName}`, `version: 1.0.0`].join('\n');
  writeFile(path.join(pkgDir, 'openpackage.yml'), manifest);
}

async function testSaveSyncsWorkspaceToSource(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-phase6-save-'));
  try {
    const pkgName = 'pkg-save';
    const pkgPath = './.openpackage/packages/pkg-save/';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', 'pkg-save');

    writeWorkspaceManifest(tmp, pkgName, pkgPath);
    writePackageManifest(pkgDir, pkgName);

    // Workspace edit
    const wsFile = path.join(tmp, '.cursor', 'rules', 'foo.md');
    writeFile(wsFile, 'hello-from-workspace');

    // Unified index mapping
    await writeWorkspaceIndex({
      path: getWorkspaceIndexPath(tmp),
      index: {
        packages: {
          [pkgName]: {
            path: pkgPath,
            files: { 'rules/': ['.cursor/rules/'] }
          }
        }
      }
    });

    const result = await runSaveToSourcePipeline(pkgName, { force: true });
    assert.ok(result.success, result.error);

    const sourceFile = path.join(pkgDir, 'rules', 'foo.md');
    assert.equal(fs.readFileSync(sourceFile, UTF8), 'hello-from-workspace');

    console.log('save sync test passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testAddCopiesToRootAndUpdatesIndex(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-phase7-add-'));
  try {
    const pkgName = 'pkg-add';
    const pkgPath = './.openpackage/packages/pkg-add/';
    const pkgDir = path.join(tmp, '.openpackage', 'packages', 'pkg-add');

    writeWorkspaceManifest(tmp, pkgName, pkgPath);
    writePackageManifest(pkgDir, pkgName);

    const wsDoc = path.join(tmp, 'docs', 'guide.md');
    writeFile(wsDoc, 'doc-content');

    const result = await runAddToSourcePipeline(pkgName, 'docs', { apply: false });
    assert.ok(result.success, result.error);

    const addedFile = path.join(pkgDir, 'root', 'docs', 'guide.md');
    assert.equal(fs.readFileSync(addedFile, UTF8), 'doc-content');

    const index = await readWorkspaceIndex(tmp);
    const pkgEntry = index.index.packages[pkgName];
    assert.ok(pkgEntry, 'pkg entry should exist');
    assert.deepEqual(pkgEntry.files['root/docs/guide.md'], ['docs/guide.md']);

    console.log('add copy-to-root test passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

(async () => {
  await testSaveSyncsWorkspaceToSource();
  await testAddCopiesToRootAndUpdatesIndex();
})();
