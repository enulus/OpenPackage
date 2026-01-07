import assert from 'node:assert/strict';

import { PACKAGE_PATHS } from '../../../src/constants/index.js';
import { buildPartialTarballPackage } from '../../../src/core/push/push-upload.js';

const manifestPath = PACKAGE_PATHS.MANIFEST_RELATIVE;

const pkg = {
  metadata: { name: 'partial-demo', version: '1.0.0' },
  files: [
    { path: manifestPath, content: 'name: partial-demo\nversion: 1.0.0\n' },
    { path: 'docs/guide.md', content: 'guide' },
    { path: 'src/index.ts', content: 'code' }
  ]
};

const partial = buildPartialTarballPackage(pkg, ['/docs/guide.md', 'src/index.ts']);
assert.equal(partial.files.length, 3);
assert(partial.files.some((f: any) => f.path === manifestPath));
assert(partial.files.some((f: any) => f.path === 'docs/guide.md'));
assert(partial.files.some((f: any) => f.path === 'src/index.ts'));

let threw = false;
try {
  buildPartialTarballPackage(
    {
      ...pkg,
      files: pkg.files.filter((f: any) => f.path !== manifestPath)
    },
    ['docs/guide.md']
  );
} catch {
  threw = true;
}
assert.equal(threw, true);

console.log('push-partial-tarball tests passed');

