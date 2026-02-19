/**
 * Unit tests for groupFilesIntoResources with flat resource naming
 */

import assert from 'node:assert/strict';
import { groupFilesIntoResources, type ListFileMapping } from '../../../src/core/list/list-pipeline.js';

function createFile(source: string, target: string, exists = true): ListFileMapping {
  return { source, target, exists };
}

// Flat rules
{
  const files: ListFileMapping[] = [
    createFile('rules/custom-rules.mdc', '.cursor/rules/custom-rules.mdc'),
  ];
  const groups = groupFilesIntoResources(files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].resourceType, 'rules');
  assert.equal(groups[0].resources.length, 1);
  assert.equal(groups[0].resources[0].name, 'rules/custom-rules');
  console.log('✓ Flat rule produces rules/custom-rules');
}

// Nested rules
{
  const files: ListFileMapping[] = [
    createFile('rules/basics/custom-rules.mdc', '.cursor/rules/basics/custom-rules.mdc'),
  ];
  const groups = groupFilesIntoResources(files);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].resourceType, 'rules');
  assert.equal(groups[0].resources[0].name, 'rules/basics/custom-rules');
  console.log('✓ Nested rule produces rules/basics/custom-rules');
}

// Agents
{
  const files: ListFileMapping[] = [
    createFile('agents/agent-creator.md', '.cursor/agents/agent-creator.md'),
  ];
  const groups = groupFilesIntoResources(files);
  assert.equal(groups[0].resources[0].name, 'agents/agent-creator');
  console.log('✓ Agent produces agents/agent-creator');
}

// Skills
{
  const files: ListFileMapping[] = [
    createFile('skills/my-skill/readme.md', '.cursor/skills/my-skill/readme.md'),
  ];
  const groups = groupFilesIntoResources(files);
  assert.equal(groups[0].resources[0].name, 'skills/my-skill');
  console.log('✓ Skill produces skills/my-skill');
}

// Other consolidates to other/uncategorized
{
  const files: ListFileMapping[] = [
    createFile('unknown/foo.md', '.cursor/unknown/foo.md'),
  ];
  const groups = groupFilesIntoResources(files);
  assert.equal(groups[0].resourceType, 'other');
  assert.equal(groups[0].resources[0].name, 'other/uncategorized');
  console.log('✓ Other type produces other/uncategorized');
}

console.log('\n✅ All groupFilesIntoResources tests passed');
