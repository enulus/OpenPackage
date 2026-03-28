import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { parsePackageYml, writePackageYml } from '../../../packages/core/src/utils/package-yml.js';
import { writeTextFile } from '../../../packages/core/src/utils/fs.js';

describe('Manifest subdirectory migration', () => {
  it('should migrate subdirectory field to path field on read', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Create manifest with legacy subdirectory field
      const legacyManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: gh@anthropics/claude-plugins-official/plugins/feature-dev
    git: https://github.com/anthropics/claude-plugins-official.git
    subdirectory: ./plugins/feature-dev
`;
      
      await writeTextFile(manifestPath, legacyManifest);
      
      // Parse manifest (should trigger migration)
      const parsed = await parsePackageYml(manifestPath);
      
      // Verify migration happened
      assert.ok(parsed.dependencies);
      assert.strictEqual(parsed.dependencies.length, 1);
      
      const dep = parsed.dependencies[0];
      assert.strictEqual(dep.name, 'gh@anthropics/claude-plugins-official/plugins/feature-dev');
      // Phase 2: git field migrated to url field
      assert.strictEqual(dep.url, 'https://github.com/anthropics/claude-plugins-official.git');
      assert.strictEqual(dep.git, undefined); // Migrated to url
      assert.strictEqual(dep.base, 'plugins/feature-dev'); // Leading ./ stripped, migrated to base
      assert.strictEqual(dep.path, undefined); // Not a resource path
      assert.strictEqual(dep.subdirectory, undefined); // Removed
      
      // Verify migration flag is set
      assert.strictEqual((parsed as any)._needsSubdirectoryMigration, true);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should write migrated manifest with path field only', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Create manifest with legacy subdirectory field
      const legacyManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: gh@anthropics/claude-plugins-official/plugins/feature-dev
    git: https://github.com/anthropics/claude-plugins-official.git
    subdirectory: ./plugins/feature-dev
`;
      
      await writeTextFile(manifestPath, legacyManifest);
      
      // Parse and write back
      const parsed = await parsePackageYml(manifestPath);
      await writePackageYml(manifestPath, parsed);
      
      // Read back and verify
      const reparsed = await parsePackageYml(manifestPath);
      
      assert.ok(reparsed.dependencies);
      const dep = reparsed.dependencies[0];
      assert.strictEqual(dep.base, 'plugins/feature-dev');
      assert.strictEqual(dep.path, undefined);
      assert.strictEqual(dep.subdirectory, undefined);

      // Migration flag should not be set on second read (already migrated)
      assert.strictEqual((reparsed as any)._needsSubdirectoryMigration, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle mixed dependencies (some with subdirectory, some with path)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      const mixedManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: gh@anthropics/claude-plugins-official/plugins/feature-dev
    git: https://github.com/anthropics/claude-plugins-official.git
    subdirectory: plugins/feature-dev
  - name: gh@user/repo/plugins/another
    git: https://github.com/user/repo.git
    path: plugins/another
  - name: local-package
    path: ./local
`;
      
      await writeTextFile(manifestPath, mixedManifest);
      
      const parsed = await parsePackageYml(manifestPath);
      
      assert.ok(parsed.dependencies);
      assert.strictEqual(parsed.dependencies.length, 3);
      
      // First dep: subdirectory → base (git subdirectory)
      assert.strictEqual(parsed.dependencies[0].base, 'plugins/feature-dev');
      assert.strictEqual(parsed.dependencies[0].path, undefined);
      assert.strictEqual(parsed.dependencies[0].subdirectory, undefined);

      // Second dep: old path (non-resource prefix) → base
      assert.strictEqual(parsed.dependencies[1].base, 'plugins/another');
      assert.strictEqual(parsed.dependencies[1].path, undefined);
      assert.strictEqual(parsed.dependencies[1].subdirectory, undefined);

      // Third dep: local path → base
      assert.strictEqual(parsed.dependencies[2].base, './local');
      assert.strictEqual(parsed.dependencies[2].path, undefined);
      assert.strictEqual(parsed.dependencies[2].subdirectory, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle both subdirectory and path gracefully', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));

    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');

      // Edge case: both fields present. subdirectory migrates to base,
      // path stays as-is (since base is now set, path→base migration is skipped)
      const conflictManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: gh@user/repo/plugins/feature
    git: https://github.com/user/repo.git
    path: plugins/feature
    subdirectory: old-path
`;

      await writeTextFile(manifestPath, conflictManifest);

      const parsed = await parsePackageYml(manifestPath);
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      // subdirectory migrated to base
      assert.strictEqual(dep.base, 'old-path');
      // path kept (base already set, so path→base migration skipped)
      assert.strictEqual(dep.path, 'plugins/feature');
      assert.strictEqual(dep.subdirectory, undefined);

    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should not migrate subdirectory without git field', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      const invalidManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: some-package
    version: 1.0.0
    subdirectory: invalid
`;
      
      await writeTextFile(manifestPath, invalidManifest);
      
      // Should throw during validation
      await assert.rejects(
        async () => await parsePackageYml(manifestPath),
        /has subdirectory field without git\/url source/
      );
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should normalize path by stripping leading ./ during migration', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      const manifestWithLeadingDot = `name: test-package
version: 1.0.0
dependencies:
  - name: gh@user/repo/plugins/feature
    git: https://github.com/user/repo.git
    subdirectory: ./plugins/feature
`;
      
      await writeTextFile(manifestPath, manifestWithLeadingDot);
      
      const parsed = await parsePackageYml(manifestPath);
      
      assert.ok(parsed.dependencies);
      assert.strictEqual(parsed.dependencies[0].base, 'plugins/feature'); // ./ stripped, migrated to base
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle dev-dependencies migration', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      const devManifest = `name: test-package
version: 1.0.0
dev-dependencies:
  - name: gh@user/repo/tools/dev-tool
    git: https://github.com/user/repo.git
    subdirectory: tools/dev-tool
`;
      
      await writeTextFile(manifestPath, devManifest);
      
      const parsed = await parsePackageYml(manifestPath);
      
      assert.ok(parsed['dev-dependencies']);
      assert.strictEqual(parsed['dev-dependencies'].length, 1);
      assert.strictEqual(parsed['dev-dependencies'][0].base, 'tools/dev-tool');
      assert.strictEqual(parsed['dev-dependencies'][0].path, undefined);
      assert.strictEqual(parsed['dev-dependencies'][0].subdirectory, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

console.log('✓ All manifest subdirectory migration tests passed');
