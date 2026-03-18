import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.resolve(repoRoot, 'bin/openpackage');
const nestedFixtures = path.resolve(__dirname, '../fixtures/nested-deps');
const claudeFixture = path.resolve(__dirname, '../fixtures/claude-format-pkg');

// No network gate — all sub-tests use local-only fixtures.

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
    timeout: 30_000
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

async function withWorkspace(
  name: string,
  fn: (dir: string) => Promise<void>
): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `opkg-${name}-`));
  try {
    await fs.mkdir(path.join(dir, '.cursor'), { recursive: true });
    await fs.mkdir(path.join(dir, '.claude'), { recursive: true });
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
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

async function writeManifest(dir: string, content: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'openpackage.yml'), content, 'utf8');
}

async function writeResource(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 1: --namespace force mode (proactive namespacing)
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 1: --namespace force mode...');

await withWorkspace('namespace-force', async (dir) => {
  // Create a simple package with a rule
  const pkgDir = path.join(dir, 'packages', 'my-pkg');
  await writeManifest(pkgDir, [
    'name: my-pkg',
    'version: 1.0.0',
    'dependencies: []',
    'dev-dependencies: []',
  ].join('\n'));
  await writeResource(
    path.join(pkgDir, 'rules', 'coding.md'),
    '---\nname: coding\n---\nCoding standards.\n'
  );
  await writeResource(
    path.join(pkgDir, 'agents', 'helper.md'),
    '---\nname: helper\ndescription: Helper agent\n---\nA helper agent.\n'
  );

  // Install with --namespace (boolean true) — should namespace ALL files
  const result = runCli(
    ['install', './packages/my-pkg', '--namespace', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `--namespace force install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  // ALL files should be namespaced with the auto-derived slug (my-pkg)
  assert.ok(
    allFiles.length > 0,
    'Files should be installed'
  );

  // Every installed file should have the namespace prefix
  const nonNamespacedFiles = allFiles.filter(f =>
    (f.includes('coding') || f.includes('helper')) && !f.includes('my-pkg')
  );
  assert.strictEqual(
    nonNamespacedFiles.length,
    0,
    `All files should be namespaced with --namespace flag (non-namespaced: ${nonNamespacedFiles.join(', ')}; all: ${allFiles.join(', ')})`
  );

  // Verify namespace prefix format (slug-leaf)
  assert.ok(
    allFiles.some(f => f.includes('my-pkg-coding')),
    `Rule should be namespaced as my-pkg-coding (got: ${allFiles.join(', ')})`
  );
  assert.ok(
    allFiles.some(f => f.includes('my-pkg-helper')),
    `Agent should be namespaced as my-pkg-helper (got: ${allFiles.join(', ')})`
  );
});

console.log('  Sub-test 1: --namespace force mode ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 2: --namespace <custom-slug> (custom prefix)
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 2: --namespace custom slug...');

await withWorkspace('namespace-custom', async (dir) => {
  const pkgDir = path.join(dir, 'packages', 'my-pkg');
  await writeManifest(pkgDir, [
    'name: my-pkg',
    'version: 1.0.0',
    'dependencies: []',
    'dev-dependencies: []',
  ].join('\n'));
  await writeResource(
    path.join(pkgDir, 'rules', 'coding.md'),
    '---\nname: coding\n---\nCoding standards.\n'
  );

  // Install with --namespace custom-prefix
  const result = runCli(
    ['install', './packages/my-pkg', '--namespace', 'acme', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `--namespace custom install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  // Files should use the custom slug "acme" instead of auto-derived slug
  assert.ok(
    allFiles.some(f => f.includes('acme-coding')),
    `Rule should be namespaced with custom slug 'acme' (got: ${allFiles.join(', ')})`
  );

  // Verify it does NOT use the package name as slug
  const usedPackageName = allFiles.filter(f => f.includes('my-pkg-coding'));
  assert.strictEqual(
    usedPackageName.length,
    0,
    `Custom slug should override auto-derived slug (found my-pkg prefix: ${usedPackageName.join(', ')})`
  );
});

console.log('  Sub-test 2: --namespace custom slug ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 3: exists-unowned conflict — --conflicts namespace
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 3: exists-unowned + namespace...');

await withWorkspace('unowned-namespace', async (dir) => {
  // PRE-CREATE a file that will conflict (unowned — not in any package index).
  // Use .claude/ because Claude keeps .md extension for rules (Cursor converts to .mdc).
  await fs.mkdir(path.join(dir, '.claude', 'rules'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.claude', 'rules', 'coding.md'),
    'User-written coding standards that differ from package.\n',
    'utf8'
  );

  // Create package with same-named resource
  const pkgDir = path.join(dir, 'packages', 'my-pkg');
  await writeManifest(pkgDir, [
    'name: my-pkg',
    'version: 1.0.0',
    'dependencies: []',
    'dev-dependencies: []',
  ].join('\n'));
  await writeResource(
    path.join(pkgDir, 'rules', 'coding.md'),
    '---\nname: coding\n---\nPackage coding standards.\n'
  );

  // Note: do NOT use --force here — it overrides conflict strategy for exists-unowned
  const result = runCli(
    ['install', './packages/my-pkg', '--conflicts', 'namespace'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `exists-unowned + namespace should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // The original unowned file should still exist at its original path
  const originalContent = await readInstalledFile(dir, '.claude', 'rules', 'coding.md');
  assert.ok(
    originalContent !== null,
    'Original unowned file should still exist at original path'
  );
  assert.ok(
    originalContent!.includes('User-written'),
    'Original unowned file content should be preserved'
  );

  // The package's file should be namespaced (prefix added)
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const namespacedFiles = claudeFiles.filter(f =>
    f.includes('coding') && f.includes('my-pkg')
  );
  assert.ok(
    namespacedFiles.length > 0,
    `Package file should be namespaced due to exists-unowned conflict (claude files: ${claudeFiles.join(', ')})`
  );
});

console.log('  Sub-test 3: exists-unowned + namespace ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 4: exists-unowned conflict — --conflicts overwrite
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 4: exists-unowned + overwrite...');

await withWorkspace('unowned-overwrite', async (dir) => {
  // PRE-CREATE an unowned file in .claude/ (keeps .md extension for rules)
  await fs.mkdir(path.join(dir, '.claude', 'rules'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.claude', 'rules', 'coding.md'),
    'User-written coding standards.\n',
    'utf8'
  );

  const pkgDir = path.join(dir, 'packages', 'my-pkg');
  await writeManifest(pkgDir, [
    'name: my-pkg',
    'version: 1.0.0',
    'dependencies: []',
    'dev-dependencies: []',
  ].join('\n'));
  await writeResource(
    path.join(pkgDir, 'rules', 'coding.md'),
    '---\nname: coding\n---\nPackage coding standards.\n'
  );

  const result = runCli(
    ['install', './packages/my-pkg', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `exists-unowned + overwrite should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // The file should be overwritten with package content
  const content = await readInstalledFile(dir, '.claude', 'rules', 'coding.md');
  assert.ok(
    content !== null,
    'File should exist after overwrite install'
  );
  assert.ok(
    content!.includes('Package coding standards'),
    `File should contain package content after overwrite (got: ${content?.slice(0, 100)})`
  );
});

console.log('  Sub-test 4: exists-unowned + overwrite ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 5: exists-unowned conflict — --conflicts skip
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 5: exists-unowned + skip...');

await withWorkspace('unowned-skip', async (dir) => {
  // PRE-CREATE an unowned file in .claude/ (keeps .md extension for rules)
  await fs.mkdir(path.join(dir, '.claude', 'rules'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.claude', 'rules', 'coding.md'),
    'User-written coding standards.\n',
    'utf8'
  );

  const pkgDir = path.join(dir, 'packages', 'my-pkg');
  await writeManifest(pkgDir, [
    'name: my-pkg',
    'version: 1.0.0',
    'dependencies: []',
    'dev-dependencies: []',
  ].join('\n'));
  await writeResource(
    path.join(pkgDir, 'rules', 'coding.md'),
    '---\nname: coding\n---\nPackage coding standards.\n'
  );

  const result = runCli(
    ['install', './packages/my-pkg', '--conflicts', 'skip'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `exists-unowned + skip should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // The original file should be preserved (not overwritten)
  const content = await readInstalledFile(dir, '.claude', 'rules', 'coding.md');
  assert.ok(
    content !== null,
    'Original file should still exist after skip install'
  );
  assert.ok(
    content!.includes('User-written'),
    `Original content should be preserved with skip strategy (got: ${content?.slice(0, 100)})`
  );
});

console.log('  Sub-test 5: exists-unowned + skip ✓');

// ══════════════════════════════════════════════════════════════════════
// SUB-TEST 6: Claude-format package conversion
// ══════════════════════════════════════════════════════════════════════
console.log('  Sub-test 6: Claude-format conversion...');

await withWorkspace('claude-format', async (dir) => {
  // Copy the Claude-format fixture package
  await copyDir(claudeFixture, path.join(dir, 'claude-pkg'));

  const result = runCli(
    ['install', './claude-pkg', '--force', '--conflicts', 'overwrite'],
    dir,
    { CI: 'true' }
  );

  assert.strictEqual(
    result.code,
    0,
    `Claude-format install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  );

  // Resources should be installed to platform directories
  const cursorFiles = await listAllFiles(path.join(dir, '.cursor'));
  const claudeFiles = await listAllFiles(path.join(dir, '.claude'));
  const allFiles = [...cursorFiles, ...claudeFiles];

  assert.ok(
    allFiles.length > 0,
    `Resources should be installed from Claude-format package (got 0 files)`
  );

  // The agent should be installed (converted from .claude/agents/ to platform dirs)
  assert.ok(
    allFiles.some(f => f.includes('analyzer')),
    `Analyzer agent should be installed (got: ${allFiles.join(', ')})`
  );

  // The rule should be installed
  assert.ok(
    allFiles.some(f => f.includes('quality')),
    `Quality rule should be installed (got: ${allFiles.join(', ')})`
  );

  // The command should be installed
  assert.ok(
    allFiles.some(f => f.includes('check')),
    `Check command should be installed (got: ${allFiles.join(', ')})`
  );

  // Verify the installed agent file contains content (was actually written)
  const agentContent = await readInstalledFile(dir, '.claude', 'agents', 'analyzer.md')
    ?? await readInstalledFile(dir, '.cursor', 'agents', 'analyzer.md');
  assert.ok(
    agentContent !== null,
    'Analyzer agent file should exist in a platform directory'
  );
  assert.ok(
    agentContent!.includes('Analyzes code') || agentContent!.includes('analyzer'),
    `Agent content should be present (got: ${agentContent?.slice(0, 200)})`
  );
});

console.log('  Sub-test 6: Claude-format conversion ✓');

console.log('✅ All advanced-install tests passed');
