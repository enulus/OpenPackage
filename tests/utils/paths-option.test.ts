import assert from 'node:assert/strict';

import { buildRequestedPaths, parsePathsOption } from '../../src/utils/registry-paths.js';

const parsed = parsePathsOption(' /docs ,docs ,/docs/guide , /docs ');
assert.deepEqual(parsed, ['docs', 'docs/guide']);

const combined = buildRequestedPaths(['docs', 'docs'], '/docs/tutorial ');
assert.deepEqual(combined, ['docs', 'docs/tutorial']);

assert.deepEqual(parsePathsOption(''), []);
assert.deepEqual(parsePathsOption(undefined as any), []);

console.log('paths-option tests passed');

