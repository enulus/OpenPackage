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
import { runSetPipeline } from '../../packages/core/src/core/set/set-pipeline.js';
import type { SetCommandOptions } from '../../packages/core/src/core/set/set-types.js';

describe('opkg set command', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'opkg-set-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      return await fn();
    } finally {
      process.chdir(originalCwd);
    }
  }

  describe('CWD package updates', () => {
    it('should update version field', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          ver: '2.0.0',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        assert.deepStrictEqual(result.data?.updatedFields, ['version']);

        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /version: 2\.0\.0/);
      });
    });

    it('should update multiple fields at once', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(
        manifestPath,
        'name: test-package\nver: 1.0.0\ndescription: Old description\n'
      );

      await withCwd(testDir, async () => {
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
      });
    });

    it('should parse space-separated keywords', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          keywords: 'ai coding assistant',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);

        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /keywords: \[ai, coding, assistant\]/);
      });
    });

    it('should set private flag', async () => {
      const manifestPath = join(testDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-package\nver: 1.0.0\n');

      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          private: true,
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);

        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /private: true/);
      });
    });
  });

  describe('Workspace package updates', () => {
    it('should resolve workspace manifest when no CWD-level openpackage.yml exists', async () => {
      const workspaceDir = join(testDir, '.openpackage');
      await mkdir(workspaceDir, { recursive: true });

      const manifestPath = join(workspaceDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: workspace-pkg\nver: 1.0.0\n');

      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          ver: '2.0.0',
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data?.sourceType, 'workspace');

        const content = await readFile(manifestPath, 'utf-8');
        assert.match(content, /version: 2\.0\.0/);
      });
    });

    it('should update workspace package by name', async () => {
      const workspaceDir = join(testDir, '.openpackage', 'packages', 'test-pkg');
      await mkdir(workspaceDir, { recursive: true });

      const manifestPath = join(workspaceDir, 'openpackage.yml');
      await writeFile(manifestPath, 'name: test-pkg\nver: 1.0.0\n');

      await withCwd(testDir, async () => {
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
      });
    });
  });

  describe('Validation', () => {
    it('should reject invalid version format', async () => {
      await writeFile(join(testDir, 'openpackage.yml'), 'name: test-package\nver: 1.0.0\n');

      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          ver: 'invalid-version',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /Invalid version format/);
      });
    });

    it('should reject invalid package name', async () => {
      await writeFile(join(testDir, 'openpackage.yml'), 'name: test-package\nver: 1.0.0\n');

      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          name: 'Invalid Name With Spaces',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /invalid characters/);
      });
    });

    it('should reject invalid homepage URL', async () => {
      await writeFile(join(testDir, 'openpackage.yml'), 'name: test-package\nver: 1.0.0\n');

      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          homepage: 'not-a-valid-url',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /Invalid homepage URL/);
      });
    });

    it('should require at least one flag in non-interactive mode', async () => {
      await writeFile(join(testDir, 'openpackage.yml'), 'name: test-package\nver: 1.0.0\n');

      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /requires at least one field flag/);
      });
    });
  });

  describe('No-op scenarios', () => {
    it('should detect when no changes are made', async () => {
      await writeFile(join(testDir, 'openpackage.yml'), 'name: test-package\nversion: 1.0.0\n');

      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          ver: '1.0.0', // Same as current
          nonInteractive: true
        });

        assert.strictEqual(result.success, true);
        assert.strictEqual(result.data?.updatedFields.length, 0);
      });
    });
  });

  describe('Error scenarios', () => {
    it('should fail when no openpackage.yml in CWD and no package specified', async () => {
      await withCwd(testDir, async () => {
        const result = await runSetPipeline(undefined, {
          ver: '1.0.0',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /No openpackage\.yml found in current directory or workspace/);
      });
    });

    it('should fail when package is not found', async () => {
      await withCwd(testDir, async () => {
        const result = await runSetPipeline('nonexistent-package', {
          ver: '1.0.0',
          nonInteractive: true
        });

        assert.strictEqual(result.success, false);
        assert.match(result.error || '', /not found/);
      });
    });
  });

  describe('Field updates', () => {
    const fieldCases: {
      field: string;
      initial: string;
      options: SetCommandOptions;
      expected: RegExp;
    }[] = [
      {
        field: 'license',
        initial: 'name: test-package\nver: 1.0.0\nlicense: MIT\n',
        options: { license: 'Apache-2.0', nonInteractive: true },
        expected: /license: Apache-2\.0/,
      },
      {
        field: 'homepage',
        initial: 'name: test-package\nver: 1.0.0\n',
        options: { homepage: 'https://example.com', nonInteractive: true },
        expected: /homepage: https:\/\/example\.com/,
      },
      {
        field: 'name',
        initial: 'name: old-name\nver: 1.0.0\n',
        options: { name: 'new-name', nonInteractive: true },
        expected: /name: new-name/,
      },
    ];

    for (const { field, initial, options, expected } of fieldCases) {
      it(`should update ${field} field`, async () => {
        const manifestPath = join(testDir, 'openpackage.yml');
        await writeFile(manifestPath, initial);

        await withCwd(testDir, async () => {
          const result = await runSetPipeline(undefined, options);

          assert.strictEqual(result.success, true);

          const content = await readFile(manifestPath, 'utf-8');
          assert.match(content, expected);
        });
      });
    }
  });
});
