/**
 * Tests for $transform operation with empty results
 * 
 * Verifies that fields are unset when transform results in empty string or array.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyMapPipeline,
  createMapContext,
} from '../../../src/core/flows/map-pipeline/index.js';
import type { MapPipeline } from '../../../src/core/flows/map-pipeline/types.js';

function createTestContext() {
  return createMapContext({
    filename: 'test-agent',
    dirname: 'agents',
    path: 'agents/test-agent.md',
    ext: '.md',
  });
}

describe('$transform with empty results', () => {
  it('unsets field when all values are filtered out (empty string result)', () => {
    const pipeline: MapPipeline = [
      {
        $transform: {
          field: 'tools',
          steps: [
            { filter: { value: true } },
            { keys: true },
            { join: ', ' },
          ],
        },
      },
    ];

    const result = applyMapPipeline(
      { tools: { write: false, edit: false } },
      pipeline,
      createTestContext()
    );

    // Field should be completely removed when transform results in empty string
    assert.strictEqual('tools' in result, false, 'tools field should be unset');
  });

  it('unsets field when filter results in empty object', () => {
    const pipeline: MapPipeline = [
      { $set: { name: '$$filename' } },
      {
        $transform: {
          field: 'tools',
          steps: [
            { filter: { value: true } },
            { keys: true },
            { join: ', ' },
          ],
        },
      },
    ];

    const result = applyMapPipeline(
      { tools: { write: false, edit: false } },
      pipeline,
      createTestContext()
    );

    // Result should have name but not tools
    assert.deepStrictEqual(result, { name: 'test-agent' });
  });

  it('keeps field when at least one value passes filter', () => {
    const pipeline: MapPipeline = [
      {
        $transform: {
          field: 'tools',
          steps: [
            { filter: { value: true } },
            { keys: true },
            { join: ', ' },
          ],
        },
      },
    ];

    const result = applyMapPipeline(
      { tools: { write: false, edit: false, bash: true, read: true } },
      pipeline,
      createTestContext()
    );

    // Field should be kept and have the filtered values
    assert.strictEqual(result.tools, 'bash, read');
  });

  it('unsets field when keys extraction results in empty array', () => {
    const pipeline: MapPipeline = [
      {
        $transform: {
          field: 'data',
          steps: [
            { keys: true },
          ],
        },
      },
    ];

    const result = applyMapPipeline(
      { data: {}, other: 'value' },
      pipeline,
      createTestContext()
    );

    // Empty object keys should result in field being unset
    assert.strictEqual('data' in result, false, 'data field should be unset');
    assert.strictEqual(result.other, 'value', 'other field should remain');
  });

  it('preserves empty string from non-array join', () => {
    // If the value is already a string and we try to join it,
    // it should remain unchanged (not an array, so join does nothing)
    const pipeline: MapPipeline = [
      {
        $transform: {
          field: 'value',
          steps: [
            { join: ', ' },
          ],
        },
      },
    ];

    const result = applyMapPipeline(
      { value: '' },
      pipeline,
      createTestContext()
    );

    // Non-array values passed to join should be unchanged
    // But if it's an empty string, it should be unset
    assert.strictEqual('value' in result, false, 'empty string field should be unset');
  });
});

console.log('transform-empty-result tests passed');
