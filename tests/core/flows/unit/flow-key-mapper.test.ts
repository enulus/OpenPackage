/**
 * Tests for Flow Key Mapper
 * 
 * Tests all key mapping features:
 * - Simple key rename
 * - Dot notation (nested keys)
 * - Wildcard patterns
 * - Value transforms
 * - Value lookup tables
 * - Default values
 * - Key validation
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyKeyMap,
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  validateKeyMap,
} from '../../../../src/core/flows/flow-key-mapper.js';
import type { KeyMap, FlowContext } from '../../../../src/types/flows.js';

// Helper to create a mock FlowContext
function createMockContext(overrides?: Partial<FlowContext>): FlowContext {
  return {
    workspaceRoot: '/workspace',
    packageRoot: '/package',
    platform: 'test',
    packageName: 'test-package',
    variables: {},
    direction: 'install',
    ...overrides,
  };
}

describe('Flow Key Mapper', () => {
  describe('Simple Key Rename', () => {
    it('should rename a simple key', () => {
      const input = { theme: 'dark' };
      const keyMap: KeyMap = { theme: 'colorTheme' };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, { colorTheme: 'dark' });
    });

    it('should rename multiple keys', () => {
      const input = { theme: 'dark', fontSize: 14 };
      const keyMap: KeyMap = {
        theme: 'colorTheme',
        fontSize: 'textSize',
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        colorTheme: 'dark',
        textSize: 14,
      });
    });

    it('should preserve unmapped keys', () => {
      const input = { theme: 'dark', fontSize: 14, other: 'value' };
      const keyMap: KeyMap = { theme: 'colorTheme' };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        colorTheme: 'dark',
        fontSize: 14,
        other: 'value',
      });
    });
  });

  describe('Dot Notation (Nested Keys)', () => {
    it('should map flat key to nested key', () => {
      const input = { theme: 'dark' };
      const keyMap: KeyMap = { theme: 'workbench.colorTheme' };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        workbench: {
          colorTheme: 'dark',
        },
      });
    });

    it('should map nested key to flat key', () => {
      const input = {
        editor: {
          fontSize: 14,
        },
      };
      const keyMap: KeyMap = { 'editor.fontSize': 'fontSize' };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        fontSize: 14,
        editor: {},
      });
    });

    it('should map nested key to nested key', () => {
      const input = {
        ai: {
          model: 'gpt-4',
        },
      };
      const keyMap: KeyMap = { 'ai.model': 'cursor.ai.model' };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        cursor: {
          ai: {
            model: 'gpt-4',
          },
        },
        ai: {},
      });
    });

    it('should handle deep nested structures', () => {
      const input = {
        a: {
          b: {
            c: {
              d: 'value',
            },
          },
        },
      };
      const keyMap: KeyMap = { 'a.b.c.d': 'x.y.z' };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        x: {
          y: {
            z: 'value',
          },
        },
        a: {
          b: {
            c: {},
          },
        },
      });
    });
  });

  describe('Wildcard Patterns', () => {
    it('should map wildcard pattern with prefix', () => {
      const input = {
        'ai.model': 'gpt-4',
        'ai.temperature': 0.7,
        'ai.maxTokens': 1000,
      };
      const keyMap: KeyMap = { 'ai.*': 'cursor.*' };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        'cursor.model': 'gpt-4',
        'cursor.temperature': 0.7,
        'cursor.maxTokens': 1000,
      });
    });

    it('should map wildcard pattern to nested structure', () => {
      const input = {
        'server1': { url: 'http://a.com' },
        'server2': { url: 'http://b.com' },
        'other': 'value',
      };
      const keyMap: KeyMap = { 'server*': 'mcp.servers.server*' };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        mcp: {
          servers: {
            'server1': { url: 'http://a.com' },
            'server2': { url: 'http://b.com' },
          },
        },
        other: 'value',
      });
    });

    it('should handle wildcard with nested input', () => {
      const input = {
        ai: {
          model: 'gpt-4',
          temperature: 0.7,
        },
      };
      const keyMap: KeyMap = { 'ai.*': 'cursor.ai.*' };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        cursor: {
          ai: {
            model: 'gpt-4',
            temperature: 0.7,
          },
        },
        ai: {},
      });
    });
  });

  describe('Value Transforms', () => {
    it('should apply single transform', () => {
      const input = { fontSize: '14' };
      const keyMap: KeyMap = {
        fontSize: {
          to: 'editor.fontSize',
          transform: 'number',
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        editor: {
          fontSize: 14,
        },
      });
    });

    it('should apply multiple transforms', () => {
      const input = { name: ' hello world ' };
      const keyMap: KeyMap = {
        name: {
          to: 'title',
          transform: ['trim', 'title-case'],
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        title: 'Hello World',
      });
    });

    it('should apply string case transforms', () => {
      const input = { key: 'helloWorld' };
      const keyMap: KeyMap = {
        key: {
          to: 'kebab',
          transform: 'kebab-case',
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        kebab: 'hello-world',
      });
    });

    it('should handle transform errors gracefully', () => {
      const input = { value: 'not-a-number' };
      const keyMap: KeyMap = {
        value: {
          to: 'num',
          transform: 'number',
        },
      };
      const context = createMockContext();

      // Transform should fail but not throw
      const result = applyKeyMap(input, keyMap, context);

      // Value should be unchanged due to transform failure
      assert.deepStrictEqual(result, {
        num: 'not-a-number',
      });
    });
  });

  describe('Value Lookup Tables', () => {
    it('should map values using lookup table', () => {
      const input = { environment: 'dev' };
      const keyMap: KeyMap = {
        environment: {
          to: 'env',
          values: {
            dev: 'development',
            prod: 'production',
            stg: 'staging',
          },
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        env: 'development',
      });
    });

    it('should use original value if not in lookup table', () => {
      const input = { environment: 'unknown' };
      const keyMap: KeyMap = {
        environment: {
          to: 'env',
          values: {
            dev: 'development',
            prod: 'production',
          },
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        env: 'unknown',
      });
    });

    it('should apply lookup before transform', () => {
      const input = { count: '5' };
      const keyMap: KeyMap = {
        count: {
          to: 'value',
          values: {
            '5': '10',
          },
          transform: 'number',
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        value: 10,
      });
    });
  });

  describe('Default Values', () => {
    it('should use default value for missing key', () => {
      const input = {};
      const keyMap: KeyMap = {
        theme: {
          to: 'colorTheme',
          default: 'dark',
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        colorTheme: 'dark',
      });
    });

    it('should not use default if key exists', () => {
      const input = { theme: 'light' };
      const keyMap: KeyMap = {
        theme: {
          to: 'colorTheme',
          default: 'dark',
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        colorTheme: 'light',
      });
    });

    it('should apply transform to default value', () => {
      const input = {};
      const keyMap: KeyMap = {
        fontSize: {
          to: 'editor.fontSize',
          default: '14',
          transform: 'number',
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        editor: {
          fontSize: 14,
        },
      });
    });
  });

  describe('Required Keys', () => {
    it('should skip key with undefined value when not required', () => {
      const input = { theme: 'dark' };
      const keyMap: KeyMap = {
        theme: 'colorTheme',
        missing: {
          to: 'other',
          required: false,
        },
      };
      const context = createMockContext();

      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        colorTheme: 'dark',
      });
    });

    it('should warn about missing required key', () => {
      const input = {};
      const keyMap: KeyMap = {
        required: {
          to: 'value',
          required: true,
        },
      };
      const context = createMockContext();

      // Should not throw, just warn
      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {});
    });
  });

  describe('Nested Value Helpers', () => {
    describe('getNestedValue', () => {
      it('should get simple value', () => {
        const obj = { a: 1 };
        assert.strictEqual(getNestedValue(obj, 'a'), 1);
      });

      it('should get nested value', () => {
        const obj = { a: { b: { c: 42 } } };
        assert.strictEqual(getNestedValue(obj, 'a.b.c'), 42);
      });

      it('should return undefined for missing path', () => {
        const obj = { a: { b: 1 } };
        assert.strictEqual(getNestedValue(obj, 'a.c'), undefined);
      });

      it('should handle empty path', () => {
        const obj = { a: 1 };
        expect(getNestedValue(obj, '')).toEqual(obj);
      });
    });

    describe('setNestedValue', () => {
      it('should set simple value', () => {
        const obj: any = {};
        setNestedValue(obj, 'a', 1);
        assert.deepStrictEqual(obj, { a: 1 });
      });

      it('should set nested value', () => {
        const obj: any = {};
        setNestedValue(obj, 'a.b.c', 42);
        assert.deepStrictEqual(obj, { a: { b: { c: 42 } } });
      });

      it('should overwrite existing value', () => {
        const obj: any = { a: { b: 1 } };
        setNestedValue(obj, 'a.b', 2);
        assert.deepStrictEqual(obj, { a: { b: 2 } });
      });

      it('should create intermediate objects', () => {
        const obj: any = { a: 1 };
        setNestedValue(obj, 'b.c', 2);
        assert.deepStrictEqual(obj, { a: 1, b: { c: 2 } });
      });
    });

    describe('deleteNestedValue', () => {
      it('should delete simple value', () => {
        const obj: any = { a: 1, b: 2 };
        deleteNestedValue(obj, 'a');
        assert.deepStrictEqual(obj, { b: 2 });
      });

      it('should delete nested value', () => {
        const obj: any = { a: { b: { c: 1 } } };
        deleteNestedValue(obj, 'a.b.c');
        assert.deepStrictEqual(obj, { a: { b: {} } });
      });

      it('should handle missing path gracefully', () => {
        const obj: any = { a: 1 };
        deleteNestedValue(obj, 'b.c');
        assert.deepStrictEqual(obj, { a: 1 });
      });
    });
  });

  describe('Key Map Validation', () => {
    it('should validate simple key map', () => {
      const keyMap: KeyMap = { theme: 'colorTheme' };
      const result = validateKeyMap(keyMap);

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.errors, []);
    });

    it('should validate complex key map', () => {
      const keyMap: KeyMap = {
        theme: 'colorTheme',
        'ai.*': 'cursor.*',
        fontSize: {
          to: 'editor.fontSize',
          transform: 'number',
          default: 14,
        },
      };
      const result = validateKeyMap(keyMap);

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.errors, []);
    });

    it('should reject empty source key', () => {
      const keyMap: KeyMap = { '': 'target' };
      const result = validateKeyMap(keyMap);

      assert.strictEqual(result.valid, false);
      expect(result.errors).toContain('Empty source key in key map');
    });

    it('should reject empty target', () => {
      const keyMap: KeyMap = { source: '' };
      const result = validateKeyMap(keyMap);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Empty target')));
    });

    it('should reject missing to field', () => {
      const keyMap: KeyMap = {
        source: {
          to: '',
          transform: 'number',
        } as any,
      };
      const result = validateKeyMap(keyMap);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes("Missing or empty 'to' field")));
    });

    it('should reject unknown transforms', () => {
      const keyMap: KeyMap = {
        source: {
          to: 'target',
          transform: 'unknown-transform',
        },
      };
      const result = validateKeyMap(keyMap);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Unknown transform')));
    });

    it('should reject invalid values field', () => {
      const keyMap: KeyMap = {
        source: {
          to: 'target',
          values: 'not-an-object' as any,
        },
      };
      const result = validateKeyMap(keyMap);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Invalid \'values\' field')));
    });

    it('should reject multiple wildcards in pattern', () => {
      const keyMap: KeyMap = { 'a.*.b.*': 'x.*.y.*' };
      const result = validateKeyMap(keyMap);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Multiple wildcards not supported')));
    });

    it('should reject wildcard mismatch', () => {
      const keyMap: KeyMap = { 'a.*': 'b' };
      const result = validateKeyMap(keyMap);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('Wildcard pattern mismatch')));
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle combination of all features', () => {
      const input = {
        theme: 'dark',
        fontSize: '14',
        ai: {
          model: 'gpt-4',
          temperature: '0.7',
        },
        environment: 'dev',
        extra: 'preserved',
      };

      const keyMap: KeyMap = {
        theme: 'workbench.colorTheme',
        fontSize: {
          to: 'editor.fontSize',
          transform: 'number',
        },
        'ai.*': {
          to: 'cursor.ai.*',
          transform: 'string',
        },
        environment: {
          to: 'mode',
          values: {
            dev: 'development',
            prod: 'production',
          },
        },
        missing: {
          to: 'default',
          default: 'value',
        },
      };

      const context = createMockContext();
      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        workbench: {
          colorTheme: 'dark',
        },
        editor: {
          fontSize: 14,
        },
        cursor: {
          ai: {
            model: 'gpt-4',
            temperature: '0.7',
          },
        },
        mode: 'development',
        default: 'value',
        extra: 'preserved',
        ai: {},
      });
    });

    it('should handle mapping to same nested structure', () => {
      const input = {
        a: 1,
        b: 2,
      };

      const keyMap: KeyMap = {
        a: 'nested.a',
        b: 'nested.b',
      };

      const context = createMockContext();
      const result = applyKeyMap(input, keyMap, context);

      assert.deepStrictEqual(result, {
        nested: {
          a: 1,
          b: 2,
        },
      });
    });
  });
});
