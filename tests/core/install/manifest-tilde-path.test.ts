import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import * as yaml from 'js-yaml';

import { buildPathInstallContext } from '../../../src/core/install/unified/index.js';
import { updateManifestPhase } from '../../../src/core/install/unified/phases/manifest.js';
import { parsePackageYml } from '../../../src/utils/package-yml.js';
import { getLocalPackageYmlPath } from '../../../src/utils/paths.js';
import type { PackageYml } from '../../../src/types/index.js';
import type { ExecutionContext } from '../../../src/types/execution-context.js';
import type { InstallationContext } from '../../../src/core/install/unified/context.js';

function makeExecContext(targetDir: string): ExecutionContext {
  return { sourceCwd: targetDir, targetDir, isGlobal: false };
}

const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'opkg-tilde-test-'));

function setupWorkspace(): string {
  const workspaceDir = path.join(tmpBase, 'workspace');
  const opkgDir = path.join(workspaceDir, '.openpackage');
  mkdirSync(opkgDir, { recursive: true });

  const manifest: PackageYml = {
    name: 'test-workspace',
    dependencies: [],
    'dev-dependencies': []
  };

  const manifestPath = path.join(opkgDir, 'openpackage.yml');
  writeFileSync(manifestPath, yaml.dump(manifest));

  return workspaceDir;
}

function setupPackageSource(packageName: string): string {
  const homeDir = os.homedir();
  const packagePath = path.join(homeDir, '.openpackage', 'packages', packageName);
  mkdirSync(packagePath, { recursive: true });

  const packageYml: PackageYml = {
    name: packageName,
    version: '1.0.0',
    description: 'Test package'
  };

  writeFileSync(path.join(packagePath, 'openpackage.yml'), yaml.dump(packageYml));
  writeFileSync(path.join(packagePath, 'test.txt'), 'test content');

  return packagePath;
}

/**
 * Test that path-based installations from ~/.openpackage/packages/ 
 * use tilde notation in openpackage.yml
 */
async function testTildePathInManifest(): Promise<void> {
  const workspaceDir = setupWorkspace();
  const packageName = 'test-package';
  const packagePath = setupPackageSource(packageName);

  // Build context for path installation
  const ctx = await buildPathInstallContext(
    makeExecContext(workspaceDir),
    packagePath,
    { sourceType: 'directory' }
  );

  // Set the package name and add resolved package
  ctx.source.packageName = packageName;
  ctx.resolvedPackages = [{
    name: packageName,
    version: '1.0.0',
    isRoot: true,
    contentRoot: packagePath,
    metadata: {
      name: packageName,
      version: '1.0.0'
    },
    files: []
  }];

  // Run the manifest update phase
  await updateManifestPhase(ctx);

  // Read the manifest and verify tilde notation is used
  const manifestPath = getLocalPackageYmlPath(workspaceDir);
  const manifest = await parsePackageYml(manifestPath);

  assert.ok(manifest.dependencies, 'dependencies array should exist');
  assert.equal(manifest.dependencies.length, 1, 'should have one package');
  
  const pkg = manifest.dependencies[0];
  assert.equal(pkg.name, packageName, 'package name should match');
  assert.ok(pkg.path, 'path field should be set');
  assert.ok(pkg.path.startsWith('~/.openpackage/'), 
    `path should use tilde notation, got: ${pkg.path}`);
  assert.equal(pkg.path, `~/.openpackage/packages/${packageName}`,
    `path should be ~/.openpackage/packages/${packageName}, got: ${pkg.path}`);
}

/**
 * Test that relative paths are preserved as-is
 */
async function testRelativePathPreserved(): Promise<void> {
  const workspaceDir = setupWorkspace();
  const packageName = 'relative-package';
  const relativePath = './local/packages/relative-package';
  const packagePath = path.join(workspaceDir, relativePath);
  
  mkdirSync(packagePath, { recursive: true });
  
  const packageYml: PackageYml = {
    name: packageName,
    version: '1.0.0'
  };
  
  writeFileSync(path.join(packagePath, 'openpackage.yml'), yaml.dump(packageYml));

  // Build context with relative path
  const ctx = await buildPathInstallContext(
    makeExecContext(workspaceDir),
    relativePath,
    { sourceType: 'directory' }
  );

  ctx.source.packageName = packageName;
  ctx.resolvedPackages = [{
    name: packageName,
    version: '1.0.0',
    isRoot: true,
    contentRoot: packagePath,
    metadata: {
      name: packageName,
      version: '1.0.0'
    },
    files: []
  }];

  await updateManifestPhase(ctx);

  const manifestPath = getLocalPackageYmlPath(workspaceDir);
  const manifest = await parsePackageYml(manifestPath);

  assert.ok(manifest.dependencies, 'dependencies array should exist');
  assert.equal(manifest.dependencies.length, 1, 'should have one package');
  
  const pkg = manifest.dependencies[0];
  assert.equal(pkg.name, packageName, 'package name should match');
  assert.ok(pkg.path, 'path field should be set');
  assert.ok(pkg.path.startsWith('./'), 
    `relative path should be preserved, got: ${pkg.path}`);
}

/**
 * Test that absolute paths under workspace get converted to workspace-relative
 * This is the enhanced behavior from using formatPathForYaml
 */
async function testWorkspaceRelativePath(): Promise<void> {
  const workspaceDir = setupWorkspace();
  const packageName = 'workspace-package';
  const packagePath = path.join(workspaceDir, 'vendor', 'workspace-package');
  
  mkdirSync(packagePath, { recursive: true });
  
  const packageYml: PackageYml = {
    name: packageName,
    version: '1.0.0'
  };
  
  writeFileSync(path.join(packagePath, 'openpackage.yml'), yaml.dump(packageYml));

  // Build context with ABSOLUTE path (under workspace)
  const ctx = await buildPathInstallContext(
    makeExecContext(workspaceDir),
    packagePath, // absolute path
    { sourceType: 'directory' }
  );

  ctx.source.packageName = packageName;
  ctx.resolvedPackages = [{
    name: packageName,
    version: '1.0.0',
    isRoot: true,
    contentRoot: packagePath,
    metadata: {
      name: packageName,
      version: '1.0.0'
    },
    files: []
  }];

  await updateManifestPhase(ctx);

  const manifestPath = getLocalPackageYmlPath(workspaceDir);
  const manifest = await parsePackageYml(manifestPath);

  assert.ok(manifest.dependencies, 'dependencies array should exist');
  assert.equal(manifest.dependencies.length, 1, 'should have one package');
  
  const pkg = manifest.dependencies[0];
  assert.equal(pkg.name, packageName, 'package name should match');
  assert.ok(pkg.path, 'path field should be set');
  assert.equal(pkg.path, './vendor/workspace-package',
    `absolute path under workspace should become workspace-relative, got: ${pkg.path}`);
}

async function run(): Promise<void> {
  try {
    await testTildePathInManifest();
    console.log('✓ Tilde path in manifest test passed');
    
    await testRelativePathPreserved();
    console.log('✓ Relative path preservation test passed');
    
    await testWorkspaceRelativePath();
    console.log('✓ Workspace-relative path test passed');
    
    console.log('\nAll manifest-tilde-path tests passed');
  } finally {
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error('Test failed:', error);
  process.exitCode = 1;
});
