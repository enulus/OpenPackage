import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createWorkspacePackageYml } from '../../../src/utils/package-management.js';
import { getWorkspaceIndexPath, readWorkspaceIndex, writeWorkspaceIndex } from '../../../src/utils/workspace-index-yml.js';

const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-ws-bootstrap-'));

try {
  const created = await createWorkspacePackageYml(workspace, false);
  assert.ok(created, 'createWorkspacePackageYml should create a new workspace manifest');

  const manifestPath = path.join(workspace, '.openpackage', 'openpackage.yml');
  const manifestExists = await fs.stat(manifestPath).then(() => true).catch(() => false);
  assert.equal(manifestExists, true, 'workspace manifest should exist');

  const indexPath = getWorkspaceIndexPath(workspace);
  await writeWorkspaceIndex({ path: indexPath, index: { packages: {} } });

  const indexExists = await fs.stat(indexPath).then(() => true).catch(() => false);
  assert.equal(indexExists, true, 'workspace unified index should exist');

  const index = await readWorkspaceIndex(workspace);
  assert.deepEqual(index.index.packages, {}, 'workspace unified index should round-trip');

  console.log('workspace-bootstrap tests passed');
} finally {
  await fs.rm(workspace, { recursive: true, force: true });
}

