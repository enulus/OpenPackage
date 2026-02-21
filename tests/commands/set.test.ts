/**
 * @fileoverview Tests for the 'opkg set' command
 * 
 * Tests package manifest field updates for mutable sources.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetPipeline } from '../../src/core/set/set-pipeline.js';
import type { SetCommandOptions } from '../../src/core/set/set-types.js';

describe('opkg set command', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'opkg-set-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('CWD package updates', () => {
    it('should update version field', async () => {
      // Create a test package
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      // Change to test directory
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          ver: '2.0.0',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data?.updatedFields.includes('version'), true);

        // Verify file was updated
        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /version: 2\.0\.0/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should update multiple fields at once', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(
        manifestPath,
        'name: test-package\nver: 1.0.0\ndescription: Old description\n'
      );

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          ver: '1.1.0',
          description: 'New description',
          author: 'Test Author',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data?.updatedFields.length, 3);

        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /version: 1\.1\.0/);
        assert.match(content, /description: New description/);
        assert.match(content, /author: Test Author/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should parse space-separated keywords', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          keywords: 'ai coding assistant',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        
        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /keywords: \[ai, coding, assistant\]/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should set private flag', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          private: true,
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        
        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /private: true/);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Workspace package updates', () => {
    it('should update workspace package by name', async () => {
      // Create workspace package structure
      const workspaceDir = join(testDir, '.openpackage', 'packages', 'test-pkg');
      await mkdir(workspaceDir, { recursive: true });
      
      const manifestPath = join(workspaceDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-pkg\nver: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline('test-pkg', {
          ver: '1.5.0',
          description: 'Workspace package',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data?.sourceType, 'workspace');

        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /version: 1\.5\.0/);
        assert.match(content, /description: Workspace package/);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Validation', () => {
    it('should reject invalid version format', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          ver: 'invalid-version',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /Invalid version format/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should reject invalid package name', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          name: 'Invalid Name With Spaces',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /invalid characters/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should reject invalid homepage URL', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          homepage: 'not-a-valid-url',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /Invalid homepage URL/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should require at least one flag in non-interactive mode', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /requires at least one field flag/);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('No-op scenarios', () => {
    it('should detect when no changes are made', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nversion: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          ver: '1.0.0', // Same as current
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data?.updatedFields.length, 0);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Error scenarios', () => {
    it('should fail when no openpackage.yml in CWD and no package specified', async () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          ver: '1.0.0',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /No openpackage\.yml found/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should fail when package is not found', async () => {
      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline('nonexistent-package', {
          ver: '1.0.0',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /not found/);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('Field updates', () => {
    it('should update license field', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\nlicense: MIT\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          license: 'Apache-2.0',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        
        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /license: Apache-2\.0/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should update homepage field', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          homepage: 'https://example.com',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        
        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /homepage: https:\/\/example\.com/);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should update package name', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: old-name\nver: 1.0.0\n');

      const originalCwd = process.cwd();
      process.chdir(testDir);

      try {
        const result = await runSetPipeline(undefined, {
          name: 'new-name',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        
        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /name: new-name/);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
