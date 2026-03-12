import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseNameWithVersionOverride } from '../../../packages/core/src/utils/name-version-parser.js';

describe('parseNameWithVersionOverride', () => {
  it('parses name@^2.0.0', () => {
    const result = parseNameWithVersionOverride('my-pkg@^2.0.0');
    assert.strictEqual(result.name, 'my-pkg');
    assert.strictEqual(result.versionOverride, '^2.0.0');
  });

  it('parses name@~1.0', () => {
    const result = parseNameWithVersionOverride('my-pkg@~1.0');
    assert.strictEqual(result.name, 'my-pkg');
    assert.strictEqual(result.versionOverride, '~1.0');
  });

  it('parses name@*', () => {
    const result = parseNameWithVersionOverride('my-pkg@*');
    assert.strictEqual(result.name, 'my-pkg');
    assert.strictEqual(result.versionOverride, '*');
  });

  it('parses name@>=1.0.0', () => {
    const result = parseNameWithVersionOverride('my-pkg@>=1.0.0');
    assert.strictEqual(result.name, 'my-pkg');
    assert.strictEqual(result.versionOverride, '>=1.0.0');
  });

  it('parses name@1.0.0 (exact version)', () => {
    const result = parseNameWithVersionOverride('my-pkg@1.0.0');
    assert.strictEqual(result.name, 'my-pkg');
    assert.strictEqual(result.versionOverride, '1.0.0');
  });

  it('returns name only when no @', () => {
    const result = parseNameWithVersionOverride('my-pkg');
    assert.strictEqual(result.name, 'my-pkg');
    assert.strictEqual(result.versionOverride, undefined);
  });

  it('skips gh@ prefixed inputs', () => {
    const result = parseNameWithVersionOverride('gh@owner/repo');
    assert.strictEqual(result.name, 'gh@owner/repo');
    assert.strictEqual(result.versionOverride, undefined);
  });

  it('handles scoped package @scope/pkg (no version)', () => {
    const result = parseNameWithVersionOverride('@scope/pkg');
    assert.strictEqual(result.name, '@scope/pkg');
    assert.strictEqual(result.versionOverride, undefined);
  });

  it('handles scoped package @scope/pkg@^1.0.0', () => {
    const result = parseNameWithVersionOverride('@scope/pkg@^1.0.0');
    assert.strictEqual(result.name, '@scope/pkg');
    assert.strictEqual(result.versionOverride, '^1.0.0');
  });

  it('skips when after-@ contains /', () => {
    const result = parseNameWithVersionOverride('my-pkg@foo/bar');
    assert.strictEqual(result.name, 'my-pkg@foo/bar');
    assert.strictEqual(result.versionOverride, undefined);
  });

  it('skips when after-@ does not look like a version', () => {
    const result = parseNameWithVersionOverride('my-pkg@latest');
    assert.strictEqual(result.name, 'my-pkg@latest');
    assert.strictEqual(result.versionOverride, undefined);
  });
});
