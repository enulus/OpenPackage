import { describe, test, expect } from '@jest/globals';
import { join } from 'path';
import os from 'os';
import { formatPathForDisplay } from '../src/utils/formatters.js';

describe('formatPathForDisplay', () => {
  const homeDir = os.homedir();
  const mockCwd = '/Users/testuser/workspace';

  test('should return tilde notation for paths under ~/.openpackage/', () => {
    const path = join(homeDir, '.openpackage', 'packages', 'my-pkg');
    const result = formatPathForDisplay(path, mockCwd);
    expect(result).toBe('~/.openpackage/packages/my-pkg');
  });

  test('should return tilde notation for global package paths', () => {
    const path = join(homeDir, '.openpackage', 'packages', 'global-pkg', '0.1.0');
    const result = formatPathForDisplay(path, mockCwd);
    expect(result).toBe('~/.openpackage/packages/global-pkg/0.1.0');
  });

  test('should return relative path for paths within cwd', () => {
    const path = join(mockCwd, 'file.txt');
    const result = formatPathForDisplay(path, mockCwd);
    expect(result).toBe('file.txt');
  });

  test('should return relative path for nested files within cwd', () => {
    const path = join(mockCwd, '.openpackage', 'packages', 'local-pkg');
    const result = formatPathForDisplay(path, mockCwd);
    expect(result).toBe('.openpackage/packages/local-pkg');
  });

  test('should return as-is for already relative paths', () => {
    const result = formatPathForDisplay('./relative/path.txt', mockCwd);
    expect(result).toBe('./relative/path.txt');
  });

  test('should return as-is for paths already in tilde notation', () => {
    const result = formatPathForDisplay('~/.openpackage/packages/test', mockCwd);
    expect(result).toBe('~/.openpackage/packages/test');
  });

  test('should return absolute path when outside cwd and not under home', () => {
    const path = '/opt/some/other/path';
    const result = formatPathForDisplay(path, mockCwd);
    // Should fall back to absolute since it's not under cwd or home
    expect(result).toBe('/opt/some/other/path');
  });

  test('should handle paths that go up from cwd with ..', () => {
    const path = join(mockCwd, '..', 'other-workspace', 'file.txt');
    const result = formatPathForDisplay(path, mockCwd);
    // Should not use relative path since it starts with ..
    // Falls back to absolute
    expect(result).toMatch(/other-workspace/);
  });

  test('should use cwd from process.cwd() when not provided', () => {
    const actualCwd = process.cwd();
    const path = join(actualCwd, 'test.txt');
    const result = formatPathForDisplay(path);
    expect(result).toBe('test.txt');
  });
});
