import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  markdownTransform,
  markdownToJsonTransform,
  jsonToMarkdownTransform,
  createDefaultTransformRegistry,
} from '../../../../packages/core/src/core/flows/flow-transforms.js';

describe('Markdown Transforms', () => {
  describe('markdown transform — parse direction', () => {
    it('parses Markdown with YAML frontmatter into { frontmatter, body }', () => {
      const input = '---\nname: code-reviewer\nmodel: opus\n---\n\nReview code.';
      const result = markdownTransform.execute(input, { direction: 'parse' });

      assert.deepEqual(result.frontmatter, { name: 'code-reviewer', model: 'opus' });
      assert.equal(result.body, 'Review code.');
    });

    it('returns { body } with no frontmatter key for body-only Markdown', () => {
      const input = 'Just a body, no frontmatter.';
      const result = markdownTransform.execute(input, { direction: 'parse' });

      assert.equal(result.body, 'Just a body, no frontmatter.');
      assert.equal('frontmatter' in result, false);
    });

    it('defaults to parse direction when no options given', () => {
      const input = '---\nkey: value\n---\n\nbody';
      const result = markdownTransform.execute(input);

      assert.deepEqual(result.frontmatter, { key: 'value' });
      assert.equal(result.body, 'body');
    });

    it('passes non-string input through unchanged', () => {
      const input = { already: 'an object' };
      const result = markdownTransform.execute(input, { direction: 'parse' });
      assert.equal(result, input);
    });
  });

  describe('markdown transform — stringify direction', () => {
    it('serializes { frontmatter, body } to Markdown', () => {
      const input = { frontmatter: { name: 'agent', model: 'opus' }, body: 'Body here.' };
      const result = markdownTransform.execute(input, { direction: 'stringify' });

      assert.equal(typeof result, 'string');
      assert.ok(result.startsWith('---\n'));
      assert.ok(result.includes('name: agent'));
      assert.ok(result.includes('model: opus'));
      assert.ok(result.endsWith('Body here.'));
    });

    it('passes string input through unchanged', () => {
      const input = 'already a string';
      const result = markdownTransform.execute(input, { direction: 'stringify' });
      assert.equal(result, input);
    });
  });

  describe('round-trip', () => {
    it('preserves frontmatter (deep-equal) and body (whitespace-tolerant)', () => {
      const original = {
        frontmatter: { name: 'agent', description: 'Reviews code', tags: ['review', 'qa'] },
        body: 'This is the agent body.\n\nSecond paragraph.',
      };

      const stringified = markdownTransform.execute(original, { direction: 'stringify' });
      const reparsed = markdownTransform.execute(stringified, { direction: 'parse' });

      assert.deepEqual(reparsed.frontmatter, original.frontmatter);
      assert.equal(reparsed.body.trim(), original.body.trim());
    });

    it('is byte-exact for body-only inputs', () => {
      const original = 'plain markdown without frontmatter';
      const parsed = markdownTransform.execute(original, { direction: 'parse' });
      const restringified = markdownTransform.execute(parsed, { direction: 'stringify' });
      assert.equal(restringified, original);
    });
  });

  describe('alias delegation', () => {
    it('markdown-to-json delegates to markdown { direction: parse }', () => {
      const input = '---\nname: x\n---\n\nbody';
      assert.deepEqual(
        markdownToJsonTransform.execute(input),
        markdownTransform.execute(input, { direction: 'parse' }),
      );
    });

    it('json-to-markdown delegates to markdown { direction: stringify }', () => {
      const input = { frontmatter: { name: 'x' }, body: 'body' };
      assert.equal(
        jsonToMarkdownTransform.execute(input),
        markdownTransform.execute(input, { direction: 'stringify' }),
      );
    });
  });

  describe('registry registration', () => {
    it('registers markdown, markdown-to-json, json-to-markdown', () => {
      const registry = createDefaultTransformRegistry();
      assert.ok(registry.has('markdown'), 'markdown should be registered');
      assert.ok(registry.has('markdown-to-json'), 'markdown-to-json should be registered');
      assert.ok(registry.has('json-to-markdown'), 'json-to-markdown should be registered');
    });

    it('runs end-to-end via the registry execute path', () => {
      const registry = createDefaultTransformRegistry();
      const input = '---\nname: registered\n---\n\nbody';
      const result = registry.execute('markdown-to-json', input);
      assert.deepEqual(result.frontmatter, { name: 'registered' });
      assert.equal(result.body, 'body');
    });
  });
});
