import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { PromptPort } from '../../../packages/core/src/core/ports/prompt.js';
import type { VersionCheckResult } from '../../../packages/core/src/core/sync/sync-version-checker.js';
import { resolveVersionMismatchInteractively } from '../../../packages/core/src/core/sync/sync-version-resolver.js';

function createMockPrompt(selectValue: string, textValue?: string): PromptPort {
  return {
    async confirm() { return false; },
    async select<T>(_msg: string, choices: Array<{ title: string; value: T }>) {
      return choices.find(c => (c.value as unknown as string) === selectValue)!.value;
    },
    async multiselect() { return []; },
    async groupMultiselect() { return []; },
    async text() { return textValue ?? ''; },
  };
}

const mismatchCheck: VersionCheckResult = {
  status: 'mismatch',
  sourceVersion: '2.0.0',
  manifestRange: '^1.0.0',
  suggestedRange: '^2.0.0',
};

describe('resolveVersionMismatchInteractively', () => {
  it('returns update with suggested range when user selects update', async () => {
    const prompt = createMockPrompt('update');
    const result = await resolveVersionMismatchInteractively('my-pkg', mismatchCheck, prompt);
    assert.deepStrictEqual(result, { action: 'update', newRange: '^2.0.0' });
  });

  it('returns update with custom range when user selects custom', async () => {
    const prompt = createMockPrompt('custom', '~2.0.0');
    const result = await resolveVersionMismatchInteractively('my-pkg', mismatchCheck, prompt);
    assert.deepStrictEqual(result, { action: 'update', newRange: '~2.0.0' });
  });

  it('returns skip when user selects skip', async () => {
    const prompt = createMockPrompt('skip');
    const result = await resolveVersionMismatchInteractively('my-pkg', mismatchCheck, prompt);
    assert.deepStrictEqual(result, { action: 'skip' });
  });
});
