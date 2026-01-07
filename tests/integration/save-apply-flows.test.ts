/**
 * Save and Apply Flow Integration Tests
 * 
 * Tests the integration of flow-based save and apply pipelines.
 */

import { test, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { 
  saveWorkspaceFilesWithFlows,
  shouldUseFlowsForSave,
  getFlowSaveStatistics 
} from '../../src/core/save/flow-based-saver.js';
import { exists, readTextFile, ensureDir, writeTextFile } from '../../src/utils/fs.js';
import { rmdir } from 'fs/promises';
import type { SaveCandidate } from '../../src/core/save/save-types.js';

const TEST_DIR = join(process.cwd(), 'tmp', 'test-save-apply-flows');
const PACKAGE_ROOT = join(TEST_DIR, 'package');
const WORKSPACE_ROOT = join(TEST_DIR, 'workspace');

beforeEach(async () => {
  // Clean up test directory
  if (await exists(TEST_DIR)) {
    await rmdir(TEST_DIR, { recursive: true });
  }
  
  // Create test directories
  await ensureDir(PACKAGE_ROOT);
  await ensureDir(WORKSPACE_ROOT);
  
  // Create platform config
  const platformsConfig = {
    "test-platform": {
      "name": "Test Platform",
      "rootDir": ".test",
      "flows": [
        {
          "from": "rules/{name}.md",
          "to": ".test/rules/{name}.md"
        }
      ]
    }
  };
  
  await ensureDir(join(WORKSPACE_ROOT, '.openpackage'));
  await writeTextFile(
    join(WORKSPACE_ROOT, '.openpackage', 'platforms.jsonc'),
    JSON.stringify(platformsConfig, null, 2)
  );
  
  // Create workspace platform directory
  await ensureDir(join(WORKSPACE_ROOT, '.test', 'rules'));
});

afterEach(async () => {
  // Clean up test directory
  if (await exists(TEST_DIR)) {
    await rmdir(TEST_DIR, { recursive: true });
  }
});

test('shouldUseFlowsForSave returns false for undefined platform', () => {
  const result = shouldUseFlowsForSave(undefined, WORKSPACE_ROOT);
  expect(result).toBe(false);
});

test('saveWorkspaceFilesWithFlows skips files without platform', async () => {
  const candidates: SaveCandidate[] = [
    {
      source: 'workspace',
      registryPath: 'rules/test.md',
      fullPath: join(WORKSPACE_ROOT, '.test', 'rules', 'test.md'),
      content: '# Test Rule',
      contentHash: 'hash123',
      mtime: new Date(),
      displayPath: '.test/rules/test.md',
      platform: undefined, // No platform
      isMarkdown: true
    }
  ];
  
  const result = await saveWorkspaceFilesWithFlows(
    candidates,
    PACKAGE_ROOT,
    WORKSPACE_ROOT,
    { force: false, dryRun: false }
  );
  
  expect(result.filesSkipped).toBe(1);
  expect(result.filesWritten).toBe(0);
  expect(result.fileResults[0].skipReason).toBe('No platform detected for file');
});

test('saveWorkspaceFilesWithFlows returns statistics', async () => {
  const candidates: SaveCandidate[] = [];
  
  const result = await saveWorkspaceFilesWithFlows(
    candidates,
    PACKAGE_ROOT,
    WORKSPACE_ROOT,
    { force: false, dryRun: false }
  );
  
  const stats = getFlowSaveStatistics(result);
  expect(stats).toHaveProperty('total');
  expect(stats).toHaveProperty('written');
  expect(stats).toHaveProperty('skipped');
  expect(stats).toHaveProperty('errors');
});

test('flow-based saver handles empty candidate list', async () => {
  const result = await saveWorkspaceFilesWithFlows(
    [],
    PACKAGE_ROOT,
    WORKSPACE_ROOT,
    { force: false, dryRun: false }
  );
  
  expect(result.success).toBe(true);
  expect(result.filesProcessed).toBe(0);
  expect(result.filesWritten).toBe(0);
  expect(result.errors).toHaveLength(0);
});

test('flow-based saver skips unknown platforms', async () => {
  // Create a workspace file with unknown platform
  const ruleContent = '# Test Rule\n\nThis is a test rule.';
  const workspacePath = join(WORKSPACE_ROOT, '.test', 'rules', 'test.md');
  await writeTextFile(workspacePath, ruleContent);
  
  const candidates: SaveCandidate[] = [
    {
      source: 'workspace',
      registryPath: 'rules/test.md',
      fullPath: workspacePath,
      content: ruleContent,
      contentHash: 'hash123',
      mtime: new Date(),
      displayPath: '.test/rules/test.md',
      platform: 'unknown-platform' as any,
      isMarkdown: true
    }
  ];
  
  const result = await saveWorkspaceFilesWithFlows(
    candidates,
    PACKAGE_ROOT,
    WORKSPACE_ROOT,
    { force: false, dryRun: false }
  );
  
  // Unknown platform should result in skipped files or errors
  expect(result.filesProcessed + result.filesSkipped).toBeGreaterThan(0);
  expect(result.success).toBe(true); // Errors are collected but success can still be true
});

console.log('✓ Save and Apply Flow Integration Tests');
