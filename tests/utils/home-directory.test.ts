/**
 * Tests for home directory utilities
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { 
  getHomeDirectory, 
  isHomeDirectory, 
  normalizePathWithTilde, 
  expandTilde 
} from '../../src/utils/home-directory.js';
import { homedir } from 'os';
import { join, resolve } from 'path';

describe('Home Directory Utilities', () => {
  describe('getHomeDirectory', () => {
    it('should return the home directory path', () => {
      const home = getHomeDirectory();
      assert.strictEqual(home, homedir());
      assert.ok(home);
    });
  });

  describe('isHomeDirectory', () => {
    it('should return true for home directory', () => {
      const home = getHomeDirectory();
      assert.strictEqual(isHomeDirectory(home), true);
    });

    it('should return true for home directory with trailing slash', () => {
      const home = getHomeDirectory();
      assert.strictEqual(isHomeDirectory(home + '/'), true);
    });

    it('should return false for non-home directory', () => {
      assert.strictEqual(isHomeDirectory('/tmp'), false);
      assert.strictEqual(isHomeDirectory('/usr/local'), false);
    });

    it('should return false for subdirectory of home', () => {
      const home = getHomeDirectory();
      const subdir = join(home, 'Documents');
      assert.strictEqual(isHomeDirectory(subdir), false);
    });
  });

  describe('normalizePathWithTilde', () => {
    it('should convert home directory to ~/', () => {
      const home = getHomeDirectory();
      assert.strictEqual(normalizePathWithTilde(home), '~/');
    });

    it('should convert home subdirectory to ~/subdir', () => {
      const home = getHomeDirectory();
      const subdir = join(home, 'Documents');
      assert.strictEqual(normalizePathWithTilde(subdir), '~/Documents');
    });

    it('should convert nested home subdirectory to ~/path/to/dir', () => {
      const home = getHomeDirectory();
      const nested = join(home, 'Documents', 'Projects', 'myapp');
      assert.strictEqual(normalizePathWithTilde(nested), '~/Documents/Projects/myapp');
    });

    it('should leave non-home paths unchanged', () => {
      const tmpPath = resolve('/tmp/test');
      assert.strictEqual(normalizePathWithTilde(tmpPath), tmpPath);
    });
  });

  describe('expandTilde', () => {
    it('should expand ~ to home directory', () => {
      const home = getHomeDirectory();
      assert.strictEqual(expandTilde('~'), home);
    });

    it('should expand ~/ to home directory', () => {
      const home = getHomeDirectory();
      assert.strictEqual(expandTilde('~/'), home);
    });

    it('should expand ~/subdir to home/subdir', () => {
      const home = getHomeDirectory();
      const expected = resolve(home, 'Documents');
      assert.strictEqual(expandTilde('~/Documents'), expected);
    });

    it('should expand nested ~/path/to/dir correctly', () => {
      const home = getHomeDirectory();
      const expected = resolve(home, 'Documents/Projects/myapp');
      assert.strictEqual(expandTilde('~/Documents/Projects/myapp'), expected);
    });

    it('should leave non-tilde paths unchanged', () => {
      assert.strictEqual(expandTilde('/tmp/test'), '/tmp/test');
      assert.strictEqual(expandTilde('./relative'), './relative');
    });
  });

  describe('round-trip conversion', () => {
    it('should correctly round-trip home directory', () => {
      const home = getHomeDirectory();
      const withTilde = normalizePathWithTilde(home);
      const expanded = expandTilde(withTilde);
      assert.strictEqual(expanded, home);
    });

    it('should correctly round-trip home subdirectory', () => {
      const home = getHomeDirectory();
      const subdir = join(home, 'Documents', 'test');
      const withTilde = normalizePathWithTilde(subdir);
      const expanded = expandTilde(withTilde);
      assert.strictEqual(expanded, subdir);
    });
  });
});
