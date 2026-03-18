import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.resolve(repoRoot, 'bin/openpackage');
const fixturesDir = path.resolve(__dirname, '../fixtures/nested-deps');

// ── Network gate ──────────────────────────────────────────────────────
try {
  await dns.resolve('github.com');
} catch {
  console.log('⏭️  Skipping install-flags e2e test (no network)');
  process.exit(0);
}

// ── Helpers ───────────────────────────────────────────────────────────
function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string | undefined>
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      ...(env ?? {}),
      TS_NODE_TRANSPILE_ONLY: '1'
    },
    timeout: 180_000
  });
  return {
    code: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim()
  };
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function pathExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}

async function listAllFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { recursive: true });
    // Filter to files only (exclude directory entries)
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, String(entry));
      const stat = await fs.stat(full).catch(() => null);
      if (stat?.isFile()) files.push(String(entry));
    }
    return files;
  } catch {
    return [];
  }
}

/** Set up a workspace with fixtures and platform dirs, run a test, then clean up. */
async function withWorkspace(
  name: string,
  fn: (dir: string) => Promise<void>
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `opkg-${name}-`));
  try {
    await copyDir(fixturesDir, path.join(dir, 'test-packages'));
    await fs.mkdir(path.join(dir, '.cursor'), { recursive: true });
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 1: Dry run — nothing written to disk
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 1: Dry run...');

await withWorkspace('dry-run', async (dir) => {
  const result = runCli(
    ['install', './test-packages/package-a', '--dry-run', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Dry run should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // No resource files should be written to platform directories
  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));

  assert.strictEqual(
    cursorFiles.length,
    0,
    `Dry run should not write files to .cursor/ (found: ${cursorFiles.join(', ')})`
  );
  assert.strictEqual(
    claudeFiles.length,
    0,
    `Dry run should not write files to .claude/ (found: ${claudeFiles.join(', ')})`
  );

  // Core dry-run guarantee: no resource files installed to platform dirs.
  // Metadata files (manifest, index) may still be created as an implementation detail.
});

console.log('  Sub-test 1: Dry run ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 2: Platform filter — only target platform receives files
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 2: Platform filter...');

await withWorkspace('platform-filter', async (dir) => {
  const result = runCli(
    ['install', './test-packages/package-a', '--force', '--conflicts', 'overwrite', '--platforms', 'cursor'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Platform-filtered install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // .cursor/ should have resource files
  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  assert.ok(
    cursorFiles.length > 0,
    'Cursor platform directory should have installed files'
  );

  // .claude/ should remain empty — platform filter excluded it
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  assert.strictEqual(
    claudeFiles.length,
    0,
    `.claude/ should be empty when --platforms cursor is used (found: ${claudeFiles.join(', ')})`
  );

  // Verify some expected resources landed in .cursor/
  assert.ok(
    cursorFiles.some(f => f.includes('reviewer')),
    'Reviewer agent should be installed in .cursor/'
  );
  assert.ok(
    cursorFiles.some(f => f.includes('formatting')),
    'Formatting rule should be installed in .cursor/'
  );
});

console.log('  Sub-test 2: Platform filter ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 3: Selective install — only named resources selected
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 3: Selective install...');

await withWorkspace('selective', async (dir) => {
  const result = runCli(
    ['install', './test-packages/package-a', '--agents', 'reviewer', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Selective install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  // Selected agent SHOULD be installed
  assert.ok(
    allFiles.some(f => f.includes('reviewer')),
    'Selected agent (reviewer) should be installed'
  );

  // Non-selected resources should NOT be installed
  assert.ok(
    !allFiles.some(f => f.includes('formatting')),
    'Non-selected resource (formatting rule) should not be installed'
  );
  assert.ok(
    !allFiles.some(f => f.includes('greet')),
    'Transitive dep resources should not be installed in selective mode'
  );
  assert.ok(
    !allFiles.some(f => f.includes('util')),
    'Transitive dep resources should not be installed in selective mode'
  );
});

console.log('  Sub-test 3a: Selective --agents ✓');

// ── SUB-TEST 3b: Selective --rules ──────────────────────────────────
console.log('  Sub-test 3b: Selective --rules...');

await withWorkspace('selective-rules', async (dir) => {
  const result = runCli(
    ['install', './test-packages/package-a', '--rules', 'formatting', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Selective --rules should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  assert.ok(
    allFiles.some(f => f.includes('formatting')),
    'Selected rule (formatting) should be installed'
  );
  assert.ok(
    !allFiles.some(f => f.includes('reviewer')),
    'Non-selected agent should not be installed with --rules filter'
  );
});

console.log('  Sub-test 3b: Selective --rules ✓');

// ── SUB-TEST 3c: Selective --commands ───────────────────────────────
console.log('  Sub-test 3c: Selective --commands...');

await withWorkspace('selective-commands', async (dir) => {
  const result = runCli(
    ['install', './test-packages/package-c', '--commands', 'greet', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Selective --commands should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  assert.ok(
    allFiles.some(f => f.includes('greet')),
    'Selected command (greet) should be installed'
  );
});

console.log('  Sub-test 3c: Selective --commands ✓');

// ── SUB-TEST 3d: Selective --skills ──────────────────────────────────
console.log('  Sub-test 3d: Selective --skills...');

await withWorkspace('selective-skills', async (dir) => {
  const result = runCli(
    ['install', './test-packages/package-c', '--skills', 'greeter-skill', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Selective --skills should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  assert.ok(
    allFiles.some(f => f.includes('greeter-skill') || f.includes('SKILL')),
    `Selected skill (greeter-skill) should be installed (got: ${allFiles.join(', ')})`
  );
  assert.ok(
    !allFiles.some(f => f.includes('greet') && !f.includes('greeter-skill')),
    'Non-selected command (greet) should not be installed with --skills filter'
  );
});

console.log('  Sub-test 3d: Selective --skills ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 4: Global install — resources go to HOME, not workspace
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 4: Global install...');

await withWorkspace('global', async (dir) => {
  // Create a fake HOME with platform dirs
  const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-fake-home-'));
  await fs.mkdir(path.join(fakeHome, '.cursor'), { recursive: true });
  await fs.mkdir(path.join(fakeHome, '.claude'), { recursive: true });

  try {
    const result = runCli(
      ['install', './test-packages/package-a', '--global', '--force', '--conflicts', 'overwrite'],
      dir,
      { CI: 'true', HOME: fakeHome }
    );

    assert.strictEqual(
      result.code,
      0,
      `Global install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
    );

    // Resources should be in fake HOME's platform dirs
    const homeCursorFiles = await listAllFiles(path.join(fakeHome, '.cursor'));
    const homeClaudeFiles = await listAllFiles(path.join(fakeHome, '.claude'));
    const homeFiles = [...homeCursorFiles, ...homeClaudeFiles];

    assert.ok(
      homeFiles.length > 0,
      'Global install should write resources to HOME platform directories'
    );
    assert.ok(
      homeFiles.some(f => f.includes('reviewer')),
      'Reviewer agent should be installed in HOME'
    );

    // Workspace platform dirs should remain empty (resources went to HOME)
    const workspaceCursorFiles = await listAllFiles(path.join(dir, '.cursor'));
    const workspaceClaudeFiles = await listAllFiles(path.join(dir, '.claude'));

    assert.strictEqual(
      workspaceCursorFiles.length + workspaceClaudeFiles.length,
      0,
      'Workspace platform dirs should remain empty when --global is used'
    );
  } finally {
    await fs.rm(fakeHome, { recursive: true, force: true });
  }
});

console.log('  Sub-test 4: Global install ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 5: Bulk install — reads manifest, installs all declared deps
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 5: Bulk install...');

await withWorkspace('bulk', async (dir) => {
  // Pre-populate workspace manifest with package-a as a dependency
  await fs.mkdir(path.join(dir, '.openpackage'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.openpackage', 'openpackage.yml'),
    [
      'name: test-bulk-workspace',
      'dependencies:',
      '  - name: test-nested-a',
      '    path: ./test-packages/package-a',
      'dev-dependencies: []',
      ''
    ].join('\n'),
    'utf8'
  );

  // Run install with no package argument (bulk mode)
  const result = runCli(
    ['install', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Bulk install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // Resources should be installed
  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  assert.ok(
    allFiles.length > 0,
    'Bulk install should install resources from declared dependencies'
  );

  // Package-a's own resources should be present
  assert.ok(
    allFiles.some(f => f.includes('reviewer')),
    'Reviewer agent from package-a should be installed via bulk install'
  );

  // Transitive deps should also be resolved
  const indexPath = path.join(dir, '.openpackage', 'openpackage.index.yml');
  assert.ok(await pathExists(indexPath), 'Workspace index should be created after bulk install');

  const index = await fs.readFile(indexPath, 'utf8');
  assert.ok(
    index.includes('test-nested-b'),
    'Transitive dep package-b should be resolved via bulk install'
  );
  assert.ok(
    index.includes('test-nested-d'),
    'Diamond dep package-d should be resolved via bulk install'
  );
});

console.log('  Sub-test 5: Bulk install ✓');

console.log('✅ All install-flags tests passed');
