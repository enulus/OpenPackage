import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { join } from 'path';
import { mkdir, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { createPackage } from '../../src/core/package-creation.js';
import { 
  resolveCustomPath, 
  validateCustomPath 
} from '../../src/utils/custom-path-resolution.js';
import { exists } from '../../src/utils/fs.js';

describe('Custom Path Creation', () => {
  let testDir: string;

  before(async () => {
    // Create a temporary directory for tests
    testDir = join(tmpdir(), `opkg-test-custom-path-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  after(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('resolveCustomPath', () => {
    it('should resolve relative paths correctly', () => {
      const cwd = '/home/user/project';
      const result = resolveCustomPath('./my-package', cwd);
      
      assert.strictEqual(result.original, './my-package');
      assert.strictEqual(result.absolute, join(cwd, 'my-package'));
      assert.strictEqual(result.parentDir, cwd);
      assert.strictEqual(result.packageYmlPath, join(cwd, 'my-package', 'openpackage.yml'));
    });

    it('should resolve absolute paths correctly', () => {
      const absolutePath = '/custom/location/my-package';
      const cwd = '/home/user/project';
      const result = resolveCustomPath(absolutePath, cwd);
      
      assert.strictEqual(result.original, absolutePath);
      assert.strictEqual(result.absolute, absolutePath);
      assert.strictEqual(result.parentDir, '/custom/location');
      assert.strictEqual(result.packageYmlPath, join(absolutePath, 'openpackage.yml'));
    });

    it('should expand tilde paths correctly', () => {
      const cwd = '/home/user/project';
      const result = resolveCustomPath('~/my-package', cwd);
      
      assert.strictEqual(result.original, '~/my-package');
      assert.ok(result.absolute.includes('my-package'));
      assert.ok(!result.absolute.startsWith('~'));
    });
  });

  describe('validateCustomPath', () => {
    it('should reject empty paths', async () => {
      const resolved = {
        original: '',
        absolute: '',
        parentDir: '',
        packageYmlPath: ''
      };
      
      const validation = await validateCustomPath(resolved, false);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.error?.includes('empty'));
    });

    it('should reject non-existent parent directories', async () => {
      const nonExistentPath = join(testDir, 'does-not-exist', 'my-package');
      const resolved = resolveCustomPath(nonExistentPath, testDir);
      
      const validation = await validateCustomPath(resolved, false);
      if (validation.valid) {
        console.log('Validation unexpectedly passed:', validation);
        console.log('Resolved path:', resolved);
      }
      assert.strictEqual(validation.valid, false, `Expected invalid path but got: ${JSON.stringify(validation)}`);
      assert.ok(validation.error?.includes('Parent directory does not exist'), `Error message: ${validation.error}`);
    });

    it('should accept valid paths with existing parent', async () => {
      const validPath = join(testDir, 'new-package');
      const resolved = resolveCustomPath(validPath, testDir);
      
      const validation = await validateCustomPath(resolved, false);
      if (!validation.valid) {
        console.log('Validation unexpectedly failed:', validation);
        console.log('Resolved path:', resolved);
        console.log('Test dir exists?', await exists(testDir));
      }
      assert.strictEqual(validation.valid, true, `Expected valid path but got error: ${validation.error}`);
      assert.strictEqual(validation.error, undefined);
    });

    it('should reject paths in system directories', async () => {
      const systemPath = '/usr/my-package';
      const resolved = resolveCustomPath(systemPath, testDir);
      
      const validation = await validateCustomPath(resolved, false);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.error?.includes('system directory'));
    });
  });

  describe('createPackage with custom path', () => {
    it('should create package at custom relative path', async () => {
      const customPath = join(testDir, 'custom-pkg-1');
      
      const result = await createPackage({
        cwd: testDir,
        customPath,
        packageName: 'test-package',
        force: false,
        interactive: false
      });
      
      assert.strictEqual(result.success, true);
      assert.ok(result.context);
      assert.strictEqual(result.context.name, 'test-package');
      assert.strictEqual(result.context.packageRootDir, customPath);
      
      // Verify openpackage.yml was created
      const ymlPath = join(customPath, 'openpackage.yml');
      const ymlContent = await readFile(ymlPath, 'utf-8');
      assert.ok(ymlContent.includes('name: test-package'));
    });

    it('should create package at custom absolute path', async () => {
      const customPath = join(testDir, 'custom-pkg-2');
      
      const result = await createPackage({
        cwd: '/some/other/dir', // Different cwd
        customPath,
        packageName: 'absolute-test',
        force: false,
        interactive: false
      });
      
      assert.strictEqual(result.success, true);
      assert.ok(result.context);
      assert.strictEqual(result.context.packageRootDir, customPath);
      
      // Verify openpackage.yml was created
      const ymlPath = join(customPath, 'openpackage.yml');
      const ymlContent = await readFile(ymlPath, 'utf-8');
      assert.ok(ymlContent.includes('name: absolute-test'));
    });

    it('should fail without force when package exists', async () => {
      const customPath = join(testDir, 'custom-pkg-existing');
      
      // Create first time
      await createPackage({
        cwd: testDir,
        customPath,
        packageName: 'existing-pkg',
        force: false,
        interactive: false
      });
      
      // Try to create again without force
      const result = await createPackage({
        cwd: testDir,
        customPath,
        packageName: 'existing-pkg',
        force: false,
        interactive: false
      });
      
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('already exists'));
    });

    it('should overwrite with force when package exists', async () => {
      const customPath = join(testDir, 'custom-pkg-force');
      
      // Create first time
      await createPackage({
        cwd: testDir,
        customPath,
        packageName: 'force-test',
        force: false,
        interactive: false
      });
      
      // Create again with force
      const result = await createPackage({
        cwd: testDir,
        customPath,
        packageName: 'force-test-updated',
        force: true,
        interactive: false
      });
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.wasExisting, true);
      
      // Verify it was overwritten
      const ymlPath = join(customPath, 'openpackage.yml');
      const ymlContent = await readFile(ymlPath, 'utf-8');
      assert.ok(ymlContent.includes('name: force-test-updated'));
    });
  });
});
