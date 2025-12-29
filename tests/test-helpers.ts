import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

export function getCliPath(): string {
  // Use the TypeScript entrypoint so tests validate current source behavior,
  // independent of whether `dist/` is rebuilt.
  return path.resolve(__dirname, '../../src/index.ts');
}

export function runCli(
  args: string[],
  cwd: string,
  env?: Record<string, string | undefined>
): { code: number; stdout: string; stderr: string } {
  // Spawn from repo root so Node can resolve dev deps like ts-node, but
  // run the CLI as-if it was invoked inside the workspace via --cwd.
  const result = spawnSync(
    'node',
    ['--loader', 'ts-node/esm', getCliPath(), '--cwd', cwd, ...args],
    {
      cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...(env ?? {}), TS_NODE_TRANSPILE_ONLY: '1' }
    }
  );

  return {
    code: result.status ?? 1,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim()
  };
}

