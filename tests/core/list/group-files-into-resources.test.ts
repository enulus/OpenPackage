/**
 * Unit tests for groupFilesIntoResources with flat resource naming
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupFilesIntoResources, type ListFileMapping } from '../../../packages/core/src/core/list/list-pipeline.js';

function createFile(source: string, target: string, exists = true): ListFileMapping {
  return { source, target, exists };
}

describe('groupFilesIntoResources', () => {
  it('flat rule produces rules/custom-rules', () => {
    const files: ListFileMapping[] = [
      createFile('rules/custom-rules.mdc', '.cursor/rules/custom-rules.mdc'),
    ];
    const groups = groupFilesIntoResources(files);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].resourceType, 'rules');
    assert.equal(groups[0].resources.length, 1);
    assert.equal(groups[0].resources[0].name, 'rules/custom-rules');
  });

  it('nested rule produces rules/basics/custom-rules', () => {
    const files: ListFileMapping[] = [
      createFile('rules/basics/custom-rules.mdc', '.cursor/rules/basics/custom-rules.mdc'),
    ];
    const groups = groupFilesIntoResources(files);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].resourceType, 'rules');
    assert.equal(groups[0].resources[0].name, 'rules/basics/custom-rules');
  });

  it('agent produces agents/agent-creator', () => {
    const files: ListFileMapping[] = [
      createFile('agents/agent-creator.md', '.cursor/agents/agent-creator.md'),
    ];
    const groups = groupFilesIntoResources(files);
    assert.equal(groups[0].resources[0].name, 'agents/agent-creator');
  });

  it('skill produces skills/my-skill', () => {
    const files: ListFileMapping[] = [
      createFile('skills/my-skill/readme.md', '.cursor/skills/my-skill/readme.md'),
    ];
    const groups = groupFilesIntoResources(files);
    assert.equal(groups[0].resources[0].name, 'skills/my-skill');
  });

  it('unknown type consolidates to other', () => {
    const files: ListFileMapping[] = [
      createFile('unknown/foo.md', '.cursor/unknown/foo.md'),
    ];
    const groups = groupFilesIntoResources(files);
    assert.equal(groups[0].resourceType, 'other');
    assert.equal(groups[0].resources[0].name, 'other');
  });

  it('platform-suffixed variants group under same resource', () => {
    const files: ListFileMapping[] = [
      createFile('agents/git/git-manager.md', 'agents/git/git-manager.md'),
      createFile('agents/git/git-manager.opencode.md', 'agents/git/git-manager.opencode.md'),
    ];
    const groups = groupFilesIntoResources(files);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].resourceType, 'agents');
    assert.equal(groups[0].resources.length, 1);
    assert.equal(groups[0].resources[0].name, 'agents/git/git-manager');
    assert.equal(groups[0].resources[0].files.length, 2);
  });
});
