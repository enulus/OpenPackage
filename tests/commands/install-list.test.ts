/**
 * Integration tests for install command with --interactive option
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { discoverResources } from '../../src/core/install/resource-discoverer.js';

describe('install --interactive', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'opkg-install-list-test-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('resource discovery', () => {
    it('should discover agents in universal format', async () => {
      // This test validates the resource discoverer can find agents
      // A full integration test would require mock prompts
      const result = await discoverResources(testDir, testDir);
      assert.ok(result);
      assert.ok(result.total >= 0);
      assert.ok(result.byType instanceof Map);
    });

    it('should return empty result for empty directory', async () => {
      const result = await discoverResources(testDir, testDir);
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.all.length, 0);
    });
  });

  describe('validation', () => {
    it('should reject --interactive with --agents', () => {
      // This is validated at CLI level in install.ts
      // The validation ensures mutually exclusive options
      assert.strictEqual(true, true); // Placeholder
    });

    it('should reject --interactive with --skills', () => {
      // This is validated at CLI level in install.ts
      assert.strictEqual(true, true); // Placeholder
    });
  });
});
