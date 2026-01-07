import * as assert from 'assert';
import { join } from 'path';
import { setupTestEnvironment, cleanupTestEnvironment, runCommand, createPackageYml } from '../../test-helpers.js';

/**
 * Test: Name-based install with version-aware priority resolution
 * 
 * Scenarios:
 * 1. Workspace package always wins (override)
 * 2. Global package newer than registry -> use global
 * 3. Registry newer than global -> use registry (with warning)
 * 4. Same version -> prefer global (mutable)
 * 5. Only global exists -> use global
 * 6. Only registry exists -> use registry
 */

describe('Name-Based Install Priority', () => {
  let testEnv: Awaited<ReturnType<typeof setupTestEnvironment>>;

  beforeEach(async () => {
    testEnv = await setupTestEnvironment();
  });

  afterEach(async () => {
    if (testEnv) {
      await cleanupTestEnvironment(testEnv);
    }
  });

  it('should use workspace package as override (no version check)', async () => {
    const { workspaceRoot, globalPackagesDir, registryDir } = testEnv;

    // Create workspace package (v0.1.0)
    const workspacePackageDir = join(workspaceRoot, '.openpackage', 'packages', 'test-pkg');
    await createPackageYml(workspacePackageDir, {
      name: 'test-pkg',
      version: '0.1.0',
      description: 'Workspace version'
    });

    // Create global package (v0.5.0)
    const globalPackageDir = join(globalPackagesDir, 'test-pkg');
    await createPackageYml(globalPackageDir, {
      name: 'test-pkg',
      version: '0.5.0',
      description: 'Global version'
    });

    // Create registry version (v1.0.0)
    const registryPackageDir = join(registryDir, 'test-pkg', '1.0.0');
    await createPackageYml(registryPackageDir, {
      name: 'test-pkg',
      version: '1.0.0',
      description: 'Registry version'
    });

    // Install by name
    const result = await runCommand('install', ['test-pkg'], { cwd: workspaceRoot });

    // Should use workspace package regardless of version
    assert.ok(result.stdout.includes('workspace packages'), 'Should indicate workspace package was used');
    assert.ok(result.stdout.includes('override'), 'Should mention override behavior');
  });

  it('should use global package when newer than registry', async () => {
    const { workspaceRoot, globalPackagesDir, registryDir } = testEnv;

    // Create global package (v0.5.0 - newer)
    const globalPackageDir = join(globalPackagesDir, 'test-pkg');
    await createPackageYml(globalPackageDir, {
      name: 'test-pkg',
      version: '0.5.0',
      description: 'Global version'
    });

    // Create registry version (v0.3.0 - older)
    const registryPackageDir = join(registryDir, 'test-pkg', '0.3.0');
    await createPackageYml(registryPackageDir, {
      name: 'test-pkg',
      version: '0.3.0',
      description: 'Registry version'
    });

    // Install by name
    const result = await runCommand('install', ['test-pkg'], { cwd: workspaceRoot });

    // Should show comparison and select global
    assert.ok(result.stdout.includes('Resolving test-pkg'), 'Should show resolution process');
    assert.ok(result.stdout.includes('Global packages: 0.5.0'), 'Should list global version');
    assert.ok(result.stdout.includes('Registry: 0.3.0'), 'Should list registry version');
    assert.ok(result.stdout.includes('global packages (newer version)'), 'Should indicate global was newer');
  });

  it('should use registry when newer than global package', async () => {
    const { workspaceRoot, globalPackagesDir, registryDir } = testEnv;

    // Create global package (v0.3.0 - older)
    const globalPackageDir = join(globalPackagesDir, 'test-pkg');
    await createPackageYml(globalPackageDir, {
      name: 'test-pkg',
      version: '0.3.0',
      description: 'Global version'
    });

    // Create registry version (v0.5.0 - newer)
    const registryPackageDir = join(registryDir, 'test-pkg', '0.5.0');
    await createPackageYml(registryPackageDir, {
      name: 'test-pkg',
      version: '0.5.0',
      description: 'Registry version'
    });

    // Install by name
    const result = await runCommand('install', ['test-pkg'], { cwd: workspaceRoot });

    // Should show comparison and select registry
    assert.ok(result.stdout.includes('Resolving test-pkg'), 'Should show resolution process');
    assert.ok(result.stdout.includes('Global packages: 0.3.0'), 'Should list global version');
    assert.ok(result.stdout.includes('Registry: 0.5.0'), 'Should list registry version');
    assert.ok(result.stdout.includes('registry (newer version)'), 'Should indicate registry was newer');
    assert.ok(result.stdout.includes('Global packages has older version'), 'Should warn about outdated global');
    assert.ok(result.stdout.includes('opkg pack'), 'Should suggest updating global');
  });

  it('should prefer global package on version tie', async () => {
    const { workspaceRoot, globalPackagesDir, registryDir } = testEnv;

    // Create global package (v0.5.0)
    const globalPackageDir = join(globalPackagesDir, 'test-pkg');
    await createPackageYml(globalPackageDir, {
      name: 'test-pkg',
      version: '0.5.0',
      description: 'Global version'
    });

    // Create registry version (v0.5.0 - same)
    const registryPackageDir = join(registryDir, 'test-pkg', '0.5.0');
    await createPackageYml(registryPackageDir, {
      name: 'test-pkg',
      version: '0.5.0',
      description: 'Registry version'
    });

    // Install by name
    const result = await runCommand('install', ['test-pkg'], { cwd: workspaceRoot });

    // Should show comparison and prefer global (mutable)
    assert.ok(result.stdout.includes('Resolving test-pkg'), 'Should show resolution process');
    assert.ok(result.stdout.includes('same version, prefer mutable'), 'Should indicate tie-breaker logic');
    assert.ok(result.stdout.includes('global packages'), 'Should select global');
  });

  it('should use global package when only source', async () => {
    const { workspaceRoot, globalPackagesDir } = testEnv;

    // Create only global package
    const globalPackageDir = join(globalPackagesDir, 'test-pkg');
    await createPackageYml(globalPackageDir, {
      name: 'test-pkg',
      version: '0.5.0',
      description: 'Global version'
    });

    // Install by name
    const result = await runCommand('install', ['test-pkg'], { cwd: workspaceRoot });

    // Should use global without comparison
    assert.ok(result.stdout.includes('Found test-pkg in global packages'), 'Should indicate found in global');
    assert.ok(!result.stdout.includes('Resolving'), 'Should not show comparison');
  });

  it('should support scoped packages in global directory', async () => {
    const { workspaceRoot, globalPackagesDir } = testEnv;

    // Create scoped global package
    const globalPackageDir = join(globalPackagesDir, '@myorg', 'test-pkg');
    await createPackageYml(globalPackageDir, {
      name: '@myorg/test-pkg',
      version: '0.5.0',
      description: 'Scoped global package'
    });

    // Install by name
    const result = await runCommand('install', ['@myorg/test-pkg'], { cwd: workspaceRoot });

    // Should find and use scoped package
    assert.ok(result.stdout.includes('Found @myorg/test-pkg'), 'Should find scoped package');
    assert.ok(result.success, 'Install should succeed');
  });

  it('should allow explicit path to bypass version logic', async () => {
    const { workspaceRoot, globalPackagesDir, registryDir } = testEnv;

    // Create global package (v0.3.0 - older)
    const globalPackageDir = join(globalPackagesDir, 'test-pkg');
    await createPackageYml(globalPackageDir, {
      name: 'test-pkg',
      version: '0.3.0',
      description: 'Global version'
    });

    // Create registry version (v0.5.0 - newer)
    const registryPackageDir = join(registryDir, 'test-pkg', '0.5.0');
    await createPackageYml(registryPackageDir, {
      name: 'test-pkg',
      version: '0.5.0',
      description: 'Registry version'
    });

    // Install with explicit path (should bypass version comparison)
    const result = await runCommand('install', ['~/.openpackage/packages/test-pkg/'], { cwd: workspaceRoot });

    // Should use global despite being older (explicit path)
    assert.ok(!result.stdout.includes('Resolving'), 'Should not show version comparison');
    assert.ok(result.success, 'Install should succeed');
  });
});
