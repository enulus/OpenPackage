import assert from 'node:assert/strict';

import { PACKAGE_PATHS } from '../../../src/constants/index.js';
import { preparePackageForUpload } from '../../../src/core/push/push-upload.js';

const manifestPath = PACKAGE_PATHS.MANIFEST_RELATIVE;

function buildPkg(name: string) {
  return {
    metadata: { name, version: '1.0.0' },
    files: [
      { path: manifestPath, content: `name: ${name}\nversion: 1.0.0\n` },
      { path: 'README.md', content: 'readme' },
    ],
  };
}

// rewrites manifest and metadata for upload, without mutating the source package
{
  const source = buildPkg('demo');
  const upload = preparePackageForUpload(source as any, '@user/demo');

  assert.equal(upload.metadata.name, '@user/demo');
  assert.equal(source.metadata.name, 'demo'); // source untouched

  const uploadManifest = upload.files.find((f: any) => f.path === manifestPath);
  assert(uploadManifest);
  assert.match(uploadManifest!.content, /name:\s+"@user\/demo"/);

  const originalManifest = source.files.find((f: any) => f.path === manifestPath);
  assert(originalManifest);
  assert.match(originalManifest!.content, /name:\s+demo/);

  // Non-manifest files are preserved as-is
  const uploadReadme = upload.files.find((f: any) => f.path === 'README.md');
  const sourceReadme = source.files.find((f: any) => f.path === 'README.md');
  assert(uploadReadme && sourceReadme);
  assert.equal(uploadReadme!.content, 'readme');
}

// returns the same package when upload name matches
{
  const scoped = buildPkg('@user/demo');
  const result = preparePackageForUpload(scoped as any, '@user/demo');
  assert.equal(result, scoped);
}

// throws when manifest is missing
{
  let threw = false;
  try {
    preparePackageForUpload(
      {
        metadata: { name: 'demo', version: '1.0.0' },
        files: [{ path: 'README.md', content: 'readme' }],
      } as any,
      '@user/demo'
    );
  } catch {
    threw = true;
  }
  assert.equal(threw, true);
}

console.log('push-upload-prepare tests passed');

