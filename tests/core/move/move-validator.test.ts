import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateMoveArgs, validateNotNoop } from '../../../packages/core/src/core/move/move-validator.js';

describe('move-validator', () => {
  describe('validateMoveArgs', () => {
    it('throws when no newName, no --to, no --from', () => {
      assert.throws(() => validateMoveArgs(undefined, undefined, undefined), /At least one of/);
    });

    it('throws when no newName, no --to, no --from (omitted arg)', () => {
      assert.throws(() => validateMoveArgs(undefined, undefined), /At least one of/);
    });

    it('passes with newName only', () => {
      assert.doesNotThrow(() => validateMoveArgs('new-name', undefined, undefined));
    });

    it('passes with --to only', () => {
      assert.doesNotThrow(() => validateMoveArgs(undefined, 'some-pkg', undefined));
    });

    it('passes with both newName and --to', () => {
      assert.doesNotThrow(() => validateMoveArgs('new-name', 'some-pkg', undefined));
    });

    it('passes with --from only (eject)', () => {
      assert.doesNotThrow(() => validateMoveArgs(undefined, undefined, 'some-pkg'));
    });

    it('passes with --from and newName', () => {
      assert.doesNotThrow(() => validateMoveArgs('new-name', undefined, 'some-pkg'));
    });

    it('passes with --from and --to', () => {
      assert.doesNotThrow(() => validateMoveArgs(undefined, 'dest-pkg', 'src-pkg'));
    });

    it('rejects newName with slashes', () => {
      assert.throws(() => validateMoveArgs('foo/bar', undefined, undefined), /slashes/);
    });

    it('rejects newName with dots', () => {
      assert.throws(() => validateMoveArgs('foo.md', undefined, undefined), /dots/);
    });

    it('rejects newName with whitespace', () => {
      assert.throws(() => validateMoveArgs('foo bar', undefined, undefined), /whitespace/);
    });
  });

  describe('validateNotNoop', () => {
    it('throws when name and package are unchanged', () => {
      assert.throws(
        () => validateNotNoop('my-agent', undefined, 'pkg-a', undefined),
        /Nothing to do/,
      );
    });

    it('throws when explicit newName and --to match current values', () => {
      assert.throws(
        () => validateNotNoop('my-agent', 'my-agent', 'pkg-a', 'pkg-a'),
        /Nothing to do/,
      );
    });

    it('passes when newName differs', () => {
      assert.doesNotThrow(() => validateNotNoop('old', 'new', 'pkg', undefined));
    });

    it('passes when --to differs', () => {
      assert.doesNotThrow(() => validateNotNoop('name', undefined, 'pkg-a', 'pkg-b'));
    });

    it('passes when sourcePackage is undefined (untracked adopt)', () => {
      assert.doesNotThrow(() => validateNotNoop('name', undefined, undefined, 'pkg'));
    });

    it('passes when sourcePackage is undefined even with same name', () => {
      assert.doesNotThrow(() => validateNotNoop('name', 'name', undefined, 'pkg'));
    });
  });
});
