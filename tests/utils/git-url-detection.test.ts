/**
 * Tests for git-url-detection module.
 * Covers all parsers and detection priority.
 */

import assert from 'node:assert/strict';
import {
  detectGitSource,
  parseGitHubShorthand,
  parseGitHubUrl,
  parseGenericGitUrl,
  isGitUrl,
  normalizeGitHubUrl
} from '../../packages/core/src/utils/git-url-detection.js';

// =============================================================================
// GitHub Shorthand Parser Tests
// =============================================================================

console.log('Testing GitHub shorthand parser...');

// Valid: basic shorthand
{
  const spec = parseGitHubShorthand('gh@user/repo');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Valid: shorthand with path
{
  const spec = parseGitHubShorthand('gh@user/repo/plugins/x');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, 'plugins/x');
}

// Valid: shorthand with nested path
{
  const spec = parseGitHubShorthand('gh@user/repo/a/b/c');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, 'a/b/c');
}

// Valid: shorthand with trailing slash (empty path = undefined)
{
  const spec = parseGitHubShorthand('gh@user/repo/');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.path, undefined);
}

// Not shorthand: returns null
{
  const spec = parseGitHubShorthand('https://github.com/user/repo');
  assert.equal(spec, null);
}

// Error: missing repo
{
  try {
    parseGitHubShorthand('gh@user');
    assert.fail('Should have thrown error');
  } catch (error: any) {
    assert(error.message.includes('Invalid GitHub shorthand'));
  }
}

// Error: empty repo (trailing slash filtered out)
{
  try {
    parseGitHubShorthand('gh@user/');
    assert.fail('Should have thrown error');
  } catch (error: any) {
    assert(error.message.includes('Invalid GitHub shorthand'));
  }
}

// Error: just gh@
{
  try {
    parseGitHubShorthand('gh@');
    assert.fail('Should have thrown error');
  } catch (error: any) {
    assert(error.message.includes('Invalid GitHub shorthand'));
  }
}

console.log('✓ GitHub shorthand parser tests passed');

// =============================================================================
// GitHub URL Parser Tests
// =============================================================================

console.log('Testing GitHub URL parser...');

// Valid: basic repo URL
{
  const spec = parseGitHubUrl('https://github.com/user/repo');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Valid: repo URL with .git
{
  const spec = parseGitHubUrl('https://github.com/user/repo.git');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Valid: tree URL with ref
{
  const spec = parseGitHubUrl('https://github.com/user/repo/tree/main');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, 'main');
  assert.equal(spec.path, undefined);
}

// Valid: tree URL with ref and path
{
  const spec = parseGitHubUrl('https://github.com/user/repo/tree/main/plugins/x');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, 'main');
  assert.equal(spec.path, 'plugins/x');
}

// Valid: tree URL with version tag
{
  const spec = parseGitHubUrl('https://github.com/user/repo/tree/v1.0.0/packages/a/b');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, 'v1.0.0');
  assert.equal(spec.path, 'packages/a/b');
}

// Valid: URL with query params (ignored)
{
  const spec = parseGitHubUrl('https://github.com/user/repo?tab=readme');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Valid: URL with trailing slash
{
  const spec = parseGitHubUrl('https://github.com/user/repo/');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Valid: URL-encoded path
{
  const spec = parseGitHubUrl('https://github.com/user/repo/tree/main/path%20with%20spaces');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, 'main');
  assert.equal(spec.path, 'path with spaces');
}

// Not GitHub URL: returns null
{
  const spec = parseGitHubUrl('https://gitlab.com/user/repo');
  assert.equal(spec, null);
}

// Not a URL: returns null
{
  const spec = parseGitHubUrl('gh@user/repo');
  assert.equal(spec, null);
}

// Error: blob URL (single file)
{
  try {
    parseGitHubUrl('https://github.com/user/repo/blob/main/file.md');
    assert.fail('Should have thrown error');
  } catch (error: any) {
    assert(error.message.includes('Cannot install from single file URL'));
  }
}

// Error: missing owner and repo
{
  try {
    parseGitHubUrl('https://github.com/');
    assert.fail('Should have thrown error');
  } catch (error: any) {
    assert(error.message.includes('Invalid GitHub URL'));
  }
}

// Error: missing repo
{
  try {
    parseGitHubUrl('https://github.com/user');
    assert.fail('Should have thrown error');
  } catch (error: any) {
    assert(error.message.includes('Invalid GitHub URL'));
  }
}

// Error: empty ref after tree
{
  try {
    parseGitHubUrl('https://github.com/user/repo/tree/');
    assert.fail('Should have thrown error');
  } catch (error: any) {
    assert(error.message.includes('Ref is required after /tree/'));
  }
}

console.log('✓ GitHub URL parser tests passed');

// =============================================================================
// Generic Git URL Parser Tests
// =============================================================================

console.log('Testing generic git URL parser...');

// Valid: HTTPS git URL
{
  const spec = parseGenericGitUrl('https://gitlab.com/user/repo.git');
  assert(spec);
  assert.equal(spec.url, 'https://gitlab.com/user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Valid: SSH git URL
{
  const spec = parseGenericGitUrl('git@gitlab.com:user/repo.git');
  assert(spec);
  assert.equal(spec.url, 'git@gitlab.com:user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Valid: git:// protocol
{
  const spec = parseGenericGitUrl('git://host/repo.git');
  assert(spec);
  assert.equal(spec.url, 'git://host/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Valid: URL with ref in hash
{
  const spec = parseGenericGitUrl('https://gitlab.com/user/repo.git#main');
  assert(spec);
  assert.equal(spec.url, 'https://gitlab.com/user/repo.git');
  assert.equal(spec.ref, 'main');
  assert.equal(spec.path, undefined);
}

// Valid: URL with ref and path
{
  const spec = parseGenericGitUrl('https://example.com/repo.git#v1.0.0&path=packages/a');
  assert(spec);
  assert.equal(spec.url, 'https://example.com/repo.git');
  assert.equal(spec.ref, 'v1.0.0');
  assert.equal(spec.path, 'packages/a');
}

// Valid: URL with path only
{
  const spec = parseGenericGitUrl('git://host/repo.git#path=src/plugin');
  assert(spec);
  assert.equal(spec.url, 'git://host/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, 'src/plugin');
}

// Valid: URL with subdirectory (backward compat)
{
  const spec = parseGenericGitUrl('https://gitlab.com/user/repo.git#main&subdirectory=packages/x');
  assert(spec);
  assert.equal(spec.url, 'https://gitlab.com/user/repo.git');
  assert.equal(spec.ref, 'main');
  assert.equal(spec.path, 'packages/x');
}

// Valid: GitHub URL (handled by generic parser if not caught by GitHub parser)
{
  const spec = parseGenericGitUrl('https://github.com/user/repo.git');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
}

// Not git URL: returns null
{
  const spec = parseGenericGitUrl('path/to/local');
  assert.equal(spec, null);
}

// Error: unknown parameter in hash
{
  try {
    parseGenericGitUrl('https://example.com/repo.git#main&foo=bar');
    assert.fail('Should have thrown error');
  } catch (error: any) {
    assert(error.message.includes('Unknown parameter: foo'));
  }
}

// Error: multiple refs
{
  try {
    parseGenericGitUrl('https://example.com/repo.git#main&v1.0.0');
    assert.fail('Should have thrown error');
  } catch (error: any) {
    assert(error.message.includes('Multiple refs specified'));
  }
}

console.log('✓ Generic git URL parser tests passed');

// =============================================================================
// detectGitSource Integration Tests
// =============================================================================

console.log('Testing detectGitSource priority...');

// Priority 1: GitHub shorthand
{
  const spec = detectGitSource('gh@user/repo');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
}

// Priority 2: GitHub URL
{
  const spec = detectGitSource('https://github.com/user/repo/tree/main/path');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, 'main');
  assert.equal(spec.path, 'path');
}

// Priority 3: Generic git URL
{
  const spec = detectGitSource('https://gitlab.com/user/repo.git#main');
  assert(spec);
  assert.equal(spec.url, 'https://gitlab.com/user/repo.git');
  assert.equal(spec.ref, 'main');
}

// Not a git source: returns null
{
  const spec = detectGitSource('./local/path');
  assert.equal(spec, null);
}

// Not a git source: package name
{
  const spec = detectGitSource('my-package');
  assert.equal(spec, null);
}

// Empty input: returns null
{
  const spec = detectGitSource('');
  assert.equal(spec, null);
}

console.log('✓ detectGitSource priority tests passed');

// =============================================================================
// Legacy Prefix Tests (with deprecation warnings)
// =============================================================================

console.log('Testing legacy prefix support...');

// Legacy: github: prefix
{
  const spec = detectGitSource('github:user/repo');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Legacy: github: with ref
{
  const spec = detectGitSource('github:user/repo#main');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, 'main');
}

// Legacy: github: with subdirectory
{
  const spec = detectGitSource('github:user/repo#subdirectory=plugins/x');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.path, 'plugins/x');
}

// Legacy: github: with ref and subdirectory
{
  const spec = detectGitSource('github:user/repo#main&subdirectory=plugins/x');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.git');
  assert.equal(spec.ref, 'main');
  assert.equal(spec.path, 'plugins/x');
}

// Legacy: git: prefix
{
  const spec = detectGitSource('git:https://gitlab.com/user/repo.git');
  assert(spec);
  assert.equal(spec.url, 'https://gitlab.com/user/repo.git');
}

// Legacy: git: with ref
{
  const spec = detectGitSource('git:https://gitlab.com/user/repo.git#main');
  assert(spec);
  assert.equal(spec.url, 'https://gitlab.com/user/repo.git');
  assert.equal(spec.ref, 'main');
}

// Legacy: git: with ref and subdirectory
{
  const spec = detectGitSource('git:https://gitlab.com/repo.git#main&subdirectory=x');
  assert(spec);
  assert.equal(spec.url, 'https://gitlab.com/repo.git');
  assert.equal(spec.ref, 'main');
  assert.equal(spec.path, 'x');
}

console.log('✓ Legacy prefix tests passed (deprecation warnings expected above)');

// =============================================================================
// Helper Function Tests
// =============================================================================

console.log('Testing helper functions...');

// isGitUrl: HTTPS
{
  assert.equal(isGitUrl('https://github.com/user/repo.git'), true);
}

// isGitUrl: HTTP
{
  assert.equal(isGitUrl('http://example.com/repo.git'), true);
}

// isGitUrl: git://
{
  assert.equal(isGitUrl('git://host/repo.git'), true);
}

// isGitUrl: git@
{
  assert.equal(isGitUrl('git@github.com:user/repo.git'), true);
}

// isGitUrl: ssh://
{
  assert.equal(isGitUrl('ssh://user@host/repo.git'), true);
  assert.equal(isGitUrl('ssh://git@github.com/owner/repo.git'), true);
}

// isGitUrl: .git extension
{
  assert.equal(isGitUrl('path/to/repo.git'), true);
}

// isGitUrl: .git with hash fragment
{
  assert.equal(isGitUrl('https://example.com/repo.git#main'), true);
  assert.equal(isGitUrl('ssh://user@host/repo.git#v1.0.0'), true);
  assert.equal(isGitUrl('repo.git#main'), true);
}

// isGitUrl: not a git URL
{
  assert.equal(isGitUrl('path/to/local'), false);
  assert.equal(isGitUrl('my-package'), false);
  assert.equal(isGitUrl('./local/path'), false);
}

// normalizeGitHubUrl: basic
{
  const url = normalizeGitHubUrl('user', 'repo');
  assert.equal(url, 'https://github.com/user/repo.git');
}

// normalizeGitHubUrl: strips .git from repo
{
  const url = normalizeGitHubUrl('user', 'repo.git');
  assert.equal(url, 'https://github.com/user/repo.git');
}

console.log('✓ Helper function tests passed');

// =============================================================================
// Edge Cases
// =============================================================================

console.log('Testing edge cases...');

// Edge: repo name with dots
{
  const spec = parseGitHubShorthand('gh@user/repo.name');
  assert(spec);
  assert.equal(spec.url, 'https://github.com/user/repo.name.git');
}

// Edge: path with special characters
{
  const spec = parseGitHubUrl('https://github.com/user/repo/tree/main/path-with_special.chars');
  assert(spec);
  assert.equal(spec.path, 'path-with_special.chars');
}

// Edge: ref with slashes (like release/v1.0)
{
  const spec = parseGenericGitUrl('https://gitlab.com/repo.git#release/v1.0');
  assert(spec);
  assert.equal(spec.ref, 'release/v1.0');
}

// Edge: path with equals sign (not a parameter)
{
  const spec = parseGenericGitUrl('https://example.com/repo.git#path=packages/x=y');
  assert(spec);
  assert.equal(spec.path, 'packages/x=y');
}

// Edge: empty hash fragment
{
  const spec = parseGenericGitUrl('https://example.com/repo.git#');
  assert(spec);
  assert.equal(spec.ref, undefined);
  assert.equal(spec.path, undefined);
}

// Edge: multiple & separators
{
  const spec = parseGenericGitUrl('https://example.com/repo.git#main&path=x');
  assert(spec);
  assert.equal(spec.ref, 'main');
  assert.equal(spec.path, 'x');
}

console.log('✓ Edge case tests passed');

// =============================================================================
// Summary
// =============================================================================

console.log('\n✅ All git-url-detection tests passed!\n');
