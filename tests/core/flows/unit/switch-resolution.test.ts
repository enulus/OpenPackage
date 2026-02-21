/**
 * Unit tests for switch expression resolution
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSwitchExpression, validateSwitchExpression } from '../../../../src/core/flows/switch-resolver.js';
import type { SwitchExpression, FlowContext } from '../../../../src/types/flows.js';

describe('Switch Expression Resolution', () => {
  const createContext = (variables: Record<string, any>): FlowContext => ({
    workspaceRoot: '/workspace',
    packageRoot: '/package',
    platform: 'test',
    packageName: 'test-package',
    variables,
    direction: 'install' as const,
  });

  describe('resolveSwitchExpression', () => {
    it('should resolve with first matching case (exact match)', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '~/', value: '.config/opencode' },
            { pattern: '/project', value: '.opencode' },
          ],
        },
      };

      const context = createContext({ targetRoot: '~/' });
      const result = resolveSwitchExpression(switchExpr, context);

      assert.strictEqual(result, '.config/opencode');
    });

    it('should resolve with second case when first does not match', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '~/', value: '.config/opencode' },
            { pattern: '/project', value: '.opencode' },
          ],
        },
      };

      const context = createContext({ targetRoot: '/project' });
      const result = resolveSwitchExpression(switchExpr, context);

      assert.strictEqual(result, '.opencode');
    });

    it('should use default when no cases match', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '~/', value: '.config/opencode' },
          ],
          default: '.opencode',
        },
      };

      const context = createContext({ targetRoot: '/some/other/path' });
      const result = resolveSwitchExpression(switchExpr, context);

      assert.strictEqual(result, '.opencode');
    });

    it('should throw error when no cases match and no default', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '~/', value: '.config/opencode' },
          ],
        },
      };

      const context = createContext({ targetRoot: '/some/other/path' });

      assert.throws(
        () => resolveSwitchExpression(switchExpr, context),
        /No matching case in \$switch expression/
      );
    });

    it('should support glob patterns in cases', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '/home/*', value: 'home-config' },
            { pattern: '/opt/*', value: 'opt-config' },
          ],
          default: 'default-config',
        },
      };

      const context = createContext({ targetRoot: '/home/user' });
      const result = resolveSwitchExpression(switchExpr, context);

      assert.strictEqual(result, 'home-config');
    });

    it('should match first case when multiple patterns match', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$env',
          cases: [
            { pattern: 'prod*', value: 'production' },
            { pattern: 'prod', value: 'prod-specific' },
          ],
        },
      };

      const context = createContext({ env: 'production' });
      const result = resolveSwitchExpression(switchExpr, context);

      assert.strictEqual(result, 'production');
    });

    it('should support object pattern matching', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$config',
          cases: [
            { pattern: { type: 'dev', debug: true }, value: 'dev-debug' },
            { pattern: { type: 'dev' }, value: 'dev' },
          ],
          default: 'prod',
        },
      };

      const context = createContext({ config: { type: 'dev', debug: true } });
      const result = resolveSwitchExpression(switchExpr, context);

      assert.strictEqual(result, 'dev-debug');
    });

    it('should throw error for undefined variable', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$unknownVar',
          cases: [
            { pattern: 'value', value: 'result' },
          ],
        },
      };

      const context = createContext({ targetRoot: '~/' });

      assert.throws(
        () => resolveSwitchExpression(switchExpr, context),
        /Variable 'unknownVar' not found/
      );
    });

    it('should handle literal field values (non-variables)', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: 'literal',
          cases: [
            { pattern: 'literal', value: 'matched' },
          ],
          default: 'not-matched',
        },
      };

      const context = createContext({});
      const result = resolveSwitchExpression(switchExpr, context);

      assert.strictEqual(result, 'matched');
    });
  });

  describe('validateSwitchExpression', () => {
    it('should validate a valid switch expression', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '~/', value: '.config/opencode' },
          ],
          default: '.opencode',
        },
      };

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject switch expression without $switch property', () => {
      const switchExpr = {} as SwitchExpression;

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.includes('Switch expression must have $switch property'));
    });

    it('should reject switch expression without field', () => {
      const switchExpr: any = {
        $switch: {
          cases: [
            { pattern: '~/', value: '.config/opencode' },
          ],
        },
      };

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.some(e => e.includes('field')), true);
    });

    it('should reject switch expression without cases', () => {
      const switchExpr: any = {
        $switch: {
          field: '$$targetRoot',
        },
      };

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.some(e => e.includes('cases')), true);
    });

    it('should reject switch expression with empty cases array', () => {
      const switchExpr: any = {
        $switch: {
          field: '$$targetRoot',
          cases: [],
        },
      };

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.some(e => e.includes('at least one case')), true);
    });

    it('should reject case without pattern', () => {
      const switchExpr: any = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { value: '.config/opencode' },
          ],
        },
      };

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.some(e => e.includes('pattern')), true);
    });

    it('should reject case without value', () => {
      const switchExpr: any = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '~/' },
          ],
        },
      };

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.some(e => e.includes('value')), true);
    });

    it('should reject non-string value', () => {
      const switchExpr: any = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '~/', value: 123 },
          ],
        },
      };

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.some(e => e.includes('value must be a string')), true);
    });

    it('should reject non-string default', () => {
      const switchExpr: any = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '~/', value: '.config' },
          ],
          default: 123,
        },
      };

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.errors.some(e => e.includes('default must be a string')), true);
    });

    it('should accept valid default value', () => {
      const switchExpr: SwitchExpression = {
        $switch: {
          field: '$$targetRoot',
          cases: [
            { pattern: '~/', value: '.config/opencode' },
          ],
          default: '.opencode',
        },
      };

      const result = validateSwitchExpression(switchExpr);

      assert.strictEqual(result.valid, true);
    });
  });
});
