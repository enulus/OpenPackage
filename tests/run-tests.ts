import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const testFiles: string[] = [
  // Core - Install
  'tests/core/install/plugin-sources.test.ts',
  'tests/core/install/marketplace-parsing.test.ts',
  'tests/core/install/cli-modes.test.ts',
  'tests/core/install/install-selection.test.ts',
  'tests/core/install/workspace-level-install.test.ts',
  'tests/core/install/subsumption-resolver.test.ts',
  'tests/core/install/resource-scoping.test.ts',
  'tests/core/install/agent-skill-version-extraction.test.ts',
  'tests/core/install/conversion-context.test.ts',
  'tests/core/install/file-conflict-namespace.test.ts',
  'tests/core/install/file-format-detection.test.ts',
  'tests/core/install/format-detector.test.ts',
  'tests/core/install/format-distribution-analysis.test.ts',
  'tests/core/install/format-group-merger.test.ts',
  'tests/core/install/frontmatter-override.test.ts',
  'tests/core/install/git-cache.test.ts',
  'tests/core/install/git-source-integration.test.ts',
  'tests/core/install/import-flow-converter.test.ts',
  'tests/core/install/manifest-git-url-migration.test.ts',
  'tests/core/install/manifest-subdirectory-migration.test.ts',
  'tests/core/install/marketplace-defined-plugins.test.ts',
  'tests/core/install/package-format-detection.test.ts',
  'tests/core/install/package-marker-detection.test.ts',
  'tests/core/install/package-name-path-migration.test.ts',
  'tests/core/install/path-source-persistence.test.ts',
  'tests/core/install/phase2-integration.test.ts',
  'tests/core/install/phase3-integration.test.ts',
  'tests/core/install/phase4-integration.test.ts',
  'tests/core/install/plugin-naming.test.ts',
  'tests/core/install/stale-file-cleanup.test.ts',

  // Core - Flows
  'tests/core/flows/conditional-targetroot.test.ts',
  'tests/core/flows/integration/switch-target-path.test.ts',
  'tests/core/flows/integration/toml-key-tracking.test.ts',
  'tests/core/flows/map-dictionary.test.ts',
  'tests/core/flows/priority-patterns.test.ts',
  'tests/core/flows/recursive-glob.test.ts',
  'tests/core/flows/source-resolver.test.ts',
  'tests/core/flows/tool-mapping.test.ts',
  'tests/core/flows/transforms/toml-transforms.test.ts',
  'tests/core/flows/unified-platform-model.test.ts',
  'tests/core/flows/unit/switch-resolution.test.ts',

  // Core - Platforms
  'tests/core/platforms/platform-extension-filter.test.ts',
  'tests/core/platforms/platform-flows-config.test.ts',
  'tests/core/platforms/dynamic-subdirs.test.ts',
  'tests/core/platforms/yaml-override-merge.test.ts',
  'tests/core/platforms/converter.test.ts',

  // Core - Workspace
  'tests/core/workspace/workspace-paths.test.ts',
  'tests/core/workspace/workspace-index-yml.test.ts',
  'tests/core/workspace/workspace-bootstrap.test.ts',
  'tests/core/workspace/workspace-index-name-migration.test.ts',

  // Core - Conversion Context
  'tests/core/conversion-context/basic.test.ts',

  // Core - List
  'tests/core/list/untracked-files.test.ts',
  'tests/core/list/group-files-into-resources.test.ts',

  // Core - Resources
  'tests/core/resources/resource-namespace.test.ts',
  'tests/core/resources/resource-classifier.test.ts',
  'tests/core/resources/resource-spec.test.ts',

  // Core - Source Resolution
  'tests/core/source-resolution/source-mutability.test.ts',
  'tests/core/source-resolution/source-resolution.test.ts',

  // Core - Add
  'tests/core/add/add-dependency-flow.test.ts',
  'tests/core/add/add-flow-based-mapping.test.ts',
  'tests/core/add/add-junk-filtering-integration.test.ts',
  'tests/core/add/add-without-installation.test.ts',

  // Core - Save
  'tests/core/save/save-candidate-builder.test.ts',
  'tests/core/save/save-conflict-analyzer.test.ts',
  'tests/core/save/save-group-builder.test.ts',
  'tests/core/save/save-integration.test.ts',
  'tests/core/save/save-interactive-resolver.test.ts',
  'tests/core/save/save-merge-extraction.test.ts',
  'tests/core/save/save-merged-file-parity.test.ts',
  'tests/core/save/save-new-file-detector.test.ts',
  'tests/core/save/save-platform-handler.test.ts',
  'tests/core/save/save-resolution-executor.test.ts',
  'tests/core/save/save-write-merged-extraction.test.ts',

  // Core - Uninstall
  'tests/core/uninstall/uninstall.test.ts',
  'tests/core/uninstall/package-name-formats.test.ts',
  'tests/core/uninstall/uninstall-merged-files.test.ts',

  // Core - Other
  'tests/core/cache-manager.test.ts',
  'tests/core/execution-context.test.ts',

  // Commands
  'tests/commands/install-plugins-flag.test.ts',
  'tests/commands/install-plugins-integration.test.ts',
  'tests/commands/list-untracked.test.ts',
  'tests/commands/install-list.test.ts',
  'tests/commands/set.test.ts',

  // Utils
  'tests/utils/version-selection.test.ts',
  'tests/utils/path-resolution.test.ts',
  'tests/utils/custom-path-creation.test.ts',
  'tests/utils/directory-preservation.test.ts',
  'tests/utils/git-spec-and-schema.test.ts',
  'tests/utils/git-url-detection.test.ts',
  'tests/utils/home-directory.test.ts',
  'tests/utils/junk-file-filtering.test.ts',
  'tests/utils/package-input-git-detection.test.ts',
  'tests/utils/path-comparison.test.ts',
  'tests/utils/path-display-formatter.test.ts',

  // Integration
  'tests/integration/cwd-global.test.ts'
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

