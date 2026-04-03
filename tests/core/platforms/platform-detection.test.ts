import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { getDetectedPlatforms } from '../../../packages/core/src/core/platforms.js';

async function writeFile(filePath: string, content = ''): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

describe('platform detection', () => {
  it('does not treat a bare AGENTS.md as multiple platform detections', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-platform-detect-'));

    try {
      await writeFile(path.join(workspace, 'AGENTS.md'), '# Repo guidance\n');
      await fs.mkdir(path.join(workspace, '.factory'), { recursive: true });

      const detected = await getDetectedPlatforms(workspace);

      assert.deepEqual(
        detected,
        ['factory'],
        `Expected only Factory to be detected, got: ${detected.join(', ')}`
      );
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });

  it('detects codex from the official .agents/skills layout', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'opkg-codex-detect-'));

    try {
      await writeFile(
        path.join(workspace, '.agents', 'skills', 'decomplect', 'SKILL.md'),
        '# Decomplect\n'
      );

      const detected = await getDetectedPlatforms(workspace);

      assert.ok(detected.includes('codex'));
      assert.ok(!detected.includes('amp'));
    } finally {
      await fs.rm(workspace, { recursive: true, force: true });
    }
  });
});
