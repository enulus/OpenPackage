/**
 * Tests for subsumption-resolver: detects and resolves overlapping
 * resource-scoped and full-package installations from the same source.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkSubsumption,
  resolveSubsumption,
  extractSourceIdentity
} from '../../../src/core/install/orchestrator/subsumption-resolver.js';
import type { PackageSource } from '../../../src/core/install/unified/context.js';
import {
  getWorkspaceIndexPath,
  readWorkspaceIndex,
  writeWorkspaceIndex
} from '../../../src/utils/workspace-index-yml.js';
import { createWorkspacePackageYml } from '../../../src/utils/package-management.js';
import { getLocalPackageYmlPath } from '../../../src/utils/paths.js';

let testDir: string;

async function setup() {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-subsumption-'));
  await createWorkspacePackageYml(testDir);
}

async function cleanup() {
  if (testDir) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// ============================================================================
// extractSourceIdentity tests
// ============================================================================

function testExtractSourceIdentity() {
  // Git source - full package
  const gitFull = extractSourceIdentity({
    type: 'git',
    packageName: 'gh@user/repo',
    gitUrl: 'https://github.com/user/repo'
  } as PackageSource);
  assert.ok(gitFull);
  assert.equal(gitFull.basePackageName, 'gh@user/repo');
  assert.equal(gitFull.isResourceScoped, false);

  // Git source - resource scoped (name includes path)
  const gitResource = extractSourceIdentity({
    type: 'git',
    packageName: 'gh@user/repo/agents/agent1',
    gitUrl: 'https://github.com/user/repo',
    resourcePath: 'agents/agent1'
  } as PackageSource);
  assert.ok(gitResource);
  assert.equal(gitResource.basePackageName, 'gh@user/repo');
  assert.equal(gitResource.isResourceScoped, true);

  // Git source - resource scoped via name only (no resourcePath)
  const gitResourceByName = extractSourceIdentity({
    type: 'git',
    packageName: 'gh@user/repo/agents/agent1',
    gitUrl: 'https://github.com/user/repo'
  } as PackageSource);
  assert.ok(gitResourceByName);
  assert.equal(gitResourceByName.basePackageName, 'gh@user/repo');
  assert.equal(gitResourceByName.isResourceScoped, true);

  // Path source - not resource scoped
  const pathFull = extractSourceIdentity({
    type: 'path',
    packageName: 'my-local-pkg',
    localPath: '/tmp/my-local-pkg'
  } as PackageSource);
  assert.ok(pathFull);
  assert.equal(pathFull.isResourceScoped, false);

  // Registry source
  const regFull = extractSourceIdentity({
    type: 'registry',
    packageName: 'some-package'
  } as PackageSource);
  assert.ok(regFull);
  assert.equal(regFull.isResourceScoped, false);

  // Workspace source (unsupported)
  const workspace = extractSourceIdentity({
    type: 'workspace',
    packageName: 'self'
  } as PackageSource);
  assert.equal(workspace, null);

  console.log('  extractSourceIdentity tests passed');
}

// ============================================================================
// checkSubsumption: Scenario 1 — resource first, then full package
// ============================================================================

async function testScenario1_ResourceThenFullPackage() {
  await setup();
  try {
    // Simulate a resource-scoped install already in the workspace index
    const indexPath = getWorkspaceIndexPath(testDir);
    await writeWorkspaceIndex({
      path: indexPath,
      index: {
        packages: {
          'gh@user/repo/agents/agent1': {
            path: '.openpackage/cache/git/abc123/def456/agents/agent1',
            version: '1.0.0',
            files: {
              'agents/agent1.md': ['.claude/agents/agent1.md']
            }
          }
        }
      }
    });

    // Now check subsumption for a full package install from the same source
    const source: PackageSource = {
      type: 'git',
      packageName: 'gh@user/repo',
      gitUrl: 'https://github.com/user/repo'
    };

    const result = await checkSubsumption(source, testDir);
    assert.equal(result.type, 'upgrade');
    assert.ok('entriesToRemove' in result);
    assert.equal(result.entriesToRemove.length, 1);
    assert.equal(result.entriesToRemove[0].packageName, 'gh@user/repo/agents/agent1');

    console.log('  Scenario 1 (resource -> full package) detection passed');
  } finally {
    await cleanup();
  }
}

// ============================================================================
// checkSubsumption: Scenario 1 with multiple resources
// ============================================================================

async function testScenario1_MultipleResources() {
  await setup();
  try {
    const indexPath = getWorkspaceIndexPath(testDir);
    await writeWorkspaceIndex({
      path: indexPath,
      index: {
        packages: {
          'gh@user/repo/agents/agent1': {
            path: '.openpackage/cache/git/abc/def/agents/agent1',
            files: { 'agents/agent1.md': ['.claude/agents/agent1.md'] }
          },
          'gh@user/repo/skills/react': {
            path: '.openpackage/cache/git/abc/def/skills/react',
            files: { 'skills/react/SKILL.md': ['.claude/skills/react/SKILL.md'] }
          },
          'gh@other/unrelated': {
            path: '.openpackage/cache/git/xyz/123',
            version: '2.0.0',
            files: { 'agents/helper.md': ['.claude/agents/helper.md'] }
          }
        }
      }
    });

    const source: PackageSource = {
      type: 'git',
      packageName: 'gh@user/repo',
      gitUrl: 'https://github.com/user/repo'
    };

    const result = await checkSubsumption(source, testDir);
    assert.equal(result.type, 'upgrade');
    assert.ok('entriesToRemove' in result);
    assert.equal(result.entriesToRemove.length, 2);

    const names = result.entriesToRemove.map(e => e.packageName).sort();
    assert.deepEqual(names, [
      'gh@user/repo/agents/agent1',
      'gh@user/repo/skills/react'
    ]);

    console.log('  Scenario 1 (multiple resources -> full package) detection passed');
  } finally {
    await cleanup();
  }
}

// ============================================================================
// checkSubsumption: Scenario 2 — full package first, then resource
// ============================================================================

async function testScenario2_FullPackageThenResource() {
  await setup();
  try {
    const indexPath = getWorkspaceIndexPath(testDir);
    await writeWorkspaceIndex({
      path: indexPath,
      index: {
        packages: {
          'gh@user/repo': {
            path: '.openpackage/cache/git/abc123/def456',
            version: '1.0.0',
            files: {
              'agents/agent1.md': ['.claude/agents/agent1.md'],
              'skills/react/SKILL.md': ['.claude/skills/react/SKILL.md']
            }
          }
        }
      }
    });

    // Now try to install a single resource from the same source
    const source: PackageSource = {
      type: 'git',
      packageName: 'gh@user/repo/agents/agent1',
      gitUrl: 'https://github.com/user/repo',
      resourcePath: 'agents/agent1'
    };

    const result = await checkSubsumption(source, testDir);
    assert.equal(result.type, 'already-covered');
    assert.ok('coveringPackage' in result);
    assert.equal(result.coveringPackage, 'gh@user/repo');

    console.log('  Scenario 2 (full package -> resource) detection passed');
  } finally {
    await cleanup();
  }
}

// ============================================================================
// checkSubsumption: No overlap (different sources)
// ============================================================================

async function testNoOverlap_DifferentSources() {
  await setup();
  try {
    const indexPath = getWorkspaceIndexPath(testDir);
    await writeWorkspaceIndex({
      path: indexPath,
      index: {
        packages: {
          'gh@other/package/agents/helper': {
            path: '.openpackage/cache/git/xyz/123/agents/helper',
            files: { 'agents/helper.md': ['.claude/agents/helper.md'] }
          }
        }
      }
    });

    const source: PackageSource = {
      type: 'git',
      packageName: 'gh@user/repo',
      gitUrl: 'https://github.com/user/repo'
    };

    const result = await checkSubsumption(source, testDir);
    assert.equal(result.type, 'none');

    console.log('  No overlap (different sources) passed');
  } finally {
    await cleanup();
  }
}

// ============================================================================
// checkSubsumption: No overlap (same package reinstall)
// ============================================================================

async function testNoOverlap_SamePackageReinstall() {
  await setup();
  try {
    const indexPath = getWorkspaceIndexPath(testDir);
    await writeWorkspaceIndex({
      path: indexPath,
      index: {
        packages: {
          'gh@user/repo': {
            path: '.openpackage/cache/git/abc/def',
            version: '1.0.0',
            files: { 'agents/agent1.md': ['.claude/agents/agent1.md'] }
          }
        }
      }
    });

    // Reinstalling the same full package should not trigger subsumption
    const source: PackageSource = {
      type: 'git',
      packageName: 'gh@user/repo',
      gitUrl: 'https://github.com/user/repo'
    };

    const result = await checkSubsumption(source, testDir);
    assert.equal(result.type, 'none');

    console.log('  No overlap (same package reinstall) passed');
  } finally {
    await cleanup();
  }
}

// ============================================================================
// checkSubsumption: No overlap (resource A then resource B from same source)
// ============================================================================

async function testNoOverlap_ResourceAToResourceB() {
  await setup();
  try {
    const indexPath = getWorkspaceIndexPath(testDir);
    await writeWorkspaceIndex({
      path: indexPath,
      index: {
        packages: {
          'gh@user/repo/agents/agent1': {
            path: '.openpackage/cache/git/abc/def/agents/agent1',
            files: { 'agents/agent1.md': ['.claude/agents/agent1.md'] }
          }
        }
      }
    });

    // Installing resource B from the same package should NOT be subsumed
    // (resource A doesn't cover resource B)
    const source: PackageSource = {
      type: 'git',
      packageName: 'gh@user/repo/skills/react',
      gitUrl: 'https://github.com/user/repo',
      resourcePath: 'skills/react'
    };

    const result = await checkSubsumption(source, testDir);
    assert.equal(result.type, 'none');

    console.log('  No overlap (resource A then resource B) passed');
  } finally {
    await cleanup();
  }
}

// ============================================================================
// checkSubsumption: Empty workspace index
// ============================================================================

async function testEmptyIndex() {
  await setup();
  try {
    const source: PackageSource = {
      type: 'git',
      packageName: 'gh@user/repo',
      gitUrl: 'https://github.com/user/repo'
    };

    const result = await checkSubsumption(source, testDir);
    assert.equal(result.type, 'none');

    console.log('  Empty workspace index passed');
  } finally {
    await cleanup();
  }
}

// ============================================================================
// resolveSubsumption: Actually removes entries
// ============================================================================

async function testResolveSubsumption() {
  await setup();
  try {
    const indexPath = getWorkspaceIndexPath(testDir);

    // Set up workspace index with a resource entry
    await writeWorkspaceIndex({
      path: indexPath,
      index: {
        packages: {
          'gh@user/repo/agents/agent1': {
            path: '.openpackage/cache/git/abc/def/agents/agent1',
            version: '1.0.0',
            files: { 'agents/agent1.md': ['.claude/agents/agent1.md'] }
          },
          'gh@other/package': {
            path: '.openpackage/cache/git/xyz/123',
            version: '2.0.0',
            files: { 'agents/helper.md': ['.claude/agents/helper.md'] }
          }
        }
      }
    });

    // Also set up workspace manifest with the resource dependency
    const manifestPath = getLocalPackageYmlPath(testDir);
    fs.writeFileSync(manifestPath, `name: test-workspace
dependencies:
  - name: gh@user/repo/agents/agent1
    url: https://github.com/user/repo
    path: agents/agent1
  - name: gh@other/package
    url: https://github.com/other/package
dev-dependencies: []
`, 'utf-8');

    // Resolve subsumption: remove the resource entry
    await resolveSubsumption(
      {
        type: 'upgrade',
        entriesToRemove: [{ packageName: 'gh@user/repo/agents/agent1' }]
      },
      testDir
    );

    // Verify workspace index no longer has the resource entry
    const wsRecord = await readWorkspaceIndex(testDir);
    assert.ok(!wsRecord.index.packages['gh@user/repo/agents/agent1'],
      'Resource entry should be removed from workspace index');
    assert.ok(wsRecord.index.packages['gh@other/package'],
      'Unrelated entry should remain in workspace index');

    // Verify workspace manifest no longer has the resource dependency
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    assert.ok(!manifestContent.includes('gh@user/repo/agents/agent1'),
      'Resource dependency should be removed from manifest');
    assert.ok(manifestContent.includes('gh@other/package'),
      'Unrelated dependency should remain in manifest');

    console.log('  resolveSubsumption removes entries passed');
  } finally {
    await cleanup();
  }
}

// ============================================================================
// checkSubsumption: Case-insensitive matching
// ============================================================================

async function testCaseInsensitiveMatching() {
  await setup();
  try {
    const indexPath = getWorkspaceIndexPath(testDir);
    await writeWorkspaceIndex({
      path: indexPath,
      index: {
        packages: {
          'gh@User/Repo/agents/agent1': {
            path: '.openpackage/cache/git/abc/def/agents/agent1',
            files: { 'agents/agent1.md': ['.claude/agents/agent1.md'] }
          }
        }
      }
    });

    // Full package install with lowercase name
    const source: PackageSource = {
      type: 'git',
      packageName: 'gh@user/repo',
      gitUrl: 'https://github.com/user/repo'
    };

    const result = await checkSubsumption(source, testDir);
    // After normalization (migration), the key should match
    assert.equal(result.type, 'upgrade');
    assert.ok('entriesToRemove' in result);
    assert.equal(result.entriesToRemove.length, 1);

    console.log('  Case-insensitive matching passed');
  } finally {
    await cleanup();
  }
}

// ============================================================================
// Run all tests
// ============================================================================

try {
  testExtractSourceIdentity();

  await testScenario1_ResourceThenFullPackage();
  await testScenario1_MultipleResources();
  await testScenario2_FullPackageThenResource();
  await testNoOverlap_DifferentSources();
  await testNoOverlap_SamePackageReinstall();
  await testNoOverlap_ResourceAToResourceB();
  await testEmptyIndex();
  await testResolveSubsumption();
  await testCaseInsensitiveMatching();

  console.log('\nsubsumption-resolver tests passed');
} catch (error) {
  console.error('Test failed:', error);
  process.exitCode = 1;
}
