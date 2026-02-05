import assert from 'assert';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdir, rm, writeFile } from 'fs/promises';
import { createCacheManager } from '../../src/core/cache-manager.js';

const testDir = join(tmpdir(), `cache-manager-test-${Date.now()}`);

async function setup() {
  await mkdir(testDir, { recursive: true });
}

async function cleanup() {
  await rm(testDir, { recursive: true, force: true });
}

async function testRefCaching() {
  const cacheManager = createCacheManager();
  const testUrl = 'https://github.com/test/ref-cache-test-repo';
  const testRef = 'main';
  const testCommit = 'abc1234';
  
  // Initially should be null
  const initial = await cacheManager.getCachedCommitForRef(testUrl, testRef);
  assert.strictEqual(initial, null, 'Should return null for uncached ref');
  
  // Cache the ref
  await cacheManager.cacheRefCommit(testUrl, testRef, testCommit);
  
  // Should now return the cached commit
  const cached = await cacheManager.getCachedCommitForRef(testUrl, testRef);
  assert.strictEqual(cached, testCommit, 'Should return cached commit');
  
  console.log('✓ Ref caching works');
}

async function testImmutableRefNoExpiry() {
  const cacheManager = createCacheManager();
  const testUrl = 'https://github.com/test/immutable-test-repo';
  
  // Test with semver tag (should never expire based on TTL)
  const semverTag = 'v1.0.0';
  const commit1 = 'def5678';
  await cacheManager.cacheRefCommit(testUrl, semverTag, commit1);
  const cachedSemver = await cacheManager.getCachedCommitForRef(testUrl, semverTag);
  assert.strictEqual(cachedSemver, commit1, 'Semver tag should be cached');
  
  // Test with full SHA (should never expire)
  const fullSha = 'a'.repeat(40);
  const commit2 = 'ghi9012';
  await cacheManager.cacheRefCommit(testUrl, fullSha, commit2);
  const cachedSha = await cacheManager.getCachedCommitForRef(testUrl, fullSha);
  assert.strictEqual(cachedSha, commit2, 'Full SHA should be cached');
  
  console.log('✓ Immutable refs are cached without expiry check');
}

async function testMetadataCaching() {
  const cacheManager = createCacheManager();
  const testPackage = 'test-metadata-package';
  const testVersions = ['1.0.0', '1.1.0', '2.0.0'];
  
  // Initially should be null
  const initial = await cacheManager.getCachedMetadata(testPackage);
  assert.strictEqual(initial, null, 'Should return null for uncached metadata');
  
  // Cache metadata
  await cacheManager.cacheMetadata(testPackage, testVersions);
  
  // Should now return cached versions
  const cached = await cacheManager.getCachedMetadata(testPackage);
  assert.ok(cached, 'Should return cached metadata');
  assert.deepStrictEqual(cached.versions, testVersions, 'Versions should match');
  
  console.log('✓ Metadata caching works');
}

async function testLocalPackageCheck() {
  const cacheManager = createCacheManager();
  
  // Check for non-existent package
  const nonExistent = await cacheManager.hasLocalPackage('non-existent-pkg', '1.0.0');
  assert.strictEqual(nonExistent, false, 'Should return false for non-existent package');
  
  const nonExistentPath = await cacheManager.getLocalPackagePath('non-existent-pkg', '1.0.0');
  assert.strictEqual(nonExistentPath, null, 'Should return null path for non-existent package');
  
  console.log('✓ Local package check works for non-existent packages');
}

async function runTests() {
  try {
    await setup();
    await testRefCaching();
    await testImmutableRefNoExpiry();
    await testMetadataCaching();
    await testLocalPackageCheck();
    console.log('\ncache-manager tests passed');
  } finally {
    await cleanup();
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
