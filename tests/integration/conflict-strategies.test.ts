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
  console.log('⏭️  Skipping conflict-strategies e2e test (no network)');
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

async function listAllFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { recursive: true });
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

async function readInstalledFile(dir: string, ...segments: string[]): Promise<string | null> {
  try {
    return await fs.readFile(path.join(dir, ...segments), 'utf8');
  } catch {
    return null;
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

// ── Conflict fixture ──────────────────────────────────────────────────
//
// package-a has rules/formatting.md: "Always use consistent formatting."
// package-b has rules/formatting.md: "Use tabs for indentation."
//
// When package-a is installed, package-b is a transitive dep.
// Both formatting.md files target the same platform path, creating a conflict.
//

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 1: --conflicts namespace — both files installed with prefix
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 1: Conflict namespace...');

await withWorkspace('conflict-namespace', async (dir) => {
  const result = runCli(
    ['install', './test-packages/package-a', '--force', '--conflicts', 'namespace'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Namespace conflict install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // Both formatting files should exist (with namespace prefixes)
  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  const formattingFiles = allFiles.filter(f => f.includes('formatting'));
  assert.ok(
    formattingFiles.length >= 2,
    `Both formatting rules should be installed with namespace prefixes (got ${formattingFiles.length}: ${formattingFiles.join(', ')})`
  );

  // At least one should have a namespace prefix (slug from package name)
  assert.ok(
    formattingFiles.some(f => f.includes('test-nested-a') || f.includes('test-nested-b')),
    `At least one formatting file should have a namespace prefix (got: ${formattingFiles.join(', ')})`
  );

  // Verify both packages' content exists somewhere
  const allContent: string[] = [];
  for (const f of formattingFiles) {
    // Try both platform dirs
    const cursorContent = await readInstalledFile(path.join(dir, '.cursor'), f);
    const claudeContent = await readInstalledFile(path.join(dir, '.claude'), f);
    if (cursorContent) allContent.push(cursorContent);
    if (claudeContent) allContent.push(claudeContent);
  }

  assert.ok(
    allContent.some(c => c.includes('consistent formatting')),
    'Package-a formatting content should be present'
  );
  assert.ok(
    allContent.some(c => c.includes('tabs for indentation')),
    'Package-b formatting content should be present'
  );
});

console.log('  Sub-test 1: Conflict namespace ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 2: --conflicts skip — same namespace behavior in CI mode
// ══════════════════════════════════════════════════════════════════════
// Note: In non-interactive (CI) mode, owned-by-other conflicts always
// trigger namespace behavior regardless of the --conflicts flag.
// skip/overwrite only differ from namespace in interactive prompt behavior.
console.log('  Sub-test 2: Conflict skip...');

await withWorkspace('conflict-skip', async (dir) => {
  const result = runCli(
    ['install', './test-packages/package-a', '--force', '--conflicts', 'skip'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Skip conflict install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // Owned-by-other conflicts still namespace in CI mode
  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  const formattingFiles = allFiles.filter(f => f.includes('formatting'));
  assert.ok(
    formattingFiles.length >= 2,
    `Both formatting rules should be installed (got ${formattingFiles.length}: ${formattingFiles.join(', ')})`
  );
  assert.ok(
    formattingFiles.some(f => f.includes('test-nested-a') || f.includes('test-nested-b')),
    `Conflict should trigger namespace even with skip strategy in CI mode (got: ${formattingFiles.join(', ')})`
  );
});

console.log('  Sub-test 2: Conflict skip ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 3: --conflicts overwrite — same namespace behavior in CI mode
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 3: Conflict overwrite...');

await withWorkspace('conflict-overwrite', async (dir) => {
  const result = runCli(
    ['install', './test-packages/package-a', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Overwrite conflict install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // Owned-by-other conflicts still namespace in CI mode
  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  const formattingFiles = allFiles.filter(f => f.includes('formatting'));
  assert.ok(
    formattingFiles.length >= 2,
    `Both formatting rules should be installed (got ${formattingFiles.length}: ${formattingFiles.join(', ')})`
  );
  assert.ok(
    formattingFiles.some(f => f.includes('test-nested-a') || f.includes('test-nested-b')),
    `Conflict should trigger namespace even with overwrite strategy in CI mode (got: ${formattingFiles.join(', ')})`
  );
});

console.log('  Sub-test 3: Conflict overwrite ✓');

console.log('✅ All conflict-strategies tests passed');
