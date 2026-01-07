import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

import {
  resolveCandidateVersionsForInstall,
  maybeWarnHigherRegistryVersion
} from '../../../src/core/install/local-source-resolution.js';

const tmpBase = mkdtempSync(path.join(os.tmpdir(), 'opkg-local-source-'));
const workspaceDir = path.join(tmpBase, 'workspace');
const globalRoot = path.join(tmpBase, '.openpackage');
const originalHomedir = os.homedir;

function stubHomedir(): void {
  (os as any).homedir = () => globalRoot;
}

function restoreHomedir(): void {
  (os as any).homedir = originalHomedir;
}

function writeManifest(dir: string, version: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'openpackage.yml'), `name: foo\nversion: ${version}\n`);
}

function setupWorkspacePackage(version: string): string {
  const wsPkgDir = path.join(workspaceDir, '.openpackage', 'packages', 'foo');
  writeManifest(wsPkgDir, version);
  return wsPkgDir;
}

function setupGlobalRegistryVersion(version: string): string {
  const regDir = path.join(globalRoot, 'registry', 'foo', version);
  writeManifest(regDir, version);
  return regDir;
}

async function testWorkspaceShadowsRegistry(): Promise<void> {
  setupWorkspacePackage('1.0.0');
  setupGlobalRegistryVersion('2.0.0');

  const result = await resolveCandidateVersionsForInstall({
    cwd: workspaceDir,
    packageName: 'foo',
    mode: 'default'
  });

  assert.equal(result.sourceKind, 'workspaceMutable');
  assert.deepEqual(result.localVersions, ['1.0.0']);
}

async function testRemotePrimaryIgnoresLocals(): Promise<void> {
  const result = await resolveCandidateVersionsForInstall({
    cwd: workspaceDir,
    packageName: 'foo',
    mode: 'remote-primary'
  });

  assert.deepEqual(result.localVersions, []);
}

async function testHigherVersionWarning(): Promise<void> {
  setupGlobalRegistryVersion('1.0.0');
  setupGlobalRegistryVersion('2.0.0');

  const warning = await maybeWarnHigherRegistryVersion({
    packageName: 'foo',
    selectedVersion: '1.0.0'
  });

  assert.ok(warning && warning.includes('foo@2.0.0'), 'should warn about higher local registry version');
}

async function run(): Promise<void> {
  stubHomedir();
  mkdirSync(workspaceDir, { recursive: true });

  try {
    await testWorkspaceShadowsRegistry();
    await testRemotePrimaryIgnoresLocals();
    await testHigherVersionWarning();
    console.log('local-source-resolution tests passed');
  } finally {
    restoreHomedir();
    rmSync(tmpBase, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
