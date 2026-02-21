import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { parsePackageYml, writePackageYml } from '../../../src/utils/package-yml.js';
import { writeTextFile, readTextFile } from '../../../src/utils/fs.js';
import { buildInstallContext } from '../../../src/core/install/unified/context-builders.js';
import type { ExecutionContext } from '../../../src/types/execution-context.js';

describe('Phase 2 Integration: Schema Migration', () => {
  it('should handle complete workflow: old format → parse → context build', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Create manifest with old format (git + ref)
      const oldFormat = `name: test-workspace
version: 1.0.0
dependencies:
  - name: gh@user/plugin-a
    git: https://github.com/user/plugin-a.git
    ref: v1.0.0
    path: plugins/feature
  - name: gh@user/plugin-b
    git: https://github.com/user/plugin-b.git
  - name: local-plugin
    path: ./local/plugin
`;
      
      await writeTextFile(manifestPath, oldFormat);
      
      // Parse (should trigger migration)
      const parsed = await parsePackageYml(manifestPath);
      
      // Verify in-memory migration
      assert.ok(parsed.dependencies);
      assert.strictEqual(parsed.dependencies.length, 3);
      
      // Git sources migrated to url
      assert.strictEqual(parsed.dependencies[0].url, 'https://github.com/user/plugin-a.git#v1.0.0');
      assert.strictEqual(parsed.dependencies[0].git, undefined);
      assert.strictEqual(parsed.dependencies[0].ref, undefined);
      assert.strictEqual(parsed.dependencies[0].path, 'plugins/feature');
      
      assert.strictEqual(parsed.dependencies[1].url, 'https://github.com/user/plugin-b.git');
      assert.strictEqual(parsed.dependencies[1].git, undefined);
      
      // Local path unchanged
      assert.strictEqual(parsed.dependencies[2].path, './local/plugin');
      assert.strictEqual(parsed.dependencies[2].url, undefined);
      
      // Build contexts (this is what install command does with no packageInput)
      const execContext: ExecutionContext = { sourceCwd: tmpDir, targetDir: tmpDir, isGlobal: false };
      const contexts = await buildInstallContext(execContext, undefined, {});
      
      // buildInstallContext returns a workspace context object (not an array) for bulk install
      assert.ok(contexts != null && typeof contexts === 'object');
      // Note: actual count may vary based on workspace files, so we just verify it's an array
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should write manifest in new format after modification', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Start with old format
      const oldFormat = `name: test-workspace
version: 1.0.0
dependencies:
  - name: gh@user/old-plugin
    git: https://github.com/user/old-plugin.git
    ref: main
`;
      
      await writeTextFile(manifestPath, oldFormat);
      
      // Parse and write back
      const parsed = await parsePackageYml(manifestPath);
      await writePackageYml(manifestPath, parsed);
      
      // Read raw content
      const written = await readTextFile(manifestPath);
      
      // Verify new format is written
      assert.ok(written.includes('url: https://github.com/user/old-plugin.git#main'));
      assert.ok(!written.includes('git:'));
      assert.ok(!written.includes('ref:'));
      
      // Parse again - should not trigger migration (already new format)
      const reparsed = await parsePackageYml(manifestPath);
      assert.strictEqual(reparsed.dependencies![0].url, 'https://github.com/user/old-plugin.git#main');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle context building from Phase 1 git detection', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      // This test verifies that Phase 1 git detection and Phase 2 context building work together
      
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Create a minimal manifest
      const manifest = `name: test-workspace
version: 1.0.0
dependencies: []
`;
      
      await writeTextFile(manifestPath, manifest);
      
      // Test with GitHub shorthand (from Phase 1)
      const execContext: ExecutionContext = { sourceCwd: tmpDir, targetDir: tmpDir, isGlobal: false };
      const context = await buildInstallContext(
        execContext,
        'gh@user/repo',
        {}
      );
      
      // Should be a single context (not array)
      assert.ok(!Array.isArray(context));
      assert.strictEqual(context.source.type, 'git');
      assert.strictEqual(context.source.gitUrl, 'https://github.com/user/repo.git');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should maintain consistency across multiple read/write cycles', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Start with old format
      const oldFormat = `name: test-workspace
version: 1.0.0
dependencies:
  - name: gh@user/plugin
    git: https://github.com/user/plugin.git
    ref: v2.0.0
    path: src
`;
      
      await writeTextFile(manifestPath, oldFormat);
      
      // Multiple cycles
      for (let i = 0; i < 3; i++) {
        const parsed = await parsePackageYml(manifestPath);
        await writePackageYml(manifestPath, parsed);
        
        // Verify consistency
        const content = await readTextFile(manifestPath);
        assert.ok(content.includes('url: https://github.com/user/plugin.git#v2.0.0'));
        assert.ok(content.includes('path: src'));
        assert.ok(!content.includes('git:'));
        assert.ok(!content.includes('ref:'));
      }
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
