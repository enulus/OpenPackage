import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseGitSpec } from '../../src/utils/git-spec.js';
import { parsePackageYml } from '../../src/utils/package-yml.js';

// parseGitSpec: github shorthand
{
  const spec = parseGitSpec('github:owner/repo#v1');
  assert(spec);
  assert.equal(spec?.url, 'https://github.com/owner/repo.git');
  assert.equal(spec?.ref, 'v1');
}

// parseGitSpec: git url
{
  const spec = parseGitSpec('git:https://example.com/repo.git#main');
  assert(spec);
  assert.equal(spec?.url, 'https://example.com/repo.git');
  assert.equal(spec?.ref, 'main');
}

// schema validation: must choose exactly one source
await (async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opkg-schema-'));
  const path = join(dir, 'openpackage.yml');
  await writeFile(
    path,
    `
name: root
packages:
  - name: foo
    version: ^1.0.0
    path: ../foo
`
  );
  await assert.rejects(
    parsePackageYml(path),
    /has multiple sources/
  );
})();

// schema validation: ref requires git
await (async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opkg-schema-'));
  const path = join(dir, 'openpackage.yml');
  await writeFile(
    path,
    `
name: root
packages:
  - name: foo
    ref: main
`
  );
  await assert.rejects(
    parsePackageYml(path),
    /ref but no git\/url source/
  );
})();

// schema validation: valid git dependency passes
await (async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opkg-schema-'));
  const path = join(dir, 'openpackage.yml');
  await writeFile(
    path,
    `
name: root
packages:
  - name: foo
    git: https://example.com/foo.git
    ref: main
`
  );
  const parsed = await parsePackageYml(path);
  assert.equal(parsed.dependencies?.[0].url, 'https://example.com/foo.git#main');
})();

console.log('git-spec-and-schema tests passed');
