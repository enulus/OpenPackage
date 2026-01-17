import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const testFiles: string[] = [
  // Core - Save
  'tests/core/save/versioning.test.ts',
  'tests/core/save/package-index-root-save.test.ts',
  
  // Core - Install
  'tests/core/install/plugin-sources.test.ts',
  'tests/core/install/marketplace-parsing.test.ts',
  'tests/core/install/cli-modes.test.ts',
  'tests/core/install/install-selection.test.ts',
  
  // Core - Push
  'tests/core/push/stable-selection.test.ts',
  'tests/core/push/partial-tarball.test.ts',
  
  // Core - Pull
  'tests/core/pull/partial.test.ts',
  
  // Core - Platforms
  'tests/core/platforms/platform-extension-filter.test.ts',
  'tests/core/platforms/platform-flows-config.test.ts',
  'tests/core/platforms/dynamic-subdirs.test.ts',
  'tests/core/platforms/yaml-override-merge.test.ts',
  
  // Core - Workspace
  'tests/core/workspace/workspace-paths.test.ts',
  'tests/core/workspace/workspace-index-yml.test.ts',
  'tests/core/workspace/workspace-bootstrap.test.ts',
  
  // Core - Source Resolution
  'tests/core/source-resolution/source-mutability.test.ts',
  'tests/core/source-resolution/source-resolution.test.ts',
  
  // Core - Uninstall
  'tests/core/uninstall/uninstall.test.ts',
  
  // Core - Flows
  'tests/core/flows/integration/flow-install-pipeline.test.ts',
  'tests/core/flows/integration/flow-save-apply-pipeline.test.ts',
  
  // Commands
  'tests/commands/pack.test.ts',
  'tests/commands/status.test.ts',
  
  // Utils
  'tests/utils/version-selection.test.ts',
  'tests/utils/paths-option.test.ts',
  'tests/utils/path-resolution.test.ts',
  
  // Integration
  'tests/integration/cwd-global.test.ts',
  'tests/integration/apply-mutable-source.test.ts',
  'tests/integration/save-and-add-mutable-source.test.ts',
  'tests/integration/immutable-save-add-errors.test.ts',
  'tests/integration/save-apply-flows.test.ts'
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

