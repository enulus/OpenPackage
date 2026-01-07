import assert from 'node:assert/strict';
import { join } from 'path';

import { isAllowedRegistryPath } from '../../../src/utils/registry-entry-filter.js';
import { resolveTargetDirectory, resolveTargetFilePath } from '../../../src/utils/platform-mapper.js';

// Flow-based validation: paths must match universal patterns from platforms.jsonc
// Universal subdirectory paths are allowed
assert.equal(isAllowedRegistryPath('commands/foo.md'), true, 'commands/*.md should be allowed');
assert.equal(isAllowedRegistryPath('rules/bar.md'), true, 'rules/*.md should be allowed');
assert.equal(isAllowedRegistryPath('agents/assistant.md'), true, 'agents/*.md should be allowed');
assert.equal(isAllowedRegistryPath('skills/code-review/analyze.md'), true, 'skills/**/* should be allowed');

// Root-level files defined in flows should be allowed (e.g., mcp.jsonc in cursor/opencode platforms)
assert.equal(isAllowedRegistryPath('mcp.jsonc'), true, 'mcp.jsonc should be allowed (defined in cursor/opencode flows)');

// Non-universal paths (not in any flow pattern) are rejected
assert.equal(isAllowedRegistryPath('docs/getting-started.md'), false, 'docs/* not in flows');
assert.equal(isAllowedRegistryPath('src/features/foo/bar.md'), false, 'src/* not in flows');
assert.equal(isAllowedRegistryPath('README.md'), false, 'README.md not in flows (unless explicitly defined)');
assert.equal(isAllowedRegistryPath('root/tools/helper.sh'), false, 'root/* is copy-to-root (handled separately)');
assert.equal(isAllowedRegistryPath('random-file.txt'), false, 'random files not in flows');

// Root registry files remain blocked (handled separately)
assert.equal(isAllowedRegistryPath('AGENTS.md'), false, 'AGENTS.md is root file');
assert.equal(isAllowedRegistryPath('CLAUDE.md'), false, 'CLAUDE.md is root file');

// YAML override paths under universal subdirs are blocked
assert.equal(isAllowedRegistryPath('rules/agent.cursor.yml'), false, 'platform-specific yml files blocked');
assert.equal(isAllowedRegistryPath('commands/task.claude.yml'), false, 'platform-specific yml files blocked');

// Resolve target directory/file for generic workspace paths should preserve structure
const packageDir = '/tmp/package-example';
const genericDir = resolveTargetDirectory(packageDir, 'guides/intro.md');
assert.equal(genericDir, join(packageDir, 'guides'));
const genericPath = resolveTargetFilePath(genericDir, 'guides/intro.md');
assert.equal(genericPath, join(packageDir, 'guides', 'intro.md'));

// Universal subdir paths (v2, no .openpackage prefix) preserve the structure
const universalDir = resolveTargetDirectory(packageDir, 'rules/example.md');
assert.equal(universalDir, join(packageDir, 'rules'));
const universalPath = resolveTargetFilePath(universalDir, 'rules/example.md');
assert.equal(universalPath, join(universalDir, 'example.md'));

console.log('workspace path handling tests passed');


