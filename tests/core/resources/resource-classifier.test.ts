/**
 * Unit tests for the unified resource classifier
 */

import assert from 'node:assert/strict';
import { classifySourceKeyBatch, classifyUntrackedPaths, classifyAndGroupUntrackedFiles } from '../../../packages/core/src/core/resources/resource-classifier.js';

// classifySourceKeyBatch — simple rules
{
  const result = classifySourceKeyBatch(['rules/custom-rules.mdc']);
  const cls = result.get('rules/custom-rules.mdc')!;
  assert.equal(cls.resourceType, 'rule');
  assert.equal(cls.resourceName, 'custom-rules');
  assert.equal(cls.fullName, 'rules/custom-rules');
  console.log('✓ classifySourceKeyBatch — simple rule');
}

// classifySourceKeyBatch — nested rules
{
  const result = classifySourceKeyBatch(['rules/basics/custom-rules.mdc']);
  const cls = result.get('rules/basics/custom-rules.mdc')!;
  assert.equal(cls.resourceType, 'rule');
  assert.equal(cls.resourceName, 'basics/custom-rules');
  assert.equal(cls.fullName, 'rules/basics/custom-rules');
  console.log('✓ classifySourceKeyBatch — nested rule');
}

// classifySourceKeyBatch — agents
{
  const result = classifySourceKeyBatch(['agents/agent-creator.md']);
  const cls = result.get('agents/agent-creator.md')!;
  assert.equal(cls.resourceType, 'agent');
  assert.equal(cls.resourceName, 'agent-creator');
  assert.equal(cls.fullName, 'agents/agent-creator');
  console.log('✓ classifySourceKeyBatch — agent');
}

// classifySourceKeyBatch — nested agents
{
  const result = classifySourceKeyBatch(['agents/git/git-manager.md']);
  const cls = result.get('agents/git/git-manager.md')!;
  assert.equal(cls.resourceType, 'agent');
  assert.equal(cls.resourceName, 'git/git-manager');
  assert.equal(cls.fullName, 'agents/git/git-manager');
  console.log('✓ classifySourceKeyBatch — nested agent');
}

// classifySourceKeyBatch — nested skills (THE BUG FIX)
{
  const sourceKeys = [
    'skills/openpackage/skill-creator/SKILL.md',
    'skills/openpackage/skill-creator/agents/foo.md',
    'skills/openpackage/skill-creator/scripts/bar.py',
    'skills/my-skill/SKILL.md',
    'skills/my-skill/readme.md',
  ];
  const result = classifySourceKeyBatch(sourceKeys);

  // Nested skill should resolve to full nested name, NOT just "openpackage"
  const nested = result.get('skills/openpackage/skill-creator/SKILL.md')!;
  assert.equal(nested.resourceType, 'skill');
  assert.equal(nested.resourceName, 'openpackage/skill-creator');
  assert.equal(nested.fullName, 'skills/openpackage/skill-creator');

  // All files under same skill group to same resource name
  const nestedAgent = result.get('skills/openpackage/skill-creator/agents/foo.md')!;
  assert.equal(nestedAgent.resourceName, 'openpackage/skill-creator');
  assert.equal(nestedAgent.fullName, 'skills/openpackage/skill-creator');

  const nestedScript = result.get('skills/openpackage/skill-creator/scripts/bar.py')!;
  assert.equal(nestedScript.resourceName, 'openpackage/skill-creator');

  // Simple skill still works
  const simple = result.get('skills/my-skill/SKILL.md')!;
  assert.equal(simple.resourceName, 'my-skill');
  assert.equal(simple.fullName, 'skills/my-skill');

  const simpleReadme = result.get('skills/my-skill/readme.md')!;
  assert.equal(simpleReadme.resourceName, 'my-skill');

  console.log('✓ classifySourceKeyBatch — nested skills (bug fix)');
}

// classifySourceKeyBatch — mcp
{
  const result = classifySourceKeyBatch(['mcp.json']);
  const cls = result.get('mcp.json')!;
  assert.equal(cls.resourceType, 'mcp');
  assert.equal(cls.resourceName, 'configs');
  assert.equal(cls.fullName, 'mcps/configs');
  console.log('✓ classifySourceKeyBatch — mcp');
}

// classifySourceKeyBatch — other/unknown
{
  const result = classifySourceKeyBatch(['unknown/foo.md']);
  const cls = result.get('unknown/foo.md')!;
  assert.equal(cls.resourceType, 'other');
  assert.equal(cls.fullName, 'other');
  console.log('✓ classifySourceKeyBatch — other');
}

// classifySourceKeyBatch — empty input
{
  const result = classifySourceKeyBatch([]);
  assert.equal(result.size, 0);
  console.log('✓ classifySourceKeyBatch — empty input');
}

// classifyUntrackedPaths — skills with platform-prefixed workspace paths
{
  const files = [
    { path: '.claude/skills/openpackage/skill-creator/SKILL.md', resourceType: 'skill' as const },
    { path: '.claude/skills/openpackage/skill-creator/agents/foo.md', resourceType: 'skill' as const },
    { path: '.claude/skills/my-skill/SKILL.md', resourceType: 'skill' as const },
    { path: '.claude/skills/my-skill/readme.md', resourceType: 'skill' as const },
  ];
  const result = classifyUntrackedPaths(files);

  const nested = result.get('.claude/skills/openpackage/skill-creator/SKILL.md')!;
  assert.equal(nested.resourceType, 'skill');
  assert.equal(nested.resourceName, 'openpackage/skill-creator');
  assert.equal(nested.fullName, 'skills/openpackage/skill-creator');

  const nestedAgent = result.get('.claude/skills/openpackage/skill-creator/agents/foo.md')!;
  assert.equal(nestedAgent.resourceName, 'openpackage/skill-creator');

  const simple = result.get('.claude/skills/my-skill/SKILL.md')!;
  assert.equal(simple.resourceName, 'my-skill');

  console.log('✓ classifyUntrackedPaths — skills with platform-prefixed workspace paths');
}

// classifyUntrackedPaths — non-skill types
{
  const files = [
    { path: '.cursor/rules/custom-rules.mdc', resourceType: 'rule' as const },
    { path: '.cursor/agents/agent-creator.md', resourceType: 'agent' as const },
  ];
  const result = classifyUntrackedPaths(files);

  const rule = result.get('.cursor/rules/custom-rules.mdc')!;
  assert.equal(rule.resourceType, 'rule');
  assert.equal(rule.resourceName, 'custom-rules');
  assert.equal(rule.fullName, 'rules/custom-rules');

  const agent = result.get('.cursor/agents/agent-creator.md')!;
  assert.equal(agent.resourceType, 'agent');
  assert.equal(agent.resourceName, 'agent-creator');
  assert.equal(agent.fullName, 'agents/agent-creator');

  console.log('✓ classifyUntrackedPaths — non-skill types');
}

// classifyUntrackedPaths — empty input
{
  const result = classifyUntrackedPaths([]);
  assert.equal(result.size, 0);
  console.log('✓ classifyUntrackedPaths — empty input');
}

// classifyUntrackedPaths — orphan skill files with no SKILL.md → excluded
{
  const files = [
    { path: '.claude/skills/orphan-file.md', resourceType: 'skill' as const },
    { path: '.claude/skills/some-dir/random.txt', resourceType: 'skill' as const },
  ];
  const result = classifyUntrackedPaths(files);
  assert.equal(result.size, 0, 'Orphan skill files without SKILL.md should be excluded');
  console.log('✓ classifyUntrackedPaths — orphan skill files excluded');
}

// classifyUntrackedPaths — mixed valid skills + orphan files → only valid classified
{
  const files = [
    { path: '.claude/skills/my-skill/SKILL.md', resourceType: 'skill' as const },
    { path: '.claude/skills/my-skill/readme.md', resourceType: 'skill' as const },
    { path: '.claude/skills/orphan.txt', resourceType: 'skill' as const },
    { path: '.claude/skills/stray-dir/junk.md', resourceType: 'skill' as const },
  ];
  const result = classifyUntrackedPaths(files);
  assert.equal(result.size, 2, 'Only files within marker boundary should be classified');
  assert.ok(result.has('.claude/skills/my-skill/SKILL.md'));
  assert.ok(result.has('.claude/skills/my-skill/readme.md'));
  assert.ok(!result.has('.claude/skills/orphan.txt'));
  assert.ok(!result.has('.claude/skills/stray-dir/junk.md'));
  console.log('✓ classifyUntrackedPaths — mixed valid + orphan skills');
}

// classifyUntrackedPaths — non-marker types (rules, agents) unaffected by marker enforcement
{
  const files = [
    { path: '.cursor/rules/standalone-rule.mdc', resourceType: 'rule' as const },
    { path: '.claude/agents/standalone-agent.md', resourceType: 'agent' as const },
  ];
  const result = classifyUntrackedPaths(files);
  assert.equal(result.size, 2, 'Non-marker types should always be classified');
  assert.ok(result.has('.cursor/rules/standalone-rule.mdc'));
  assert.ok(result.has('.claude/agents/standalone-agent.md'));
  console.log('✓ classifyUntrackedPaths — non-marker types unaffected');
}

// classifyUntrackedPaths — all-orphan skill directory → empty result
{
  const files = [
    { path: '.claude/skills/no-marker/file1.md', resourceType: 'skill' as const },
    { path: '.claude/skills/no-marker/file2.py', resourceType: 'skill' as const },
    { path: '.claude/skills/another-orphan/stuff.txt', resourceType: 'skill' as const },
  ];
  const result = classifyUntrackedPaths(files);
  assert.equal(result.size, 0, 'All-orphan skill directory should produce empty result');
  console.log('✓ classifyUntrackedPaths — all-orphan skill directory');
}

// ---------------------------------------------------------------------------
// classifyAndGroupUntrackedFiles tests
// ---------------------------------------------------------------------------

// classifyAndGroupUntrackedFiles — basic grouping
{
  const files = [
    { workspacePath: '.cursor/rules/custom-rules.mdc', category: 'rules' },
    { workspacePath: '.cursor/rules/other-rule.mdc', category: 'rules' },
    { workspacePath: '.claude/agents/agent-creator.md', category: 'agents' },
  ];
  const grouped = classifyAndGroupUntrackedFiles(files);

  assert.equal(grouped.size, 3, 'Should produce 3 groups (2 rules + 1 agent)');

  const ruleGroup1 = grouped.get('rule::custom-rules');
  assert.ok(ruleGroup1, 'Should have rule::custom-rules group');
  assert.equal(ruleGroup1!.resourceType, 'rule');
  assert.equal(ruleGroup1!.resourceName, 'custom-rules');
  assert.equal(ruleGroup1!.fullName, 'rules/custom-rules');
  assert.deepEqual(ruleGroup1!.filePaths, ['.cursor/rules/custom-rules.mdc']);

  const ruleGroup2 = grouped.get('rule::other-rule');
  assert.ok(ruleGroup2, 'Should have rule::other-rule group');
  assert.deepEqual(ruleGroup2!.filePaths, ['.cursor/rules/other-rule.mdc']);

  const agentGroup = grouped.get('agent::agent-creator');
  assert.ok(agentGroup, 'Should have agent::agent-creator group');
  assert.equal(agentGroup!.resourceType, 'agent');
  assert.equal(agentGroup!.fullName, 'agents/agent-creator');

  console.log('✓ classifyAndGroupUntrackedFiles — basic grouping');
}

// classifyAndGroupUntrackedFiles — orphan exclusion
{
  const files = [
    { workspacePath: '.claude/skills/my-skill/SKILL.md', category: 'skills' },
    { workspacePath: '.claude/skills/my-skill/readme.md', category: 'skills' },
    { workspacePath: '.claude/skills/orphan.txt', category: 'skills' },
  ];
  const grouped = classifyAndGroupUntrackedFiles(files);

  assert.equal(grouped.size, 1, 'Orphan files should be excluded');
  const skillGroup = grouped.get('skill::my-skill');
  assert.ok(skillGroup, 'Should have skill::my-skill group');
  assert.deepEqual(skillGroup!.filePaths, [
    '.claude/skills/my-skill/SKILL.md',
    '.claude/skills/my-skill/readme.md',
  ]);

  console.log('✓ classifyAndGroupUntrackedFiles — orphan exclusion');
}

// classifyAndGroupUntrackedFiles — empty input
{
  const grouped = classifyAndGroupUntrackedFiles([]);
  assert.equal(grouped.size, 0);
  console.log('✓ classifyAndGroupUntrackedFiles — empty input');
}

// classifyAndGroupUntrackedFiles — mixed types
{
  const files = [
    { workspacePath: '.cursor/rules/my-rule.mdc', category: 'rules' },
    { workspacePath: '.claude/skills/my-skill/SKILL.md', category: 'skills' },
    { workspacePath: '.claude/agents/my-agent.md', category: 'agents' },
  ];
  const grouped = classifyAndGroupUntrackedFiles(files);

  assert.equal(grouped.size, 3, 'Should group each type separately');
  assert.ok(grouped.has('rule::my-rule'));
  assert.ok(grouped.has('skill::my-skill'));
  assert.ok(grouped.has('agent::my-agent'));

  console.log('✓ classifyAndGroupUntrackedFiles — mixed types');
}

console.log('\n✅ All resource-classifier tests passed');
