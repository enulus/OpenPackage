import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { parsePackageYml } from '../../../packages/core/src/utils/package-yml.js';
import { writeTextFile, readTextFile } from '../../../packages/core/src/utils/fs.js';
import { classifyPackageInput } from '../../../packages/core/src/core/install/package-input.js';

/**
 * Phase 3 Integration Tests
 * 
 * End-to-end tests for git source installation with new syntax.
 * Tests backward compatibility and manifest format conversion.
 */

describe('Git source integration tests (Phase 3)', () => {
  
  describe('Input detection and classification', () => {
    it('should detect gh@ shorthand as git source', async () => {
      const result = await classifyPackageInput('gh@user/repo');
      assert.strictEqual(result.type, 'git');
      assert.strictEqual(result.gitUrl, 'https://github.com/user/repo.git');
    });
    
    it('should detect gh@ with path as git source', async () => {
      const result = await classifyPackageInput('gh@user/repo/plugins/x');
      assert.strictEqual(result.type, 'git');
      assert.strictEqual(result.gitUrl, 'https://github.com/user/repo.git');
      assert.strictEqual(result.gitPath, 'plugins/x');
    });
    
    it('should detect GitHub web URL as git source', async () => {
      const result = await classifyPackageInput('https://github.com/user/repo');
      assert.strictEqual(result.type, 'git');
      assert.ok(result.gitUrl?.includes('github.com'));
    });
    
    it('should detect GitHub web URL with tree/ref as git source', async () => {
      const result = await classifyPackageInput('https://github.com/user/repo/tree/main');
      assert.strictEqual(result.type, 'git');
      assert.ok(result.gitUrl?.includes('github.com'));
      assert.strictEqual(result.gitRef, 'main');
    });
    
    it('should detect GitHub web URL with path as git source', async () => {
      const result = await classifyPackageInput('https://github.com/user/repo/tree/main/plugins/x');
      assert.strictEqual(result.type, 'git');
      assert.ok(result.gitUrl?.includes('github.com'));
      assert.strictEqual(result.gitRef, 'main');
      assert.strictEqual(result.gitPath, 'plugins/x');
    });
    
    it('should detect generic git URL as git source', async () => {
      const result = await classifyPackageInput('https://gitlab.com/user/repo.git');
      assert.strictEqual(result.type, 'git');
      assert.strictEqual(result.gitUrl, 'https://gitlab.com/user/repo.git');
    });
    
    it('should detect generic git URL with ref', async () => {
      const result = await classifyPackageInput('https://gitlab.com/user/repo.git#v1.0.0');
      assert.strictEqual(result.type, 'git');
      assert.strictEqual(result.gitRef, 'v1.0.0');
    });
    
    it('should detect generic git URL with path', async () => {
      const result = await classifyPackageInput('https://gitlab.com/user/repo.git#main&path=packages/x');
      assert.strictEqual(result.type, 'git');
      assert.strictEqual(result.gitRef, 'main');
      assert.strictEqual(result.gitPath, 'packages/x');
    });
    
    it('should handle legacy github: prefix with deprecation', async () => {
      const result = await classifyPackageInput('github:user/repo');
      assert.strictEqual(result.type, 'git');
      assert.ok(result.gitUrl?.includes('github.com'));
    });
    
    it('should handle legacy git: prefix with deprecation', async () => {
      const result = await classifyPackageInput('git:https://gitlab.com/user/repo.git');
      assert.strictEqual(result.type, 'git');
      assert.strictEqual(result.gitUrl, 'https://gitlab.com/user/repo.git');
    });
  });
  
  describe('Manifest format - new format writing', () => {
    it('should write new format for gh@ shorthand input', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
      
      try {
        const manifestPath = join(tmpDir, 'openpackage.yml');
        
        // Create initial manifest
        const initialManifest = `name: test-package
version: 1.0.0
dependencies: []
`;
        await writeTextFile(manifestPath, initialManifest);
        
        // Parse and add a git dependency (simulating install behavior)
        const parsed = await parsePackageYml(manifestPath);
        parsed.dependencies = [
          {
            name: 'gh@user/repo',
            url: 'https://github.com/user/repo.git'
          }
        ];
        
        // Write back (should use new format)
        const yaml = await import('js-yaml');
        const content = yaml.dump(parsed, { lineWidth: -1 });
        await writeTextFile(manifestPath, content);
        
        // Read and verify
        const written = await readTextFile(manifestPath);
        assert.ok(written.includes('url: https://github.com/user/repo.git'));
        assert.ok(!written.includes('git:'));
        
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
    
    it('should write new format with embedded ref', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
      
      try {
        const manifestPath = join(tmpDir, 'openpackage.yml');
        
        const initialManifest = `name: test-package
version: 1.0.0
dependencies: []
`;
        await writeTextFile(manifestPath, initialManifest);
        
        const parsed = await parsePackageYml(manifestPath);
        parsed.dependencies = [
          {
            name: 'my-plugin',
            url: 'https://github.com/user/repo.git#v1.0.0',
            path: 'plugins/x'
          }
        ];
        
        const yaml = await import('js-yaml');
        const content = yaml.dump(parsed, { lineWidth: -1 });
        await writeTextFile(manifestPath, content);
        
        const written = await readTextFile(manifestPath);
        assert.ok(written.includes('url: https://github.com/user/repo.git#v1.0.0'));
        assert.ok(written.includes('path: plugins/x'));
        assert.ok(!written.includes('git:'));
        assert.ok(!written.includes('ref:'));
        
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
  
  describe('Backward compatibility - old format reading', () => {
    it('should read old format manifest without errors', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
      
      try {
        const manifestPath = join(tmpDir, 'openpackage.yml');
        
        // Old format with git + ref
        const oldManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    git: https://github.com/user/repo.git
    ref: main
    path: plugins/x
`;
        await writeTextFile(manifestPath, oldManifest);
        
        // Should parse without errors
        const parsed = await parsePackageYml(manifestPath);
        
        // Should auto-migrate to new format
        assert.ok(parsed.dependencies);
        assert.strictEqual(parsed.dependencies[0].url, 'https://github.com/user/repo.git#main');
        assert.strictEqual(parsed.dependencies[0].base, 'plugins/x');
        assert.strictEqual(parsed.dependencies[0].path, undefined);
        assert.strictEqual(parsed.dependencies[0].git, undefined);
        assert.strictEqual(parsed.dependencies[0].ref, undefined);
        
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
    
    it('should handle mixed old and new format dependencies', async () => {
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
        
        const parsed = await parsePackageYml(manifestPath);
        
        assert.ok(parsed.dependencies);
        assert.strictEqual(parsed.dependencies.length, 3);
        
        // Old format auto-migrated
        assert.strictEqual(parsed.dependencies[0].url, 'https://github.com/user/old.git#main');
        assert.strictEqual(parsed.dependencies[0].git, undefined);
        
        // New format unchanged
        assert.strictEqual(parsed.dependencies[1].url, 'https://github.com/user/new.git#v2.0.0');
        
        // Registry unchanged
        assert.strictEqual(parsed.dependencies[2].version, '^1.0.0');
        
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
  
  describe('File conversion on write', () => {
    it('should convert entire manifest to new format on write', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
      
      try {
        const manifestPath = join(tmpDir, 'openpackage.yml');
        
        // Start with old format
        const oldManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: plugin1
    git: https://github.com/user/repo1.git
    ref: v1.0.0
  - name: plugin2
    git: https://github.com/user/repo2.git
    ref: main
    subdirectory: plugins/x
`;
        await writeTextFile(manifestPath, oldManifest);
        
        // Parse and write back
        const parsed = await parsePackageYml(manifestPath);
        const yaml = await import('js-yaml');
        const content = yaml.dump(parsed, { lineWidth: -1 });
        await writeTextFile(manifestPath, content);
        
        // Read raw content
        const written = await readTextFile(manifestPath);
        
        // Verify all old fields are gone
        assert.ok(!written.includes('git:'));
        assert.ok(!written.includes('ref:'));
        assert.ok(!written.includes('subdirectory:'));
        
        // Verify new format is used
        assert.ok(written.includes('url: https://github.com/user/repo1.git#v1.0.0'));
        assert.ok(written.includes('url: https://github.com/user/repo2.git#main'));
        assert.ok(written.includes('base: plugins/x'));
        
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
  
  describe('Path field semantics', () => {
    it('should preserve path field semantics with git url', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
      
      try {
        const manifestPath = join(tmpDir, 'openpackage.yml');
        
        const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: git-plugin
    url: https://github.com/user/repo.git#main
    path: plugins/x
  - name: local-pkg
    path: ./local-dir
`;
        await writeTextFile(manifestPath, manifest);
        
        const parsed = await parsePackageYml(manifestPath);
        
        // Git source: non-resource path migrates to base (subdirectory)
        assert.strictEqual(parsed.dependencies![0].url, 'https://github.com/user/repo.git#main');
        assert.strictEqual(parsed.dependencies![0].base, 'plugins/x');
        assert.strictEqual(parsed.dependencies![0].path, undefined);

        // Local source: path migrates to base (filesystem path)
        assert.strictEqual(parsed.dependencies![1].base, './local-dir');
        assert.strictEqual(parsed.dependencies![1].path, undefined);
        assert.strictEqual(parsed.dependencies![1].url, undefined);
        
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
  
  describe('Validation', () => {
    it('should validate exactly one source required', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
      
      try {
        const manifestPath = join(tmpDir, 'openpackage.yml');
        
        // Invalid: both url and version
        const invalidManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: bad-plugin
    url: https://github.com/user/repo.git
    version: ^1.0.0
`;
        await writeTextFile(manifestPath, invalidManifest);
        
        await assert.rejects(
          async () => await parsePackageYml(manifestPath),
          /has multiple sources/
        );
        
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
    
    it('should reject url and git together', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
      
      try {
        const manifestPath = join(tmpDir, 'openpackage.yml');
        
        const invalidManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: bad-plugin
    url: https://github.com/user/repo1.git
    git: https://github.com/user/repo2.git
`;
        await writeTextFile(manifestPath, invalidManifest);
        
        await assert.rejects(
          async () => await parsePackageYml(manifestPath),
          /has multiple sources/
        );
        
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
  
  describe('Round-trip consistency', () => {
    it('should maintain data integrity through read-write cycles', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
      
      try {
        const manifestPath = join(tmpDir, 'openpackage.yml');
        
        // Start with new format
        const newManifest = `name: test-package
version: 1.0.0
dependencies:
  - name: my-plugin
    url: https://github.com/user/repo.git#v1.0.0
    path: plugins/x
`;
        await writeTextFile(manifestPath, newManifest);
        
        // Multiple read-write cycles
        for (let i = 0; i < 3; i++) {
          const parsed = await parsePackageYml(manifestPath);
          const yaml = await import('js-yaml');
          const content = yaml.dump(parsed, { lineWidth: -1 });
          await writeTextFile(manifestPath, content);
        }
        
        // Final verification — plugins/x migrates from path to base on first cycle
        const final = await parsePackageYml(manifestPath);
        assert.strictEqual(final.dependencies![0].url, 'https://github.com/user/repo.git#v1.0.0');
        assert.strictEqual(final.dependencies![0].base, 'plugins/x');
        assert.strictEqual(final.dependencies![0].path, undefined);
        assert.strictEqual(final.dependencies![0].git, undefined);
        assert.strictEqual(final.dependencies![0].ref, undefined);
        
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
