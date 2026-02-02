import assert from 'node:assert/strict';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { writeFile } from 'fs/promises';

console.log('manifest-base-simple test starting');

// Create a simple test with minimal dependencies
const tempDir = mkdtempSync(join(tmpdir(), 'opkg-test-'));

try {
  const manifestPath = join(tempDir, 'openpackage.yml');
  const manifestContent = `name: test-workspace
dependencies:
  - name: gh@user/repo
    url: https://github.com/user/repo.git
    base: plugins/my-plugin
`;
  
  await writeFile(manifestPath, manifestContent, 'utf-8');
  
  console.log('✓ Created test manifest with base field');
  
  // Now try to parse it
  const { parsePackageYml } = await import('../../../src/utils/package-yml.js');
  
  const parsed = await parsePackageYml(manifestPath);
  
  assert.ok(parsed.dependencies, 'dependencies should be defined');
  assert.equal(parsed.dependencies.length, 1, 'should have 1 dependency');
  assert.equal(parsed.dependencies[0].base, 'plugins/my-plugin', 'base should be parsed');
  
  console.log('✓ Successfully parsed base field from manifest');
  console.log('✅ manifest-base-simple test passed');
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
