import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { parsePackageYml, writePackageYml } from '../../../packages/core/src/utils/package-yml.js';
import { writeTextFile } from '../../../packages/core/src/utils/fs.js';

describe('Package name path migration', () => {
  it('should migrate package name to use full path from path field', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Package name has basename, but path field has full path
      const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: gh@wshobson/agents/cicd-automation
    git: https://github.com/wshobson/agents.git
    path: plugins/cicd-automation
`;
      
      await writeTextFile(manifestPath, manifest);
      
      const parsed = await parsePackageYml(manifestPath);
      
      assert.ok(parsed.dependencies);
      assert.strictEqual(parsed.dependencies.length, 1);
      
      const dep = parsed.dependencies[0];
      // Name should be updated to include full path
      assert.strictEqual(dep.name, 'gh@wshobson/agents/plugins/cicd-automation');
      assert.strictEqual(dep.base, 'plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should migrate package name without gh@ prefix to include full path', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Missing gh@ prefix AND has wrong path
      const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: wshobson/agents/cicd-automation
    git: https://github.com/wshobson/agents.git
    path: plugins/cicd-automation
`;
      
      await writeTextFile(manifestPath, manifest);
      
      const parsed = await parsePackageYml(manifestPath);
      
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      // Should add gh@ prefix and use full path
      assert.strictEqual(dep.name, 'gh@wshobson/agents/plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should migrate old @ format to gh@ with full path', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: "@wshobson/agents/cicd-automation"
    git: https://github.com/wshobson/agents.git
    path: plugins/cicd-automation
`;
      
      await writeTextFile(manifestPath, manifest);
      
      const parsed = await parsePackageYml(manifestPath);
      
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      assert.strictEqual(dep.name, 'gh@wshobson/agents/plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should migrate combined: subdirectory to path AND name to use full path', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      // Both legacy subdirectory field AND wrong package name
      const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: gh@wshobson/agents/cicd-automation
    git: https://github.com/wshobson/agents.git
    subdirectory: ./plugins/cicd-automation
`;
      
      await writeTextFile(manifestPath, manifest);
      
      const parsed = await parsePackageYml(manifestPath);
      
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      
      // Both migrations should happen
      assert.strictEqual(dep.name, 'gh@wshobson/agents/plugins/cicd-automation');
      assert.strictEqual(dep.base, 'plugins/cicd-automation');
      assert.strictEqual(dep.subdirectory, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle standalone repo without path field', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: wshobson/agents
    git: https://github.com/wshobson/agents.git
`;
      
      await writeTextFile(manifestPath, manifest);
      
      const parsed = await parsePackageYml(manifestPath);
      
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      // Should just add gh@ prefix
      assert.strictEqual(dep.name, 'gh@wshobson/agents');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should not change correctly formatted names', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: gh@wshobson/agents/plugins/cicd-automation
    git: https://github.com/wshobson/agents.git
    path: plugins/cicd-automation
`;
      
      await writeTextFile(manifestPath, manifest);
      
      const parsed = await parsePackageYml(manifestPath);
      
      assert.ok(parsed.dependencies);
      const dep = parsed.dependencies[0];
      // Should remain unchanged
      assert.strictEqual(dep.name, 'gh@wshobson/agents/plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should write migrated manifest with correct names', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      const manifestPath = join(tmpDir, 'openpackage.yml');
      
      const manifest = `name: test-package
version: 1.0.0
dependencies:
  - name: wshobson/agents/cicd-automation
    git: https://github.com/wshobson/agents.git
    subdirectory: ./plugins/cicd-automation
`;
      
      await writeTextFile(manifestPath, manifest);
      
      // Parse and write back
      const parsed = await parsePackageYml(manifestPath);
      await writePackageYml(manifestPath, parsed);
      
      // Re-read and verify
      const reparsed = await parsePackageYml(manifestPath);
      
      assert.ok(reparsed.dependencies);
      const dep = reparsed.dependencies[0];
      
      assert.strictEqual(dep.name, 'gh@wshobson/agents/plugins/cicd-automation');
      assert.strictEqual(dep.base, 'plugins/cicd-automation');
      assert.strictEqual(dep.subdirectory, undefined);
      
      // Should not need migration on second read
      assert.strictEqual((reparsed as any)._needsGitHubMigration, undefined);
      assert.strictEqual((reparsed as any)._needsSubdirectoryMigration, undefined);
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

console.log('✓ All package name path migration tests passed');
