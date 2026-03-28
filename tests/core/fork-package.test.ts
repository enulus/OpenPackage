import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { join } from 'path';
import { mkdir, rm, readFile, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { forkPackageFromSource } from '../../packages/core/src/core/fork-package.js';
import { exists } from '../../packages/core/src/utils/fs.js';

describe('forkPackageFromSource', () => {
  let testDir: string;
  let sourceDir: string;
  let targetDir: string;

  before(async () => {
    testDir = join(tmpdir(), `opkg-test-fork-${Date.now()}`);
    sourceDir = join(testDir, 'source-pkg');
    targetDir = join(testDir, 'target-pkg');
    await mkdir(sourceDir, { recursive: true });
    await mkdir(join(sourceDir, 'skills', 'my-skill'), { recursive: true });
    await mkdir(targetDir, { recursive: true });
  });

  after(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should copy source manifest metadata with name updated', async () => {
    // Source package with full metadata
    await writeFile(join(sourceDir, 'openpackage.yml'), [
      'name: source-pkg',
      'version: 1.2.3',
      'description: "A package with rich metadata"',
      'keywords: [testing, fork, metadata]',
    ].join('\n'));

    await writeFile(join(sourceDir, 'skills', 'my-skill', 'SKILL.md'), '# My Skill\nContent here.');

    // Pre-create a minimal manifest in target (as createPackage would)
    await writeFile(join(targetDir, 'openpackage.yml'), 'name: forked-pkg\n');

    const result = await forkPackageFromSource({
      source: sourceDir,
      targetDir,
      newPackageName: 'forked-pkg',
      cwd: testDir,
    });

    // Verify content files were copied
    assert.strictEqual(result.filesCopied, 1);
    assert.strictEqual(result.sourcePackageName, 'source-pkg');

    const skillContent = await readFile(join(targetDir, 'skills', 'my-skill', 'SKILL.md'), 'utf-8');
    assert.strictEqual(skillContent, '# My Skill\nContent here.');

    // Verify manifest was overwritten with source metadata + new name
    const manifest = await readFile(join(targetDir, 'openpackage.yml'), 'utf-8');
    assert.ok(manifest.includes('name: forked-pkg'), 'name should be the new package name');
    assert.ok(manifest.includes('version: 1.2.3'), 'version should be preserved from source');
    assert.ok(manifest.includes('A package with rich metadata'), 'description should be preserved');
    assert.ok(manifest.includes('keywords:'), 'keywords should be preserved');
  });

  it('should preserve minimal manifest when source has none', async () => {
    const noManifestSource = join(testDir, 'bare-source');
    const bareTarget = join(testDir, 'bare-target');
    await mkdir(join(noManifestSource, 'skills', 'foo'), { recursive: true });
    await mkdir(bareTarget, { recursive: true });

    // Source with no openpackage.yml
    await writeFile(join(noManifestSource, 'skills', 'foo', 'SKILL.md'), '# Foo');

    // Pre-create minimal manifest in target
    await writeFile(join(bareTarget, 'openpackage.yml'), 'name: bare-pkg\n');

    await forkPackageFromSource({
      source: noManifestSource,
      targetDir: bareTarget,
      newPackageName: 'bare-pkg',
      cwd: testDir,
    });

    // Minimal manifest should remain untouched
    const manifest = await readFile(join(bareTarget, 'openpackage.yml'), 'utf-8');
    assert.ok(manifest.includes('name: bare-pkg'));
    assert.ok(!manifest.includes('version:'), 'should not have version from nowhere');
  });

  it('should copy nested openpackage.yml files as regular files', async () => {
    const nestedSource = join(testDir, 'nested-source');
    const nestedTarget = join(testDir, 'nested-target');
    await mkdir(join(nestedSource, 'docker'), { recursive: true });
    await mkdir(nestedTarget, { recursive: true });

    // Root manifest
    await writeFile(join(nestedSource, 'openpackage.yml'), [
      'name: nested-pkg',
      'version: 0.5.0',
      'description: "Has nested manifests"',
    ].join('\n'));

    // Nested manifest (e.g., docker template)
    await writeFile(join(nestedSource, 'docker', 'openpackage.yml'), [
      'name: template-agent',
      'dependencies:',
      '  - name: some-dep',
    ].join('\n'));

    await writeFile(join(nestedTarget, 'openpackage.yml'), 'name: my-fork\n');

    const result = await forkPackageFromSource({
      source: nestedSource,
      targetDir: nestedTarget,
      newPackageName: 'my-fork',
      cwd: testDir,
    });

    // Nested manifest should be copied as a regular file
    assert.strictEqual(result.filesCopied, 1); // only docker/openpackage.yml (root is handled separately)
    const nestedManifest = await readFile(join(nestedTarget, 'docker', 'openpackage.yml'), 'utf-8');
    assert.ok(nestedManifest.includes('name: template-agent'), 'nested manifest should be copied verbatim');

    // Root manifest should have updated name but source metadata
    const rootManifest = await readFile(join(nestedTarget, 'openpackage.yml'), 'utf-8');
    assert.ok(rootManifest.includes('name: my-fork'));
    assert.ok(rootManifest.includes('Has nested manifests'));
  });
});
