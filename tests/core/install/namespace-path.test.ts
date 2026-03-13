/**
 * Prefix-Based Namespace Path Generation — Unit Tests
 *
 * Tests for `generatePrefixedLeafPath` and `shouldSkipPrefix` from
 * the namespace-path module.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  generatePrefixedLeafPath,
  shouldSkipPrefix,
} from '../../../packages/core/src/core/install/conflicts/namespace-path.js';

// ============================================================================
// shouldSkipPrefix — dedup rule
// ============================================================================

describe('shouldSkipPrefix', () => {
  it('returns true when leaf name (sans extension) equals slug', () => {
    assert.strictEqual(shouldSkipPrefix('code-review.md', 'code-review'), true);
  });

  it('returns true when leaf has no extension and equals slug', () => {
    assert.strictEqual(shouldSkipPrefix('acme', 'acme'), true);
  });

  it('returns false when leaf name differs from slug', () => {
    assert.strictEqual(shouldSkipPrefix('foo.md', 'acme'), false);
  });

  it('returns false when leaf partially matches slug', () => {
    assert.strictEqual(shouldSkipPrefix('code-review-extra.md', 'code-review'), false);
  });
});

// ============================================================================
// generatePrefixedLeafPath — file-based prefixing
// ============================================================================

describe('generatePrefixedLeafPath — file-based', () => {
  it('prefixes leaf file under a ** glob pattern', () => {
    assert.equal(
      generatePrefixedLeafPath('rules/foo.mdc', 'acme', 'rules/**'),
      'rules/acme-foo.mdc'
    );
  });

  it('prefixes leaf file in a nested path', () => {
    assert.equal(
      generatePrefixedLeafPath('rules/git/commits.md', 'acme', 'rules/**'),
      'rules/git/acme-commits.md'
    );
  });

  it('prefixes leaf after cursor-prefixed base dir', () => {
    assert.equal(
      generatePrefixedLeafPath('.cursor/rules/my-rule.mdc', 'corp', '.cursor/rules/**'),
      '.cursor/rules/corp-my-rule.mdc'
    );
  });

  it('prefixes leaf under a single-level * glob', () => {
    assert.equal(
      generatePrefixedLeafPath('agents/helper.md', 'my-pkg', 'agents/*'),
      'agents/my-pkg-helper.md'
    );
  });

  it('falls back to prefixing leaf when flowToPattern is undefined', () => {
    assert.equal(
      generatePrefixedLeafPath('rules/foo.mdc', 'acme', undefined),
      'rules/acme-foo.mdc'
    );
  });

  it('prefixes single-segment path (no parent dir)', () => {
    assert.equal(
      generatePrefixedLeafPath('foo.mdc', 'acme', undefined),
      'acme-foo.mdc'
    );
  });

  it('preserves deep sub-paths and prefixes only the leaf', () => {
    assert.equal(
      generatePrefixedLeafPath('rules/a/b/c.md', 'pkg', 'rules/**'),
      'rules/a/b/pkg-c.md'
    );
  });
});

// ============================================================================
// generatePrefixedLeafPath — dedup rule
// ============================================================================

describe('generatePrefixedLeafPath — dedup rule', () => {
  it('skips prefix when leaf name matches slug', () => {
    assert.equal(
      generatePrefixedLeafPath('rules/code-review.md', 'code-review', 'rules/**'),
      'rules/code-review.md'
    );
  });

  it('skips prefix for single-segment path when name matches slug', () => {
    assert.equal(
      generatePrefixedLeafPath('acme.md', 'acme', undefined),
      'acme.md'
    );
  });
});

// ============================================================================
// generatePrefixedLeafPath — marker-based (skill directory) prefixing
// ============================================================================

describe('generatePrefixedLeafPath — marker-based resources', () => {
  it('prefixes parent directory for SKILL.md marker file', () => {
    assert.equal(
      generatePrefixedLeafPath('commands/review/SKILL.md', 'pkg-a', 'commands/**'),
      'commands/pkg-a-review/SKILL.md'
    );
  });

  it('dedup rule: skips prefix when dir name matches slug for SKILL.md', () => {
    assert.equal(
      generatePrefixedLeafPath('commands/pkg-a/SKILL.md', 'pkg-a', 'commands/**'),
      'commands/pkg-a/SKILL.md'
    );
  });
});

// ============================================================================
// generatePrefixedLeafPath — literal pattern
// ============================================================================

describe('generatePrefixedLeafPath — literal pattern', () => {
  it('handles a literal (no-glob) flow pattern', () => {
    assert.equal(
      generatePrefixedLeafPath('rules/foo.mdc', 'acme', 'rules/foo.mdc'),
      'rules/acme-foo.mdc'
    );
  });
});

// ============================================================================
// generatePrefixedLeafPath — edge cases
// ============================================================================

describe('generatePrefixedLeafPath — edge cases', () => {
  it('handles path with no extension', () => {
    const result = generatePrefixedLeafPath('rules/Makefile', 'acme', 'rules/**');
    assert.equal(result, 'rules/acme-Makefile');
  });

  it('handles backslash normalization', () => {
    assert.equal(
      generatePrefixedLeafPath('rules\\foo.mdc', 'acme', 'rules/**'),
      'rules/acme-foo.mdc'
    );
  });
});
