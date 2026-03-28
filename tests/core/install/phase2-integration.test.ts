import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { parsePackageYml } from '../../../packages/core/src/utils/package-yml.js';
import { writeTextFile } from '../../../packages/core/src/utils/fs.js';
import { buildInstallContext } from '../../../packages/core/src/core/install/unified/context-builders.js';
import type { ExecutionContext } from '../../../packages/core/src/types/execution-context.js';

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
      assert.strictEqual(parsed.dependencies[0].base, 'plugins/feature');  // non-resource path → base
      assert.strictEqual(parsed.dependencies[0].path, undefined);

      assert.strictEqual(parsed.dependencies[1].url, 'https://github.com/user/plugin-b.git');
      assert.strictEqual(parsed.dependencies[1].git, undefined);

      // Local path migrated to base
      assert.strictEqual(parsed.dependencies[2].base, './local/plugin');
      assert.strictEqual(parsed.dependencies[2].path, undefined);
      assert.strictEqual(parsed.dependencies[2].url, undefined);
      
      // Build contexts (this is what install command does with no packageInput)
      const execContext: ExecutionContext = { sourceCwd: tmpDir, targetDir: tmpDir, isGlobal: false };
      const contexts = await buildInstallContext(execContext, undefined, {});
      
      // buildInstallContext returns a BulkInstallContextsResult for bulk install (no packageInput)
      assert.ok(contexts != null && typeof contexts === 'object');
      assert.ok(!Array.isArray(contexts));
      assert.ok('workspaceContext' in contexts, 'result should have workspaceContext property');
      assert.ok('hasDependencies' in contexts, 'result should have hasDependencies property');
      const bulk = contexts as { workspaceContext: unknown; hasDependencies: boolean };
      assert.strictEqual(typeof bulk.hasDependencies, 'boolean', 'hasDependencies should be a boolean');
      
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
  
});
