import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

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

describe('codex skill bundle integration', () => {
  it('installs a root skill package into the official Codex .agents/skills layout', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-workspace-'));
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-source-'));
    const skillDir = path.join(sourceRoot, 'decomplect');

    try {
      await fs.mkdir(path.join(workspace, '.agents'), { recursive: true });

      await writeFile(
        path.join(skillDir, 'SKILL.md'),
        '# Decomplect\n'
      );
      await writeFile(
        path.join(skillDir, 'commands', 'decomplect.md'),
        '# Decomplect Command\n'
      );
      await writeFile(
        path.join(skillDir, 'agents', 'coupling-analyzer.md'),
        '# Coupling Analyzer\n'
      );
      await writeFile(
        path.join(skillDir, 'reference', 'coupling.md'),
        '# Coupling Reference\n'
      );
      await writeFile(
        path.join(skillDir, 'README.md'),
        '# Decomplect Readme\n'
      );
      await writeFile(
        path.join(skillDir, 'EXAMPLES.md'),
        '# Decomplect Examples\n'
      );

      const result = runCli(
        ['install', skillDir, '--platforms', 'codex', '--force', '--conflicts', 'overwrite'],
        workspace,
        { CI: 'true' }
      );

      assert.equal(
        result.code,
        0,
        `Codex skill install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );

      await fs.access(path.join(workspace, '.agents', 'skills', 'decomplect', 'SKILL.md'));
      await fs.access(path.join(workspace, '.agents', 'skills', 'decomplect', 'commands', 'decomplect.md'));
      await fs.access(path.join(workspace, '.agents', 'skills', 'decomplect', 'agents', 'coupling-analyzer.md'));
      await fs.access(path.join(workspace, '.agents', 'skills', 'decomplect', 'references', 'coupling.md'));
      await fs.access(path.join(workspace, '.agents', 'skills', 'decomplect', 'references', 'README.md'));
      await fs.access(path.join(workspace, '.agents', 'skills', 'decomplect', 'references', 'EXAMPLES.md'));
      await fs.access(path.join(workspace, '.codex', 'prompts', 'decomplect.md'));

      await assert.rejects(
        fs.access(path.join(workspace, '.codex', 'skills', 'decomplect', 'SKILL.md'))
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
      await fs.rm(sourceRoot, { recursive: true, force: true });
    }
  });
});
