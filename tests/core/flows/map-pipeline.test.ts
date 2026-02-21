/**
 * Map Pipeline Tests
 * 
 * Comprehensive tests for the MongoDB-inspired map transformation system.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyMapPipeline,
  createMapContext,
  validateMapPipeline,
} from '../../../src/core/flows/map-pipeline/index.js';
import type { MapPipeline, MapContext } from '../../../src/core/flows/map-pipeline/types.js';

/**
 * Helper to create test context
 */
function createTestContext(overrides?: Partial<MapContext>): MapContext {
  return createMapContext({
    filename: 'test-file',
    dirname: 'test-dir',
    path: 'test-dir/test-file.md',
    ext: '.md',
    ...overrides,
  });
}

describe('Map Pipeline', () => {
  describe('$set operation', () => {
    it('sets a single field with literal value', () => {
      const pipeline: MapPipeline = [
        { $set: { name: 'agent-name' } },
      ];
      const result = applyMapPipeline({}, pipeline, createTestContext());
      assert.deepStrictEqual(result, { name: 'agent-name' });
    });

    it('sets multiple fields', () => {
      const pipeline: MapPipeline = [
        { $set: { name: 'agent-name', version: '1.0.0', status: 'active' } },
      ];
      const result = applyMapPipeline({}, pipeline, createTestContext());
      expect(result).toEqual({
        name: 'agent-name',
        version: '1.0.0',
        status: 'active',
      });
    });

    it('sets field with context variable $$filename', () => {
      const pipeline: MapPipeline = [
        { $set: { name: '$$filename' } },
      ];
      const result = applyMapPipeline({}, pipeline, createTestContext({ filename: 'my-agent' }));
      assert.deepStrictEqual(result, { name: 'my-agent' });
    });

    it('sets field with context variable $$dirname', () => {
      const pipeline: MapPipeline = [
        { $set: { folder: '$$dirname' } },
      ];
      const result = applyMapPipeline({}, pipeline, createTestContext({ dirname: 'agents' }));
      assert.deepStrictEqual(result, { folder: 'agents' });
    });

    it('sets field with context variable $$path', () => {
      const pipeline: MapPipeline = [
        { $set: { source: '$$path' } },
      ];
      const result = applyMapPipeline({}, pipeline, createTestContext({ path: 'agents/reviewer.md' }));
      assert.deepStrictEqual(result, { source: 'agents/reviewer.md' });
    });

    it('sets field with context variable $$ext', () => {
      const pipeline: MapPipeline = [
        { $set: { extension: '$$ext' } },
      ];
      const result = applyMapPipeline({}, pipeline, createTestContext({ ext: '.yaml' }));
      assert.deepStrictEqual(result, { extension: '.yaml' });
    });

    it('sets nested field using dot notation', () => {
      const pipeline: MapPipeline = [
        { $set: { 'config.model': 'sonnet' } },
      ];
      const result = applyMapPipeline({}, pipeline, createTestContext());
      assert.deepStrictEqual(result, { config: { model: 'sonnet' } });
    });

    it('preserves existing fields', () => {
      const pipeline: MapPipeline = [
        { $set: { name: '$$filename' } },
      ];
      const result = applyMapPipeline(
        { existing: 'value', other: 123 },
        pipeline,
        createTestContext({ filename: 'agent' })
      );
      assert.deepStrictEqual(result, { existing: 'value', other: 123, name: 'agent' });
    });

    it('handles escaped literal $$', () => {
      const pipeline: MapPipeline = [
        { $set: { value: '\\$$literal' } },
      ];
      const result = applyMapPipeline({}, pipeline, createTestContext());
      assert.deepStrictEqual(result, { value: '$$literal' });
    });
  });

  describe('$rename operation', () => {
    it('renames a single field', () => {
      const pipeline: MapPipeline = [
        { $rename: { oldName: 'newName' } },
      ];
      const result = applyMapPipeline({ oldName: 'value' }, pipeline, createTestContext());
      assert.deepStrictEqual(result, { newName: 'value' });
    });

    it('renames multiple fields', () => {
      const pipeline: MapPipeline = [
        { $rename: { old1: 'new1', old2: 'new2' } },
      ];
      const result = applyMapPipeline(
        { old1: 'value1', old2: 'value2', keep: 'keep' },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result, { new1: 'value1', new2: 'value2', keep: 'keep' });
    });

    it('renames nested field with dot notation', () => {
      const pipeline: MapPipeline = [
        { $rename: { 'config.old': 'settings.new' } },
      ];
      const result = applyMapPipeline(
        { config: { old: 'value', keep: 'yes' } },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result, { config: { keep: 'yes' }, settings: { new: 'value' } });
    });

    it('renames with wildcard pattern', () => {
      const pipeline: MapPipeline = [
        { $rename: { 'mcp.*': 'mcpServers.*' } },
      ];
      const result = applyMapPipeline(
        { mcp: { server1: { url: 'http://1' }, server2: { url: 'http://2' } } },
        pipeline,
        createTestContext()
      );
      expect(result).toEqual({
        mcpServers: { server1: { url: 'http://1' }, server2: { url: 'http://2' } },
      });
    });

    it('does nothing if source field does not exist', () => {
      const pipeline: MapPipeline = [
        { $rename: { nonexistent: 'target' } },
      ];
      const result = applyMapPipeline({ other: 'value' }, pipeline, createTestContext());
      assert.deepStrictEqual(result, { other: 'value' });
    });
  });

  describe('$unset operation', () => {
    it('removes a single field', () => {
      const pipeline: MapPipeline = [
        { $unset: 'remove' },
      ];
      const result = applyMapPipeline(
        { remove: 'value', keep: 'value' },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result, { keep: 'value' });
    });

    it('removes multiple fields', () => {
      const pipeline: MapPipeline = [
        { $unset: ['remove1', 'remove2'] },
      ];
      const result = applyMapPipeline(
        { remove1: 'a', remove2: 'b', keep: 'c' },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result, { keep: 'c' });
    });

    it('removes nested field with dot notation', () => {
      const pipeline: MapPipeline = [
        { $unset: 'config.deprecated' },
      ];
      const result = applyMapPipeline(
        { config: { deprecated: 'old', keep: 'new' } },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result, { config: { keep: 'new' } });
    });

    it('does nothing if field does not exist', () => {
      const pipeline: MapPipeline = [
        { $unset: 'nonexistent' },
      ];
      const result = applyMapPipeline({ other: 'value' }, pipeline, createTestContext());
      assert.deepStrictEqual(result, { other: 'value' });
    });
  });

  describe('$switch operation', () => {
    it('matches string glob pattern', () => {
      const pipeline: MapPipeline = [
        {
          $switch: {
            field: 'model',
            cases: [
              { pattern: 'anthropic/claude-sonnet-*', value: 'sonnet' },
              { pattern: 'anthropic/claude-opus-*', value: 'opus' },
            ],
          },
        },
      ];
      const result = applyMapPipeline(
        { model: 'anthropic/claude-sonnet-4' },
        pipeline,
        createTestContext()
      );
      assert.strictEqual(result.model, 'sonnet');
    });

    it('first match wins', () => {
      const pipeline: MapPipeline = [
        {
          $switch: {
            field: 'value',
            cases: [
              { pattern: 'test-*', value: 'first' },
              { pattern: 'test-*', value: 'second' },
            ],
          },
        },
      ];
      const result = applyMapPipeline({ value: 'test-file' }, pipeline, createTestContext());
      assert.strictEqual(result.value, 'first');
    });

    it('uses default when no match', () => {
      const pipeline: MapPipeline = [
        {
          $switch: {
            field: 'model',
            cases: [
              { pattern: 'anthropic/claude-sonnet-*', value: 'sonnet' },
            ],
            default: 'inherit',
          },
        },
      ];
      const result = applyMapPipeline(
        { model: 'openai/gpt-4' },
        pipeline,
        createTestContext()
      );
      assert.strictEqual(result.model, 'inherit');
    });

    it('matches object shape pattern', () => {
      const pipeline: MapPipeline = [
        {
          $switch: {
            field: 'permission',
            cases: [
              { pattern: { edit: 'deny', bash: 'deny' }, value: 'plan' },
              { pattern: { edit: 'allow' }, value: 'edit' },
            ],
          },
        },
      ];
      const result = applyMapPipeline(
        { permission: { edit: 'deny', bash: 'deny' } },
        pipeline,
        createTestContext()
      );
      assert.strictEqual(result.permission, 'plan');
    });

    it('matches wildcard in object pattern', () => {
      const pipeline: MapPipeline = [
        {
          $switch: {
            field: 'permission',
            cases: [
              { pattern: { '*': 'deny' }, value: 'restricted' },
            ],
          },
        },
      ];
      const result = applyMapPipeline(
        { permission: { edit: 'deny', bash: 'deny', read: 'deny' } },
        pipeline,
        createTestContext()
      );
      assert.strictEqual(result.permission, 'restricted');
    });

    it('does not modify value when no match and no default', () => {
      const pipeline: MapPipeline = [
        {
          $switch: {
            field: 'value',
            cases: [
              { pattern: 'nomatch', value: 'result' },
            ],
          },
        },
      ];
      const result = applyMapPipeline({ value: 'original' }, pipeline, createTestContext());
      assert.strictEqual(result.value, 'original');
    });
  });

  describe('$transform operation', () => {
    it('filters object by value', () => {
      const pipeline: MapPipeline = [
        {
          $transform: {
            field: 'tools',
            steps: [{ filter: { value: true } }],
          },
        },
      ];
      const result = applyMapPipeline(
        { tools: { write: false, read: true, bash: true } },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result.tools, { read: true, bash: true });
    });

    it('extracts keys to array', () => {
      const pipeline: MapPipeline = [
        {
          $transform: {
            field: 'tools',
            steps: [{ keys: true }],
          },
        },
      ];
      const result = applyMapPipeline(
        { tools: { read: true, write: false, bash: true } },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result.tools, ['read', 'write', 'bash']);
    });

    it('extracts values to array', () => {
      const pipeline: MapPipeline = [
        {
          $transform: {
            field: 'data',
            steps: [{ values: true }],
          },
        },
      ];
      const result = applyMapPipeline(
        { data: { a: 1, b: 2, c: 3 } },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result.data, [1, 2, 3]);
    });

    it('converts to entries array', () => {
      const pipeline: MapPipeline = [
        {
          $transform: {
            field: 'data',
            steps: [{ entries: true }],
          },
        },
      ];
      const result = applyMapPipeline(
        { data: { a: 1, b: 2 } },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result.data, [['a', 1], ['b', 2]]);
    });

    it('capitalizes array elements', () => {
      const pipeline: MapPipeline = [
        {
          $transform: {
            field: 'items',
            steps: [{ map: 'capitalize' }],
          },
        },
      ];
      const result = applyMapPipeline(
        { items: ['read', 'write', 'bash'] },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result.items, ['Read', 'Write', 'Bash']);
    });

    it('uppercases array elements', () => {
      const pipeline: MapPipeline = [
        {
          $transform: {
            field: 'items',
            steps: [{ map: 'uppercase' }],
          },
        },
      ];
      const result = applyMapPipeline(
        { items: ['read', 'write'] },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result.items, ['READ', 'WRITE']);
    });

    it('joins array to string', () => {
      const pipeline: MapPipeline = [
        {
          $transform: {
            field: 'items',
            steps: [{ join: ', ' }],
          },
        },
      ];
      const result = applyMapPipeline(
        { items: ['read', 'write', 'bash'] },
        pipeline,
        createTestContext()
      );
      assert.strictEqual(result.items, 'read, write, bash');
    });

    it('chains multiple transform steps', () => {
      const pipeline: MapPipeline = [
        {
          $transform: {
            field: 'tools',
            steps: [
              { filter: { value: true } },
              { keys: true },
              { map: 'capitalize' },
              { join: ', ' },
            ],
          },
        },
      ];
      const result = applyMapPipeline(
        { tools: { write: false, read: true, bash: true } },
        pipeline,
        createTestContext()
      );
      assert.strictEqual(result.tools, 'Read, Bash');
    });
  });

  describe('$copy operation', () => {
    it('copies field without transformation', () => {
      const pipeline: MapPipeline = [
        {
          $copy: {
            from: 'source',
            to: 'target',
          },
        },
      ];
      const result = applyMapPipeline(
        { source: 'value' },
        pipeline,
        createTestContext()
      );
      assert.deepStrictEqual(result, { source: 'value', target: 'value' });
    });

    it('copies and transforms with pattern matching', () => {
      const pipeline: MapPipeline = [
        {
          $copy: {
            from: 'permission',
            to: 'permissionMode',
            transform: {
              cases: [
                { pattern: { edit: 'deny', bash: 'deny' }, value: 'plan' },
                { pattern: { '*': 'deny' }, value: 'ignore' },
                { pattern: { '*': 'allow' }, value: 'dontAsk' },
              ],
              default: 'default',
            },
          },
        },
      ];
      const result = applyMapPipeline(
        { permission: { edit: 'deny', bash: 'deny' } },
        pipeline,
        createTestContext()
      );
      assert.strictEqual(result.permissionMode, 'plan');
      assert.deepStrictEqual(result.permission, { edit: 'deny', bash: 'deny' });
    });

    it('uses default when no pattern matches', () => {
      const pipeline: MapPipeline = [
        {
          $copy: {
            from: 'value',
            to: 'result',
            transform: {
              cases: [
                { pattern: 'nomatch', value: 'transformed' },
              ],
              default: 'default',
            },
          },
        },
      ];
      const result = applyMapPipeline(
        { value: 'original' },
        pipeline,
        createTestContext()
      );
      assert.strictEqual(result.result, 'default');
    });

    it('does not set target if source does not exist', () => {
      const pipeline: MapPipeline = [
        {
          $copy: {
            from: 'nonexistent',
            to: 'target',
          },
        },
      ];
      const result = applyMapPipeline({ other: 'value' }, pipeline, createTestContext());
      assert.deepStrictEqual(result, { other: 'value' });
      assert.strictEqual('target' in result, false);
    });
  });

  describe('Complex pipeline examples', () => {
    it('Example 1: Simple MCP rename', () => {
      const pipeline: MapPipeline = [
        { $rename: { mcp: 'mcpServers' } },
      ];
      const result = applyMapPipeline(
        { mcp: { server1: { url: 'http://example.com' } } },
        pipeline,
        createTestContext()
      );
      expect(result).toEqual({
        mcpServers: { server1: { url: 'http://example.com' } },
      });
    });

    it('Example 2: Agent name from filename', () => {
      const pipeline: MapPipeline = [
        { $set: { name: '$$filename' } },
      ];
      const result = applyMapPipeline(
        {},
        pipeline,
        createTestContext({ filename: 'code-reviewer' })
      );
      assert.deepStrictEqual(result, { name: 'code-reviewer' });
    });

    it('Example 3: Model transformation with pattern matching', () => {
      const pipeline: MapPipeline = [
        { $set: { name: '$$filename' } },
        {
          $switch: {
            field: 'model',
            cases: [
              { pattern: 'anthropic/claude-sonnet-*', value: 'sonnet' },
              { pattern: 'anthropic/claude-opus-*', value: 'opus' },
              { pattern: 'anthropic/claude-haiku-*', value: 'haiku' },
            ],
            default: 'inherit',
          },
        },
      ];
      const result = applyMapPipeline(
        { model: 'anthropic/claude-sonnet-4-20250514' },
        pipeline,
        createTestContext({ filename: 'code-reviewer' })
      );
      expect(result).toEqual({
        name: 'code-reviewer',
        model: 'sonnet',
      });
    });

    it('Example 4: Tools pipeline (Object → CSV String)', () => {
      const pipeline: MapPipeline = [
        { $set: { name: '$$filename' } },
        {
          $transform: {
            field: 'tools',
            steps: [
              { filter: { value: true } },
              { keys: true },
              { map: 'capitalize' },
              { join: ', ' },
            ],
          },
        },
      ];
      const result = applyMapPipeline(
        {
          tools: {
            write: false,
            edit: false,
            bash: true,
            read: true,
          },
        },
        pipeline,
        createTestContext({ filename: 'code-reviewer' })
      );
      expect(result).toEqual({
        name: 'code-reviewer',
        tools: 'Bash, Read',
      });
    });

    it('Example 5: Permission transformation', () => {
      const pipeline: MapPipeline = [
        { $set: { name: '$$filename' } },
        {
          $copy: {
            from: 'permission',
            to: 'permissionMode',
            transform: {
              cases: [
                { pattern: { edit: 'deny', bash: 'deny' }, value: 'plan' },
                { pattern: { '*': 'deny' }, value: 'ignore' },
                { pattern: { '*': 'allow' }, value: 'dontAsk' },
              ],
              default: 'default',
            },
          },
        },
        { $unset: 'permission' },
      ];
      const result = applyMapPipeline(
        {
          permission: {
            edit: 'deny',
            bash: 'deny',
          },
        },
        pipeline,
        createTestContext({ filename: 'code-reviewer' })
      );
      expect(result).toEqual({
        name: 'code-reviewer',
        permissionMode: 'plan',
      });
      assert.strictEqual('permission' in result, false);
    });

    it('Example 6: Complete Claude agent transformation', () => {
      const pipeline: MapPipeline = [
        { $set: { name: '$$filename' } },
        {
          $switch: {
            field: 'model',
            cases: [
              { pattern: 'anthropic/claude-sonnet-*', value: 'sonnet' },
              { pattern: 'anthropic/claude-opus-*', value: 'opus' },
              { pattern: 'anthropic/claude-haiku-*', value: 'haiku' },
            ],
            default: 'inherit',
          },
        },
        {
          $transform: {
            field: 'tools',
            steps: [
              { filter: { value: true } },
              { keys: true },
              { map: 'capitalize' },
              { join: ', ' },
            ],
          },
        },
        {
          $copy: {
            from: 'permission',
            to: 'permissionMode',
            transform: {
              cases: [
                { pattern: { edit: 'deny', bash: 'deny' }, value: 'plan' },
                { pattern: { '*': 'deny' }, value: 'ignore' },
                { pattern: { '*': 'allow' }, value: 'dontAsk' },
              ],
              default: 'default',
            },
          },
        },
        { $unset: 'permission' },
      ];

      const result = applyMapPipeline(
        {
          model: 'anthropic/claude-sonnet-4-20250514',
          tools: {
            write: false,
            edit: false,
            bash: true,
            read: true,
          },
          permission: {
            edit: 'deny',
            bash: 'deny',
          },
        },
        pipeline,
        createTestContext({ filename: 'code-reviewer' })
      );

      expect(result).toEqual({
        name: 'code-reviewer',
        model: 'sonnet',
        tools: 'Bash, Read',
        permissionMode: 'plan',
      });
    });
  });

  describe('Validation', () => {
    it('validates empty pipeline', () => {
      const validation = validateMapPipeline([]);
      assert.strictEqual(validation.valid, false);
      assert.ok(validation.errors.includes('Map pipeline must have at least one operation'));
    });

    it('validates unknown operation', () => {
      const validation = validateMapPipeline([{ $unknown: {} }] as any);
      assert.strictEqual(validation.valid, false);
    });

    it('validates $set with empty object', () => {
      const validation = validateMapPipeline([{ $set: {} }]);
      assert.strictEqual(validation.valid, false);
    });

    it('validates $rename with mismatched wildcards', () => {
      const validation = validateMapPipeline([{ $rename: { 'a.*': 'b' } }]);
      assert.strictEqual(validation.valid, false);
    });

    it('validates $switch without cases', () => {
      const validation = validateMapPipeline([
        { $switch: { field: 'x', cases: [] } },
      ]);
      assert.strictEqual(validation.valid, false);
    });

    it('validates valid pipeline', () => {
      const validation = validateMapPipeline([
        { $set: { name: '$$filename' } },
        { $rename: { old: 'new' } },
        { $unset: 'temp' },
      ]);
      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.errors.length, 0);
    });
  });
});
