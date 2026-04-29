/**
 * Codex agents integration test (GH #53).
 *
 * Validates universal `agents/*.md` ↔ `.codex/agents/*.toml` round-trips
 * for project scope, global scope, and frontmatter-less inputs.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import * as TOML from 'smol-toml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');
const cliPath = path.resolve(repoRoot, 'bin/openpackage');

function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string | undefined>,
): { code: number; stdout: string; stderr: string } {
  const result = spawnSync('node', [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      TS_NODE_TRANSPILE_ONLY: '1',
    },
  });
  return {
    code: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

describe('codex agents integration', () => {
  it('installs universal agents/*.md to .codex/agents/*.toml (project scope)', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-agents-ws-'));
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-agents-src-'));
    const pkgDir = path.join(sourceRoot, 'reviewer-pkg');

    try {
      await writeFile(
        path.join(pkgDir, 'agents', 'code-reviewer.md'),
        '---\ndescription: Reviews code for bugs and style\nmodel: opus\n---\n\n' +
          'You are a thorough code reviewer. Look for bugs and unclear naming.'
      );

      const result = runCli(
        ['install', pkgDir, '--platforms', 'codex', '--force', '--conflicts', 'overwrite'],
        workspace,
        { CI: 'true' }
      );

      assert.equal(
        result.code,
        0,
        `Install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );

      const tomlPath = path.join(workspace, '.codex', 'agents', 'code-reviewer.toml');
      const tomlContent = await fs.readFile(tomlPath, 'utf8');
      const parsed = TOML.parse(tomlContent) as Record<string, unknown>;

      assert.equal(parsed.name, 'code-reviewer', 'name should be derived from filename');
      assert.equal(parsed.description, 'Reviews code for bugs and style');
      assert.equal(parsed.model, 'opus');
      assert.match(
        parsed.developer_instructions as string,
        /thorough code reviewer/,
        'developer_instructions should be the markdown body'
      );

      // Misplaced flow is gone: nothing should land at .agents/skills/<leaf>/agents/
      await assert.rejects(
        fs.access(path.join(workspace, '.agents', 'skills', 'reviewer-pkg', 'agents', 'code-reviewer.md'))
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it('installs universal agents/*.md to ~/.codex/agents/*.toml (global scope)', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-agents-gws-'));
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-agents-gsrc-'));
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-agents-home-'));
    const pkgDir = path.join(sourceRoot, 'global-agent-pkg');

    try {
      await writeFile(
        path.join(pkgDir, 'agents', 'planner.md'),
        '---\ndescription: Plans multi-step tasks\n---\n\nYou are a careful planner.'
      );

      const result = runCli(
        ['install', pkgDir, '--platforms', 'codex', '--global', '--force', '--conflicts', 'overwrite'],
        workspace,
        { CI: 'true', HOME: fakeHome }
      );

      assert.equal(
        result.code,
        0,
        `Global install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );

      const tomlPath = path.join(fakeHome, '.codex', 'agents', 'planner.toml');
      const tomlContent = await fs.readFile(tomlPath, 'utf8');
      const parsed = TOML.parse(tomlContent) as Record<string, unknown>;

      assert.equal(parsed.name, 'planner');
      assert.equal(parsed.description, 'Plans multi-step tasks');
      assert.match(parsed.developer_instructions as string, /careful planner/);

      // Project location should be empty for global install
      await assert.rejects(
        fs.access(path.join(workspace, '.codex', 'agents', 'planner.toml'))
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(sourceRoot, { recursive: true, force: true });
      await fs.rm(fakeHome, { recursive: true, force: true });
    }
  });

  it('derives name from filename when frontmatter omits it', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-agents-pl-ws-'));
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-agents-pl-src-'));
    const pkgDir = path.join(sourceRoot, 'plain-pkg');

    try {
      // No frontmatter — body only
      await writeFile(
        path.join(pkgDir, 'agents', 'plain-agent.md'),
        'Just instructions, no frontmatter.'
      );

      const result = runCli(
        ['install', pkgDir, '--platforms', 'codex', '--force', '--conflicts', 'overwrite'],
        workspace,
        { CI: 'true' }
      );

      assert.equal(result.code, 0, `Install should succeed.\nstderr: ${result.stderr}`);

      const tomlPath = path.join(workspace, '.codex', 'agents', 'plain-agent.toml');
      const tomlContent = await fs.readFile(tomlPath, 'utf8');
      const parsed = TOML.parse(tomlContent) as Record<string, unknown>;

      assert.equal(parsed.name, 'plain-agent', 'name should fall back to filename without extension');
      assert.equal(parsed.developer_instructions, 'Just instructions, no frontmatter.');
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it('round-trips .codex/agents/*.toml back to universal agents/*.md via opkg add', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-agents-rev-'));

    try {
      // Set up a minimal package in the workspace
      await writeFile(
        path.join(workspace, '.openpackage', 'openpackage.yml'),
        'name: test-pkg\nversion: 0.1.0\n'
      );

      // Pre-existing codex agent in the workspace
      const tomlSource =
        'name = "round-tripper"\n' +
        'description = "Tests forward and reverse mappings"\n' +
        'model = "opus"\n' +
        'developer_instructions = "You round-trip cleanly."\n';
      await writeFile(path.join(workspace, '.codex', 'agents', 'round-tripper.toml'), tomlSource);

      const result = runCli(
        ['add', path.join(workspace, '.codex', 'agents', 'round-tripper.toml')],
        workspace,
        { CI: 'true' }
      );

      assert.equal(
        result.code,
        0,
        `opkg add should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );

      const mdPath = path.join(workspace, '.openpackage', 'agents', 'round-tripper.md');
      const md = await fs.readFile(mdPath, 'utf8');

      assert.match(md, /^---/, 'output should begin with frontmatter delimiter');
      assert.match(md, /name: round-tripper/);
      assert.match(md, /description: Tests forward and reverse mappings/);
      assert.match(md, /model: opus/);
      assert.match(md, /You round-trip cleanly\./);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
