/**
 * Tests for ExecutionContext module
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionContext, getContextVariables, getDisplayTargetDir } from '../../src/core/execution-context.js';
import { getHomeDirectory } from '../../src/utils/home-directory.js';
import { mkdir, rm } from 'fs/promises';
import { realpathSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ExecutionContext', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // Save original cwd
    originalCwd = process.cwd();
    
    // Create test directory
    testDir = join(tmpdir(), `opkg-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    
    // Resolve real path (handles /private on macOS)
    testDir = realpathSync(testDir);
    
    // Change to test directory
    process.chdir(testDir);
  });

  afterEach(async () => {
    // Restore original cwd
    process.chdir(originalCwd);
    
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('createExecutionContext', () => {
    it('should create default context with no flags', async () => {
      const context = await createExecutionContext({});
      
      assert.strictEqual(context.sourceCwd, testDir);
      assert.strictEqual(context.targetDir, testDir);
      assert.strictEqual(context.isGlobal, false);
    });

    it('should create global context with --global flag', async () => {
      const homeDir = getHomeDirectory();
      const context = await createExecutionContext({ global: true });
      
      assert.strictEqual(context.sourceCwd, testDir);
      assert.strictEqual(context.targetDir, homeDir);
      assert.strictEqual(context.isGlobal, true);
    });

    it('should create context with --cwd flag', async () => {
      const targetDir = join(testDir, 'subdir');
      await mkdir(targetDir, { recursive: true });
      
      const context = await createExecutionContext({ cwd: 'subdir' });
      
      assert.strictEqual(context.sourceCwd, testDir);
      assert.strictEqual(context.targetDir, targetDir);
      assert.strictEqual(context.isGlobal, false);
    });

    it('should prioritize --global over --cwd', async () => {
      const homeDir = getHomeDirectory();
      const targetDir = join(testDir, 'subdir');
      await mkdir(targetDir, { recursive: true });
      
      const context = await createExecutionContext({ 
        global: true, 
        cwd: 'subdir' 
      });
      
      assert.strictEqual(context.sourceCwd, testDir);
      assert.strictEqual(context.targetDir, homeDir);
      assert.strictEqual(context.isGlobal, true);
    });

    it('should throw error for nonexistent target directory', async () => {
      await assert.rejects(
        () => createExecutionContext({ cwd: '/nonexistent/directory/path' }),
        { message: /Target directory does not exist/ }
      );
    });

    it('should throw error if target is a file', async () => {
      // Create a file
      const filePath = join(testDir, 'somefile.txt');
      const fs = await import('fs/promises');
      await fs.writeFile(filePath, 'test');
      
      await assert.rejects(
        () => createExecutionContext({ cwd: filePath }),
        { message: /not a directory/ }
      );
    });
  });

  describe('getContextVariables', () => {
    it('should generate context variables for default context', async () => {
      const context = await createExecutionContext({});
      const variables = getContextVariables(context);
      
      assert.strictEqual(variables.$$sourceCwd, testDir);
      assert.strictEqual(variables.$$targetRoot, testDir);
      assert.strictEqual(variables.$$isGlobal, false);
    });

    it('should generate context variables with tilde for home directory', async () => {
      const context = await createExecutionContext({ global: true });
      const variables = getContextVariables(context);
      
      assert.strictEqual(variables.$$sourceCwd, testDir);
      assert.strictEqual(variables.$$targetRoot, '~/');
      assert.strictEqual(variables.$$isGlobal, true);
    });
  });

  describe('getDisplayTargetDir', () => {
    it('should return path as-is for non-home directory', async () => {
      const context = await createExecutionContext({});
      const display = getDisplayTargetDir(context);
      
      assert.strictEqual(display, testDir);
    });

    it('should return ~/ for home directory', async () => {
      const context = await createExecutionContext({ global: true });
      const display = getDisplayTargetDir(context);
      
      assert.strictEqual(display, '~/');
    });
  });
});
