import path from 'path';
import os from 'os';
import { mkdtemp, writeFile, mkdir } from 'fs/promises';

import { resolvePackageSource } from '../src/core/source-resolution/resolve-package-source.js';
import { resolveDependencyGraph } from '../src/core/source-resolution/dependency-graph.js';
import {
  DIR_PATTERNS,
  FILE_PATTERNS,
  OPENPACKAGE_DIRS,
  REGISTRY_PATH_PREFIXES,
  GIT,
  MUTABILITY,
  SOURCE_TYPES,
  RESOLUTION_SOURCES
} from '../src/constants/index.js';

// Mocks for git + registry so tests run without network or real registry layout
jest.mock('../src/utils/git-clone-registry.js', () => ({
  cloneGitToRegistry: jest.fn(async () => ({
    absolutePath: path.join(os.tmpdir(), 'fake-registry', GIT.DIRECTORY, 'user', 'repo', 'ref', path.sep),
    declaredPath: `${REGISTRY_PATH_PREFIXES.GIT}user/repo/ref/`
  }))
}));

jest.mock('../src/core/source-resolution/resolve-registry-version.js', () => ({
  resolveRegistryVersion: jest.fn(async (name: string, _opts: any) => {
    const root = path.join(os.tmpdir(), 'fake-registry');
    return {
      version: '1.2.3',
      declaredPath: `${REGISTRY_PATH_PREFIXES.BASE}${name}/1.2.3/`,
      absolutePath: path.join(root, name, '1.2.3', path.sep),
      resolutionSource: RESOLUTION_SOURCES.LOCAL
    };
  })
}));

jest.mock('../src/utils/source-mutability.js', () => {
  // Default implementation; individual tests override via mockImplementationOnce.
  const original = jest.requireActual('../src/utils/source-mutability.js');
  return {
    ...original,
    isRegistryPath: jest.fn((absPath: string) => original.isRegistryPath(absPath))
  };
});

const isRegistryPathMock = jest.mocked(
  require('../src/utils/source-mutability.js').isRegistryPath
);

async function createWorkspaceWithPathDep(): Promise<{
  workspace: string;
  packageDir: string;
}> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'opkg-ws-'));
  const openpackageDir = path.join(workspace, DIR_PATTERNS.OPENPACKAGE);
  const packagesDir = path.join(openpackageDir, OPENPACKAGE_DIRS.PACKAGES);
  const packageDir = path.join(packagesDir, 'pkg-a');

  await mkdir(packageDir, { recursive: true });

  const manifest = `
name: root
packages:
  - name: pkg-a
    path: ./.openpackage/packages/pkg-a/
`;
  await writeFile(path.join(openpackageDir, FILE_PATTERNS.OPENPACKAGE_YML), manifest);

  return { workspace, packageDir };
}

describe('resolvePackageSource', () => {
  it('resolves path dependencies relative to workspace manifest and marks as mutable', async () => {
    const { workspace, packageDir } = await createWorkspaceWithPathDep();

    const result = await resolvePackageSource(workspace, 'pkg-a');
    expect(result.packageName).toBe('pkg-a');
    expect(result.absolutePath).toBe(path.join(packageDir, path.sep));
    expect(result.declaredPath).toBe('./.openpackage/packages/pkg-a/');
    expect(result.mutability).toBe(MUTABILITY.MUTABLE);
    expect(result.sourceType).toBe(SOURCE_TYPES.PATH);
  });

  it('treats registry-resolved dependencies as immutable', async () => {
    isRegistryPathMock.mockImplementationOnce(() => true);

    // Workspace manifest with registry-only dependency
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'opkg-ws-reg-'));
    const openpackageDir = path.join(workspace, DIR_PATTERNS.OPENPACKAGE);
    await mkdir(openpackageDir, { recursive: true });
    const manifest = `
name: root
packages:
  - name: pkg-b
    version: 1.2.3
`;
    await writeFile(path.join(openpackageDir, FILE_PATTERNS.OPENPACKAGE_YML), manifest);

    const result = await resolvePackageSource(workspace, 'pkg-b');
    expect(result.mutability).toBe(MUTABILITY.IMMUTABLE);
    expect(result.sourceType).toBe(SOURCE_TYPES.REGISTRY);
    expect(result.version).toBe('1.2.3');
  });

  it('uses git clone helper and marks registry-cloned git as immutable', async () => {
    isRegistryPathMock.mockImplementationOnce(() => true);

    const workspace = await mkdtemp(path.join(os.tmpdir(), 'opkg-ws-git-'));
    const openpackageDir = path.join(workspace, DIR_PATTERNS.OPENPACKAGE);
    await mkdir(openpackageDir, { recursive: true });
    const manifest = `
name: root
packages:
  - name: git-pkg
    git: https://github.com/user/repo.git
    ref: main
`;
    await writeFile(path.join(openpackageDir, FILE_PATTERNS.OPENPACKAGE_YML), manifest);

    const result = await resolvePackageSource(workspace, 'git-pkg');
    expect(result.sourceType).toBe(SOURCE_TYPES.GIT);
    expect(result.mutability).toBe(MUTABILITY.IMMUTABLE);
    expect(result.declaredPath).toBe(`${REGISTRY_PATH_PREFIXES.GIT}user/repo/ref/`);
  });
});

describe('resolveDependencyGraph', () => {
  it('walks dependencies by reading manifests without cached index', async () => {
    // Root package manifest in workspace (declares pkg-a)
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'opkg-ws-graph-'));
    const openpackageDir = path.join(workspace, DIR_PATTERNS.OPENPACKAGE);
    await mkdir(openpackageDir, { recursive: true });
    const manifestRoot = `
name: root
packages:
  - name: pkg-a
    path: ./packages/pkg-a/
`;
    await writeFile(path.join(openpackageDir, FILE_PATTERNS.OPENPACKAGE_YML), manifestRoot);

    // pkg-a manifest with one child dependency pkg-b
    const pkgADir = path.join(workspace, 'packages', 'pkg-a');
    await mkdir(pkgADir, { recursive: true });
    const manifestA = `
name: pkg-a
packages:
  - name: pkg-b
    path: ../pkg-b/
`;
    await writeFile(path.join(pkgADir, FILE_PATTERNS.OPENPACKAGE_YML), manifestA);

    // pkg-b manifest with no further deps
    const pkgBDir = path.join(workspace, 'packages', 'pkg-b');
    await mkdir(pkgBDir, { recursive: true });
    const manifestB = `
name: pkg-b
packages: []
`;
    await writeFile(path.join(pkgBDir, FILE_PATTERNS.OPENPACKAGE_YML), manifestB);

    const graph = await resolveDependencyGraph(workspace, 'pkg-a');
    const names = graph.map(n => n.name).sort();
    expect(names).toEqual(['pkg-a', 'pkg-b']);
  });
});
