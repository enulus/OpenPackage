/**
 * Unit tests for Flow Executor
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';
import { mkdir, mkdtemp, rm, writeFile as fsWriteFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'path';
import os from 'os';
import { createFlowExecutor } from '../../../src/core/flows/flow-executor.js';
import type { Flow, FlowContext } from '../../../src/types/flows.js';

// Helper functions
async function writeJSON(filePath: string, data: any): Promise<void> {
  await fsWriteFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readJSON(filePath: string): Promise<any> {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fsWriteFile(filePath, content, 'utf-8');
}

function pathExists(filePath: string): boolean {
  return existsSync(filePath);
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

describe('FlowExecutor', () => {
  let executor: ReturnType<typeof createFlowExecutor>;
  let testDir: string;
  let workspaceRoot: string;
  let packageRoot: string;

  beforeEach(async () => {
    executor = createFlowExecutor();
    testDir = await mkdtemp(path.join(os.tmpdir(), 'flow-executor-test-'));
    workspaceRoot = path.join(testDir, 'workspace');
    packageRoot = path.join(testDir, 'package');
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(packageRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('validateFlow', () => {
    it('should validate a valid flow', () => {
      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
      };

      const result = executor.validateFlow(flow);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject flow without from field', () => {
      const flow: Flow = {
        from: '',
        to: 'target.json',
      };

      const result = executor.validateFlow(flow);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].code, 'MISSING_FROM');
    });

    it('should reject flow with invalid merge strategy', () => {
      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        merge: 'invalid' as any,
      };

      const result = executor.validateFlow(flow);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.code === 'INVALID_MERGE'));
    });
  });

  describe('executeFlow - Simple operations', () => {
    it('should copy a simple JSON file', async () => {
      const sourceData = { name: 'test', value: 42 };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, false);

      const targetPath = path.join(workspaceRoot, 'target.json');
      const targetData = await readJSON(targetPath);
      assert.deepStrictEqual(targetData, sourceData);
    });

    it('should return error if source file does not exist', async () => {
      const flow: Flow = {
        from: 'nonexistent.json',
        to: 'target.json',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.message.includes('not found'));
    });
  });

  describe('executeFlow - Format conversion', () => {
    it('should convert YAML to JSON', async () => {
      const sourcePath = path.join(packageRoot, 'source.yaml');
      await writeFile(sourcePath, 'name: test\nvalue: 42\n');

      const flow: Flow = {
        from: 'source.yaml',
        to: 'target.json',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);

      const targetPath = path.join(workspaceRoot, 'target.json');
      const targetData = await readJSON(targetPath);
      assert.deepStrictEqual(targetData, { name: 'test', value: 42 });
    });
  });

  describe('executeFlow - JSONPath extraction', () => {
    it('should extract data using JSONPath', async () => {
      const sourceData = {
        config: {
          settings: {
            theme: 'dark',
            fontSize: 14,
          },
        },
      };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        path: '$.config.settings',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, true);

      const targetPath = path.join(workspaceRoot, 'target.json');
      const targetData = await readJSON(targetPath);
      assert.deepStrictEqual(targetData, sourceData.config.settings);
    });
  });

  describe('executeFlow - Pick/Omit keys', () => {
    it('should pick specified keys', async () => {
      const sourceData = {
        theme: 'dark',
        fontSize: 14,
        lineHeight: 1.5,
        wordWrap: true,
      };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        pick: ['theme', 'fontSize'],
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, true);

      const targetPath = path.join(workspaceRoot, 'target.json');
      const targetData = await readJSON(targetPath);
      assert.deepStrictEqual(targetData, { theme: 'dark', fontSize: 14 });
    });

    it('should omit specified keys', async () => {
      const sourceData = {
        theme: 'dark',
        fontSize: 14,
        lineHeight: 1.5,
        wordWrap: true,
      };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        omit: ['lineHeight', 'wordWrap'],
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, true);

      const targetPath = path.join(workspaceRoot, 'target.json');
      const targetData = await readJSON(targetPath);
      assert.deepStrictEqual(targetData, { theme: 'dark', fontSize: 14 });
    });
  });

  describe('executeFlow - Key mapping', () => {
    it('should map simple keys', async () => {
      const sourceData = {
        theme: 'dark',
        fontSize: 14,
      };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        map: {
          theme: 'workbench.colorTheme',
          fontSize: 'editor.fontSize',
        },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, true);

      const targetPath = path.join(workspaceRoot, 'target.json');
      const targetData = await readJSON(targetPath);
      assert.deepStrictEqual(targetData, {
        workbench: { colorTheme: 'dark' },
        editor: { fontSize: 14 },
      });
    });

    it('should map keys with value transforms', async () => {
      const sourceData = {
        fontSize: '14',
        theme: 'DARK',
      };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        map: {
          fontSize: {
            to: 'editor.fontSize',
            transform: 'number',
          },
          theme: {
            to: 'workbench.colorTheme',
            transform: 'lowercase',
          },
        },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, true);

      const targetPath = path.join(workspaceRoot, 'target.json');
      const targetData = await readJSON(targetPath);
      assert.deepStrictEqual(targetData, {
        editor: { fontSize: 14 },
        workbench: { colorTheme: 'dark' },
      });
    });
  });

  describe('executeFlow - Embed', () => {
    it('should embed content under key', async () => {
      const sourceData = {
        server1: { url: 'http://localhost:3000' },
        server2: { url: 'http://localhost:3001' },
      };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        embed: 'mcpServers',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transformed, true);

      const targetPath = path.join(workspaceRoot, 'target.json');
      const targetData = await readJSON(targetPath);
      assert.deepStrictEqual(targetData, { mcpServers: sourceData });
    });
  });

  describe('executeFlow - Merge strategies', () => {
    it('should deep merge existing content', async () => {
      const sourceData = {
        config: { theme: 'dark', fontSize: 14 },
        settings: { auto: true },
      };
      const existingData = {
        config: { lineHeight: 1.5 },
        other: 'value',
      };

      const sourcePath = path.join(packageRoot, 'source.json');
      const targetPath = path.join(workspaceRoot, 'target.json');

      await writeJSON(sourcePath, sourceData);
      await writeJSON(targetPath, existingData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        merge: 'deep',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);
      // Conflicts may or may not be present depending on actual conflicts
      // assert.ok(result.conflicts);

      const targetData = await readJSON(targetPath);
      assert.strictEqual(targetData.config.theme, 'dark');
      assert.strictEqual(targetData.config.fontSize, 14);
      assert.strictEqual(targetData.config.lineHeight, 1.5);
      assert.strictEqual(targetData.settings.auto, true);
      assert.strictEqual(targetData.other, 'value');
    });
  });

  describe('executeFlow - Conditional execution', () => {
    it('should execute flow when condition is true', async () => {
      await ensureDir(path.join(workspaceRoot, '.cursor'));

      const sourceData = { name: 'test' };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        when: { exists: '.cursor' },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'cursor',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);

      const targetPath = path.join(workspaceRoot, 'target.json');
      assert.strictEqual(pathExists(targetPath), true);
    });

    it('should skip flow when condition is false', async () => {
      const sourceData = { name: 'test' };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
        when: { exists: '.cursor' },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);
      assert.ok(result.warnings);
      assert.ok(result.warnings.includes('Flow skipped due to condition'));

      const targetPath = path.join(workspaceRoot, 'target.json');
      assert.strictEqual(pathExists(targetPath), false);
    });
  });

  describe('executeFlow - Multi-target', () => {
    it('should execute multi-target flow', async () => {
      const sourceData = {
        server1: { url: 'http://localhost:3000' },
        server2: { url: 'http://localhost:3001' },
      };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: {
          'target1.json': { embed: 'servers' },
          'target2.json': { pick: ['server1'] },
        },
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);

      // Check target1
      const target1Path = path.join(workspaceRoot, 'target1.json');
      const target1Data = await readJSON(target1Path);
      assert.deepStrictEqual(target1Data, { servers: sourceData });

      // Check target2
      const target2Path = path.join(workspaceRoot, 'target2.json');
      const target2Data = await readJSON(target2Path);
      assert.ok('server1' in target2Data);
      assert.ok(!('server2' in target2Data));
    });
  });

  describe('executeFlow - Dry run', () => {
    it('should not write files in dry run mode', async () => {
      const sourceData = { name: 'test' };
      const sourcePath = path.join(packageRoot, 'source.json');
      await writeJSON(sourcePath, sourceData);

      const flow: Flow = {
        from: 'source.json',
        to: 'target.json',
      };

      const context: FlowContext = {
        workspaceRoot,
        packageRoot,
        platform: 'test',
        packageName: 'test-package',
        variables: {},
        direction: 'install',
        dryRun: true,
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true);

      const targetPath = path.join(workspaceRoot, 'target.json');
      assert.strictEqual(pathExists(targetPath), false);
    });
  });
});
