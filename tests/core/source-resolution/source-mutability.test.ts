import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';

import { getRegistryDirectories } from '../../../src/core/directory.js';
import { assertMutableSourceOrThrow, isRegistryPath } from '../../../src/utils/source-mutability.js';

// Ensure predictable registry root for this test
const fakeHome = path.join(os.tmpdir(), 'opkg-home-mutability');
process.env.HOME = fakeHome;

const registryRoot = getRegistryDirectories().packages;
const registryExample = path.join(registryRoot, 'example', '1.0.0');
const nonRegistry = '/tmp/opkg-non-registry-path';

assert.equal(isRegistryPath(registryExample), true);
assert.equal(isRegistryPath(nonRegistry), false);

let threw = false;
try {
  assertMutableSourceOrThrow(registryExample, { packageName: 'example', command: 'save' });
} catch (err) {
  threw = true;
  assert.ok((err as Error).message.includes('immutable'));
}
assert.equal(threw, true, 'assertMutableSourceOrThrow should throw for registry paths');

assert.doesNotThrow(() =>
  assertMutableSourceOrThrow(nonRegistry, { packageName: 'example', command: 'save' })
);

console.log('source-mutability tests passed');

