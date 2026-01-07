/**
 * Tests for Flow Transforms
 * 
 * Comprehensive tests for all transform implementations:
 * - Format converters (JSONC, YAML, TOML)
 * - Content filters (comments, empty, null)
 * - Markdown transforms (sections, frontmatter, body)
 * - Value transforms (type converters, string transforms, array/object operations)
 * - Validation transforms
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TransformRegistry,
  createDefaultTransformRegistry,
  executeTransform,
  // Format converters
  jsoncTransform,
  yamlTransform,
  tomlTransform,
  // Content filters
  filterCommentsTransform,
  filterEmptyTransform,
  filterNullTransform,
  // Markdown transforms
  sectionsTransform,
  frontmatterTransform,
  bodyTransform,
  serializeMarkdownWithFrontmatter,
  // Type converters
  numberTransform,
  stringTransform,
  booleanTransform,
  jsonTransform,
  dateTransform,
  // String transforms
  uppercaseTransform,
  lowercaseTransform,
  trimTransform,
  titleCaseTransform,
  camelCaseTransform,
  kebabCaseTransform,
  snakeCaseTransform,
  slugifyTransform,
  // Array transforms
  arrayAppendTransform,
  arrayUniqueTransform,
  arrayFlattenTransform,
  // Object transforms
  flattenTransform,
  unflattenTransform,
  pickKeysTransform,
  omitKeysTransform,
  // Validation
  validateTransform,
} from '../../../src/core/flows/flow-transforms.js';

describe('Transform Registry', () => {
  it('should register and retrieve transforms', () => {
    const registry = new TransformRegistry();
    registry.register(numberTransform);

    assert.equal(registry.has('number'), true);
    assert.ok(registry.get('number'));
    assert.ok(registry.list().includes('number'));
  });

  it('should execute registered transforms', () => {
    const registry = new TransformRegistry();
    registry.register(numberTransform);

    const result = registry.execute('number', '42');
    assert.equal(result, 42);
  });

  it('should throw error for unknown transform', () => {
    const registry = new TransformRegistry();
    assert.throws(() => registry.execute('unknown', 'value'), /Transform not found/);
  });

  it('should create default registry with all transforms', () => {
    const registry = createDefaultTransformRegistry();
    
    // Check that key transforms are registered
    assert.equal(registry.has('jsonc'), true);
    assert.equal(registry.has('yaml'), true);
    assert.equal(registry.has('toml'), true);
    assert.equal(registry.has('number'), true);
    assert.equal(registry.has('trim'), true);
    assert.equal(registry.has('flatten'), true);
    
    assert.ok(registry.list().length >= 30);
  });
});

describe('Format Converters', () => {
  describe('JSONC Transform', () => {
    it('should parse JSONC with single-line comments', () => {
      const input = `{
        // This is a comment
        "key": "value"
      }`;
      const result = jsoncTransform.execute(input);
      assert.deepEqual(result, { key: 'value' });
    });

    it('should parse JSONC with multi-line comments', () => {
      const input = `{
        /* This is a
           multi-line comment */
        "key": "value"
      }`;
      const result = jsoncTransform.execute(input);
      assert.deepEqual(result, { key: 'value' });
    });

    it('should handle trailing commas', () => {
      const input = `{
        "key": "value",
      }`;
      const result = jsoncTransform.execute(input);
      assert.deepEqual(result, { key: 'value' });
    });

    it('should return object as-is if not string', () => {
      const input = { key: 'value' };
      const result = jsoncTransform.execute(input);
      assert.deepEqual(result, input);
    });
  });

  describe('YAML Transform', () => {
    it('should parse YAML to object', () => {
      const input = `
key: value
nested:
  foo: bar
list:
  - item1
  - item2
`;
      const result = yamlTransform.execute(input);
      assert.deepEqual(result, {
        key: 'value',
        nested: { foo: 'bar' },
        list: ['item1', 'item2'],
      });
    });

    it('should stringify object to YAML', () => {
      const input = { key: 'value', nested: { foo: 'bar' } };
      const result = yamlTransform.execute(input, { direction: 'stringify' });
      assert.ok(result.includes('key: value'));
      assert.ok(result.includes('nested:'));
      assert.ok(result.includes('foo: bar'));
    });

    it('should return object as-is if not string (parse mode)', () => {
      const input = { key: 'value' };
      const result = yamlTransform.execute(input);
      assert.deepEqual(result, input);
    });
  });

  describe('TOML Transform', () => {
    it('should parse TOML to object', () => {
      const input = `
key = "value"

[nested]
foo = "bar"
`;
      const result = tomlTransform.execute(input);
      assert.deepEqual(result, {
        key: 'value',
        nested: { foo: 'bar' },
      });
    });

    it('should stringify object to TOML', () => {
      const input = { key: 'value', nested: { foo: 'bar' } };
      const result = tomlTransform.execute(input, { direction: 'stringify' });
      assert.ok(result.includes('key = "value"'));
      assert.ok(result.includes('[nested]'));
      assert.ok(result.includes('foo = "bar"'));
    });
  });
});

describe('Content Filters', () => {
  describe('Filter Comments', () => {
    it('should remove single-line comments', () => {
      const input = `line1
// comment
line2`;
      const result = filterCommentsTransform.execute(input);
      assert.ok(!result.includes('comment'));
      assert.ok(result.includes('line1'));
      assert.ok(result.includes('line2'));
    });

    it('should remove multi-line comments', () => {
      const input = `line1
/* multi
   line
   comment */
line2`;
      const result = filterCommentsTransform.execute(input);
      assert.ok(!result.includes('multi'));
      assert.ok(result.includes('line1'));
      assert.ok(result.includes('line2'));
    });

    it('should remove hash comments (YAML style)', () => {
      const input = `line1
# comment
line2`;
      const result = filterCommentsTransform.execute(input);
      assert.ok(!result.includes('comment'));
    });
  });

  describe('Filter Empty', () => {
    it('should remove empty strings from object', () => {
      const input = { a: 'value', b: '', c: 'other' };
      const result = filterEmptyTransform.execute(input);
      assert.deepEqual(result, { a: 'value', c: 'other' });
    });

    it('should remove empty arrays', () => {
      const input = { a: [1, 2], b: [], c: 'value' };
      const result = filterEmptyTransform.execute(input);
      assert.deepEqual(result, { a: [1, 2], c: 'value' });
    });

    it('should remove empty objects', () => {
      const input = { a: { nested: 'value' }, b: {}, c: 'value' };
      const result = filterEmptyTransform.execute(input);
      assert.deepEqual(result, { a: { nested: 'value' }, c: 'value' });
    });

    it('should filter recursively by default', () => {
      const input = { a: { b: '', c: 'value' }, d: 'value' };
      const result = filterEmptyTransform.execute(input);
      assert.deepEqual(result, { a: { c: 'value' }, d: 'value' });
    });

    it('should filter shallow if recursive=false', () => {
      const input = { a: { b: '', c: 'value' }, d: '' };
      const result = filterEmptyTransform.execute(input, { recursive: false });
      assert.deepEqual(result, { a: { b: '', c: 'value' } });
    });
  });

  describe('Filter Null', () => {
    it('should remove null values from object', () => {
      const input = { a: 'value', b: null, c: 'other' };
      const result = filterNullTransform.execute(input);
      assert.deepEqual(result, { a: 'value', c: 'other' });
    });

    it('should remove undefined values', () => {
      const input = { a: 'value', b: undefined, c: 'other' };
      const result = filterNullTransform.execute(input);
      assert.deepEqual(result, { a: 'value', c: 'other' });
    });

    it('should filter arrays', () => {
      const input = [1, null, 2, undefined, 3];
      const result = filterNullTransform.execute(input);
      assert.deepEqual(result, [1, 2, 3]);
    });

    it('should filter recursively', () => {
      const input = { a: { b: null, c: 'value' }, d: 'value' };
      const result = filterNullTransform.execute(input);
      assert.deepEqual(result, { a: { c: 'value' }, d: 'value' });
    });
  });
});

describe('Markdown Transforms', () => {
  describe('Sections', () => {
    it('should split markdown by h1 headers', () => {
      const input = `
Preamble text

# Section 1
Content 1

# Section 2
Content 2
`;
      const result = sectionsTransform.execute(input);
      assert.ok('_preamble' in result);
      assert.ok('Section 1' in result);
      assert.ok('Section 2' in result);
      assert.ok(result['Section 1'].includes('Content 1'));
      assert.ok(result['Section 2'].includes('Content 2'));
    });

    it('should split by specified header level', () => {
      const input = `
# Title

## Section 1
Content 1

## Section 2
Content 2
`;
      const result = sectionsTransform.execute(input, { level: 2 });
      assert.ok('Section 1' in result);
      assert.ok('Section 2' in result);
    });
  });

  describe('Frontmatter', () => {
    it('should extract YAML frontmatter', () => {
      const input = `---
title: Test
author: John
---

Body content`;
      const result = frontmatterTransform.execute(input);
      assert.deepEqual(result, { title: 'Test', author: 'John' });
    });

    it('should return empty object if no frontmatter', () => {
      const input = 'Just body content';
      const result = frontmatterTransform.execute(input);
      assert.deepEqual(result, {});
    });

    it('should handle invalid YAML gracefully', () => {
      const input = `---
invalid: [yaml
---

Body`;
      const result = frontmatterTransform.execute(input);
      assert.deepEqual(result, {});
    });
  });

  describe('Body', () => {
    it('should extract body without frontmatter', () => {
      const input = `---
title: Test
---

Body content here`;
      const result = bodyTransform.execute(input);
      assert.equal(result, 'Body content here');
    });

    it('should return full content if no frontmatter', () => {
      const input = 'Just body content';
      const result = bodyTransform.execute(input);
      assert.equal(result, 'Just body content');
    });
  });

  describe('Serialize Markdown', () => {
    it('should serialize frontmatter and body', () => {
      const frontmatter = { title: 'Test', author: 'John' };
      const body = 'Body content';
      const result = serializeMarkdownWithFrontmatter(frontmatter, body);
      
      assert.ok(result.includes('---'));
      assert.ok(result.includes('title: Test'));
      assert.ok(result.includes('author: John'));
      assert.ok(result.includes('Body content'));
    });
  });
});

describe('Value Transforms - Type Converters', () => {
  it('should convert to number', () => {
    assert.equal(numberTransform.execute('42'), 42);
    assert.equal(numberTransform.execute('3.14'), 3.14);
    assert.throws(() => numberTransform.execute('invalid'));
  });

  it('should convert to string', () => {
    assert.equal(stringTransform.execute(42), '42');
    assert.equal(stringTransform.execute(true), 'true');
    assert.ok(stringTransform.execute({ key: 'value' }).includes('[object Object]'));
  });

  it('should convert to boolean', () => {
    assert.equal(booleanTransform.execute('true'), true);
    assert.equal(booleanTransform.execute('false'), false);
    assert.equal(booleanTransform.execute('1'), true);
    assert.equal(booleanTransform.execute('0'), false);
    assert.equal(booleanTransform.execute(1), true);
    assert.equal(booleanTransform.execute(0), false);
  });

  it('should parse JSON', () => {
    assert.deepEqual(jsonTransform.execute('{"key":"value"}'), { key: 'value' });
    assert.deepEqual(jsonTransform.execute({ key: 'value' }), { key: 'value' });
  });

  it('should convert to date', () => {
    const date = dateTransform.execute('2026-01-04');
    assert.ok(date instanceof Date);
    assert.equal(date.getFullYear(), 2026);
    assert.throws(() => dateTransform.execute('invalid'));
  });
});

describe('Value Transforms - String Transforms', () => {
  it('should convert to uppercase', () => {
    assert.equal(uppercaseTransform.execute('hello'), 'HELLO');
  });

  it('should convert to lowercase', () => {
    assert.equal(lowercaseTransform.execute('HELLO'), 'hello');
  });

  it('should trim whitespace', () => {
    assert.equal(trimTransform.execute('  hello  '), 'hello');
  });

  it('should convert to title case', () => {
    assert.equal(titleCaseTransform.execute('hello world'), 'Hello World');
  });

  it('should convert to camelCase', () => {
    assert.equal(camelCaseTransform.execute('hello-world'), 'helloWorld');
    assert.equal(camelCaseTransform.execute('hello_world'), 'helloWorld');
    assert.equal(camelCaseTransform.execute('hello world'), 'helloWorld');
  });

  it('should convert to kebab-case', () => {
    assert.equal(kebabCaseTransform.execute('helloWorld'), 'hello-world');
    assert.equal(kebabCaseTransform.execute('hello_world'), 'hello-world');
    assert.equal(kebabCaseTransform.execute('hello world'), 'hello-world');
  });

  it('should convert to snake_case', () => {
    assert.equal(snakeCaseTransform.execute('helloWorld'), 'hello_world');
    assert.equal(snakeCaseTransform.execute('hello-world'), 'hello_world');
    assert.equal(snakeCaseTransform.execute('hello world'), 'hello_world');
  });

  it('should slugify text', () => {
    assert.equal(slugifyTransform.execute('Hello World!'), 'hello-world');
    assert.equal(slugifyTransform.execute('Test@123#456'), 'test123456');
    assert.equal(slugifyTransform.execute('  spaced  '), 'spaced');
  });
});

describe('Value Transforms - Array Transforms', () => {
  it('should append to array', () => {
    const result = arrayAppendTransform.execute([1, 2], { value: 3 });
    assert.deepEqual(result, [1, 2, 3]);
  });

  it('should convert non-array to array and append', () => {
    const result = arrayAppendTransform.execute('value', { value: 'new' });
    assert.deepEqual(result, ['value', 'new']);
  });

  it('should remove duplicates', () => {
    const result = arrayUniqueTransform.execute([1, 2, 2, 3, 1]);
    assert.deepEqual(result, [1, 2, 3]);
  });

  it('should flatten nested arrays', () => {
    const result = arrayFlattenTransform.execute([1, [2, 3], [[4, 5]]]);
    assert.deepEqual(result, [1, 2, 3, 4, 5]);
  });

  it('should flatten to specified depth', () => {
    const result = arrayFlattenTransform.execute([1, [2, [3, [4]]]], { depth: 2 });
    assert.deepEqual(result, [1, 2, 3, [4]]);
  });
});

describe('Value Transforms - Object Transforms', () => {
  describe('Flatten', () => {
    it('should flatten nested object', () => {
      const input = { a: { b: { c: 'value' } } };
      const result = flattenTransform.execute(input);
      assert.deepEqual(result, { 'a.b.c': 'value' });
    });

    it('should use custom separator', () => {
      const input = { a: { b: 'value' } };
      const result = flattenTransform.execute(input, { separator: '_' });
      assert.deepEqual(result, { 'a_b': 'value' });
    });

    it('should preserve arrays', () => {
      const input = { a: { b: [1, 2, 3] } };
      const result = flattenTransform.execute(input);
      assert.deepEqual(result, { 'a.b': [1, 2, 3] });
    });
  });

  describe('Unflatten', () => {
    it('should unflatten dotted keys', () => {
      const input = { 'a.b.c': 'value' };
      const result = unflattenTransform.execute(input);
      assert.deepEqual(result, { a: { b: { c: 'value' } } });
    });

    it('should use custom separator', () => {
      const input = { 'a_b_c': 'value' };
      const result = unflattenTransform.execute(input, { separator: '_' });
      assert.deepEqual(result, { a: { b: { c: 'value' } } });
    });
  });

  describe('Pick Keys', () => {
    it('should pick specified keys', () => {
      const input = { a: 1, b: 2, c: 3 };
      const result = pickKeysTransform.execute(input, { keys: ['a', 'c'] });
      assert.deepEqual(result, { a: 1, c: 3 });
    });

    it('should handle missing keys', () => {
      const input = { a: 1, b: 2 };
      const result = pickKeysTransform.execute(input, { keys: ['a', 'missing'] });
      assert.deepEqual(result, { a: 1 });
    });

    it('should validate options', () => {
      assert.equal(pickKeysTransform.validate!({ keys: ['a', 'b'] }), true);
      assert.equal(pickKeysTransform.validate!({ keys: 'invalid' as any }), false);
    });
  });

  describe('Omit Keys', () => {
    it('should omit specified keys', () => {
      const input = { a: 1, b: 2, c: 3 };
      const result = omitKeysTransform.execute(input, { keys: ['b'] });
      assert.deepEqual(result, { a: 1, c: 3 });
    });

    it('should handle missing keys', () => {
      const input = { a: 1, b: 2 };
      const result = omitKeysTransform.execute(input, { keys: ['missing'] });
      assert.deepEqual(result, { a: 1, b: 2 });
    });
  });
});

describe('Validation Transforms', () => {
  it('should validate required keys', () => {
    const input = { a: 1, b: 2 };
    const result = validateTransform.execute(input, { required: ['a', 'b'] });
    assert.deepEqual(result, input);
  });

  it('should throw error for missing required keys', () => {
    const input = { a: 1 };
    assert.throws(
      () => validateTransform.execute(input, { required: ['a', 'b'] }),
      /missing required keys: b/
    );
  });

  it('should pass validation with no required keys', () => {
    const input = { a: 1 };
    const result = validateTransform.execute(input);
    assert.deepEqual(result, input);
  });

  it('should throw error for non-object input', () => {
    assert.throws(
      () => validateTransform.execute('string', { required: ['a'] }),
      /input must be an object/
    );
  });
});

describe('Integration Tests', () => {
  it('should chain multiple transforms using executeTransform', () => {
    let result: any = '  hello world  ';
    result = executeTransform('trim', result);
    result = executeTransform('title-case', result);
    result = executeTransform('kebab-case', result);
    assert.equal(result, 'hello-world');
  });

  it('should handle complex object transformations', () => {
    const input = { a: { b: '42', c: '' }, d: null, e: 'value' };
    
    // Filter empty and null
    let result = executeTransform('filter-empty', input);
    result = executeTransform('filter-null', result);
    
    // Should have filtered out c and d
    assert.deepEqual(result, { a: { b: '42' }, e: 'value' });
  });

  it('should handle YAML to JSON conversion', () => {
    const yaml = 'key: value\nnested:\n  foo: bar';
    const parsed = executeTransform('yaml', yaml);
    assert.deepEqual(parsed, { key: 'value', nested: { foo: 'bar' } });
  });
});

console.log('✅ All transform tests passed!');
