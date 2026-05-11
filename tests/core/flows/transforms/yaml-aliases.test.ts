/**
 * YAML Alias Transform Tests
 *
 * Regression coverage for `yaml-to-json` and `json-to-yaml` aliases.
 * Both aliases are referenced by the bundled Goose flows (platforms.jsonc
 * around the Goose MCP install/import) and were previously unregistered,
 * causing `Transform not found` crashes at install time.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import yaml from 'js-yaml';
import {
  yamlTransform,
  yamlToJsonTransform,
  jsonToYamlTransform,
  createDefaultTransformRegistry,
} from '../../../../packages/core/src/core/flows/flow-transforms.js';

describe('YAML alias transforms', () => {
  describe('registry registration', () => {
    it('registers yaml-to-json and json-to-yaml', () => {
      const registry = createDefaultTransformRegistry();
      assert.ok(registry.has('yaml-to-json'), 'yaml-to-json should be registered');
      assert.ok(registry.has('json-to-yaml'), 'json-to-yaml should be registered');
    });
  });

  describe('alias delegation', () => {
    it('yaml-to-json delegates to yaml { direction: parse }', () => {
      const input = 'name: foo\nmodel: bar';
      assert.deepEqual(
        yamlToJsonTransform.execute(input),
        yamlTransform.execute(input, { direction: 'parse' }),
      );
    });

    it('json-to-yaml delegates to yaml { direction: stringify }', () => {
      const input = { name: 'foo', model: 'bar' };
      assert.equal(
        jsonToYamlTransform.execute(input),
        yamlTransform.execute(input, { direction: 'stringify' }),
      );
    });
  });

  describe('Goose-shape regression', () => {
    // Mirrors the shape produced by platforms.jsonc Goose flows after
    // the $rename step — `mcpServers` already renamed to `extensions`.
    const gooseShape = {
      extensions: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: 'placeholder' },
        },
        sqlite: {
          command: 'uvx',
          args: ['mcp-server-sqlite', '--db-path', './test.db'],
        },
      },
    };

    it('round-trips through json-to-yaml then yaml-to-json without loss', () => {
      const yamlString = jsonToYamlTransform.execute(gooseShape);
      assert.equal(typeof yamlString, 'string');
      assert.ok(yamlString.includes('extensions:'));
      assert.ok(yamlString.includes('github:'));

      const reparsed = yamlToJsonTransform.execute(yamlString);
      assert.deepEqual(reparsed, gooseShape);
    });

    it('produces valid YAML that js-yaml can parse independently', () => {
      const yamlString = jsonToYamlTransform.execute(gooseShape);
      const parsed = yaml.load(yamlString);
      assert.deepEqual(parsed, gooseShape);
    });
  });

  describe('end-to-end via registry execute path', () => {
    it('runs json-to-yaml through the registry like a $pipe call would', () => {
      const registry = createDefaultTransformRegistry();
      const result = registry.execute('json-to-yaml', { hello: 'world' });
      assert.equal(typeof result, 'string');
      assert.ok(result.includes('hello: world'));
    });

    it('runs yaml-to-json through the registry like a $pipe call would', () => {
      const registry = createDefaultTransformRegistry();
      const result = registry.execute('yaml-to-json', 'hello: world\n');
      assert.deepEqual(result, { hello: 'world' });
    });
  });
});
