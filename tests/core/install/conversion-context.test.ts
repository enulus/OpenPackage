/**
 * Conversion Context Tests
 * 
 * Tests for Phase 3: Conversion Context Management
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createConversionContext,
  recordGroupConversion,
  recordConversionError,
  finalizeConversion,
  getConversionSummary,
  isConversionSuccessful,
  getConversionErrors,
  cacheImportFlows,
  getCachedImportFlows,
  createFormatGroupsFromPaths
} from '../../../src/core/install/conversion-context.js';
import type { PackageFile } from '../../../src/core/install/detection-types.js';
import type { Flow } from '../../../src/types/flows.js';

describe('Conversion Context', () => {
  describe('createConversionContext', () => {
    it('should create context with initial state', () => {
      const formatGroups = new Map<string, PackageFile[]>([
        ['claude', [
          { path: 'agents/agent1.md', content: 'Agent 1' },
          { path: 'agents/agent2.md', content: 'Agent 2' }
        ]],
        ['universal', [
          { path: 'commands/build.md', content: 'Build' }
        ]]
      ]);

      const context = createConversionContext(formatGroups);

      assert.deepStrictEqual(context.formatGroups, formatGroups);
      assert.strictEqual(context.convertedGroups.size, 0);
      assert.strictEqual(context.errors.size, 0);
      assert.strictEqual(context.metadata.totalFiles, 3);
      assert.strictEqual(context.metadata.convertedFiles, 0);
      assert.strictEqual(context.metadata.skippedFiles, 0);
      assert.strictEqual(context.metadata.failedFiles, 0);
      assert.ok(context.metadata.startTime);
      assert.strictEqual(context.importFlowsCache.size, 0);
    });

    it('should handle empty format groups', () => {
      const formatGroups = new Map<string, PackageFile[]>();

      const context = createConversionContext(formatGroups);

      assert.strictEqual(context.metadata.totalFiles, 0);
    });
  });

  describe('recordGroupConversion', () => {
    it('should record successful group conversion', () => {
      const context = createConversionContext(new Map([
        ['claude', [
          { path: 'agents/agent1.md', content: 'Agent 1' },
          { path: 'agents/agent2.md', content: 'Agent 2' }
        ]]
      ]));

      const convertedFiles: PackageFile[] = [
        { path: 'agents/agent1.md', content: 'Converted 1' },
        { path: 'agents/agent2.md', content: 'Converted 2' }
      ];

      recordGroupConversion(context, 'claude', convertedFiles, 2, 0);

      assert.deepStrictEqual(context.convertedGroups.get('claude'), convertedFiles);
      assert.strictEqual(context.metadata.convertedFiles, 2);
      assert.strictEqual(context.metadata.skippedFiles, 0);
    });

    it('should accumulate counts across multiple groups', () => {
      const context = createConversionContext(new Map([
        ['claude', [{ path: 'a.md', content: 'a' }]],
        ['opencode', [{ path: 'b.md', content: 'b' }]]
      ]));

      recordGroupConversion(context, 'claude', [{ path: 'a.md', content: 'a-converted' }], 1, 0);
      recordGroupConversion(context, 'opencode', [{ path: 'b.md', content: 'b-converted' }], 0, 1);

      assert.strictEqual(context.metadata.convertedFiles, 1);
      assert.strictEqual(context.metadata.skippedFiles, 1);
    });
  });

  describe('recordConversionError', () => {
    it('should record file conversion error', () => {
      const context = createConversionContext(new Map([
        ['claude', [{ path: 'agents/bad.md', content: 'Bad' }]]
      ]));

      const error = new Error('Conversion failed');
      recordConversionError(context, 'agents/bad.md', error);

      assert.strictEqual(context.errors.get('agents/bad.md'), error);
      assert.strictEqual(context.metadata.failedFiles, 1);
    });

    it('should accumulate multiple errors', () => {
      const context = createConversionContext(new Map());

      recordConversionError(context, 'file1.md', new Error('Error 1'));
      recordConversionError(context, 'file2.md', new Error('Error 2'));

      assert.strictEqual(context.errors.size, 2);
      assert.strictEqual(context.metadata.failedFiles, 2);
    });
  });

  describe('finalizeConversion', () => {
    it('should set end time and duration', async () => {
      const context = createConversionContext(new Map());
      
      // Wait a bit to have measurable duration
      await new Promise(resolve => setTimeout(resolve, 10));
      finalizeConversion(context);

      assert.ok(context.metadata.endTime);
      assert.ok(context.metadata.durationMs);
      assert.ok(context.metadata.durationMs! > 0);
    });
  });

  describe('getConversionSummary', () => {
    it('should generate summary string', () => {
      const context = createConversionContext(new Map([
        ['claude', [
          { path: 'a.md', content: 'a' },
          { path: 'b.md', content: 'b' }
        ]]
      ]));

      context.metadata.convertedFiles = 1;
      context.metadata.skippedFiles = 1;
      context.metadata.failedFiles = 0;
      context.metadata.durationMs = 150;

      const summary = getConversionSummary(context);

      assert.ok(summary.includes('Total: 2 files'));
      assert.ok(summary.includes('Converted: 1'));
      assert.ok(summary.includes('Skipped: 1'));
      assert.ok(summary.includes('Duration: 150ms'));
    });

    it('should include failed count when present', () => {
      const context = createConversionContext(new Map());
      context.metadata.totalFiles = 3;
      context.metadata.convertedFiles = 1;
      context.metadata.skippedFiles = 1;
      context.metadata.failedFiles = 1;

      const summary = getConversionSummary(context);

      assert.ok(summary.includes('Failed: 1'));
    });
  });

  describe('isConversionSuccessful', () => {
    it('should return true when no failures', () => {
      const context = createConversionContext(new Map());
      context.metadata.failedFiles = 0;

      assert.strictEqual(isConversionSuccessful(context), true);
    });

    it('should return false when failures exist', () => {
      const context = createConversionContext(new Map());
      context.metadata.failedFiles = 1;

      assert.strictEqual(isConversionSuccessful(context), false);
    });
  });

  describe('getConversionErrors', () => {
    it('should return array of errors', () => {
      const context = createConversionContext(new Map());
      
      const error1 = new Error('Error 1');
      const error2 = new Error('Error 2');
      
      recordConversionError(context, 'file1.md', error1);
      recordConversionError(context, 'file2.md', error2);

      const errors = getConversionErrors(context);

      assert.strictEqual(errors.length, 2);
      assert.strictEqual(errors[0][0], 'file1.md');
      assert.strictEqual(errors[0][1], error1);
      assert.strictEqual(errors[1][0], 'file2.md');
      assert.strictEqual(errors[1][1], error2);
    });
  });

  describe('Import flows caching', () => {
    it('should cache import flows', () => {
      const context = createConversionContext(new Map());

      const flows: Flow[] = [
        {
          from: '.claude/agents/**/*.md',
          to: 'agents/**/*.md'
        }
      ];

      cacheImportFlows(context, 'claude', flows);

      assert.deepStrictEqual(context.importFlowsCache.get('claude'), flows);
    });

    it('should retrieve cached flows', () => {
      const context = createConversionContext(new Map());

      const flows: Flow[] = [
        {
          from: '.claude/agents/**/*.md',
          to: 'agents/**/*.md'
        }
      ];

      cacheImportFlows(context, 'claude', flows);

      const cached = getCachedImportFlows(context, 'claude');

      assert.deepStrictEqual(cached, flows);
    });

    it('should return null for uncached platform', () => {
      const context = createConversionContext(new Map());

      const cached = getCachedImportFlows(context, 'opencode');

      assert.strictEqual(cached, null);
    });
  });

  describe('createFormatGroupsFromPaths', () => {
    it('should create format groups from path map', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent1.md', content: 'Agent 1' },
        { path: 'agents/agent2.md', content: 'Agent 2' },
        { path: 'rules/rule1.md', content: 'Rule 1' }
      ];

      const formatGroups = new Map<string, string[]>([
        ['claude', ['agents/agent1.md', 'rules/rule1.md']],
        ['opencode', ['agents/agent2.md']]
      ]);

      const result = createFormatGroupsFromPaths(files, formatGroups);

      assert.strictEqual(result.size, 2);
      assert.strictEqual(result.get('claude')!.length, 2);
      assert.strictEqual(result.get('opencode')!.length, 1);
      assert.strictEqual(result.get('claude')?.[0].path, 'agents/agent1.md');
      assert.strictEqual(result.get('opencode')?.[0].path, 'agents/agent2.md');
    });

    it('should handle missing files gracefully', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent1.md', content: 'Agent 1' }
      ];

      const formatGroups = new Map<string, string[]>([
        ['claude', ['agents/agent1.md', 'agents/missing.md']]
      ]);

      const result = createFormatGroupsFromPaths(files, formatGroups);

      assert.strictEqual(result.get('claude')!.length, 1);
      assert.strictEqual(result.get('claude')?.[0].path, 'agents/agent1.md');
    });

    it('should skip empty groups', () => {
      const files: PackageFile[] = [
        { path: 'agents/agent1.md', content: 'Agent 1' }
      ];

      const formatGroups = new Map<string, string[]>([
        ['claude', ['agents/agent1.md']],
        ['opencode', ['nonexistent.md']]
      ]);

      const result = createFormatGroupsFromPaths(files, formatGroups);

      assert.strictEqual(result.size, 1);
      assert.strictEqual(result.has('claude'), true);
      assert.strictEqual(result.has('opencode'), false);
    });
  });
});
