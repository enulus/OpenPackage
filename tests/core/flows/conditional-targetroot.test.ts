/**
 * Tests for conditional flows based on $$targetRoot variable
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir, homedir } from 'os';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { DefaultFlowExecutor } from '../../../src/core/flows/flow-executor.js';
import type { Flow, FlowContext } from '../../../src/types/flows.js';

describe('conditional-targetroot', () => {
  let tempDir: string;
  let packageRoot: string;
  let workspaceRoot: string;
  let executor: DefaultFlowExecutor;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-conditional-test-'));
    packageRoot = join(tempDir, 'package');
    workspaceRoot = join(tempDir, 'workspace');
    
    await mkdir(packageRoot, { recursive: true });
    await mkdir(workspaceRoot, { recursive: true });
    
    executor = new DefaultFlowExecutor();
  });

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('$$targetRoot variable resolution', () => {
    it('should resolve $$targetRoot to workspaceRoot', async () => {
      // Create source file
      const sourceFile = join(packageRoot, 'config.json');
      await writeFile(sourceFile, JSON.stringify({ setting: 'value' }));

      // Flow that copies to different locations based on targetRoot
      const flow: Flow = {
        from: 'config.json',
        to: 'output.json',
        when: {
          $eq: ['$$targetRoot', workspaceRoot]
        }
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          targetRoot: workspaceRoot
        }
      };

      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, false); // No transformation, just copy
    });

    it('should skip flow when $$targetRoot condition does not match', async () => {
      // Create source file
      const sourceFile = join(packageRoot, 'config.json');
      await writeFile(sourceFile, JSON.stringify({ setting: 'value' }));

      // Flow with condition that won't match
      const flow: Flow = {
        from: 'config.json',
        to: 'output.json',
        when: {
          $eq: ['$$targetRoot', '/different/path']
        }
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          targetRoot: workspaceRoot
        }
      };

      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.ok(result.warnings.includes('Flow skipped due to condition'));
    });
  });

  describe('tilde expansion in conditions', () => {
    it('should match home directory with ~/', async () => {
      const homeDir = homedir();
      
      // Create source file
      const sourceFile = join(packageRoot, 'config.json');
      await writeFile(sourceFile, JSON.stringify({ setting: 'value' }));

      // Flow that only runs when installing to home directory
      const flow: Flow = {
        from: 'config.json',
        to: 'output.json',
        when: {
          $eq: ['$$targetRoot', '~/']
        }
      };

      const context: FlowContext = {
        workspaceRoot: homeDir,
        packageRoot,
        platform: 'test',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          targetRoot: homeDir
        }
      };

      const result = await executor.executeFlow(flow, context);
      
      // Should match because workspaceRoot equals expanded ~/
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.warnings, undefined);
    });

    it('should not match workspace directory with ~/', async () => {
      const homeDir = homedir();
      
      // Create source file
      const sourceFile = join(packageRoot, 'config.json');
      await writeFile(sourceFile, JSON.stringify({ setting: 'value' }));

      // Flow that only runs when installing to home directory
      const flow: Flow = {
        from: 'config.json',
        to: 'output.json',
        when: {
          $eq: ['$$targetRoot', '~/']
        }
      };

      const context: FlowContext = {
        workspaceRoot: join(homeDir, 'workspace'),  // NOT home dir
        packageRoot,
        platform: 'test',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          targetRoot: join(homeDir, 'workspace')
        }
      };

      const result = await executor.executeFlow(flow, context);
      
      // Should skip because workspaceRoot is not home directory
      assert.strictEqual(result.success, true);
      assert.ok(result.warnings.includes('Flow skipped due to condition'));
    });
  });

  describe('$ne (not equals) conditions', () => {
    it('should execute flow when $$targetRoot is NOT home directory', async () => {
      const homeDir = homedir();
      
      // Create source file
      const sourceFile = join(packageRoot, 'config.json');
      await writeFile(sourceFile, JSON.stringify({ setting: 'value' }));

      // Flow that runs when NOT installing to home directory
      const flow: Flow = {
        from: 'config.json',
        to: 'output.json',
        when: {
          $ne: ['$$targetRoot', '~/']
        }
      };

      const context: FlowContext = {
        workspaceRoot,  // Not home dir
        packageRoot,
        platform: 'test',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          targetRoot: workspaceRoot
        }
      };

      const result = await executor.executeFlow(flow, context);
      
      // Should execute because workspaceRoot is not home directory
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.warnings, undefined);
    });

    it('should skip flow when $ne condition matches', async () => {
      const homeDir = homedir();
      
      // Create source file
      const sourceFile = join(packageRoot, 'config.json');
      await writeFile(sourceFile, JSON.stringify({ setting: 'value' }));

      // Flow that runs when NOT installing to home directory
      const flow: Flow = {
        from: 'config.json',
        to: 'output.json',
        when: {
          $ne: ['$$targetRoot', '~/']
        }
      };

      const context: FlowContext = {
        workspaceRoot: homeDir,  // IS home dir
        packageRoot,
        platform: 'test',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          targetRoot: homeDir
        }
      };

      const result = await executor.executeFlow(flow, context);
      
      // Should skip because workspaceRoot IS home directory
      assert.strictEqual(result.success, true);
      assert.ok(result.warnings.includes('Flow skipped due to condition'));
    });
  });

  describe('glob pattern matching in conditions', () => {
    it('should match paths with glob patterns', async () => {
      // Create source file
      const sourceFile = join(packageRoot, 'config.json');
      await writeFile(sourceFile, JSON.stringify({ setting: 'value' }));

      // Flow that matches /tmp/* paths
      const flow: Flow = {
        from: 'config.json',
        to: 'output.json',
        when: {
          $eq: ['$$targetRoot', '/tmp/*']
        }
      };

      const context: FlowContext = {
        workspaceRoot: '/tmp/test-workspace',
        packageRoot,
        platform: 'test',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          targetRoot: '/tmp/test-workspace'
        }
      };

      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.warnings, undefined);
    });
  });

  describe('multi-target flows with conditions', () => {
    it('should route to different targets based on $$targetRoot', async () => {
      const homeDir = homedir();
      
      // Create source file
      const sourceFile = join(packageRoot, 'mcp.json');
      await writeFile(sourceFile, JSON.stringify({ servers: {} }));

      // Simulate Claude platform behavior:
      // - In workspace: write to .mcp.json
      // - In home dir: write to .claude.json
      
      // Test workspace installation
      const workspaceFlow: Flow = {
        from: 'mcp.json',
        to: '.mcp.json',
        when: {
          $ne: ['$$targetRoot', '~/']
        }
      };

      const workspaceContext: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'claude',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          targetRoot: workspaceRoot
        }
      };

      const workspaceResult = await executor.executeFlow(workspaceFlow, workspaceContext);
      assert.strictEqual(workspaceResult.success, true);
      assert.strictEqual(workspaceResult.warnings, undefined);

      // Test global installation
      const globalFlow: Flow = {
        from: 'mcp.json',
        to: '.claude.json',
        when: {
          $eq: ['$$targetRoot', '~/']
        }
      };

      const globalContext: FlowContext = {
        workspaceRoot: homeDir,
        packageRoot,
        platform: 'claude',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          targetRoot: homeDir
        }
      };

      const globalResult = await executor.executeFlow(globalFlow, globalContext);
      assert.strictEqual(globalResult.success, true);
      assert.strictEqual(globalResult.warnings, undefined);
    });
  });
});
