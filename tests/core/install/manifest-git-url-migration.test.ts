import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { parsePackageYml, writePackageYml } from '../../../packages/core/src/utils/package-yml.js';
import { writeTextFile, readTextFile } from '../../../packages/core/src/utils/fs.js';

describe('Manifest git→url migration (Phase 2)', () => {
  it('should migrate git field to url field on read', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Create manifest with legacy git field
      // Use gh@ prefix to avoid name migration
      const legacyManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: gh@user/repo
    git: https://github.com/user/repo.git
`;
      
      await writeTextFile(manifestPath, legacyManifest);
      
      // Parse manifest (should trigger migration)
      const parsed = await parsePackageYml(manifestPath);
      
      // Verify migration happened in-memory
      assert.ok(parsed.dependencies);
      assert.strictEqual(parsed.dependencies.length, 1);
      
      const dep = parsed.dependencies[0];
      assert.strictEqual(dep.name, 'gh@user/repo');
      assert.strictEqual(dep.url, 'https://github.com/user/repo.git');
      assert.strictEqual(dep.git, undefined); // Old field removed
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should embed ref in url when migrating', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Create manifest with legacy git + ref fields
      const legacyManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    git: https://github.com/user/repo.git
    ref: main
`;
      
      await writeTextFile(manifestPath, legacyManifest);
      
      // Parse manifest
      const parsed = await parsePackageYml(manifestPath);
      
      // Verify migration with embedded ref
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      assert.strictEqual(dep.url, 'https://github.com/user/repo.git#main');
      assert.strictEqual(dep.git, undefined);
      assert.strictEqual(dep.ref, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should write manifest in new format only', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Create manifest with legacy fields
      const legacyManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    git: https://github.com/user/repo.git
    ref: v1.0.0
    path: plugins/x
`;
      
      await writeTextFile(manifestPath, legacyManifest);
      
      // Parse and write back
      const parsed = await parsePackageYml(manifestPath);
      await writePackageYml(manifestPath, parsed);
      
      // Read the raw file content
      const written = await readTextFile(manifestPath);
      
      // Verify new format is used
      assert.ok(written.includes('url: https://github.com/user/repo.git#v1.0.0'));
      assert.ok(written.includes('base: plugins/x'));
      assert.ok(!written.includes('git:'));
      assert.ok(!written.includes('ref:'));
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle url field that already has embedded ref', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Edge case: url already has ref, separate ref field also present
      const edgeCaseManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    git: https://github.com/user/repo.git#main
    ref: develop
`;
      
      await writeTextFile(manifestPath, edgeCaseManifest);
      
      // Parse manifest
      const parsed = await parsePackageYml(manifestPath);
      
      // URL ref should take priority, separate ref ignored
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      assert.strictEqual(dep.url, 'https://github.com/user/repo.git#main');
      assert.strictEqual(dep.ref, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should migrate mixed old and new formats', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      const mixedManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: old-plugin
    git: https://github.com/user/old.git
    ref: main
  - name: new-plugin
    url: https://github.com/user/new.git#v2.0.0
  - name: registry-plugin
    version: ^1.0.0
`;
      
      await writeTextFile(manifestPath, mixedManifest);
      
      // Parse
      const parsed = await parsePackageYml(manifestPath);
      
      // Verify all dependencies
      assert.ok(parsed.dependencies);
      assert.strictEqual(parsed.dependencies.length, 3);
      
      // Old format migrated
      assert.strictEqual(parsed.dependencies[0].url, 'https://github.com/user/old.git#main');
      assert.strictEqual(parsed.dependencies[0].git, undefined);
      assert.strictEqual(parsed.dependencies[0].ref, undefined);
      
      // New format unchanged
      assert.strictEqual(parsed.dependencies[1].url, 'https://github.com/user/new.git#v2.0.0');
      
      // Registry unchanged
      assert.strictEqual(parsed.dependencies[2].version, '^1.0.0');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle git source with subdirectory (combined migration)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Legacy format with git, ref, and subdirectory
      const legacyManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    git: https://github.com/user/repo.git
    ref: v1.0.0
    subdirectory: ./plugins/x
`;
      
      await writeTextFile(manifestPath, legacyManifest);
      
      // Parse
      const parsed = await parsePackageYml(manifestPath);
      
      // Verify all migrations
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      assert.strictEqual(dep.url, 'https://github.com/user/repo.git#v1.0.0');
      assert.strictEqual(dep.base, 'plugins/x');
      assert.strictEqual(dep.git, undefined);
      assert.strictEqual(dep.ref, undefined);
      assert.strictEqual(dep.subdirectory, undefined);
      
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
  - name: dev-tool
    git: https://github.com/user/dev-tool.git
    ref: main
`;
      
      await writeTextFile(manifestPath, devManifest);
      
      // Parse
      const parsed = await parsePackageYml(manifestPath);
      
      // Verify dev-dependencies migration
      assert.ok(parsed['dev-dependencies']);
      assert.strictEqual(parsed['dev-dependencies'].length, 1);
      const dep = parsed['dev-dependencies'][0];
      assert.strictEqual(dep.url, 'https://github.com/user/dev-tool.git#main');
      assert.strictEqual(dep.git, undefined);
      assert.strictEqual(dep.ref, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should round-trip correctly (read → write → read)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Start with legacy format
      const legacyManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    git: https://github.com/user/repo.git
    ref: v1.0.0
`;
      
      await writeTextFile(manifestPath, legacyManifest);
      
      // Read, write, read again
      const parsed1 = await parsePackageYml(manifestPath);
      await writePackageYml(manifestPath, parsed1);
      const parsed2 = await parsePackageYml(manifestPath);
      
      // Verify consistency
      assert.ok(parsed2.dependencies);
      const dep = parsed2.dependencies[0];
      assert.strictEqual(dep.url, 'https://github.com/user/repo.git#v1.0.0');
      assert.strictEqual(dep.git, undefined);
      assert.strictEqual(dep.ref, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should validate that url and git are mutually exclusive', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Invalid: both url and git present
      const invalidManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    url: https://github.com/user/repo1.git
    git: https://github.com/user/repo2.git
`;
      
      await writeTextFile(manifestPath, invalidManifest);
      
      // Should throw during validation
      await assert.rejects(
        async () => await parsePackageYml(manifestPath),
        /has multiple sources/
      );
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle git source without ref', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Git without ref (uses default branch)
      const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    git: https://github.com/user/repo.git
`;
      
      await writeTextFile(manifestPath, manifest);
      
      // Parse
      const parsed = await parsePackageYml(manifestPath);
      
      // Verify migration without ref
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      assert.strictEqual(dep.url, 'https://github.com/user/repo.git');
      assert.strictEqual(dep.git, undefined);
      assert.strictEqual(dep.ref, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should preserve path field semantics with url', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Git source with path (subdirectory within repo)
      const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    git: https://github.com/user/repo.git
    ref: main
    path: plugins/x
  - name: local-pkg
    path: ./local-dir
`;
      
      await writeTextFile(manifestPath, manifest);
      
      // Parse and write
      const parsed = await parsePackageYml(manifestPath);
      await writePackageYml(manifestPath, parsed);
      
      // Read back
      const reparsed = await parsePackageYml(manifestPath);
      
      // First dep: plugins/x is not a resource prefix, so it migrates to base
      assert.strictEqual(reparsed.dependencies![0].url, 'https://github.com/user/repo.git#main');
      assert.strictEqual(reparsed.dependencies![0].base, 'plugins/x');

      // Second dep: local filesystem path migrates to base
      assert.strictEqual(reparsed.dependencies![1].base, './local-dir');
      assert.strictEqual(reparsed.dependencies![1].url, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

console.log('✓ All manifest git→url migration tests passed');
