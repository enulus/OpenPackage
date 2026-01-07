import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  invertFlow,
  invertFlows,
  isInvertedFlow,
  getOriginalFlow
} from '../../../src/core/flows/flow-inverter.js';
import type { Flow } from '../../../src/types/flows.js';

describe('Flow Inverter', () => {
  describe('invertFlow', () => {
    it('should swap from and to paths', () => {
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: '.claude/commands/**/*.md'
      };

      const inverted = invertFlow(flow, 'claude');

      assert.strictEqual(inverted.from, '.claude/commands/**/*.md');
      assert.strictEqual(inverted.to, 'commands/**/*.md');
      assert.strictEqual(inverted._inverted, true);
      assert.strictEqual(inverted._sourcePlatform, 'claude');
    });

    it('should invert $rename operations', () => {
      const flow: Flow = {
        from: 'mcp.jsonc',
        to: '.claude/mcp.json',
        map: [
          { $rename: { 'mcp': 'mcpServers' } }
        ]
      };

      const inverted = invertFlow(flow, 'claude');

      assert.ok(inverted.map);
      assert.strictEqual(inverted.map.length, 1);
      assert.deepStrictEqual(inverted.map[0], {
        $rename: { 'mcpServers': 'mcp' }
      });
    });

    it('should invert multiple $rename operations in reverse order', () => {
      const flow: Flow = {
        from: 'config.yaml',
        to: '.claude/config.json',
        map: [
          { $rename: { 'a': 'b' } },
          { $rename: { 'c': 'd' } }
        ]
      };

      const inverted = invertFlow(flow, 'claude');

      assert.ok(inverted.map);
      assert.strictEqual(inverted.map.length, 2);
      // Operations reversed
      assert.deepStrictEqual(inverted.map[0], { $rename: { 'd': 'c' } });
      assert.deepStrictEqual(inverted.map[1], { $rename: { 'b': 'a' } });
    });

    it('should skip $set operations (not reversible)', () => {
      const flow: Flow = {
        from: 'agents/**/*.md',
        to: '.claude/agents/**/*.md',
        map: [
          { $set: { 'name': '$$filename' } },
          { $rename: { 'model': 'modelType' } }
        ]
      };

      const inverted = invertFlow(flow, 'claude');

      assert.ok(inverted.map);
      // $set skipped, only $rename inverted
      assert.strictEqual(inverted.map.length, 1);
      assert.deepStrictEqual(inverted.map[0], { $rename: { 'modelType': 'model' } });
    });

    it('should skip $unset operations (not reversible)', () => {
      const flow: Flow = {
        from: 'agents/**/*.md',
        to: '.claude/agents/**/*.md',
        map: [
          { $unset: 'deprecated' },
          { $rename: { 'tools': 'enabledTools' } }
        ]
      };

      const inverted = invertFlow(flow, 'claude');

      assert.ok(inverted.map);
      // $unset skipped, only $rename inverted
      assert.strictEqual(inverted.map.length, 1);
      assert.deepStrictEqual(inverted.map[0], { $rename: { 'enabledTools': 'tools' } });
    });

    it('should preserve merge strategy', () => {
      const flow: Flow = {
        from: 'mcp.jsonc',
        to: '.claude/mcp.json',
        merge: 'deep'
      };

      const inverted = invertFlow(flow, 'claude');

      assert.strictEqual(inverted.merge, 'deep');
    });

    it('should preserve conditional when', () => {
      const flow: Flow = {
        from: 'config.yaml',
        to: '.claude/config.json',
        when: { platform: 'claude' }
      };

      const inverted = invertFlow(flow, 'claude');

      assert.deepStrictEqual(inverted.when, { platform: 'claude' });
    });

    it('should keep format converters in pipe', () => {
      const flow: Flow = {
        from: 'config.yaml',
        to: '.claude/config.json',
        pipe: ['yaml', 'jsonc']
      };

      const inverted = invertFlow(flow, 'claude');

      assert.ok(inverted.pipe);
      assert.ok(inverted.pipe.includes('yaml'));
      assert.ok(inverted.pipe.includes('jsonc'));
    });

    it('should skip filter transforms in pipe', () => {
      const flow: Flow = {
        from: 'config.yaml',
        to: '.claude/config.json',
        pipe: ['yaml', 'filter-empty', 'filter-null', 'jsonc']
      };

      const inverted = invertFlow(flow, 'claude');

      assert.ok(inverted.pipe);
      assert.ok(inverted.pipe.includes('yaml'));
      assert.ok(inverted.pipe.includes('jsonc'));
      // Filters should be skipped
      assert.ok(!inverted.pipe.includes('filter-empty'));
      assert.ok(!inverted.pipe.includes('filter-null'));
    });

    it('should remove embed field', () => {
      const flow: Flow = {
        from: 'mcp.jsonc',
        to: '.claude/config.json',
        embed: 'mcp'
      };

      const inverted = invertFlow(flow, 'claude');

      assert.strictEqual(inverted.embed, undefined);
    });

    it('should remove section field', () => {
      const flow: Flow = {
        from: 'mcp.jsonc',
        to: '.claude/config.toml',
        section: 'mcp_servers'
      };

      const inverted = invertFlow(flow, 'claude');

      assert.strictEqual(inverted.section, undefined);
    });

    it('should invert $copy operation', () => {
      const flow: Flow = {
        from: 'agents/**/*.md',
        to: '.claude/agents/**/*.md',
        map: [
          {
            $copy: {
              from: 'permission',
              to: 'permissionMode'
            }
          }
        ]
      };

      const inverted = invertFlow(flow, 'claude');

      assert.ok(inverted.map);
      assert.strictEqual(inverted.map.length, 1);
      assert.deepStrictEqual(inverted.map[0], {
        $copy: {
          from: 'permissionMode',
          to: 'permission'
        }
      });
    });

    it('should handle flows with no map operations', () => {
      const flow: Flow = {
        from: 'rules/**/*.md',
        to: '.cursor/rules/**/*.mdc'
      };

      const inverted = invertFlow(flow, 'cursor');

      assert.strictEqual(inverted.from, '.cursor/rules/**/*.mdc');
      assert.strictEqual(inverted.to, 'rules/**/*.md');
      assert.strictEqual(inverted.map, undefined);
    });
  });

  describe('isInvertedFlow', () => {
    it('should return true for inverted flows', () => {
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: '.claude/commands/**/*.md'
      };

      const inverted = invertFlow(flow, 'claude');

      assert.strictEqual(isInvertedFlow(inverted), true);
    });

    it('should return false for normal flows', () => {
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: '.claude/commands/**/*.md'
      };

      assert.strictEqual(isInvertedFlow(flow), false);
    });
  });

  describe('getOriginalFlow', () => {
    it('should return original flow from inverted flow', () => {
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: '.claude/commands/**/*.md'
      };

      const inverted = invertFlow(flow, 'claude');
      const original = getOriginalFlow(inverted);

      assert.deepStrictEqual(original, flow);
    });
  });

  describe('invertFlows', () => {
    it('should invert multiple flows', () => {
      const flows: Flow[] = [
        {
          from: 'commands/**/*.md',
          to: '.claude/commands/**/*.md'
        },
        {
          from: 'agents/**/*.md',
          to: '.claude/agents/**/*.md'
        }
      ];

      const inverted = invertFlows(flows, 'claude');

      assert.strictEqual(inverted.length, 2);
      assert.strictEqual(inverted[0].from, '.claude/commands/**/*.md');
      assert.strictEqual(inverted[0].to, 'commands/**/*.md');
      assert.strictEqual(inverted[1].from, '.claude/agents/**/*.md');
      assert.strictEqual(inverted[1].to, 'agents/**/*.md');
    });

    it('should handle empty flow array', () => {
      const flows: Flow[] = [];

      const inverted = invertFlows(flows, 'claude');

      assert.strictEqual(inverted.length, 0);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle flow with multiple operations', () => {
      const flow: Flow = {
        from: 'agents/**/*.md',
        to: '.claude/agents/**/*.md',
        map: [
          { $set: { 'name': '$$filename' } },
          { $rename: { 'model': 'modelType' } },
          { $unset: 'deprecated' },
          { $rename: { 'tools': 'enabledTools' } }
        ],
        pipe: ['yaml', 'filter-empty', 'jsonc'],
        merge: 'deep'
      };

      const inverted = invertFlow(flow, 'claude');

      // Paths swapped
      assert.strictEqual(inverted.from, '.claude/agents/**/*.md');
      assert.strictEqual(inverted.to, 'agents/**/*.md');

      // Map operations: only $rename inverted, in reverse order
      assert.ok(inverted.map);
      assert.strictEqual(inverted.map.length, 2);
      assert.deepStrictEqual(inverted.map[0], { $rename: { 'enabledTools': 'tools' } });
      assert.deepStrictEqual(inverted.map[1], { $rename: { 'modelType': 'model' } });

      // Pipe: filters skipped, converters kept
      assert.ok(inverted.pipe);
      assert.ok(inverted.pipe.includes('yaml'));
      assert.ok(inverted.pipe.includes('jsonc'));
      assert.ok(!inverted.pipe.includes('filter-empty'));

      // Merge preserved
      assert.strictEqual(inverted.merge, 'deep');
    });
  });
});
