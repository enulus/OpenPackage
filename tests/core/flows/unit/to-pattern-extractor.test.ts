/**
 * Unit tests for extractToPatternString
 *
 * Regression coverage for GH issue #54: a `to:` field shaped as
 * `{ pattern: "...", schema: "..." }` was previously falling through to the
 * multi-target catch-all and producing the literal string "pattern".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractToPatternString } from '../../../../packages/core/src/core/flows/to-pattern-extractor.js';
import type { Flow, SwitchExpression } from '../../../../packages/core/src/types/flows.js';

describe('extractToPatternString', () => {
  const failOnSwitch = (sw: SwitchExpression): string | undefined => {
    throw new Error(`switch resolver should not have been called: ${JSON.stringify(sw)}`);
  };

  it('returns the string as-is when `to` is a plain string', () => {
    const result = extractToPatternString('agents/foo.md', failOnSwitch);
    assert.strictEqual(result, 'agents/foo.md');
  });

  it('returns the .pattern property when `to` is a FlowPattern (issue #54)', () => {
    const to = {
      pattern: 'agents/**/*.md',
      schema: './schemas/formats/universal-agent.schema.json',
    } as unknown as Flow['to'];
    const result = extractToPatternString(to, failOnSwitch);
    assert.strictEqual(result, 'agents/**/*.md');
  });

  it('returns the first key when `to` is a MultiTargetFlows object', () => {
    const to: Flow['to'] = {
      '.cursor/rules/{name}.mdc': { merge: 'replace' },
      '.cursor/rules/extra.mdc': { merge: 'deep' },
    };
    const result = extractToPatternString(to, failOnSwitch);
    assert.strictEqual(result, '.cursor/rules/{name}.mdc');
  });

  it('delegates to the resolver callback when `to` is a SwitchExpression', () => {
    const to: SwitchExpression = {
      $switch: {
        field: '$$targetRoot',
        cases: [
          { pattern: '~/', value: '.config/opencode' },
        ],
        default: 'fallback.md',
      },
    };
    let received: SwitchExpression | undefined;
    const result = extractToPatternString(to, (sw) => {
      received = sw;
      return 'resolved-by-callback.md';
    });
    assert.strictEqual(result, 'resolved-by-callback.md');
    assert.strictEqual(received, to);
  });

  it('returns undefined for null/non-object inputs', () => {
    assert.strictEqual(extractToPatternString(null as unknown as Flow['to'], failOnSwitch), undefined);
  });
});
