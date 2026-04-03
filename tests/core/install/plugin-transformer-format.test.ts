/**
 * Regression test for plugin-transformer _format detection bug.
 *
 * transformPluginToPackage() strips the .claude-plugin/ prefix from files
 * before calling detectPackageFormat(), so format detection sees paths like
 * `skills/test/SKILL.md` (universal) instead of `.claude-plugin/skills/...`.
 * The fix forces _format to platform-specific / claude-plugin regardless of
 * what detectPackageFormat returns.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { transformPluginToPackage } from '../../../packages/core/src/core/install/plugin-transformer.js';

describe('transformPluginToPackage _format regression', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-plugin-fmt-'));

    // Create minimal .claude-plugin/plugin.json
    const pluginMetaDir = path.join(tmpDir, '.claude-plugin');
    fs.mkdirSync(pluginMetaDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginMetaDir, 'plugin.json'),
      JSON.stringify({
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin for format detection'
      })
    );

    // Create a skill file (universal-looking path once .claude-plugin/ is stripped)
    const skillDir = path.join(tmpDir, 'skills', 'test');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill');
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should set _format.type to platform-specific', async () => {
    const result = await transformPluginToPackage(tmpDir, {
      gitUrl: 'https://github.com/test/test-plugin'
    });

    assert.strictEqual(result.package._format.type, 'platform-specific');
  });

  it('should set _format.platform to claude-plugin', async () => {
    const result = await transformPluginToPackage(tmpDir, {
      gitUrl: 'https://github.com/test/test-plugin'
    });

    assert.strictEqual(result.package._format.platform, 'claude-plugin');
  });

  it('should return context with originalFormat.platform === claude-plugin', async () => {
    const result = await transformPluginToPackage(tmpDir, {
      gitUrl: 'https://github.com/test/test-plugin'
    });

    assert.strictEqual(result.context.originalFormat.platform, 'claude-plugin');
  });
});
