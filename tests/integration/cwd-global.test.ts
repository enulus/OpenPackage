import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliPath = path.resolve(__dirname, '../bin/openpackage');

// Helper to run CLI with args, capture output/exit
function runCli(
  args: string[],
  cwd?: string,
  envOverrides?: Record<string, string | undefined>
): { stdout: string; stderr: string; code: number } {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      ...(envOverrides ?? {}),
      TS_NODE_TRANSPILE_ONLY: '1'
    } // Mimic test env if needed
  });
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    code: result.status ?? 1
  };
}

// Test 1: --help shows --cwd option
{
  const result = runCli(['--help']);
  assert.ok(result.stdout.includes('--cwd <dir>'), 'Global --cwd should appear in --help');
  assert.strictEqual(result.code, 0);
}

// Test 2: Invalid --cwd errors with validation message (no chdir)
{
  const result = runCli(['status', '--cwd', '/nonexistent']);
  assert.ok(result.stderr.includes('Invalid --cwd'), 'Should error on invalid dir');
  assert.ok(result.stderr.includes('must exist'), 'Should mention existence check');
  assert.strictEqual(result.code, 1);
}

// Test 3: Valid --cwd chdirs and runs command (use status on empty dir - expects error on no pkg, but chdir succeeds)
{
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-cwd-test-'));
  try {
    const result = runCli(['status', '--cwd', tempDir]);
    // Status should fail (no package), but stderr should *not* have cwd error (valid dir)
    assert.ok(!result.stderr.includes('Invalid --cwd'), 'Valid dir should not error on validation');
    assert.ok(result.stderr.includes('No .openpackage'), 'Should detect no pkg at target cwd'); // Expected status error
    assert.strictEqual(result.code, 1); // Fails as expected, but chdir worked
  } finally {
    await fs.rm(tempDir, { recursive: true });
  }
}

// Test 4: Global commands handle --cwd (e.g., login --help - just verify no crash)
{
  const result = runCli(['login', '--help', '--cwd', '/tmp']); // /tmp exists
  assert.ok(!result.stderr.includes('Invalid --cwd'), 'Valid dir on global cmd ok');
  assert.ok(result.stdout.includes('--profile'), 'Help still shows'); // Verify ran
  assert.strictEqual(result.code, 0);
}

// Test 5: Relative --cwd resolves correctly (from test cwd)
{
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-cwd-rel-'));
  try {
    const result = runCli(['status', '--cwd', path.relative(process.cwd(), tempDir)], process.cwd());
    assert.ok(!result.stderr.includes('Invalid --cwd'), 'Relative valid dir ok');
    assert.strictEqual(result.code, 1); // Status fails, but chdir ok
  } finally {
    await fs.rm(tempDir, { recursive: true });
  }
}

console.log('All --cwd tests passed!');

// Test 6: install should not scaffold empty platform subdirectories when package has no platform files
{
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-home-'));
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-workspace-'));

  try {
    // Create detected platform roots but no subdirs
    await fs.mkdir(path.join(workspaceDir, '.claude'), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, '.opencode'), { recursive: true });

    // Seed a minimal registry package directly under HOME to avoid prompts/pack flow
    const pkgName = 'empty-package';
    const version = '1.0.0';
    const pkgRoot = path.join(
      tempHome,
      '.openpackage',
      'registry',
      pkgName,
      version
    );
    await fs.mkdir(path.join(pkgRoot, '.openpackage'), { recursive: true });

    await fs.writeFile(
      path.join(pkgRoot, 'openpackage.yml'),
      [
        `name: ${pkgName}`,
        `version: ${version}`,
        `packages: []`,
        `dev-packages: []`,
        ``
      ].join('\n'),
      'utf8'
    );

    await fs.writeFile(path.join(pkgRoot, 'some-file.md'), '# hello\n', 'utf8');

    const result = runCli(
      ['install', '--local', `${pkgName}@${version}`],
      workspaceDir,
      { HOME: tempHome }
    );
    assert.strictEqual(result.code, 0, `install should succeed\nstderr: ${result.stderr}`);

    // Ensure platform subdirs were NOT created (only roots existed)
    const shouldNotExist = [
      path.join(workspaceDir, '.claude', 'agents'),
      path.join(workspaceDir, '.claude', 'commands'),
      path.join(workspaceDir, '.claude', 'rules'),
      path.join(workspaceDir, '.claude', 'skills'),
      path.join(workspaceDir, '.opencode', 'agent'),
      path.join(workspaceDir, '.opencode', 'command'),
    ];

    for (const p of shouldNotExist) {
      let existsFlag = true;
      try {
        await fs.stat(p);
      } catch {
        existsFlag = false;
      }
      assert.equal(existsFlag, false, `should not create empty directory: ${p}`);
    }
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

// Test 7: apply should not scaffold empty platform subdirectories when package has no platform files
{
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-home-'));
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-workspace-'));

  try {
    // Create detected platform roots but no subdirs
    await fs.mkdir(path.join(workspaceDir, '.claude'), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, '.opencode'), { recursive: true });

    const pkgName = 'empty-package';
    const version = '1.0.0';

    // Seed a minimal registry package under HOME (source of truth)
    const pkgRoot = path.join(
      tempHome,
      '.openpackage',
      'registry',
      pkgName,
      version
    );
    await fs.mkdir(path.join(pkgRoot, '.openpackage'), { recursive: true });
    await fs.writeFile(
      path.join(pkgRoot, 'openpackage.yml'),
      [
        `name: ${pkgName}`,
        `version: ${version}`,
        `packages: []`,
        `dev-packages: []`,
        ``
      ].join('\n'),
      'utf8'
    );

    // Include a non-platform file; apply should ignore it and still not scaffold platform dirs
    await fs.writeFile(path.join(pkgRoot, 'some-file.md'), '# hello\n', 'utf8');

    // Create unified workspace index entry (strict index-driven apply)
    const wsIndexPath = path.join(workspaceDir, '.openpackage', 'openpackage.index.yml');
    await fs.mkdir(path.dirname(wsIndexPath), { recursive: true });
    await fs.writeFile(
      wsIndexPath,
      [
        '# This file is managed by OpenPackage. Do not edit manually.',
        '',
        'packages:',
        `  ${pkgName}:`,
        `    path: ${pkgRoot}/`,
        `    version: ${version}`,
        '    files: {}',
        ''
      ].join('\n'),
      'utf8'
    );

    const result = runCli(['apply', pkgName], workspaceDir, { HOME: tempHome });
    assert.strictEqual(result.code, 0, `apply should succeed\nstderr: ${result.stderr}`);

    const shouldNotExist = [
      path.join(workspaceDir, '.claude', 'agents'),
      path.join(workspaceDir, '.claude', 'commands'),
      path.join(workspaceDir, '.claude', 'rules'),
      path.join(workspaceDir, '.claude', 'skills'),
      path.join(workspaceDir, '.opencode', 'agent'),
      path.join(workspaceDir, '.opencode', 'command'),
    ];

    for (const p of shouldNotExist) {
      let existsFlag = true;
      try {
        await fs.stat(p);
      } catch {
        existsFlag = false;
      }
      assert.equal(existsFlag, false, `should not create empty directory: ${p}`);
    }
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}