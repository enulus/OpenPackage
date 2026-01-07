import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { join } from 'node:path';

import { installPackageByIndex } from '../../../src/utils/index-based-installer.js';
import { packageManager } from '../../../src/core/package.js';

const originalLoadPackage = packageManager.loadPackage;

let tempDir;

try {
  tempDir = await mkdtemp(join(process.env.TMPDIR || '/tmp', 'opkg-install-non-universal-'));

  // Stub packageManager.loadPackage to return a payload with a universal file and a non-universal README
  packageManager.loadPackage = async () => ({
    metadata: { name: 'pkg', version: '1.0.0' },
    files: [
      { path: 'README.md', content: 'readme' },
      { path: 'commands/foo.md', content: 'cmd' }
    ]
  });

  const result = await installPackageByIndex(
    tempDir,
    'pkg',
    '1.0.0',
    ['cursor'],
    {},
    undefined
  );

  // Universal file should be installed to platform path
  await access(join(tempDir, '.cursor', 'commands', 'foo.md'), fsConstants.R_OK);

  // Non-universal README must not be installed
  let readmeMissing = false;
  try {
    await access(join(tempDir, 'README.md'), fsConstants.R_OK);
  } catch {
    readmeMissing = true;
  }
  assert.equal(readmeMissing, true, 'README.md should not be installed');

  // Index-based installer should count only the universal file
  assert.equal(result.installed >= 1 || result.updated >= 1, true);

  console.log('install non-universal test passed');
} finally {
  packageManager.loadPackage = originalLoadPackage;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
}
