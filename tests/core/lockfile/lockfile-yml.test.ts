/**
 * Tests for lockfile I/O — read, write, sanitization, cache.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, beforeEach } from 'node:test';
import {
  readLockfile,
  writeLockfile,
  removeLockfileEntry,
  getLockfilePath,
  invalidateLockfileCache,
} from '../../../packages/core/src/utils/lockfile-yml.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-lockfile-test-'));
}

function setupWorkspace(tmpDir: string): string {
  const opkgDir = path.join(tmpDir, '.openpackage');
  fs.mkdirSync(opkgDir, { recursive: true });
  return tmpDir;
}

describe('lockfile-yml', () => {
  let tmpDir: string;

  beforeEach(() => {
    invalidateLockfileCache();
    tmpDir = setupWorkspace(createTempDir());
  });

  // ── Read/Write round-trip ──────────────────────────────

  it('writes and reads a lockfile with version and dependencies', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: {
          'my-package': {
            version: '1.0.0',
            dependencies: ['dep-a', 'dep-b'],
          },
          'dep-a': {
            version: '2.3.0',
          },
        },
      },
    });

    invalidateLockfileCache();
    const { lockfile } = await readLockfile(tmpDir);

    assert.equal(lockfile.lockfileVersion, 1);
    assert.equal(lockfile.packages['my-package'].version, '1.0.0');
    assert.deepEqual(lockfile.packages['my-package'].dependencies, ['dep-a', 'dep-b']);
    assert.equal(lockfile.packages['dep-a'].version, '2.3.0');
    assert.equal(lockfile.packages['dep-a'].dependencies, undefined);
  });

  it('writes and reads marketplace metadata', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: {
          'my-plugin': {
            version: '0.1.0',
            marketplace: {
              url: 'https://example.com/repo',
              commitSha: 'abc123',
              pluginName: 'my-plugin',
            },
          },
        },
      },
    });

    invalidateLockfileCache();
    const { lockfile } = await readLockfile(tmpDir);

    assert.equal(lockfile.packages['my-plugin'].marketplace?.url, 'https://example.com/repo');
    assert.equal(lockfile.packages['my-plugin'].marketplace?.commitSha, 'abc123');
    assert.equal(lockfile.packages['my-plugin'].marketplace?.pluginName, 'my-plugin');
  });

  // ── Missing lockfile ───────────────────────────────────

  it('returns empty lockfile when file does not exist', async () => {
    const { lockfile } = await readLockfile(tmpDir);
    assert.equal(lockfile.lockfileVersion, 1);
    assert.deepEqual(lockfile.packages, {});
  });

  // ── Sanitization ───────────────────────────────────────

  it('sanitizes invalid version (non-string)', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    fs.writeFileSync(lockfilePath, 'lockfileVersion: 1\npackages:\n  pkg:\n    version: 123\n');
    invalidateLockfileCache();

    const { lockfile } = await readLockfile(tmpDir);
    assert.equal(lockfile.packages['pkg'].version, undefined);
  });

  it('sanitizes invalid dependencies (non-array)', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    fs.writeFileSync(lockfilePath, 'lockfileVersion: 1\npackages:\n  pkg:\n    version: "1.0.0"\n    dependencies: "not-an-array"\n');
    invalidateLockfileCache();

    const { lockfile } = await readLockfile(tmpDir);
    assert.equal(lockfile.packages['pkg'].dependencies, undefined);
  });

  it('filters non-string entries from dependencies array', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    fs.writeFileSync(lockfilePath, 'lockfileVersion: 1\npackages:\n  pkg:\n    dependencies:\n      - valid-dep\n      - 123\n      - ""\n      - another-dep\n');
    invalidateLockfileCache();

    const { lockfile } = await readLockfile(tmpDir);
    assert.deepEqual(lockfile.packages['pkg'].dependencies, ['valid-dep', 'another-dep']);
  });

  it('rejects unsupported lockfile version', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    fs.writeFileSync(lockfilePath, 'lockfileVersion: 99\npackages: {}\n');
    invalidateLockfileCache();

    const { lockfile } = await readLockfile(tmpDir);
    assert.deepEqual(lockfile.packages, {});
  });

  // ── Dependencies dedup and sort ────────────────────────

  it('deduplicates and sorts dependencies on write', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: {
          pkg: {
            version: '1.0.0',
            dependencies: ['zebra', 'alpha', 'zebra', 'beta'],
          },
        },
      },
    });

    invalidateLockfileCache();
    const { lockfile } = await readLockfile(tmpDir);
    assert.deepEqual(lockfile.packages['pkg'].dependencies, ['alpha', 'beta', 'zebra']);
  });

  // ── Source provenance fields ─────────────────────────────

  it('writes and reads path source', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: {
          'local-pkg': {
            version: '1.0.0',
            path: '../local-pkg',
          },
        },
      },
    });

    invalidateLockfileCache();
    const { lockfile } = await readLockfile(tmpDir);
    assert.equal(lockfile.packages['local-pkg'].path, '../local-pkg');
    assert.equal(lockfile.packages['local-pkg'].url, undefined);
    assert.equal(lockfile.packages['local-pkg'].ref, undefined);
  });

  it('writes and reads git source with url, ref, and path', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: {
          'git-pkg': {
            version: '0.3.0',
            url: 'https://github.com/user/repo.git',
            ref: '9f9f693a4e',
            path: 'plugins/foo',
          },
        },
      },
    });

    invalidateLockfileCache();
    const { lockfile } = await readLockfile(tmpDir);
    assert.equal(lockfile.packages['git-pkg'].url, 'https://github.com/user/repo.git');
    assert.equal(lockfile.packages['git-pkg'].ref, '9f9f693a4e');
    assert.equal(lockfile.packages['git-pkg'].path, 'plugins/foo');
  });

  it('registry source has no path/url/ref', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: {
          'registry-pkg': { version: '2.0.0' },
        },
      },
    });

    invalidateLockfileCache();
    const { lockfile } = await readLockfile(tmpDir);
    assert.equal(lockfile.packages['registry-pkg'].version, '2.0.0');
    assert.equal(lockfile.packages['registry-pkg'].path, undefined);
    assert.equal(lockfile.packages['registry-pkg'].url, undefined);
    assert.equal(lockfile.packages['registry-pkg'].ref, undefined);
  });

  it('sanitizes non-string source fields', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    fs.writeFileSync(lockfilePath, 'lockfileVersion: 1\npackages:\n  pkg:\n    version: "1.0.0"\n    path: 123\n    url: true\n    ref: []\n');
    invalidateLockfileCache();

    const { lockfile } = await readLockfile(tmpDir);
    assert.equal(lockfile.packages['pkg'].path, undefined);
    assert.equal(lockfile.packages['pkg'].url, undefined);
    assert.equal(lockfile.packages['pkg'].ref, undefined);
  });

  // ── Remove entry ───────────────────────────────────────

  it('removes a package entry from the lockfile', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: {
          'pkg-a': { version: '1.0.0' },
          'pkg-b': { version: '2.0.0' },
        },
      },
    });

    invalidateLockfileCache();
    await removeLockfileEntry(tmpDir, 'pkg-a');

    invalidateLockfileCache();
    const { lockfile } = await readLockfile(tmpDir);
    assert.equal(lockfile.packages['pkg-a'], undefined);
    assert.equal(lockfile.packages['pkg-b'].version, '2.0.0');
  });

  it('removes stale dependency references when entry is removed', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: {
          'pkg-a': { version: '1.0.0', dependencies: ['pkg-b', 'pkg-c'] },
          'pkg-b': { version: '2.0.0', dependencies: ['pkg-c'] },
          'pkg-c': { version: '3.0.0' },
        },
      },
    });

    invalidateLockfileCache();
    await removeLockfileEntry(tmpDir, 'pkg-c');

    invalidateLockfileCache();
    const { lockfile } = await readLockfile(tmpDir);
    assert.equal(lockfile.packages['pkg-c'], undefined);
    // pkg-a and pkg-b should no longer reference pkg-c
    assert.deepEqual(lockfile.packages['pkg-a'].dependencies, ['pkg-b']);
    assert.equal(lockfile.packages['pkg-b'].dependencies, undefined); // was ['pkg-c'], now empty → deleted
  });

  it('does nothing when removing non-existent entry', async () => {
    const { lockfile: before } = await readLockfile(tmpDir);
    await removeLockfileEntry(tmpDir, 'does-not-exist');
    invalidateLockfileCache();
    const { lockfile: after } = await readLockfile(tmpDir);
    assert.deepEqual(before.packages, after.packages);
  });

  // ── Cache ──────────────────────────────────────────────

  it('caches lockfile reads', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: { pkg: { version: '1.0.0' } },
      },
    });

    invalidateLockfileCache();
    const result1 = await readLockfile(tmpDir);
    const result2 = await readLockfile(tmpDir);
    assert.equal(result1, result2); // same object reference = cached
  });

  it('invalidates cache per directory', async () => {
    const lockfilePath = getLockfilePath(tmpDir);
    await writeLockfile({
      path: lockfilePath,
      lockfile: {
        lockfileVersion: 1,
        packages: { pkg: { version: '1.0.0' } },
      },
    });

    invalidateLockfileCache();
    const result1 = await readLockfile(tmpDir);
    invalidateLockfileCache(tmpDir);
    const result2 = await readLockfile(tmpDir);
    assert.notEqual(result1, result2); // different reference after invalidation
  });
});
