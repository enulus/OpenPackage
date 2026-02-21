/**
 * Test $map operation with replace-based value mapping
 * 
 * This tests the fix for supporting lookup table value replacement
 * in the $map operation, as used in the claude-plugin import flows.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executePipeline, validatePipeline } from '../../../src/core/flows/map-pipeline/operations/transform.js';

describe('$map operation - replace mode', () => {
  it('should support replace-based value mapping', () => {
    const document = {
      tools: ['read', 'write', 'askuserquestion', 'bash', 'notebookedit', 'exitplanmode']
    };

    const operation = {
      $pipeline: {
        field: 'tools',
        operations: [
          {
            $map: {
              replace: {
                askuserquestion: 'question',
                notebookedit: 'notebook',
                exitplanmode: 'exitplan'
              }
            }
          }
        ]
      }
    };

    const result = executePipeline(document, operation, { variables: {} });

    assert.deepStrictEqual(result.tools, [
      'read',
      'write',
      'question',
      'bash',
      'notebook',
      'exitplan'
    ]);
  });

  it('should preserve unmapped values when using replace mapping', () => {
    const document = {
      items: ['apple', 'banana', 'cherry']
    };

    const operation = {
      $pipeline: {
        field: 'items',
        operations: [
          {
            $map: {
              replace: {
                banana: 'plantain'
              }
            }
          }
        ]
      }
    };

    const result = executePipeline(document, operation, { variables: {} });

    assert.deepStrictEqual(result.items, ['apple', 'plantain', 'cherry']);
  });

  it('should validate replace mapping as valid', () => {
    const operation = {
      $pipeline: {
        field: 'tools',
        operations: [
          {
            $map: {
              replace: {
                askuserquestion: 'question',
                notebookedit: 'notebook'
              }
            }
          }
        ]
      }
    };

    const validation = validatePipeline(operation);
    assert.strictEqual(validation.valid, true);
    assert.deepStrictEqual(validation.errors, []);
  });

  it('should still support string transformations (capitalize)', () => {
    const document = {
      tools: ['read', 'write', 'bash']
    };

    const operation = {
      $pipeline: {
        field: 'tools',
        operations: [
          {
            $map: {
              each: 'capitalize'
            }
          }
        ]
      }
    };

    const result = executePipeline(document, operation, { variables: {} });
    assert.deepStrictEqual(result.tools, ['Read', 'Write', 'Bash']);
  });

  it('should still support string transformations (uppercase)', () => {
    const document = {
      tools: ['read', 'write', 'bash']
    };

    const operation = {
      $pipeline: {
        field: 'tools',
        operations: [
          {
            $map: {
              each: 'uppercase'
            }
          }
        ]
      }
    };

    const result = executePipeline(document, operation, { variables: {} });
    assert.deepStrictEqual(result.tools, ['READ', 'WRITE', 'BASH']);
  });

  it('should still support string transformations (lowercase)', () => {
    const document = {
      tools: ['Read', 'Write', 'Bash']
    };

    const operation = {
      $pipeline: {
        field: 'tools',
        operations: [
          {
            $map: {
              each: 'lowercase'
            }
          }
        ]
      }
    };

    const result = executePipeline(document, operation, { variables: {} });
    assert.deepStrictEqual(result.tools, ['read', 'write', 'bash']);
  });

  it('should reject invalid $map configurations', () => {
    const operation = {
      $pipeline: {
        field: 'tools',
        operations: [
          {
            $map: {
              each: 123  // Invalid: not a valid string transformation
            }
          }
        ]
      }
    };

    const validation = validatePipeline(operation);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.length > 0);
  });

  it('should reject $map with both each and replace', () => {
    const operation = {
      $pipeline: {
        field: 'tools',
        operations: [
          {
            $map: {
              each: 'lowercase',
              replace: { 'foo': 'bar' }  // Cannot have both
            }
          }
        ]
      }
    };

    const validation = validatePipeline(operation);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.includes(
      '$pipeline.operations[0].$map cannot have both \'each\' and \'replace\' properties'
    ));
  });

  it('should reject $map with neither each nor replace', () => {
    const operation = {
      $pipeline: {
        field: 'tools',
        operations: [
          {
            $map: {}  // Empty config
          }
        ]
      }
    };

    const validation = validatePipeline(operation);
    assert.strictEqual(validation.valid, false);
    assert.ok(validation.errors.includes(
      '$pipeline.operations[0].$map must have either \'each\' or \'replace\' property'
    ));
  });

  it('should work in a complete claude-plugin import flow scenario', () => {
    // This simulates the exact flow from platforms.jsonc
    const document = {
      tools: 'Read, Write, AskUserQuestion, Bash, NotebookEdit'
    };

    const operation = {
      $pipeline: {
        field: 'tools',
        operations: [
          // Step 1: Split "Read, Write, Bash" → ["Read", "Write", "Bash"]
          { $reduce: { type: 'split', separator: ', ' } },
          // Step 2: Lowercase all
          { $map: { each: 'lowercase' } },
          // Step 3: Replace special cases AFTER lowercase
          {
            $map: {
              replace: {
                askuserquestion: 'question',
                notebookedit: 'notebook',
                exitplanmode: 'exitplan'
              }
            }
          }
        ]
      }
    };

    const result = executePipeline(document, operation, { variables: {} });

    assert.deepStrictEqual(result.tools, [
      'read',
      'write',
      'question',
      'bash',
      'notebook'
    ]);
  });
});
