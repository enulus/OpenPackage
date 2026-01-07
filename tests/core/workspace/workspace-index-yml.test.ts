import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getWorkspaceIndexPath, readWorkspaceIndex, writeWorkspaceIndex } from '../../../src/utils/workspace-index-yml.js';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-index-yml-'));

try {
  const indexPath = getWorkspaceIndexPath(tmpDir);

  const record = {
    path: indexPath,
    index: {
      packages: {
        pkgA: {
          path: '~/pkgA',
          version: '1.2.3',
          dependencies: ['b', 'a', 'b'],
          files: {
            'rules/file.md': ['.cursor/rules/file.md', '.cursor/rules/file.md'],
            'root/': ['app/dir', 'app/']
          }
        }
      }
    }
  };

  await writeWorkspaceIndex(record);

  const roundTripped = await readWorkspaceIndex(tmpDir);
  const pkgA = roundTripped.index.packages.pkgA;
  assert.ok(pkgA, 'pkgA should exist after round-trip');
  assert.equal(pkgA.path, '~/pkgA');
  assert.equal(pkgA.version, '1.2.3');
  assert.deepEqual(pkgA.dependencies, ['a', 'b']); // sorted + deduped

  // Files should be sorted and deduped
  assert.deepEqual(Object.keys(pkgA.files), ['root/', 'rules/file.md']);
  assert.deepEqual(pkgA.files['rules/file.md'], ['.cursor/rules/file.md']);
  assert.deepEqual(pkgA.files['root/'], ['app/', 'app/dir']);

  // Sanitize invalid shape -> empty packages
  fs.writeFileSync(indexPath, 'packages: 123', 'utf-8');
  const sanitized = await readWorkspaceIndex(tmpDir);
  assert.deepEqual(sanitized.index.packages, {});

  console.log('workspace-index-yml tests passed');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

