/**
 * Tests for path comparison utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'os';
import * as path from 'path';
import {
  isPathLike,
  expandTilde,
  hasGlobChars,
  comparePathsWithGlobSupport,
  smartEquals,
  smartNotEquals
} from '../../src/utils/path-comparison.js';

describe('path-comparison', () => {
  const originalHomedir = os.homedir();

  describe('isPathLike', () => {
    it('should detect Unix-style paths', () => {
      assert.strictEqual(isPathLike('/usr/local/bin'), true);
      assert.strictEqual(isPathLike('./relative/path'), true);
      assert.strictEqual(isPathLike('../parent/path'), true);
    });

    it('should detect tilde paths', () => {
      assert.strictEqual(isPathLike('~/'), true);
      assert.strictEqual(isPathLike('~/Documents'), true);
    });

    it('should detect Windows-style paths', () => {
      assert.strictEqual(isPathLike('C:\\Windows\\System32'), true);
      assert.strictEqual(isPathLike('D:\\Projects'), true);
    });

    it('should return false for non-path strings', () => {
      assert.strictEqual(isPathLike('hello'), false);
      assert.strictEqual(isPathLike('my-package'), false);
      assert.strictEqual(isPathLike('123'), false);
      assert.strictEqual(isPathLike(''), false);
    });

    it('should return false for non-strings', () => {
      assert.strictEqual(isPathLike(123), false);
      assert.strictEqual(isPathLike(null), false);
      assert.strictEqual(isPathLike(undefined), false);
      assert.strictEqual(isPathLike({}), false);
    });
  });

  describe('expandTilde', () => {
    it('should expand ~ to home directory', () => {
      assert.strictEqual(expandTilde('~'), originalHomedir);
    });

    it('should expand ~/ paths', () => {
      assert.strictEqual(expandTilde('~/Documents'), path.join(originalHomedir, 'Documents'));
      assert.strictEqual(expandTilde('~/.config'), path.join(originalHomedir, '.config'));
    });

    it('should not modify paths without tilde', () => {
      assert.strictEqual(expandTilde('/usr/local'), '/usr/local');
      assert.strictEqual(expandTilde('./relative'), './relative');
      assert.strictEqual(expandTilde('no-tilde'), 'no-tilde');
    });

    it('should handle empty strings', () => {
      assert.strictEqual(expandTilde(''), '');
    });
  });

  describe('hasGlobChars', () => {
    it('should detect glob patterns', () => {
      assert.strictEqual(hasGlobChars('*.js'), true);
      assert.strictEqual(hasGlobChars('file?.txt'), true);
      assert.strictEqual(hasGlobChars('dir/[abc].md'), true);
      assert.strictEqual(hasGlobChars('path/{a,b,c}'), true);
    });

    it('should return false for non-glob strings', () => {
      assert.strictEqual(hasGlobChars('/usr/local/bin'), false);
      assert.strictEqual(hasGlobChars('~/Documents'), false);
      assert.strictEqual(hasGlobChars('regular-file.txt'), false);
    });
  });

  describe('comparePathsWithGlobSupport', () => {
    it('should match exact paths', () => {
      const testPath = path.join(originalHomedir, 'Documents');
      assert.strictEqual(comparePathsWithGlobSupport(testPath, testPath), true);
    });

    it('should expand and compare tilde paths', () => {
      const expanded = path.join(originalHomedir);
      assert.strictEqual(comparePathsWithGlobSupport(expanded, '~'), true);
      assert.strictEqual(comparePathsWithGlobSupport(expanded, '~/'), true);
    });

    it('should handle path normalization', () => {
      const testPath = '/usr/local/bin';
      assert.strictEqual(comparePathsWithGlobSupport('/usr/local/./bin', testPath), true);
      assert.strictEqual(comparePathsWithGlobSupport('/usr/local/lib/../bin', testPath), true);
    });

    it('should support glob patterns', () => {
      assert.strictEqual(comparePathsWithGlobSupport('/usr/local/bin', '/usr/*/bin'), true);
      assert.strictEqual(comparePathsWithGlobSupport('/usr/local/bin', '/usr/local/*'), true);
      assert.strictEqual(comparePathsWithGlobSupport('/home/user/project', '/home/*/project'), true);
    });

    it('should handle tilde in glob patterns', () => {
      const userDir = path.join(originalHomedir, 'Projects', 'my-app');
      assert.strictEqual(comparePathsWithGlobSupport(userDir, '~/Projects/*'), true);
    });

    it('should return false for non-matching paths', () => {
      assert.strictEqual(comparePathsWithGlobSupport('/usr/local/bin', '/opt/bin'), false);
      assert.strictEqual(comparePathsWithGlobSupport('/home/user1', '/home/user2'), false);
    });

    it('should return false for non-matching glob patterns', () => {
      assert.strictEqual(comparePathsWithGlobSupport('/usr/local/bin', '/opt/*/bin'), false);
      assert.strictEqual(comparePathsWithGlobSupport('/home/user/docs', '/home/*/project'), false);
    });
  });

  describe('smartEquals', () => {
    it('should use path comparison for path-like values', () => {
      const expanded = path.join(originalHomedir);
      assert.strictEqual(smartEquals(expanded, '~'), true);
      assert.strictEqual(smartEquals('~/', expanded), true);
    });

    it('should use standard equality for non-paths', () => {
      assert.strictEqual(smartEquals('hello', 'hello'), true);
      assert.strictEqual(smartEquals('hello', 'world'), false);
      assert.strictEqual(smartEquals(123, 123), true);
      assert.strictEqual(smartEquals(123, 456), false);
    });

    it('should handle mixed types', () => {
      assert.strictEqual(smartEquals('~/Documents', 'hello'), false);
      assert.strictEqual(smartEquals(123, '/path/to/file'), false);
    });

    it('should support glob patterns in path comparison', () => {
      assert.strictEqual(smartEquals('/usr/local/bin', '/usr/*/bin'), true);
      assert.strictEqual(smartEquals('/usr/local/bin', '/opt/*/bin'), false);
    });
  });

  describe('smartNotEquals', () => {
    it('should return opposite of smartEquals', () => {
      const expanded = path.join(originalHomedir);
      assert.strictEqual(smartNotEquals(expanded, '~'), false);
      assert.strictEqual(smartNotEquals('hello', 'world'), true);
      assert.strictEqual(smartNotEquals('/usr/local/bin', '/usr/*/bin'), false);
      assert.strictEqual(smartNotEquals('/usr/local/bin', '/opt/*/bin'), true);
    });
  });

  describe('integration scenarios', () => {
    it('should handle global installation check', () => {
      // Simulate checking if targetRoot is home directory
      const targetRoot = originalHomedir;
      assert.strictEqual(smartEquals(targetRoot, '~/'), true);
      assert.strictEqual(smartEquals(targetRoot, '~'), true);
      assert.strictEqual(smartNotEquals(targetRoot, '~/'), false);
    });

    it('should handle workspace installation check', () => {
      // Simulate checking if targetRoot is NOT home directory
      const targetRoot = '/Users/john/my-project';
      assert.strictEqual(smartNotEquals(targetRoot, '~/'), true);
      assert.strictEqual(smartEquals(targetRoot, '~/'), false);
    });

    it('should handle pattern-based checks', () => {
      // Check if in Projects folder
      const projectPath = '/Users/john/Projects/my-app';
      assert.strictEqual(smartEquals(projectPath, '/Users/*/Projects/*'), true);
      
      // Check if in temp directory
      const tempPath = '/tmp/test-workspace';
      assert.strictEqual(smartEquals(tempPath, '/tmp/*'), true);
    });
  });
});
