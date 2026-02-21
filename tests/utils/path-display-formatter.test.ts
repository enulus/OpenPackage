import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'path';
import os from 'os';
import { formatPathForDisplay } from '../../src/utils/formatters.js';

describe('formatPathForDisplay', () => {
  const homeDir = os.homedir();
  const mockCwd = '/Users/testuser/workspace';

  test('should return tilde notation for paths under ~/.openpackage/', () => {
    const path = join(homeDir, '.openpackage', 'packages', 'my-pkg');
    const result = formatPathForDisplay(path, mockCwd);
    assert.strictEqual(result, '~/.openpackage/packages/my-pkg');
  });

  test('should return tilde notation for global package paths', () => {
    const path = join(homeDir, '.openpackage', 'packages', 'global-pkg', '0.1.0');
    const result = formatPathForDisplay(path, mockCwd);
    assert.strictEqual(result, '~/.openpackage/packages/global-pkg/0.1.0');
  });

  test('should return relative path for paths within cwd', () => {
    const path = join(mockCwd, 'file.txt');
    const result = formatPathForDisplay(path, mockCwd);
    assert.strictEqual(result, 'file.txt');
  });

  test('should return relative path for nested files within cwd', () => {
    const path = join(mockCwd, '.openpackage', 'packages', 'local-pkg');
    const result = formatPathForDisplay(path, mockCwd);
    assert.strictEqual(result, '.openpackage/packages/local-pkg');
  });

  test('should return as-is for already relative paths', () => {
    const result = formatPathForDisplay('./relative/path.txt', mockCwd);
    assert.strictEqual(result, './relative/path.txt');
  });

  test('should return as-is for paths already in tilde notation', () => {
    const result = formatPathForDisplay('~/.openpackage/packages/test', mockCwd);
    assert.strictEqual(result, '~/.openpackage/packages/test');
  });

  test('should return absolute path when outside cwd and not under home', () => {
    const path = '/opt/some/other/path';
    const result = formatPathForDisplay(path, mockCwd);
    // Should fall back to absolute since it's not under cwd or home
    assert.strictEqual(result, '/opt/some/other/path');
  });

  test('should handle paths that go up from cwd with ..', () => {
    const path = join(mockCwd, '..', 'other-workspace', 'file.txt');
    const result = formatPathForDisplay(path, mockCwd);
    // Should not use relative path since it starts with ..
    // Falls back to absolute
    assert.match(result, /other-workspace/);
  });

  test('should use cwd from process.cwd() when not provided', () => {
    const actualCwd = process.cwd();
    const path = join(actualCwd, 'test.txt');
    const result = formatPathForDisplay(path);
    assert.strictEqual(result, 'test.txt');
  });
});
