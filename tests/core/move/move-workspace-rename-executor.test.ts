import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { executeWorkspaceRename } from '../../../packages/core/src/core/move/move-workspace-rename-executor.js';

let tmpDir: string;

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function writeFile(p: string, content: string) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf-8');
}

function readFile(p: string): string {
  return fs.readFileSync(p, 'utf-8');
}

describe('move-workspace-rename-executor', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-ws-rename-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('file-based resource rename', () => {
    it('renames a single-file agent in .claude/', async () => {
      // Create .claude platform directory so detection works
      ensureDir(path.join(tmpDir, '.claude', 'agents'));
      writeFile(path.join(tmpDir, '.claude', 'agents', 'old-agent.md'), [
        '---',
        'name: old-agent',
        '---',
        'Agent content',
      ].join('\n'));

      const result = await executeWorkspaceRename('agent', 'old-agent', 'new-agent', tmpDir);

      assert.equal(result.renamedFiles, 1);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'old-agent.md')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'agents', 'new-agent.md')));

      const content = readFile(path.join(tmpDir, '.claude', 'agents', 'new-agent.md'));
      assert.ok(content.includes('name: new-agent'), 'frontmatter name should be updated');
      assert.ok(content.includes('Agent content'), 'body content should be preserved');
    });
  });

  describe('directory-based resource rename', () => {
    it('renames a skill directory in .claude/', async () => {
      ensureDir(path.join(tmpDir, '.claude', 'skills', 'old-skill'));
      writeFile(path.join(tmpDir, '.claude', 'skills', 'old-skill', 'SKILL.md'), [
        '---',
        'name: old-skill',
        '---',
        'Skill instructions',
      ].join('\n'));
      writeFile(path.join(tmpDir, '.claude', 'skills', 'old-skill', 'data.txt'), 'data');

      const result = await executeWorkspaceRename('skill', 'old-skill', 'new-skill', tmpDir);

      assert.ok(result.renamedFiles >= 2, `expected >= 2 renamed files, got ${result.renamedFiles}`);
      assert.ok(!fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'old-skill')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'new-skill', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(tmpDir, '.claude', 'skills', 'new-skill', 'data.txt')));

      const content = readFile(path.join(tmpDir, '.claude', 'skills', 'new-skill', 'SKILL.md'));
      assert.ok(content.includes('name: new-skill'), 'frontmatter name should be updated');
    });

    it('throws when target already exists', async () => {
      ensureDir(path.join(tmpDir, '.claude', 'skills', 'old-skill'));
      writeFile(path.join(tmpDir, '.claude', 'skills', 'old-skill', 'SKILL.md'), '---\nname: old-skill\n---\n');
      ensureDir(path.join(tmpDir, '.claude', 'skills', 'new-skill'));

      await assert.rejects(
        () => executeWorkspaceRename('skill', 'old-skill', 'new-skill', tmpDir),
        /already exists/,
      );
    });
  });

  it('throws when no files found', async () => {
    // Create the platform root but no resource files
    ensureDir(path.join(tmpDir, '.claude', 'agents'));

    await assert.rejects(
      () => executeWorkspaceRename('agent', 'nonexistent', 'new-name', tmpDir),
      /No files found/,
    );
  });

  it('throws when target file already exists (file-based)', async () => {
    ensureDir(path.join(tmpDir, '.claude', 'agents'));
    writeFile(path.join(tmpDir, '.claude', 'agents', 'old-agent.md'), '---\nname: old-agent\n---\ncontent');
    writeFile(path.join(tmpDir, '.claude', 'agents', 'new-agent.md'), '---\nname: new-agent\n---\nexisting');

    await assert.rejects(
      () => executeWorkspaceRename('agent', 'old-agent', 'new-agent', tmpDir),
      /already exists/,
    );
  });
});
