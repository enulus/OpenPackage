/**
 * Tests for recursive dependency resolution (graph builder, manifest reader, ID generator).
 * Uses path-based dependencies only to avoid network and side effects.
 */

import assert from 'node:assert/strict';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DependencyGraphBuilder,
  computeDependencyId,
  readManifestAtPath,
  extractDependencies,
  getManifestPathAtContentRoot,
  clearLoadCache
} from '../../../src/core/install/resolution/index.js';
import type { DependencyDeclaration } from '../../../src/core/install/resolution/types.js';
import { getLocalPackageYmlPath } from '../../../src/utils/paths.js';
import { createWorkspacePackageYml } from '../../../src/utils/package-management.js';
import { DIR_PATTERNS, FILE_PATTERNS } from '../../../src/constants/index.js';

let testDir: string;

async function setup() {
  testDir = join(tmpdir(), `opkg-recursive-resolution-${Date.now()}`);
  await mkdir(testDir, { recursive: true });
  await createWorkspacePackageYml(testDir);
}

async function cleanup() {
  if (testDir) {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
  }
  clearLoadCache();
}

async function testTwoLevelDependencies() {
  const wsManifestPath = getLocalPackageYmlPath(testDir);
  await writeFile(
    wsManifestPath,
    `name: test-workspace
version: 1.0.0
dependencies:
  - name: essentials
    path: ./.openpackage/packages/essentials
dev-dependencies: []
`
  );

  const essentialsDir = join(testDir, '.openpackage', 'packages', 'essentials');
  await mkdir(essentialsDir, { recursive: true });
  await writeFile(
    join(essentialsDir, FILE_PATTERNS.OPENPACKAGE_YML),
    `name: essentials
version: 1.0.0
dependencies:
  - name: nested-a
    path: ./nested-a
dev-dependencies: []
`
  );

  const nestedDir = join(essentialsDir, 'nested-a');
  await mkdir(nestedDir, { recursive: true });
  await writeFile(
    join(nestedDir, FILE_PATTERNS.OPENPACKAGE_YML),
    `name: nested-a
version: 0.1.0
dependencies: []
dev-dependencies: []
`
  );

  const builder = new DependencyGraphBuilder(testDir, {
    workspaceRoot: testDir,
    includeDev: true,
    maxDepth: 10
  });
  const graph = await builder.build();

  assert.ok(graph.nodes.size >= 2, 'Should discover at least essentials and nested-a');
  assert.ok(graph.roots.length >= 1, 'Should have at least one root');
  assert.ok(
    graph.installationOrder.length >= 2,
    'Installation order should include nested deps (nested first, then parent)'
  );

  const nodeKeys = Array.from(graph.nodes.keys());
  const hasPathKeys = nodeKeys.some((k) => k.startsWith('path:'));
  assert.ok(hasPathKeys, 'Nodes should use path: IDs');

  console.log('✓ Two-level dependencies discovered correctly');
}

async function testCycleDetection() {
  const wsManifestPath = getLocalPackageYmlPath(testDir);
  await writeFile(
    wsManifestPath,
    `name: cycle-workspace
version: 1.0.0
dependencies:
  - name: pkg-a
    path: ./.openpackage/packages/pkg-a
dev-dependencies: []
`
  );

  const pkgADir = join(testDir, '.openpackage', 'packages', 'pkg-a');
  await mkdir(pkgADir, { recursive: true });
  await writeFile(
    join(pkgADir, FILE_PATTERNS.OPENPACKAGE_YML),
    `name: pkg-a
version: 1.0.0
dependencies:
  - name: pkg-b
    path: ../pkg-b
dev-dependencies: []
`
  );

  const pkgBDir = join(testDir, '.openpackage', 'packages', 'pkg-b');
  await mkdir(pkgBDir, { recursive: true });
  await writeFile(
    join(pkgBDir, FILE_PATTERNS.OPENPACKAGE_YML),
    `name: pkg-b
version: 1.0.0
dependencies:
  - name: pkg-a
    path: ../pkg-a
dev-dependencies: []
`
  );

  const builder = new DependencyGraphBuilder(testDir, {
    workspaceRoot: testDir,
    includeDev: false,
    maxDepth: 10
  });
  const graph = await builder.build();

  assert.ok(graph.cycles.length >= 1, 'Should detect at least one cycle');
  assert.ok(
    graph.metadata.warnings.some((w) => w.toLowerCase().includes('circular')),
    'Warnings should mention circular dependency'
  );

  console.log('✓ Cycle detection works');
}

async function testExtractDependencies() {
  const extractDir = join(testDir, 'extract-subdir');
  await mkdir(extractDir, { recursive: true });
  const manifestPath = join(extractDir, FILE_PATTERNS.OPENPACKAGE_YML);
  await writeFile(
    manifestPath,
    `name: extract-test
version: 1.0.0
dependencies:
  - name: dep-one
    path: ./dep-one
  - name: dep-two
    path: ./dep-two
dev-dependencies:
  - name: dev-dep
    path: ./dev-dep
`
  );

  const manifest = await readManifestAtPath(extractDir);
  assert.ok(manifest, 'Manifest should be read');
  assert.equal(manifest!.name, 'extract-test', 'Manifest name should match');

  const decls = extractDependencies(manifest!, manifestPath, 0, true);
  assert.ok(decls.length >= 3, 'Should extract deps + dev-deps when includeDev=true');
  const depNames = decls.map((d) => d.name);
  assert.ok(depNames.includes('dep-one'), 'Should include dep-one');
  assert.ok(depNames.includes('dep-two'), 'Should include dep-two');
  assert.ok(depNames.includes('dev-dep'), 'Should include dev-dep when includeDev=true');

  const declsNoDev = extractDependencies(manifest!, manifestPath, 0, false);
  assert.equal(declsNoDev.length, 2, 'Without dev-deps should have 2');

  console.log('✓ extractDependencies works');
}

async function testComputeDependencyId() {
  const declaredIn = join(testDir, '.openpackage', 'openpackage.yml');

  const pathDecl: DependencyDeclaration = {
    name: 'local-pkg',
    path: './packages/local-pkg',
    isDev: false,
    declaredIn,
    depth: 0
  };
  const pathId = computeDependencyId(pathDecl, join(testDir, '.openpackage'));
  assert.equal(pathId.sourceType, 'path', 'Path decl should yield path sourceType');
  assert.ok(pathId.key.startsWith('path:'), 'Key should start with path:');
  assert.equal(pathId.displayName, 'local-pkg', 'Display name should match');

  const registryDecl: DependencyDeclaration = {
    name: 'registry-pkg',
    version: '^1.0.0',
    isDev: false,
    declaredIn,
    depth: 0
  };
  const regId = computeDependencyId(registryDecl, join(testDir, '.openpackage'));
  assert.equal(regId.sourceType, 'registry', 'Registry decl should yield registry sourceType');
  assert.ok(regId.key.startsWith('registry:'), 'Key should start with registry:');

  const gitDefaultRefDecl: DependencyDeclaration = {
    name: 'gh@owner/repo/plugins/some-plugin',
    url: 'https://github.com/owner/repo.git',
    path: 'plugins/some-plugin',
    isDev: false,
    declaredIn,
    depth: 0
  };
  const gitDefaultId = computeDependencyId(gitDefaultRefDecl, join(testDir, '.openpackage'));
  assert.equal(gitDefaultId.sourceType, 'git', 'Git decl should yield git sourceType');
  // IMPORTANT: default branch should NOT be represented as '#HEAD' (that breaks `git clone --branch HEAD`)
  assert.ok(!gitDefaultId.key.includes('#HEAD:'), 'Default git ref must not be HEAD');
  assert.ok(gitDefaultId.key.includes('#default:'), 'Default git ref should be encoded as default');

  const gitEmbeddedRefDecl: DependencyDeclaration = {
    name: 'gh@owner/repo/plugins/some-plugin',
    url: 'https://github.com/owner/repo.git#v1.2.3',
    path: 'plugins/some-plugin',
    isDev: false,
    declaredIn,
    depth: 0
  };
  const gitEmbeddedId = computeDependencyId(gitEmbeddedRefDecl, join(testDir, '.openpackage'));
  assert.ok(gitEmbeddedId.key.includes('#v1.2.3:'), 'Embedded url#ref should be reflected in key');

  console.log('✓ computeDependencyId works');
}

async function testDeduplicationSamePath() {
  const wsManifestPath = getLocalPackageYmlPath(testDir);
  await writeFile(
    wsManifestPath,
    `name: dedupe-workspace
version: 1.0.0
dependencies:
  - name: same-pkg
    path: ./.openpackage/packages/same-pkg
  - name: same-pkg
    path: ./.openpackage/packages/same-pkg
dev-dependencies: []
`
  );

  const pkgDir = join(testDir, '.openpackage', 'packages', 'same-pkg');
  await mkdir(pkgDir, { recursive: true });
  await writeFile(
    join(pkgDir, FILE_PATTERNS.OPENPACKAGE_YML),
    `name: same-pkg
version: 1.0.0
dependencies: []
dev-dependencies: []
`
  );

  const builder = new DependencyGraphBuilder(testDir, {
    workspaceRoot: testDir,
    includeDev: true,
    maxDepth: 10
  });
  const graph = await builder.build();

  const pathNodes = Array.from(graph.nodes.values()).filter((n) => n.source.type === 'path');
  const samePkgNodes = pathNodes.filter((n) => n.id.displayName === 'same-pkg' || n.loaded?.name === 'same-pkg');
  assert.ok(
    samePkgNodes.length <= 1 || samePkgNodes[0]?.declarations.length >= 2,
    'Same path should dedupe to one node (or merge declarations)'
  );
  assert.ok(graph.nodes.size >= 1, 'Should have at least one node');

  console.log('✓ Deduplication for same path works');
}

async function testMaxDepth() {
  const wsManifestPath = getLocalPackageYmlPath(testDir);
  await writeFile(
    wsManifestPath,
    `name: depth-workspace
version: 1.0.0
dependencies:
  - name: level1
    path: ./.openpackage/packages/level1
dev-dependencies: []
`
  );

  let prevPath = join(testDir, '.openpackage', 'packages', 'level1');
  await mkdir(prevPath, { recursive: true });
  for (let i = 1; i <= 5; i++) {
    const name = i === 1 ? 'level1' : `level${i}`;
    const nextName = `level${i + 1}`;
    const nextPath = join(prevPath, nextName);
    await mkdir(nextPath, { recursive: true });
    await writeFile(
      join(prevPath, FILE_PATTERNS.OPENPACKAGE_YML),
      `name: ${name}
version: 1.0.0
dependencies:
  - name: ${nextName}
    path: ./${nextName}
dev-dependencies: []
`
    );
    prevPath = nextPath;
  }
  await writeFile(
    join(prevPath, FILE_PATTERNS.OPENPACKAGE_YML),
    `name: level6
version: 1.0.0
dependencies: []
dev-dependencies: []
`
  );

  const builder = new DependencyGraphBuilder(testDir, {
    workspaceRoot: testDir,
    includeDev: false,
    maxDepth: 3
  });
  const graph = await builder.build();

  assert.ok(graph.metadata.maxDepth <= 3, 'Reported max depth should respect limit');
  assert.ok(
    graph.metadata.warnings.some((w) => w.includes('max depth')) || graph.metadata.maxDepth <= 3,
    'Should cap or warn on depth'
  );

  console.log('✓ Max depth respected');
}

async function testBuildFromRootManifestPath() {
  const wsManifestPath = getLocalPackageYmlPath(testDir);
  await writeFile(
    wsManifestPath,
    `name: test-workspace
version: 1.0.0
dependencies:
  - name: essentials
    path: ./.openpackage/packages/essentials
dev-dependencies: []
`
  );

  const essentialsDir = join(testDir, '.openpackage', 'packages', 'essentials');
  await mkdir(essentialsDir, { recursive: true });
  const essentialsManifestPath = join(essentialsDir, FILE_PATTERNS.OPENPACKAGE_YML);
  await writeFile(
    essentialsManifestPath,
    `name: essentials
version: 1.0.0
dependencies:
  - name: nested-b
    path: ./nested-b
dev-dependencies: []
`
  );

  const nestedDir = join(essentialsDir, 'nested-b');
  await mkdir(nestedDir, { recursive: true });
  await writeFile(
    join(nestedDir, FILE_PATTERNS.OPENPACKAGE_YML),
    `name: nested-b
version: 0.1.0
dependencies: []
dev-dependencies: []
`
  );

  const builder = new DependencyGraphBuilder(testDir, {
    workspaceRoot: testDir,
    includeDev: false,
    maxDepth: 10,
    rootManifestPath: essentialsManifestPath
  });
  const graph = await builder.build();

  assert.ok(graph.nodes.size >= 1, 'Should discover at least one dep (nested-b) when building from root manifest path');
  assert.ok(graph.roots.length >= 1, 'Should have at least one root');
  assert.ok(
    graph.installationOrder.length >= 1,
    'Installation order should include discovered deps'
  );
  const nodeKeys = Array.from(graph.nodes.keys());
  const hasPathKeys = nodeKeys.some((k) => k.startsWith('path:'));
  assert.ok(hasPathKeys, 'Nodes should use path: IDs when built from root manifest path');

  console.log('✓ Build from rootManifestPath works');
}

async function testGetManifestPathAtContentRoot() {
  const atRootDir = join(testDir, 'manifest-at-root');
  await mkdir(atRootDir, { recursive: true });
  const atRootPath = join(atRootDir, FILE_PATTERNS.OPENPACKAGE_YML);
  await writeFile(atRootPath, 'name: at-root\nversion: 1.0.0\ndependencies: []\n');

  const inOpenPackageDir = join(testDir, 'manifest-in-openpackage');
  await mkdir(join(inOpenPackageDir, DIR_PATTERNS.OPENPACKAGE), { recursive: true });
  const inOpenPackagePath = join(inOpenPackageDir, DIR_PATTERNS.OPENPACKAGE, FILE_PATTERNS.OPENPACKAGE_YML);
  await writeFile(inOpenPackagePath, 'name: in-openpackage\nversion: 1.0.0\ndependencies: []\n');

  const noManifestDir = join(testDir, 'no-manifest');
  await mkdir(noManifestDir, { recursive: true });

  const atRootResolved = await getManifestPathAtContentRoot(atRootDir);
  assert.equal(atRootResolved, atRootPath, 'Should return path to openpackage.yml at root');

  const inOpenPackageResolved = await getManifestPathAtContentRoot(inOpenPackageDir);
  assert.equal(inOpenPackageResolved, inOpenPackagePath, 'Should return path to .openpackage/openpackage.yml');

  const noManifestResolved = await getManifestPathAtContentRoot(noManifestDir);
  assert.equal(noManifestResolved, null, 'Should return null when no manifest exists');

  console.log('✓ getManifestPathAtContentRoot works');
}

async function run() {
  try {
    await setup();
    await testComputeDependencyId();
    await testExtractDependencies();
    await testGetManifestPathAtContentRoot();
    await testTwoLevelDependencies();
    await testBuildFromRootManifestPath();
    await testDeduplicationSamePath();
    await testCycleDetection();
    await testMaxDepth();
    console.log('\n✓ All recursive resolution tests passed');
  } finally {
    await cleanup();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
