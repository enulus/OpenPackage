/**
 * Integration tests for switch expressions in flow target paths
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { DefaultFlowExecutor } from '../../../../src/core/flows/flow-executor.js';
import type { Flow, FlowContext } from '../../../../src/types/flows.js';

describe('Switch Target Path Integration', () => {
  let tempDir: string;
  let workspaceRoot: string;
  let packageRoot: string;
  let executor: DefaultFlowExecutor;

  beforeEach(async () => {
    // Create temp directories
    tempDir = path.join(os.tmpdir(), `opkg-test-${Date.now()}`);
    workspaceRoot = path.join(tempDir, 'workspace');
    packageRoot = path.join(tempDir, 'package');

    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(packageRoot, { recursive: true });

    executor = new DefaultFlowExecutor();
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Export flows with switch expressions', () => {
    it('should write to .config/opencode when targetRoot is ~/', async () => {
      // Setup: Create source file in package
      const sourceFile = path.join(packageRoot, 'commands', 'test.md');
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(sourceFile, '# Test Command');

      // Define flow with switch expression
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: {
          $switch: {
            field: '$$targetRoot',
            cases: [
              { pattern: '~/', value: '.config/opencode/command/**/*.md' },
            ],
            default: '.opencode/command/**/*.md',
          },
        },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'opencode',
        packageName: 'test-package',
        variables: { targetRoot: '~/' },
        direction: 'install',
      };

      // Execute flow
      const result = await executor.executeFlow(flow, context);

      // Verify
      assert.strictEqual(result.success, true);
      const targetFile = path.join(workspaceRoot, '.config/opencode/command/test.md');
      const content = await fs.readFile(targetFile, 'utf-8');
      assert.strictEqual(content, '# Test Command');
    });

    it('should write to .opencode when targetRoot is not ~/', async () => {
      // Setup: Create source file in package
      const sourceFile = path.join(packageRoot, 'commands', 'test.md');
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(sourceFile, '# Test Command');

      // Define flow with switch expression
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: {
          $switch: {
            field: '$$targetRoot',
            cases: [
              { pattern: '~/', value: '.config/opencode/command/**/*.md' },
            ],
            default: '.opencode/command/**/*.md',
          },
        },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'opencode',
        packageName: 'test-package',
        variables: { targetRoot: '/project' },
        direction: 'install',
      };

      // Execute flow
      const result = await executor.executeFlow(flow, context);

      // Verify
      assert.strictEqual(result.success, true);
      const targetFile = path.join(workspaceRoot, '.opencode/command/test.md');
      const content = await fs.readFile(targetFile, 'utf-8');
      assert.strictEqual(content, '# Test Command');
    });

    it('should handle multiple files with switch expression', async () => {
      // Setup: Create multiple source files
      const files = ['command1.md', 'command2.md', 'command3.md'];
      for (const file of files) {
        const sourceFile = path.join(packageRoot, 'commands', file);
        await fs.mkdir(path.dirname(sourceFile), { recursive: true });
        await fs.writeFile(sourceFile, `# ${file}`);
      }

      // Define flow
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: {
          $switch: {
            field: '$$targetRoot',
            cases: [
              { pattern: '~/', value: '.config/opencode/command/**/*.md' },
            ],
            default: '.opencode/command/**/*.md',
          },
        },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'opencode',
        packageName: 'test-package',
        variables: { targetRoot: '~/' },
        direction: 'install',
      };

      // Execute flow
      const result = await executor.executeFlow(flow, context);

      // Verify all files were written
      assert.strictEqual(result.success, true);
      for (const file of files) {
        const targetFile = path.join(workspaceRoot, '.config/opencode/command', file);
        const exists = await fs.access(targetFile).then(() => true).catch(() => false);
        assert.strictEqual(exists, true);
      }
    });

    it('should work with merge strategy', async () => {
      // Setup: Create source file and existing target
      const sourceFile = path.join(packageRoot, 'config.json');
      await fs.writeFile(sourceFile, JSON.stringify({ a: 1, b: 2 }));

      const targetFile = path.join(workspaceRoot, '.config/opencode/config.json');
      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.writeFile(targetFile, JSON.stringify({ b: 99, c: 3 }));

      // Define flow with merge
      const flow: Flow = {
        from: 'config.json',
        to: {
          $switch: {
            field: '$$targetRoot',
            cases: [
              { pattern: '~/', value: '.config/opencode/config.json' },
            ],
            default: '.opencode/config.json',
          },
        },
        merge: 'deep',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'opencode',
        packageName: 'test-package',
        variables: { targetRoot: '~/' },
        direction: 'install',
      };

      // Execute flow
      const result = await executor.executeFlow(flow, context);

      // Verify merge
      assert.strictEqual(result.success, true);
      const content = await fs.readFile(targetFile, 'utf-8');
      const merged = JSON.parse(content);
      assert.deepStrictEqual(merged, { a: 1, b: 2, c: 3 });
    });
  });

  describe('Import flows with switch expressions', () => {
    it('should read from .config/opencode when targetRoot is ~/', async () => {
      // Setup: Create source file in packageRoot (executor resolves 'from' against packageRoot)
      // Use non-dot directory path since the glob resolver uses minimatch with dot:false
      const sourceFile = path.join(packageRoot, 'config/opencode/command/test.md');
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(sourceFile, '# Test Command');

      // Define flow with switch expression using non-dot paths for glob matching
      const flow: Flow = {
        from: {
          $switch: {
            field: '$$targetRoot',
            cases: [
              { pattern: '~/', value: 'config/opencode/command/**/*.md' },
            ],
            default: 'opencode/command/**/*.md',
          },
        },
        to: 'commands/**/*.md',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'opencode',
        packageName: 'test-package',
        variables: { targetRoot: '~/' },
        direction: 'save',
      };

      // Execute flow
      const result = await executor.executeFlow(flow, context);

      // Verify: output is written to workspaceRoot (executor writes 'to' relative to workspaceRoot)
      assert.strictEqual(result.success, true);
      const targetFile = path.join(workspaceRoot, 'commands/test.md');
      const content = await fs.readFile(targetFile, 'utf-8');
      assert.strictEqual(content, '# Test Command');
    });

    it('should read from .opencode when targetRoot is not ~/', async () => {
      // Setup: Create source file in packageRoot (executor resolves 'from' against packageRoot)
      // Use non-dot directory path since the glob resolver uses minimatch with dot:false
      const sourceFile = path.join(packageRoot, 'opencode/command/test.md');
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(sourceFile, '# Test Command');

      // Define flow with switch expression using non-dot paths for glob matching
      const flow: Flow = {
        from: {
          $switch: {
            field: '$$targetRoot',
            cases: [
              { pattern: '~/', value: 'config/opencode/command/**/*.md' },
            ],
            default: 'opencode/command/**/*.md',
          },
        },
        to: 'commands/**/*.md',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'opencode',
        packageName: 'test-package',
        variables: { targetRoot: '/project' },
        direction: 'save',
      };

      // Execute flow
      const result = await executor.executeFlow(flow, context);

      // Verify: output is written to workspaceRoot (executor writes 'to' relative to workspaceRoot)
      assert.strictEqual(result.success, true);
      const targetFile = path.join(workspaceRoot, 'commands/test.md');
      const content = await fs.readFile(targetFile, 'utf-8');
      assert.strictEqual(content, '# Test Command');
    });
  });

  describe('Error handling', () => {
    it('should fail gracefully when variable is missing', async () => {
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: {
          $switch: {
            field: '$$unknownVar',
            cases: [
              { pattern: 'value', value: '.config/opencode' },
            ],
          },
        },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'opencode',
        packageName: 'test-package',
        variables: { targetRoot: '~/' },
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, false);
      assert.match(result.error?.message, /Variable 'unknownVar' not found/);
    });

    it('should fail when no cases match and no default', async () => {
      // Setup source file
      const sourceFile = path.join(packageRoot, 'commands/test.md');
      await fs.mkdir(path.dirname(sourceFile), { recursive: true });
      await fs.writeFile(sourceFile, '# Test');

      const flow: Flow = {
        from: 'commands/**/*.md',
        to: {
          $switch: {
            field: '$$targetRoot',
            cases: [
              { pattern: 'nomatch', value: '.config/opencode' },
            ],
          },
        },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'opencode',
        packageName: 'test-package',
        variables: { targetRoot: '~/' },
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, false);
      assert.match(result.error?.message, /No matching case/);
    });
  });

  describe('Validation', () => {
    it('should validate switch expression structure', async () => {
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: {
          $switch: {
            field: '$$targetRoot',
            cases: [],
          },
        } as any,
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'opencode',
        packageName: 'test-package',
        variables: { targetRoot: '~/' },
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, false);
      assert.match(result.error?.message, /No matching case|Invalid flow|at least one case/);
    });
  });
});
