import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const testFiles: string[] = [
  'tests/save-pack-versioning.test.ts',
  'tests/install-cli-modes.test.ts',
  'tests/install-selection.test.ts',
  'tests/version-selection.test.ts',
  'tests/push-stable-selection.test.ts',
  'tests/workspace-paths.test.ts',
  'tests/platform-extension-filter.test.ts',
  'tests/platform-flows-config.test.ts',
  'tests/pull-partial.test.ts',
  'tests/paths-option.test.ts',
  'tests/push-partial-tarball.test.ts',
  'tests/dynamic-subdirs.test.ts',
  'tests/yaml-override-merge.test.ts',
  'tests/cwd-global.test.ts',
  'tests/path-resolution.test.ts',
  'tests/workspace-index-yml.test.ts',
  'tests/source-mutability.test.ts',
  'tests/source-resolution.test.ts',
  'tests/workspace-bootstrap.test.ts',
  'tests/apply-mutable-source.test.ts',
  'tests/save-and-add-mutable-source.test.ts',
  'tests/pack.test.ts',
  'tests/status.test.ts',
  'tests/uninstall.test.ts',
  'tests/immutable-save-add-errors.test.ts',
  'tests/flows/integration/flow-install-pipeline.test.ts',
  'tests/flows/integration/flow-save-apply-pipeline.test.ts',
  'tests/save-apply-flows.test.ts'
];

function runTestFile(relPath: string): void {
  const absPath = path.resolve(repoRoot, relPath);

  const result = spawnSync('node', ['--loader', 'ts-node/esm', absPath], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      TS_NODE_TRANSPILE_ONLY: '1'
    }
  });

  if ((result.status ?? 1) !== 0) {
    throw new Error(`Test failed: ${relPath}`);
  }
}

try {
  for (const file of testFiles) {
    runTestFile(file);
  }
  console.log(`\n✓ All tests passed (${testFiles.length})`);
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}

