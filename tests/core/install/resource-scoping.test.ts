/**
 * Tests for resolveResourceScoping: the shared helper that computes
 * resource-to-base relative paths and match patterns.
 *
 * This covers the bug where a resource path equal to the base directory
 * (empty relative path) was incorrectly rejected as "outside the package base".
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveResourceScoping } from '../../../packages/core/src/core/install/preprocessing/base-resolver.js';

let tmpDir: string;

before(() => {
  // Create a temp directory tree simulating a repo with a plugin inside:
  //   <tmpDir>/
  //     plugins/
  //       feature-dev/
  //         index.ts
  //     skills/
  //       react-best-practices/
  //         guide.md
  //     standalone-file.ts
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-resource-scoping-'));
  fs.mkdirSync(path.join(tmpDir, 'plugins', 'feature-dev'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'plugins', 'feature-dev', 'index.ts'), '// plugin');
  fs.mkdirSync(path.join(tmpDir, 'skills', 'react-best-practices'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'skills', 'react-best-practices', 'guide.md'), '# Guide');
  fs.writeFileSync(path.join(tmpDir, 'standalone-file.ts'), '// standalone');
});

after(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe('resolveResourceScoping', () => {

  describe('resource path equals base (the bug case)', () => {
    it('should return pattern "**" when resource path IS the base directory', async () => {
      // Base is <tmpDir>/plugins/feature-dev, resource path is "plugins/feature-dev"
      // relative("plugins/feature-dev", "plugins/feature-dev") => "" (empty string)
      const repoRoot = tmpDir;
      const baseAbs = path.join(tmpDir, 'plugins', 'feature-dev');
      const resourcePath = 'plugins/feature-dev';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.ok(result, 'should not return null');
      assert.equal(result.relPath, '');
      assert.equal(result.isDirectory, true);
      assert.equal(result.pattern, '**');
    });

    it('should return pattern "**" when base and repo root are the same', async () => {
      // Edge case: resource path is "." effectively (base = repoRoot, resource = repoRoot)
      // This happens when the entire repo IS the package.
      const repoRoot = tmpDir;
      const baseAbs = tmpDir;
      const resourcePath = '.';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.ok(result, 'should not return null');
      assert.equal(result.isDirectory, true);
      assert.equal(result.pattern, '**');
    });
  });

  describe('resource is a subdirectory of the base', () => {
    it('should return correct pattern for a nested directory', async () => {
      // Base is <tmpDir>, resource path is "plugins/feature-dev"
      const repoRoot = tmpDir;
      const baseAbs = tmpDir;
      const resourcePath = 'plugins/feature-dev';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.ok(result, 'should not return null');
      assert.equal(result.relPath, 'plugins/feature-dev');
      assert.equal(result.isDirectory, true);
      assert.equal(result.pattern, 'plugins/feature-dev/**');
    });

    it('should return correct pattern for a single-level subdirectory', async () => {
      const repoRoot = tmpDir;
      const baseAbs = tmpDir;
      const resourcePath = 'plugins';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.ok(result, 'should not return null');
      assert.equal(result.relPath, 'plugins');
      assert.equal(result.isDirectory, true);
      assert.equal(result.pattern, 'plugins/**');
    });
  });

  describe('resource is a file within the base', () => {
    it('should return the file path as the pattern', async () => {
      const repoRoot = tmpDir;
      const baseAbs = tmpDir;
      const resourcePath = 'standalone-file.ts';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.ok(result, 'should not return null');
      assert.equal(result.relPath, 'standalone-file.ts');
      assert.equal(result.isDirectory, false);
      assert.equal(result.pattern, 'standalone-file.ts');
    });

    it('should return the nested file path as the pattern', async () => {
      const repoRoot = tmpDir;
      const baseAbs = tmpDir;
      const resourcePath = 'plugins/feature-dev/index.ts';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.ok(result, 'should not return null');
      assert.equal(result.relPath, 'plugins/feature-dev/index.ts');
      assert.equal(result.isDirectory, false);
      assert.equal(result.pattern, 'plugins/feature-dev/index.ts');
    });
  });

  describe('resource is outside the base', () => {
    it('should return null when resource path is outside the base', async () => {
      const repoRoot = tmpDir;
      const baseAbs = path.join(tmpDir, 'plugins', 'feature-dev');
      // Resource path "skills/react-best-practices" relative to base "plugins/feature-dev"
      // would be "../../skills/react-best-practices" -> starts with ".."
      const resourcePath = 'skills/react-best-practices';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.equal(result, null);
    });

    it('should return null when resource path traverses above repo root', async () => {
      const repoRoot = tmpDir;
      const baseAbs = tmpDir;
      const resourcePath = '../outside-repo';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.equal(result, null);
    });
  });

  describe('strict mode', () => {
    it('should throw when resource path does not exist on disk and strict is true', async () => {
      const repoRoot = tmpDir;
      const baseAbs = tmpDir;
      const resourcePath = 'nonexistent/path';

      await assert.rejects(
        () => resolveResourceScoping(repoRoot, baseAbs, resourcePath, { strict: true }),
        (err: Error) => {
          assert.ok(err.message.includes('does not exist in the repository'));
          return true;
        }
      );
    });

    it('should not throw when resource path does not exist on disk and strict is false', async () => {
      const repoRoot = tmpDir;
      const baseAbs = tmpDir;
      const resourcePath = 'nonexistent/path';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.ok(result, 'should not return null');
      assert.equal(result.isDirectory, false);
      assert.equal(result.pattern, 'nonexistent/path');
    });

    it('should default to non-strict when options are omitted', async () => {
      const repoRoot = tmpDir;
      const baseAbs = tmpDir;
      const resourcePath = 'another/missing/file.ts';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.ok(result, 'should not return null');
      assert.equal(result.isDirectory, false);
      assert.equal(result.pattern, 'another/missing/file.ts');
    });
  });

  describe('resource path relative to a non-root base', () => {
    it('should compute correct relative path when base is a subdirectory', async () => {
      // Base is <tmpDir>/skills, resource is "skills/react-best-practices"
      const repoRoot = tmpDir;
      const baseAbs = path.join(tmpDir, 'skills');
      const resourcePath = 'skills/react-best-practices';

      const result = await resolveResourceScoping(repoRoot, baseAbs, resourcePath);

      assert.ok(result, 'should not return null');
      assert.equal(result.relPath, 'react-best-practices');
      assert.equal(result.isDirectory, true);
      assert.equal(result.pattern, 'react-best-practices/**');
    });
  });
});
