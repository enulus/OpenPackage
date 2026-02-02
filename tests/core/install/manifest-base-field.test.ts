import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

console.log('manifest-base-field tests starting');

const { parsePackageYml, writePackageYml } = await import(
  new URL('../../../src/utils/package-yml.js', import.meta.url).href
);
const { buildInstallContext } = await import(
  new URL('../../../src/core/install/unified/context-builders.js', import.meta.url).href
);
const { writeTextFile } = await import(
  new URL('../../../src/utils/fs.js', import.meta.url).href
);

console.log('Imports loaded successfully');

let tempDir: string;

function setupTempDir() {
  tempDir = mkdtempSync(join(tmpdir(), 'opkg-test-'));
}

function cleanupTempDir() {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function parsesBaseFieldFromDependencies() {
  setupTempDir();
  
  try {
    const manifestPath = join(tempDir, 'openpackage.yml');
    const manifestContent = `name: test-workspace
dependencies:
  - name: gh@user/repo
    url: https://github.com/user/repo.git
    base: plugins/my-plugin
`;
    
    await writeTextFile(manifestPath, manifestContent);
    
    const parsed = await parsePackageYml(manifestPath);
    
    assert.ok(parsed.dependencies, 'dependencies should be defined');
    assert.equal(parsed.dependencies.length, 1, 'should have 1 dependency');
    assert.equal(parsed.dependencies[0].base, 'plugins/my-plugin', 'base should be parsed');
    
    console.log('✓ Parses base field from dependencies');
  } finally {
    cleanupTempDir();
  }
}

async function handlesDependenciesWithoutBase() {
  setupTempDir();
  
  try {
    const manifestPath = join(tempDir, 'openpackage.yml');
    const manifestContent = `name: test-workspace
dependencies:
  - name: my-package
    version: 1.0.0
`;
    
    await writeTextFile(manifestPath, manifestContent);
    
    const parsed = await parsePackageYml(manifestPath);
    
    assert.ok(parsed.dependencies, 'dependencies should be defined');
    assert.equal(parsed.dependencies.length, 1, 'should have 1 dependency');
    assert.equal(parsed.dependencies[0].base, undefined, 'base should be undefined');
    
    console.log('✓ Handles dependencies without base field');
  } finally {
    cleanupTempDir();
  }
}

async function validatesBaseFieldIsString() {
  setupTempDir();
  
  try {
    const manifestPath = join(tempDir, 'openpackage.yml');
    const manifestContent = `name: test-workspace
dependencies:
  - name: gh@user/repo
    url: https://github.com/user/repo.git
    base: 123
`;
    
    await writeTextFile(manifestPath, manifestContent);
    
    let errorThrown = false;
    try {
      await parsePackageYml(manifestPath);
    } catch (error: any) {
      errorThrown = true;
      assert.match(error.message, /invalid base field.*must be a string/i, 'should throw validation error');
    }
    
    assert.ok(errorThrown, 'should throw error for invalid base');
    
    console.log('✓ Validates base field is a string');
  } finally {
    cleanupTempDir();
  }
}

async function validatesBaseFieldIsNotAbsolute() {
  setupTempDir();
  
  try {
    const manifestPath = join(tempDir, 'openpackage.yml');
    const manifestContent = `name: test-workspace
dependencies:
  - name: gh@user/repo
    url: https://github.com/user/repo.git
    base: /absolute/path
`;
    
    await writeTextFile(manifestPath, manifestContent);
    
    let errorThrown = false;
    try {
      await parsePackageYml(manifestPath);
    } catch (error: any) {
      errorThrown = true;
      assert.match(error.message, /absolute base path.*must be relative/i, 'should throw validation error');
    }
    
    assert.ok(errorThrown, 'should throw error for absolute base');
    
    console.log('✓ Validates base field is not absolute');
  } finally {
    cleanupTempDir();
  }
}

async function preservesBaseFieldWhenWriting() {
  setupTempDir();
  
  try {
    const manifestPath = join(tempDir, 'openpackage.yml');
    
    const config = {
      name: 'test-workspace',
      dependencies: [
        {
          name: 'gh@user/repo',
          url: 'https://github.com/user/repo.git',
          base: 'plugins/my-plugin'
        }
      ]
    };
    
    await writePackageYml(manifestPath, config);
    
    // Read back and verify
    const parsed = await parsePackageYml(manifestPath);
    assert.equal(parsed.dependencies[0].base, 'plugins/my-plugin', 'base should be preserved');
    
    console.log('✓ Preserves base field when writing');
  } finally {
    cleanupTempDir();
  }
}

async function omitsBaseFieldWhenUndefined() {
  setupTempDir();
  
  try {
    const manifestPath = join(tempDir, 'openpackage.yml');
    
    const config = {
      name: 'test-workspace',
      dependencies: [
        {
          name: 'my-package',
          version: '1.0.0'
        }
      ]
    };
    
    await writePackageYml(manifestPath, config);
    
    // Read back and verify
    const parsed = await parsePackageYml(manifestPath);
    assert.equal(parsed.dependencies[0].base, undefined, 'base should be undefined');
    
    console.log('✓ Omits base field when undefined');
  } finally {
    cleanupTempDir();
  }
}

async function passesManifestBaseToSource() {
  setupTempDir();
  
  try {
    // Setup workspace manifest with base field
    const opkgDir = join(tempDir, '.openpackage');
    await writeTextFile(opkgDir, '', { isDirectory: true });
    
    const manifestPath = join(opkgDir, 'openpackage.yml');
    const manifestContent = `name: test-workspace
dependencies:
  - name: gh@user/repo
    url: https://github.com/user/repo.git#main
    base: plugins/my-plugin
`;
    
    await writeTextFile(manifestPath, manifestContent);
    
    // Build contexts for bulk install
    const contexts = await buildInstallContext(tempDir, undefined, {});
    
    // Should have at least one context (from manifest dependency)
    assert.ok(Array.isArray(contexts), 'contexts should be an array');
    
    // Find the git source context
    const gitContext = contexts.find(ctx => ctx.source.type === 'git');
    assert.ok(gitContext, 'should have a git source context');
    
    // Verify manifestBase is set in source
    assert.equal(gitContext.source.manifestBase, 'plugins/my-plugin', 'manifestBase should be set');
    
    // Verify context has baseRelative and baseSource
    assert.equal(gitContext.baseRelative, 'plugins/my-plugin', 'baseRelative should be set');
    assert.equal(gitContext.baseSource, 'manifest', 'baseSource should be manifest');
    
    console.log('✓ Passes manifest base to source');
  } finally {
    cleanupTempDir();
  }
}

async function handlesMultipleDependenciesWithMixedBase() {
  setupTempDir();
  
  try {
    const opkgDir = join(tempDir, '.openpackage');
    await writeTextFile(opkgDir, '', { isDirectory: true });
    
    const manifestPath = join(opkgDir, 'openpackage.yml');
    const manifestContent = `name: test-workspace
dependencies:
  - name: gh@user/repo1
    url: https://github.com/user/repo1.git
    base: plugins/plugin1
  - name: gh@user/repo2
    url: https://github.com/user/repo2.git
  - name: my-package
    version: 1.0.0
`;
    
    await writeTextFile(manifestPath, manifestContent);
    
    const contexts = await buildInstallContext(tempDir, undefined, {});
    
    assert.ok(Array.isArray(contexts), 'contexts should be an array');
    
    // Find contexts
    const repo1Context = contexts.find(
      ctx => ctx.source.type === 'git' && ctx.source.packageName === 'gh@user/repo1'
    );
    const repo2Context = contexts.find(
      ctx => ctx.source.type === 'git' && ctx.source.packageName === 'gh@user/repo2'
    );
    const registryContext = contexts.find(
      ctx => ctx.source.type === 'registry'
    );
    
    // repo1 should have manifestBase
    assert.ok(repo1Context, 'repo1 context should exist');
    assert.equal(repo1Context.source.manifestBase, 'plugins/plugin1', 'repo1 should have manifestBase');
    assert.equal(repo1Context.baseRelative, 'plugins/plugin1', 'repo1 baseRelative should be set');
    assert.equal(repo1Context.baseSource, 'manifest', 'repo1 baseSource should be manifest');
    
    // repo2 should not have manifestBase
    assert.ok(repo2Context, 'repo2 context should exist');
    assert.equal(repo2Context.source.manifestBase, undefined, 'repo2 should not have manifestBase');
    assert.equal(repo2Context.baseRelative, undefined, 'repo2 baseRelative should be undefined');
    
    // registry should not have manifestBase
    assert.ok(registryContext, 'registry context should exist');
    assert.equal(registryContext.source.manifestBase, undefined, 'registry should not have manifestBase');
    
    console.log('✓ Handles multiple dependencies with mixed base fields');
  } finally {
    cleanupTempDir();
  }
}

// Run tests
try {
  await parsesBaseFieldFromDependencies();
  await handlesDependenciesWithoutBase();
  await validatesBaseFieldIsString();
  await validatesBaseFieldIsNotAbsolute();
  await preservesBaseFieldWhenWriting();
  await omitsBaseFieldWhenUndefined();
  await passesManifestBaseToSource();
  await handlesMultipleDependenciesWithMixedBase();

  console.log('✅ All manifest-base-field tests passed');
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}
