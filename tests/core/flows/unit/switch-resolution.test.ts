/**
 * Unit tests for switch expression resolution
 */

import { describe, it, expect } from 'vitest';
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

      expect(result).toBe('.config/opencode');
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

      expect(result).toBe('.opencode');
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

      expect(result).toBe('.opencode');
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

      expect(() => resolveSwitchExpression(switchExpr, context)).toThrow(
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

      expect(result).toBe('home-config');
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

      expect(result).toBe('production');
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

      expect(result).toBe('dev-debug');
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

      expect(() => resolveSwitchExpression(switchExpr, context)).toThrow(
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

      expect(result).toBe('matched');
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

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject switch expression without $switch property', () => {
      const switchExpr = {} as SwitchExpression;

      const result = validateSwitchExpression(switchExpr);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Switch expression must have $switch property');
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

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('field'))).toBe(true);
    });

    it('should reject switch expression without cases', () => {
      const switchExpr: any = {
        $switch: {
          field: '$$targetRoot',
        },
      };

      const result = validateSwitchExpression(switchExpr);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('cases'))).toBe(true);
    });

    it('should reject switch expression with empty cases array', () => {
      const switchExpr: any = {
        $switch: {
          field: '$$targetRoot',
          cases: [],
        },
      };

      const result = validateSwitchExpression(switchExpr);

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('at least one case'))).toBe(true);
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

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('pattern'))).toBe(true);
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

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('value'))).toBe(true);
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

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('value must be a string'))).toBe(true);
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

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('default must be a string'))).toBe(true);
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

      expect(result.valid).toBe(true);
    });
  });
});
