/**
 * Tests for plugin source normalization.
 * 
 * Verifies that all Claude Code marketplace plugin source types are properly
 * normalized and validated.
 */

import assert from 'node:assert/strict';
import {
  normalizePluginSource,
  isRelativePathSource,
  isGitSource,
  type GitHubSource,
  type GitUrlSource
} from '../../../src/core/install/plugin-sources.js';

// Test: relative path sources
{
  const result = normalizePluginSource('./plugins/my-plugin', 'test-plugin');
  assert.equal(result.type, 'relative-path');
  assert.equal(result.relativePath, './plugins/my-plugin');
  assert.equal(isRelativePathSource(result), true);
  assert.equal(isGitSource(result), false);
}

{
  const result = normalizePluginSource('plugins/my-plugin', 'test-plugin');
  assert.equal(result.type, 'relative-path');
  assert.equal(result.relativePath, 'plugins/my-plugin');
}

// Test: reject paths with .. for security
assert.throws(
  () => normalizePluginSource('../plugins/my-plugin', 'test-plugin'),
  /contains '\.\.' which is not allowed/
);

// Test: reject absolute paths
assert.throws(
  () => normalizePluginSource('/absolute/path', 'test-plugin'),
  /must be relative to marketplace root, not absolute/
);

// Test: GitHub sources with repo only
{
  const source: GitHubSource = {
    source: 'github',
    repo: 'owner/repo'
  };
  
  const result = normalizePluginSource(source, 'test-plugin');
  assert.equal(result.type, 'git');
  assert.equal(result.gitUrl, 'https://github.com/owner/repo.git');
  assert.equal(result.gitRef, undefined);
  assert.equal(result.gitSubdirectory, undefined);
  assert.equal(isGitSource(result), true);
  assert.equal(isRelativePathSource(result), false);
}

// Test: GitHub sources with ref
{
  const source: GitHubSource = {
    source: 'github',
    repo: 'owner/repo',
    ref: 'v1.0.0'
  };
  
  const result = normalizePluginSource(source, 'test-plugin');
  assert.equal(result.type, 'git');
  assert.equal(result.gitUrl, 'https://github.com/owner/repo.git');
  assert.equal(result.gitRef, 'v1.0.0');
  assert.equal(result.gitSubdirectory, undefined);
}

// Test: GitHub sources with path (subdirectory)
{
  const source: GitHubSource = {
    source: 'github',
    repo: 'owner/repo',
    path: 'plugins/my-plugin'
  };
  
  const result = normalizePluginSource(source, 'test-plugin');
  assert.equal(result.type, 'git');
  assert.equal(result.gitUrl, 'https://github.com/owner/repo.git');
  assert.equal(result.gitRef, undefined);
  assert.equal(result.gitSubdirectory, 'plugins/my-plugin');
}

// Test: GitHub sources with ref and path
{
  const source: GitHubSource = {
    source: 'github',
    repo: 'owner/repo',
    ref: 'main',
    path: 'plugins/my-plugin'
  };
  
  const result = normalizePluginSource(source, 'test-plugin');
  assert.equal(result.type, 'git');
  assert.equal(result.gitUrl, 'https://github.com/owner/repo.git');
  assert.equal(result.gitRef, 'main');
  assert.equal(result.gitSubdirectory, 'plugins/my-plugin');
}

// Test: reject GitHub sources without repo field
assert.throws(
  () => {
    const source = { source: 'github' } as GitHubSource;
    normalizePluginSource(source, 'test-plugin');
  },
  /missing 'repo' field/
);

// Test: reject GitHub sources with invalid repo format (no slash)
assert.throws(
  () => {
    const source: GitHubSource = { source: 'github', repo: 'invalidrepo' };
    normalizePluginSource(source, 'test-plugin');
  },
  /must be in 'owner\/repo' format/
);

// Test: reject GitHub sources with invalid repo format (empty parts)
assert.throws(
  () => {
    const source: GitHubSource = { source: 'github', repo: '/repo' };
    normalizePluginSource(source, 'test-plugin');
  },
  /must be in 'owner\/repo' format/
);

// Test: Git URL sources (HTTPS)
{
  const source: GitUrlSource = {
    source: 'url',
    url: 'https://gitlab.com/team/plugin.git'
  };
  
  const result = normalizePluginSource(source, 'test-plugin');
  assert.equal(result.type, 'git');
  assert.equal(result.gitUrl, 'https://gitlab.com/team/plugin.git');
  assert.equal(result.gitRef, undefined);
  assert.equal(result.gitSubdirectory, undefined);
}

// Test: Git URL sources with ref
{
  const source: GitUrlSource = {
    source: 'url',
    url: 'https://gitlab.com/team/plugin.git',
    ref: 'develop'
  };
  
  const result = normalizePluginSource(source, 'test-plugin');
  assert.equal(result.type, 'git');
  assert.equal(result.gitUrl, 'https://gitlab.com/team/plugin.git');
  assert.equal(result.gitRef, 'develop');
}

// Test: Git URL sources with path
{
  const source: GitUrlSource = {
    source: 'url',
    url: 'https://bitbucket.org/team/monorepo.git',
    path: 'packages/plugin-a'
  };
  
  const result = normalizePluginSource(source, 'test-plugin');
  assert.equal(result.type, 'git');
  assert.equal(result.gitUrl, 'https://bitbucket.org/team/monorepo.git');
  assert.equal(result.gitSubdirectory, 'packages/plugin-a');
}

// Test: Git URL sources with ref and path
{
  const source: GitUrlSource = {
    source: 'url',
    url: 'https://gitlab.com/team/plugin.git',
    ref: 'v2.0.0',
    path: 'src/plugin'
  };
  
  const result = normalizePluginSource(source, 'test-plugin');
  assert.equal(result.type, 'git');
  assert.equal(result.gitUrl, 'https://gitlab.com/team/plugin.git');
  assert.equal(result.gitRef, 'v2.0.0');
  assert.equal(result.gitSubdirectory, 'src/plugin');
}

// Test: SSH Git URLs
{
  const source: GitUrlSource = {
    source: 'url',
    url: 'git@gitlab.com:team/plugin.git'
  };
  
  const result = normalizePluginSource(source, 'test-plugin');
  assert.equal(result.type, 'git');
  assert.equal(result.gitUrl, 'git@gitlab.com:team/plugin.git');
}

// Test: reject Git URL sources without url field
assert.throws(
  () => {
    const source = { source: 'url' } as GitUrlSource;
    normalizePluginSource(source, 'test-plugin');
  },
  /missing 'url' field/
);

// Test: reject invalid Git URLs
assert.throws(
  () => {
    const source: GitUrlSource = { source: 'url', url: 'not-a-git-url' };
    normalizePluginSource(source, 'test-plugin');
  },
  /has invalid Git URL/
);

// Test: throw on missing source
assert.throws(
  () => normalizePluginSource(null as any, 'test-plugin'),
  /missing required 'source' field/
);

// Test: throw on empty source
assert.throws(
  () => normalizePluginSource('' as any, 'test-plugin'),
  /missing required 'source' field/
);

// Test: throw on object without source field
assert.throws(
  () => {
    const source = { repo: 'owner/repo' } as any;
    normalizePluginSource(source, 'test-plugin');
  },
  /missing 'source' field/
);

// Test: throw on unsupported source type
assert.throws(
  () => {
    const source = { source: 'npm', package: 'some-package' } as any;
    normalizePluginSource(source, 'test-plugin');
  },
  /unsupported source type: 'npm'/
);

// Test: include plugin name in error messages
assert.throws(
  () => {
    const source: GitHubSource = { source: 'github', repo: 'invalid' };
    normalizePluginSource(source, 'my-custom-plugin');
  },
  /Plugin 'my-custom-plugin'/
);

// Test: preserve raw string source
{
  const rawSource = './plugins/test';
  const result = normalizePluginSource(rawSource, 'test-plugin');
  assert.equal(result.rawSource, rawSource);
}

// Test: preserve raw object source
{
  const rawSource: GitHubSource = {
    source: 'github',
    repo: 'owner/repo',
    ref: 'main'
  };
  
  const result = normalizePluginSource(rawSource, 'test-plugin');
  assert.equal(result.rawSource, rawSource);
}

console.log('✅ All plugin-sources tests passed');
