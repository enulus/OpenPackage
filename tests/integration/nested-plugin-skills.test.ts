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
    timeout: 60_000
  });

  return {
    code: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim()
  };
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

describe('nested plugin skills integration', () => {
  it('installs a nested config/skills resource via --skills', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-nested-plugin-'));

    try {
      await fs.mkdir(path.join(workspace, '.cursor'), { recursive: true });
      await fs.mkdir(path.join(workspace, '.claude'), { recursive: true });

      const pkgDir = path.join(workspace, 'packages', 'langsmith-plugin');
      await writeFile(
        path.join(pkgDir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'langsmith-plugin', version: '0.1.0' }, null, 2)
      );
      await writeFile(
        path.join(pkgDir, 'config', 'AGENTS.md'),
        '# Plugin Guide\n'
      );
      await writeFile(
        path.join(pkgDir, 'config', 'skills', 'langsmith-dataset', 'SKILL.md'),
        '---\nname: langsmith-dataset\n---\n# Dataset Skill\n'
      );
      await writeFile(
        path.join(pkgDir, 'config', 'skills', 'langsmith-dataset', 'helper.ts'),
        'export const helper = true;\n'
      );

      const result = runCli(
        ['install', './packages/langsmith-plugin', '--skills', 'langsmith-dataset', '--force', '--conflicts', 'overwrite'],
        workspace,
        { CI: 'true' }
      );

      assert.equal(
        result.code,
        0,
        `Nested plugin install should succeed.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
      );

      const installedSkill = path.join(workspace, '.cursor', 'skills', 'langsmith-dataset', 'SKILL.md');
      const installedHelper = path.join(workspace, '.cursor', 'skills', 'langsmith-dataset', 'helper.ts');

      await fs.access(installedSkill);
      await fs.access(installedHelper);

      const skillContent = await fs.readFile(installedSkill, 'utf8');
      assert.match(skillContent, /name: langsmith-dataset/);
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
