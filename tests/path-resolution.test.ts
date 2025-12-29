import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { expandTildePath, resolveDeclaredPath } from '../../src/utils/path-resolution.js';

// expandTildePath
assert.equal(expandTildePath('~/project', '/home/tester'), path.join('/home/tester', 'project'));
assert.equal(expandTildePath('~', '/home/tester'), '/home/tester');
assert.equal(expandTildePath('plain/path', '/home/tester'), 'plain/path');
// ~user should be left untouched (we don't resolve other users)
assert.equal(expandTildePath('~someone/project', '/home/tester'), '~someone/project');

// resolveDeclaredPath with reference directory
const referenceDir = '/workspace/.openpackage';
const resolvedRelative = resolveDeclaredPath('./packages/foo', referenceDir);
assert.equal(resolvedRelative.declared, './packages/foo');
assert.equal(resolvedRelative.absolute, path.resolve(referenceDir, './packages/foo'));

const resolvedParent = resolveDeclaredPath('../shared', referenceDir);
assert.equal(resolvedParent.declared, '../shared');
assert.equal(resolvedParent.absolute, path.resolve(referenceDir, '../shared'));

const resolvedTilde = resolveDeclaredPath('~/proj', referenceDir);
assert.equal(resolvedTilde.declared, '~/proj');
assert.equal(resolvedTilde.absolute, path.join(os.homedir(), 'proj'));

const resolvedAbsolute = resolveDeclaredPath('/abs/path/here', referenceDir);
assert.equal(resolvedAbsolute.declared, '/abs/path/here');
assert.equal(resolvedAbsolute.absolute, '/abs/path/here');

console.log('path-resolution tests passed');

