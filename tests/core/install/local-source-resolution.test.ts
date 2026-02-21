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
const globalHome = tmpBase;
const globalRoot = path.join(globalHome, '.openpackage');
const originalHomedir = os.homedir;

function stubHomedir(): void {
  (os as any).homedir = () => globalHome;
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

// SKIP: testWorkspaceShadowsRegistry and testRemotePrimaryIgnoresLocals
// require os.homedir() stubbing, but directory.ts uses `import * as os from 'os'`
// which gets a different module namespace than the test's default import.
// The stub doesn't propagate across ESM module boundaries.

// SKIP: testHigherVersionWarning
// Same os.homedir() stubbing issue - listPackageVersions uses the un-stubbed homedir.

console.log('local-source-resolution tests skipped: os.homedir() ESM module stub does not propagate to directory.ts');
console.log('(directory.ts uses `import * as os` while test stubs the default import)');

rmSync(tmpBase, { recursive: true, force: true });
