/**
 * Tests for Unified Platform Model implementation
 * 
 * Tests the following features:
 * - $eq and $ne condition operators
 * - $$source and $$platform variables in flow conditions
 * - Detection array for platform identification
 * - claude-plugin as a platform
 */

import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, rm } from 'fs/promises';
import { DefaultFlowExecutor } from '../../../src/core/flows/flow-executor.js';
import { detectPackageFormat } from '../../../src/core/install/format-detector.js';
import { getPlatformDefinition, clearPlatformsCache } from '../../../src/core/platforms.js';
import { writeTextFile, ensureDir } from '../../../src/utils/fs.js';
import type { Flow, FlowContext } from '../../../src/types/flows.js';
import type { PackageFile } from '../../../src/types/index.js';

describe('Unified Platform Model', () => {
  let tempDir: string;
  let workspaceRoot: string;
  let packageRoot: string;

  before(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
    workspaceRoot = join(tempDir, 'workspace');
    packageRoot = join(tempDir, 'package');
    await ensureDir(workspaceRoot);
    await ensureDir(packageRoot);
    clearPlatformsCache();
  });

  after(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  describe('Condition Operators', () => {
    it('should support $eq operator with literal values', async () => {
      const executor = new DefaultFlowExecutor();
      
      const flow: Flow = {
        from: 'test.txt',
        to: 'output.txt',
        when: { $eq: ['value1', 'value1'] }
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'cursor',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {}
      };

      // Create source file
      const sourcePath = join(packageRoot, 'test.txt');
      await writeTextFile(sourcePath, 'test content');

      const result = await executor.executeFlow(flow, context);
      assert.equal(result.success, true);
      assert.ok(!result.warnings || !result.warnings.includes('Flow skipped due to condition'));
    });

    it('should support $eq operator with $$platform variable', async () => {
      const executor = new DefaultFlowExecutor();
      
      const flow: Flow = {
        from: 'test.txt',
        to: 'output.txt',
        when: { $eq: ['$$platform', 'claude'] }
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'claude',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          platform: 'claude'
        }
      };

      // Create source file
      const sourcePath = join(packageRoot, 'test.txt');
      await writeTextFile(sourcePath, 'test content');

      const result = await executor.executeFlow(flow, context);
      assert.equal(result.success, true);
      assert.ok(!result.warnings || !result.warnings.includes('Flow skipped due to condition'));
    });

    it('should skip flow when $eq condition fails', async () => {
      const executor = new DefaultFlowExecutor();
      
      const flow: Flow = {
        from: 'test.txt',
        to: 'output.txt',
        when: { $eq: ['$$platform', 'claude'] }
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'cursor',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          platform: 'cursor'
        }
      };

      // Create source file
      const sourcePath = join(packageRoot, 'test.txt');
      await writeTextFile(sourcePath, 'test content');

      const result = await executor.executeFlow(flow, context);
      assert.equal(result.success, true);
      assert.ok(result.warnings && result.warnings.includes('Flow skipped due to condition'));
    });

    it('should support $ne operator', async () => {
      const executor = new DefaultFlowExecutor();
      
      const flow: Flow = {
        from: 'test.txt',
        to: 'output.txt',
        when: { $ne: ['$$platform', 'claude'] }
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'cursor',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          platform: 'cursor'
        }
      };

      // Create source file
      const sourcePath = join(packageRoot, 'test.txt');
      await writeTextFile(sourcePath, 'test content');

      const result = await executor.executeFlow(flow, context);
      assert.equal(result.success, true);
      assert.ok(!result.warnings || !result.warnings.includes('Flow skipped due to condition'));
    });

    it('should support $$source variable in conditions', async () => {
      const executor = new DefaultFlowExecutor();
      
      const flow: Flow = {
        from: 'test.txt',
        to: 'output.txt',
        when: { $ne: ['$$source', 'claude-plugin'] }
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'cursor',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          platform: 'cursor',
          source: 'openpackage'
        }
      };

      // Create source file
      const sourcePath = join(packageRoot, 'test.txt');
      await writeTextFile(sourcePath, 'test content');

      const result = await executor.executeFlow(flow, context);
      assert.equal(result.success, true);
      assert.ok(!result.warnings || !result.warnings.includes('Flow skipped due to condition'));
    });

    it('should skip flow when $$source equals claude-plugin and target is claude', async () => {
      const executor = new DefaultFlowExecutor();
      
      const flow: Flow = {
        from: 'test.txt',
        to: 'output.txt',
        when: { $ne: ['$$source', 'claude-plugin'] }
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'claude',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          platform: 'claude',
          source: 'claude-plugin'
        }
      };

      // Create source file
      const sourcePath = join(packageRoot, 'test.txt');
      await writeTextFile(sourcePath, 'test content');

      const result = await executor.executeFlow(flow, context);
      assert.equal(result.success, true);
      assert.ok(result.warnings && result.warnings.includes('Flow skipped due to condition'));
    });
  });

  describe('Platform Detection', () => {
    it('should detect claude-plugin platform from manifest file', () => {
      const files: PackageFile[] = [
        {
          path: '.claude-plugin/plugin.json',
          content: JSON.stringify({ name: 'test-plugin', version: '1.0.0' }),
          encoding: 'utf8'
        },
        {
          path: 'commands/test.md',
          content: '# Test Command',
          encoding: 'utf8'
        }
      ];

      const format = detectPackageFormat(files);
      
      assert.equal(format.type, 'platform-specific');
      assert.equal(format.platform, 'claude-plugin');
      assert.equal(format.sourcePlatform, 'claude-plugin');
      assert.equal(format.confidence, 1.0);
    });

    it('should detect universal format without platform indicators', () => {
      const files: PackageFile[] = [
        {
          path: 'commands/test.md',
          content: '# Test Command',
          encoding: 'utf8'
        },
        {
          path: 'rules/typescript.md',
          content: '# TypeScript Rules',
          encoding: 'utf8'
        }
      ];

      const format = detectPackageFormat(files);
      
      assert.equal(format.type, 'universal');
      assert.equal(format.sourcePlatform, 'openpackage');
    });

    it('should include detection array in claude-plugin platform definition', () => {
      const claudePluginDef = getPlatformDefinition('claude-plugin');
      
      assert.equal(claudePluginDef.name, 'Claude Code Plugin');
      assert.ok(claudePluginDef.detection);
      assert.ok(claudePluginDef.detection!.includes('.claude-plugin/plugin.json'));
      assert.ok(claudePluginDef.export);
      assert.ok(claudePluginDef.import);
    });

    it('should include detection array in claude platform definition', () => {
      const claudeDef = getPlatformDefinition('claude');
      
      assert.ok(claudeDef.detection);
      assert.ok(claudeDef.detection!.includes('.claude'));
      assert.ok(claudeDef.detection!.includes('CLAUDE.md'));
    });
  });

  describe('First-Match Flow Semantics', () => {
    it('should use first matching flow when multiple flows match same pattern', async () => {
      const executor = new DefaultFlowExecutor();
      
      // First flow with condition (should match)
      const flow1: Flow = {
        from: 'agents/test.md',
        to: 'output1.md',
        when: { $eq: ['$$source', 'claude-plugin'] }
      };
      
      // Second flow without condition (fallback)
      const flow2: Flow = {
        from: 'agents/test.md',
        to: 'output2.md'
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'claude',
        packageName: 'test-pkg',
        direction: 'install',
        variables: {
          platform: 'claude',
          source: 'claude-plugin'
        }
      };

      // Create source file
      const sourcePath = join(packageRoot, 'agents/test.md');
      await ensureDir(join(packageRoot, 'agents'));
      await writeTextFile(sourcePath, '# Test Agent');

      // Execute first flow (should succeed)
      const result1 = await executor.executeFlow(flow1, context);
      assert.equal(result1.success, true);
      assert.ok(result1.target.toString().includes('output1.md'));
      
      // In a real scenario with first-match semantics, flow2 wouldn't execute
      // because flow1 already matched. We're testing the condition evaluation here.
    });
  });
});
