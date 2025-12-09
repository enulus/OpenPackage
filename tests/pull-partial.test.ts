import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildPullEndpoint, pullPackageFromRemote } from '../src/core/remote-pull.js';
import { packageManager } from '../src/core/package.js';
import { createTarballFromPackage } from '../src/utils/tarball.js';
import { parsePackageInstallSpec } from '../src/utils/package-name.js';
import { getPackageVersionPath } from '../src/core/directory.js';

const originalHome = process.env.HOME;
const tempHome = await mkdtemp(join(tmpdir(), 'pull-partial-'));
process.env.HOME = tempHome;

class StubHttpClient {
  constructor(private readonly buffer: Buffer) {}

  async downloadFile(): Promise<ArrayBuffer> {
    return this.buffer;
  }
}

async function runEndpointTest(): Promise<void> {
  const endpoint = buildPullEndpoint('@scope/name', '1.0.0', {
    recursive: true,
    paths: ['docs/read me.md']
  });

  assert(endpoint.includes('paths=docs%2Fread%20me.md'));
  assert(endpoint.includes('includeManifest=true'));
  assert(endpoint.includes('recursive=true'));
}

async function runParseSpecTest(): Promise<void> {
  const parsed = parsePackageInstallSpec('@scope/name@1.2.3/docs/file.md');
  assert.equal(parsed.name, '@scope/name');
  assert.equal(parsed.version, '1.2.3');
  assert.equal(parsed.registryPath, 'docs/file.md');
}

async function runPartialMergeTest(): Promise<void> {
  const manifest = ['name: partial-merge', 'version: "1.0.0"', ''].join('\n');

  await packageManager.savePackage(
    {
      metadata: { name: 'partial-merge', version: '1.0.0', partial: true } as any,
      files: [
        { path: '.openpackage/package.yml', content: manifest },
        { path: 'docs/keep.md', content: 'keep' },
        { path: 'docs/old.md', content: 'old' }
      ]
    },
    { partial: true }
  );

  const remotePackage = {
    metadata: { name: 'partial-merge', version: '1.0.0' } as any,
    files: [
      { path: '.openpackage/package.yml', content: manifest },
      { path: 'docs/old.md', content: 'remote' },
      { path: 'docs/new.md', content: 'new' }
    ]
  };

  const tarball = await createTarballFromPackage(remotePackage as any);
  const response = {
    package: {
      name: 'partial-merge',
      description: '',
      keywords: [],
      isPrivate: false,
      createdAt: '',
      updatedAt: '',
      versions: []
    },
    version: {
      version: '1.0.0',
      tarballSize: tarball.size + 5,
      createdAt: '',
      updatedAt: ''
    },
    downloads: [{ name: 'partial-merge@1.0.0', downloadUrl: 'https://example.com/mock' }]
  };

  const existingState = await packageManager.getPackageVersionState('partial-merge', '1.0.0');
  await pullPackageFromRemote('partial-merge', '1.0.0', {
    preFetchedResponse: response as any,
    httpClient: new StubHttpClient(tarball.buffer) as any,
    paths: ['docs/old.md', 'docs/new.md'],
    savePaths: ['docs/old.md', 'docs/new.md'],
    mergeIntoExisting: true,
    partialLocalState: existingState
  });

  const pkgPath = getPackageVersionPath('partial-merge', '1.0.0');
  const kept = await readFile(join(pkgPath, 'docs/keep.md'), 'utf8');
  const overwritten = await readFile(join(pkgPath, 'docs/old.md'), 'utf8');
  const added = await readFile(join(pkgPath, 'docs/new.md'), 'utf8');
  const manifestContent = await readFile(join(pkgPath, '.openpackage', 'package.yml'), 'utf8');

  assert.equal(kept, 'keep');
  assert.equal(overwritten, 'remote');
  assert.equal(added, 'new');
  assert(manifestContent.includes('partial: true'));

  const mergedState = await packageManager.getPackageVersionState('partial-merge', '1.0.0');
  assert.equal(mergedState.isPartial, true);
  assert(mergedState.paths.includes('docs/keep.md'));
  assert(mergedState.paths.includes('docs/old.md'));
  assert(mergedState.paths.includes('docs/new.md'));
}

async function runIntegritySkipTest(): Promise<void> {
  const manifest = ['name: integrity-partial', 'version: "1.0.0"', ''].join('\n');
  const pkg = {
    metadata: { name: 'integrity-partial', version: '1.0.0' } as any,
    files: [
      { path: '.openpackage/package.yml', content: manifest },
      { path: 'docs/file.md', content: 'hello' }
    ]
  };

  const tarball = await createTarballFromPackage(pkg as any);
  const response = {
    package: {
      name: 'integrity-partial',
      description: '',
      keywords: [],
      isPrivate: false,
      createdAt: '',
      updatedAt: '',
      versions: []
    },
    version: {
      version: '1.0.0',
      tarballSize: tarball.size + 100,
      createdAt: '',
      updatedAt: ''
    },
    downloads: [{ name: 'integrity-partial@1.0.0', downloadUrl: 'https://example.com/mock' }]
  };

  const result = await pullPackageFromRemote('integrity-partial', '1.0.0', {
    preFetchedResponse: response as any,
    httpClient: new StubHttpClient(tarball.buffer) as any,
    paths: ['docs/file.md']
  });

  assert.equal(result.success, true);
  const state = await packageManager.getPackageVersionState('integrity-partial', '1.0.0');
  assert.equal(state.isPartial, true);
  assert(state.paths.includes('docs/file.md'));
}

try {
  await runEndpointTest();
  await runParseSpecTest();
  await runPartialMergeTest();
  await runIntegritySkipTest();

  console.log('pull partial tests passed');
} finally {
  process.env.HOME = originalHome;
  await rm(tempHome, { recursive: true, force: true });
}

