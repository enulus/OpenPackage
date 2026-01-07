import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runApplyPipeline } from '../../../src/core/apply/apply-pipeline.js';
import { runSavePipeline } from '../../../src/core/save/save-pipeline.js';

function assertHasData<T>(result: { success: boolean; data?: T; error?: string }): asserts result is { success: true; data: T } {
  assert.equal(result.success, true);
  assert.ok(result.data);
}

function assertSavePipelineResultHasConfig(
  data: unknown
): asserts data is { config: { name: string; version: string }; syncResult?: unknown } {
  assert.ok(typeof data === 'object' && data !== null, 'save should return a data object');
  assert.ok('config' in data, 'save data should include config');
}

async function runApplyAndSaveApplyTests(): Promise<void> {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(join(tmpdir(), 'opkg-apply-save-'));

  try {
    // Minimal package setup
    await mkdir(join(tempDir, '.openpackage', 'commands'), { recursive: true });
    await writeFile(
      join(tempDir, 'openpackage.yml'),
      ['name: apply-save-test', 'version: "1.0.0"', ''].join('\n'),
      'utf8'
    );
    await writeFile(
      join(tempDir, '.openpackage', 'commands', 'example.md'),
      '# Example command',
      'utf8'
    );

    // Ensure at least one detectable platform (Cursor)
    await mkdir(join(tempDir, '.cursor'), { recursive: true });

    process.chdir(tempDir);

    // Default save: apply should be skipped
    const saveNoApply = await runSavePipeline(undefined, {
      mode: 'wip',
      force: true
    });
    assert.equal(saveNoApply.success, true, 'save without --apply should succeed');
    assertSavePipelineResultHasConfig(saveNoApply.data);
    const saveNoApplyData = saveNoApply.data;
    assert.equal(
      (saveNoApplyData as { syncResult?: unknown }).syncResult,
      undefined,
      'save without --apply should not include a platform sync result'
    );

    // Save with apply flag: sync should run
    const saveWithApply = await runSavePipeline(undefined, {
      mode: 'wip',
      force: true,
      apply: true
    });
    assert.equal(saveWithApply.success, true, 'save with --apply should succeed');
    assertSavePipelineResultHasConfig(saveWithApply.data);
    const saveWithApplyData = saveWithApply.data as { syncResult?: unknown };
    assert.ok(saveWithApplyData.syncResult, 'save with --apply should include a sync result');

    // Standalone apply command behavior
    const applyResult = await runApplyPipeline(undefined, { force: true });
    assertHasData(applyResult);
    assert.ok(applyResult.data.syncResult, 'apply pipeline should return sync results');

    console.log('apply-and-save-apply tests passed');
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

await runApplyAndSaveApplyTests();

