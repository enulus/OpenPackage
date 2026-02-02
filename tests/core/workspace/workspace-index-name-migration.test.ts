import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { readWorkspaceIndex, writeWorkspaceIndex } from '../../../src/utils/workspace-index-yml.js';
import { writeTextFile } from '../../../src/utils/fs.js';

describe('Workspace index name migration', () => {
  it('should migrate package name with wrong path to use full path from cache location', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      await mkdir(join(tmpDir, '.openpackage'), { recursive: true });
      const indexPath = join(tmpDir, '.openpackage', 'openpackage.index.yml');
      
      // Package name has basename, but cache path has full subdirectory
      const indexContent = `# This file is managed by OpenPackage. Do not edit manually.

packages:
  gh@wshobson/agents/cicd-automation:
    path: .openpackage/cache/git/abc123/def456/plugins/cicd-automation
    files: {}
`;
      
      await writeTextFile(indexPath, indexContent);
      
      const record = await readWorkspaceIndex(tmpDir);
      
      // Should migrate to use full path from cache
      const packages = Object.keys(record.index.packages);
      assert.strictEqual(packages.length, 1);
      assert.strictEqual(packages[0], 'gh@wshobson/agents/plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should migrate package name without gh@ prefix', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      await mkdir(join(tmpDir, '.openpackage'), { recursive: true });
      const indexPath = join(tmpDir, '.openpackage', 'openpackage.index.yml');
      
      const indexContent = `packages:
  wshobson/agents/cicd-automation:
    path: .openpackage/cache/git/abc123/def456/plugins/cicd-automation
    files: {}
`;
      
      await writeTextFile(indexPath, indexContent);
      
      const record = await readWorkspaceIndex(tmpDir);
      
      const packages = Object.keys(record.index.packages);
      assert.strictEqual(packages[0], 'gh@wshobson/agents/plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should migrate old @ format to gh@ with full path', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      await mkdir(join(tmpDir, '.openpackage'), { recursive: true });
      const indexPath = join(tmpDir, '.openpackage', 'openpackage.index.yml');
      
      const indexContent = `packages:
  "@wshobson/agents/cicd-automation":
    path: .openpackage/cache/git/abc123/def456/plugins/cicd-automation
    files: {}
`;
      
      await writeTextFile(indexPath, indexContent);
      
      const record = await readWorkspaceIndex(tmpDir);
      
      const packages = Object.keys(record.index.packages);
      assert.strictEqual(packages[0], 'gh@wshobson/agents/plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle standalone repo without subpath', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      await mkdir(join(tmpDir, '.openpackage'), { recursive: true });
      const indexPath = join(tmpDir, '.openpackage', 'openpackage.index.yml');
      
      const indexContent = `packages:
  wshobson/agents:
    path: .openpackage/cache/git/abc123/def456
    files: {}
`;
      
      await writeTextFile(indexPath, indexContent);
      
      const record = await readWorkspaceIndex(tmpDir);
      
      const packages = Object.keys(record.index.packages);
      assert.strictEqual(packages[0], 'gh@wshobson/agents');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should not change correctly formatted names', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      await mkdir(join(tmpDir, '.openpackage'), { recursive: true });
      const indexPath = join(tmpDir, '.openpackage', 'openpackage.index.yml');
      
      const indexContent = `packages:
  gh@wshobson/agents/plugins/cicd-automation:
    path: .openpackage/cache/git/abc123/def456/plugins/cicd-automation
    files: {}
`;
      
      await writeTextFile(indexPath, indexContent);
      
      const record = await readWorkspaceIndex(tmpDir);
      
      const packages = Object.keys(record.index.packages);
      assert.strictEqual(packages[0], 'gh@wshobson/agents/plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('should not collapse resource-scoped names to cache subpath', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      await mkdir(join(tmpDir, '.openpackage'), { recursive: true });
      const indexPath = join(tmpDir, '.openpackage', 'openpackage.index.yml');
      
      // Resource-scoped name is MORE specific than cache subpath; it must be preserved.
      const indexContent = `packages:
  gh@wshobson/agents/plugins/javascript-typescript/skills/typescript-advanced-types:
    path: .openpackage/cache/git/abc123/def456/plugins/javascript-typescript
    files: {}
`;
      
      await writeTextFile(indexPath, indexContent);
      
      const record = await readWorkspaceIndex(tmpDir);
      
      const packages = Object.keys(record.index.packages);
      assert.strictEqual(packages.length, 1);
      assert.strictEqual(packages[0], 'gh@wshobson/agents/plugins/javascript-typescript/skills/typescript-advanced-types');
      
      // Round-trip write should also preserve it
      await writeWorkspaceIndex(record);
      const reread = await readWorkspaceIndex(tmpDir);
      const packages2 = Object.keys(reread.index.packages);
      assert.strictEqual(packages2[0], 'gh@wshobson/agents/plugins/javascript-typescript/skills/typescript-advanced-types');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should handle multiple packages with different formats', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      await mkdir(join(tmpDir, '.openpackage'), { recursive: true });
      const indexPath = join(tmpDir, '.openpackage', 'openpackage.index.yml');
      
      const indexContent = `packages:
  wshobson/agents/cicd-automation:
    path: .openpackage/cache/git/abc123/def456/plugins/cicd-automation
    files: {}
  gh@anthropics/claude-plugins-official/feature-dev:
    path: .openpackage/cache/git/xyz789/uvw123/plugins/feature-dev
    files: {}
  "@user/repo":
    path: .openpackage/cache/git/aaa111/bbb222
    files: {}
`;
      
      await writeTextFile(indexPath, indexContent);
      
      const record = await readWorkspaceIndex(tmpDir);
      
      const packages = Object.keys(record.index.packages).sort();
      assert.strictEqual(packages.length, 3);
      assert.strictEqual(packages[0], 'gh@anthropics/claude-plugins-official/plugins/feature-dev');
      assert.strictEqual(packages[1], 'gh@user/repo');
      assert.strictEqual(packages[2], 'gh@wshobson/agents/plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should write migrated index with correct names', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      await mkdir(join(tmpDir, '.openpackage'), { recursive: true });
      const indexPath = join(tmpDir, '.openpackage', 'openpackage.index.yml');
      
      const indexContent = `packages:
  wshobson/agents/cicd-automation:
    path: .openpackage/cache/git/abc123/def456/plugins/cicd-automation
    files: {}
`;
      
      await writeTextFile(indexPath, indexContent);
      
      // Read and write back
      const record = await readWorkspaceIndex(tmpDir);
      await writeWorkspaceIndex(record);
      
      // Re-read and verify
      const reread = await readWorkspaceIndex(tmpDir);
      
      const packages = Object.keys(reread.index.packages);
      assert.strictEqual(packages[0], 'gh@wshobson/agents/plugins/cicd-automation');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
  
  it('should not migrate non-git sources', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    
    try {
      await mkdir(join(tmpDir, '.openpackage'), { recursive: true });
      const indexPath = join(tmpDir, '.openpackage', 'openpackage.index.yml');
      
      // Has version field, so it's a registry package
      const indexContent = `packages:
  "@scope/package":
    path: node_modules/@scope/package
    version: 1.0.0
    files: {}
`;
      
      await writeTextFile(indexPath, indexContent);
      
      const record = await readWorkspaceIndex(tmpDir);
      
      // Should not migrate registry packages
      const packages = Object.keys(record.index.packages);
      assert.strictEqual(packages[0], '@scope/package');
      
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

console.log('✓ All workspace index name migration tests passed');
