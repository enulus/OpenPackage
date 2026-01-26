import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validatePackageName, normalizePackageNameForLookup } from '../../../src/utils/package-name.js';

describe('Package Name Validation', () => {
  describe('validatePackageName - strict validation but flexible format', () => {
    it('should accept new format with /p/ spacer', () => {
      assert.doesNotThrow(() => {
        validatePackageName('gh@anthropics/claude-code/p/commit-commands');
      });
    });

    it('should accept legacy format without /p/ spacer', () => {
      assert.doesNotThrow(() => {
        validatePackageName('gh@anthropics/claude-code/commit-commands');
      });
    });

    it('should accept standalone repo format', () => {
      assert.doesNotThrow(() => {
        validatePackageName('gh@anthropics/claude-code');
      });
    });

    it('should accept multi-segment plugin paths with /p/', () => {
      assert.doesNotThrow(() => {
        validatePackageName('gh@user/repo/p/nested/path/plugin');
      });
    });

    it('should accept multi-segment plugin paths without /p/ (legacy)', () => {
      assert.doesNotThrow(() => {
        validatePackageName('gh@user/repo/nested/path/plugin');
      });
    });

    it('should accept old @ format for backward compatibility', () => {
      assert.doesNotThrow(() => {
        validatePackageName('@anthropics/claude-code');
        validatePackageName('@anthropics/claude-code/plugin');
      });
    });

    it('should enforce lowercase requirement', () => {
      assert.throws(() => validatePackageName('gh@user/repo/UPPERCASE'), /must be lowercase/);
      assert.throws(() => validatePackageName('Package-With-Uppercase'), /must be lowercase/);
    });

    it('should enforce first character restrictions', () => {
      assert.throws(() => validatePackageName('gh@user/repo/123-starts-with-number'), /cannot start with/);
      assert.throws(() => validatePackageName('gh@user/repo/.starts-with-dot'), /cannot start with/);
    });

    it('should enforce no consecutive special characters', () => {
      assert.throws(() => validatePackageName('gh@user/repo/has__double'), /consecutive/);
      assert.throws(() => validatePackageName('gh@user/repo/has--double'), /consecutive/);
    });

    it('should reject malformed GitHub names', () => {
      assert.throws(() => validatePackageName('gh@'), /invalid GitHub format/);
      assert.throws(() => validatePackageName('gh@/'), /invalid GitHub format/);
      assert.throws(() => validatePackageName('gh@user'), /invalid GitHub format/);
    });

    it('should reject malformed scoped names', () => {
      assert.throws(() => validatePackageName('@'), /invalid scoped format/);
      assert.throws(() => validatePackageName('@/'), /invalid scoped format/);
      assert.throws(() => validatePackageName('@scope'), /invalid scoped format/);
    });

    it('should reject empty names and names with leading/trailing spaces', () => {
      assert.throws(() => validatePackageName(''), /cannot be empty/);
      assert.throws(() => validatePackageName('  space'), /leading or trailing spaces/);
      assert.throws(() => validatePackageName('space  '), /leading or trailing spaces/);
    });
  });

  describe('normalizePackageNameForLookup', () => {
    it('should preserve new format with /p/', () => {
      const normalized = normalizePackageNameForLookup('gh@anthropics/claude-code/p/commit-commands');
      assert.strictEqual(normalized, 'gh@anthropics/claude-code/p/commit-commands');
    });

    it('should preserve legacy format without /p/', () => {
      const normalized = normalizePackageNameForLookup('gh@anthropics/claude-code/commit-commands');
      assert.strictEqual(normalized, 'gh@anthropics/claude-code/commit-commands');
    });

    it('should convert old @ format with plugin to new format with /p/', () => {
      const normalized = normalizePackageNameForLookup('@anthropics/claude-code/commit-commands');
      assert.strictEqual(normalized, 'gh@anthropics/claude-code/p/commit-commands');
    });

    it('should convert old @ format standalone to new format', () => {
      const normalized = normalizePackageNameForLookup('@anthropics/claude-code');
      assert.strictEqual(normalized, 'gh@anthropics/claude-code');
    });

    it('should handle case-insensitive normalization', () => {
      const normalized = normalizePackageNameForLookup('GH@Anthropics/Claude-Code/P/Plugin');
      assert.strictEqual(normalized, 'gh@anthropics/claude-code/p/plugin');
    });
  });

  describe('normalizePackageNameForLookup scenarios', () => {
    it('should normalize all formats for workspace lookup', () => {
      const testCases = [
        {
          input: 'gh@anthropics/claude-code/p/commit-commands',
          expected: 'gh@anthropics/claude-code/p/commit-commands'
        },
        {
          input: 'gh@anthropics/claude-code/commit-commands',
          expected: 'gh@anthropics/claude-code/commit-commands'
        },
        {
          input: '@anthropics/claude-code/commit-commands',
          expected: 'gh@anthropics/claude-code/p/commit-commands'
        },
        {
          input: 'gh@anthropics/claude-code',
          expected: 'gh@anthropics/claude-code'
        },
        {
          input: '@anthropics/claude-code',
          expected: 'gh@anthropics/claude-code'
        },
        // Uppercase is normalized
        {
          input: 'GH@Anthropics/Claude-Code/P/Plugin',
          expected: 'gh@anthropics/claude-code/p/plugin'
        },
      ];

      testCases.forEach(({ input, expected }) => {
        const normalized = normalizePackageNameForLookup(input);
        assert.strictEqual(normalized, expected, `Failed for input: ${input}`);
      });
    });
  });
});
