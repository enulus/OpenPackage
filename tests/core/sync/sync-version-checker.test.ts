import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkVersionConstraint } from '../../../packages/core/src/core/sync/sync-version-checker.js';

describe('checkVersionConstraint', () => {
  it('returns satisfied when version is in range', () => {
    const result = checkVersionConstraint('1.2.3', '^1.0.0');
    assert.strictEqual(result.status, 'satisfied');
    assert.strictEqual(result.sourceVersion, '1.2.3');
    assert.strictEqual(result.manifestRange, '^1.0.0');
  });

  it('returns mismatch when version is outside range', () => {
    const result = checkVersionConstraint('2.0.0', '^1.0.0');
    assert.strictEqual(result.status, 'mismatch');
    assert.strictEqual(result.sourceVersion, '2.0.0');
    assert.strictEqual(result.manifestRange, '^1.0.0');
    assert.strictEqual(result.suggestedRange, '^2.0.0');
  });

  it('returns unconstrained when source version is undefined', () => {
    const result = checkVersionConstraint(undefined, '^1.0.0');
    assert.strictEqual(result.status, 'unconstrained');
  });

  it('returns unconstrained when manifest range is undefined', () => {
    const result = checkVersionConstraint('1.2.3', undefined);
    assert.strictEqual(result.status, 'unconstrained');
  });

  it('returns unconstrained for unversioned packages (0.0.0)', () => {
    const result = checkVersionConstraint('0.0.0', '^1.0.0');
    assert.strictEqual(result.status, 'unconstrained');
  });

  it('returns satisfied for tilde range within patch', () => {
    const result = checkVersionConstraint('1.2.5', '~1.2.0');
    assert.strictEqual(result.status, 'satisfied');
  });

  it('returns mismatch for tilde range crossing minor', () => {
    const result = checkVersionConstraint('1.3.0', '~1.2.0');
    assert.strictEqual(result.status, 'mismatch');
    assert.strictEqual(result.suggestedRange, '^1.3.0');
  });

  it('returns satisfied for exact version match', () => {
    const result = checkVersionConstraint('1.2.3', '1.2.3');
    assert.strictEqual(result.status, 'satisfied');
  });

  it('returns satisfied for wildcard range', () => {
    const result = checkVersionConstraint('5.0.0', '*');
    assert.strictEqual(result.status, 'satisfied');
  });

  it('handles prerelease source version with base in range', () => {
    const result = checkVersionConstraint('1.2.3-abc.xyz', '^1.0.0');
    assert.strictEqual(result.status, 'satisfied');
  });

  it('computes suggestedRange from prerelease source version', () => {
    const result = checkVersionConstraint('2.0.0-beta.1', '^1.0.0');
    assert.strictEqual(result.status, 'mismatch');
    assert.strictEqual(result.suggestedRange, '^2.0.0');
  });

  it('returns unconstrained when both are undefined', () => {
    const result = checkVersionConstraint(undefined, undefined);
    assert.strictEqual(result.status, 'unconstrained');
  });
});
