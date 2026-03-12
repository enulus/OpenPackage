import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { executeInPlaceRename } from '../../../packages/core/src/core/move/move-rename-executor.js';

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

describe('move-rename-executor', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opkg-move-rename-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('file-based resource rename', () => {
    it('renames a single-file agent', async () => {
      writeFile(path.join(tmpDir, 'agents', 'old-agent.md'), [
        '---',
        'name: old-agent',
        '---',
        'Agent content',
      ].join('\n'));

      const sourceKeys = new Set(['agents/old-agent.md']);
      const result = await executeInPlaceRename(tmpDir, sourceKeys, 'old-agent', 'new-agent');

      assert.equal(result.renamedFiles, 1);
      assert.ok(!fs.existsSync(path.join(tmpDir, 'agents', 'old-agent.md')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'agents', 'new-agent.md')));

      const content = readFile(path.join(tmpDir, 'agents', 'new-agent.md'));
      assert.ok(content.includes('name: new-agent'), 'frontmatter name should be updated');
      assert.ok(content.includes('Agent content'), 'body content should be preserved');
    });

    it('preserves non-primary files in the resource', async () => {
      writeFile(path.join(tmpDir, 'agents', 'my-agent.md'), '---\nname: my-agent\n---\ncontent');
      writeFile(path.join(tmpDir, 'agents', 'helper.md'), 'helper content');

      const sourceKeys = new Set(['agents/my-agent.md', 'agents/helper.md']);
      const result = await executeInPlaceRename(tmpDir, sourceKeys, 'my-agent', 'renamed');

      assert.equal(result.renamedFiles, 2);
      assert.ok(fs.existsSync(path.join(tmpDir, 'agents', 'renamed.md')));
      // Non-primary file keeps its name
      assert.ok(fs.existsSync(path.join(tmpDir, 'agents', 'helper.md')));
    });
  });

  describe('directory-based resource rename', () => {
    it('renames a skill directory', async () => {
      writeFile(path.join(tmpDir, 'skills', 'old-skill', 'SKILL.md'), [
        '---',
        'name: old-skill',
        '---',
        'Skill instructions',
      ].join('\n'));
      writeFile(path.join(tmpDir, 'skills', 'old-skill', 'sub', 'data.txt'), 'data');

      const sourceKeys = new Set([
        'skills/old-skill/SKILL.md',
        'skills/old-skill/sub/data.txt',
      ]);
      const result = await executeInPlaceRename(tmpDir, sourceKeys, 'old-skill', 'new-skill');

      assert.equal(result.renamedFiles, 2);
      assert.ok(!fs.existsSync(path.join(tmpDir, 'skills', 'old-skill')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'skills', 'new-skill', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(tmpDir, 'skills', 'new-skill', 'sub', 'data.txt')));

      const content = readFile(path.join(tmpDir, 'skills', 'new-skill', 'SKILL.md'));
      assert.ok(content.includes('name: new-skill'));
    });

    it('throws if source directory does not exist', async () => {
      const sourceKeys = new Set(['skills/nonexistent/SKILL.md']);
      await assert.rejects(
        () => executeInPlaceRename(tmpDir, sourceKeys, 'nonexistent', 'new-name'),
        /not found/,
      );
    });

    it('throws if target directory already exists', async () => {
      ensureDir(path.join(tmpDir, 'skills', 'old-skill'));
      writeFile(path.join(tmpDir, 'skills', 'old-skill', 'SKILL.md'), '---\nname: old-skill\n---\n');
      ensureDir(path.join(tmpDir, 'skills', 'new-skill'));

      const sourceKeys = new Set(['skills/old-skill/SKILL.md']);
      await assert.rejects(
        () => executeInPlaceRename(tmpDir, sourceKeys, 'old-skill', 'new-skill'),
        /already exists/,
      );
    });
  });

  it('throws when no source keys provided', async () => {
    const sourceKeys = new Set<string>();
    await assert.rejects(
      () => executeInPlaceRename(tmpDir, sourceKeys, 'foo', 'bar'),
      /No source keys/,
    );
  });
});
