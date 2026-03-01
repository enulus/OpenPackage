/**
 * Unit tests for resource namespace derivation
 */

import assert from 'node:assert/strict';
import {
  deriveResourceFullName,
  getPathUnderCategory,
  buildMarkerBoundaries,
  deriveMarkerFullName
} from '../../../packages/core/src/core/resources/resource-namespace.js';
import {
  getMarkerFilename,
  findMarkerIndex,
  isMarkerFile
} from '../../../packages/core/src/core/resources/resource-registry.js';

// getPathUnderCategory
{
  assert.equal(getPathUnderCategory('rules/custom-rules.mdc', 'rules'), 'custom-rules.mdc');
  assert.equal(getPathUnderCategory('rules/basics/custom-rules.mdc', 'rules'), 'basics/custom-rules.mdc');
  assert.equal(getPathUnderCategory('.cursor/rules/custom-rules.mdc', 'rules'), 'custom-rules.mdc');
  assert.equal(getPathUnderCategory('.cursor/rules/basics/custom-rules.mdc', 'rules'), 'basics/custom-rules.mdc');
  assert.equal(getPathUnderCategory('agents/agent-creator.md', 'agents'), 'agent-creator.md');
  assert.equal(getPathUnderCategory('skills/my-skill/readme.md', 'skills'), 'my-skill/readme.md');
  assert.equal(getPathUnderCategory('rules/foo', 'rules'), 'foo');
  assert.equal(getPathUnderCategory('rules/', 'rules'), '');
  assert.equal(getPathUnderCategory('other/unknown.mdc', 'rules'), null);
  console.log('✓ getPathUnderCategory works');
}

// Registry marker utilities
{
  assert.equal(getMarkerFilename('skill'), 'SKILL.md');
  assert.equal(getMarkerFilename('rule'), null);
  assert.equal(getMarkerFilename('agent'), null);
  assert.equal(isMarkerFile('SKILL.md', 'skill'), true);
  assert.equal(isMarkerFile('readme.md', 'skill'), false);
  assert.equal(isMarkerFile('SKILL.md', 'rule'), false);
  assert.equal(findMarkerIndex(['my-skill', 'SKILL.md'], 'SKILL.md'), 1);
  assert.equal(findMarkerIndex(['openpackage', 'skill-creator', 'SKILL.md'], 'SKILL.md'), 2);
  assert.equal(findMarkerIndex(['my-skill', 'readme.md'], 'SKILL.md'), -1);
  console.log('✓ Registry marker utilities');
}

// deriveResourceFullName - rules
{
  assert.equal(deriveResourceFullName('rules/custom-rules.mdc', 'rule'), 'rules/custom-rules');
  assert.equal(deriveResourceFullName('rules/basics/custom-rules.mdc', 'rule'), 'rules/basics/custom-rules');
  assert.equal(deriveResourceFullName('.cursor/rules/custom-rules.mdc', 'rule'), 'rules/custom-rules');
  assert.equal(deriveResourceFullName('.cursor/rules/basics/custom-rules.mdc', 'rule'), 'rules/basics/custom-rules');
  // Platform-suffixed variants should resolve to same resource as base
  assert.equal(deriveResourceFullName('rules/foo.mdc', 'rule'), 'rules/foo');
  assert.equal(deriveResourceFullName('rules/foo.cursor.mdc', 'rule'), 'rules/foo');
  console.log('✓ deriveResourceFullName rules');
}

// deriveResourceFullName - agents
{
  assert.equal(deriveResourceFullName('agents/agent-creator.md', 'agent'), 'agents/agent-creator');
  assert.equal(deriveResourceFullName('.opencode/agents/foo.md', 'agent'), 'agents/foo');
  // Platform-suffixed variants should resolve to same resource as base
  assert.equal(deriveResourceFullName('agents/git/git-manager.md', 'agent'), 'agents/git/git-manager');
  assert.equal(deriveResourceFullName('agents/git/git-manager.opencode.md', 'agent'), 'agents/git/git-manager');
  console.log('✓ deriveResourceFullName agents');
}

// deriveResourceFullName - skills (single file, no boundary context)
{
  assert.equal(deriveResourceFullName('skills/my-skill/readme.md', 'skill'), 'skills/my-skill');
  assert.equal(deriveResourceFullName('skills/foo/SKILL.md', 'skill'), 'skills/foo');
  // Nested skill with SKILL.md - deriveResourceFullName detects marker in path
  assert.equal(deriveResourceFullName('skills/openpackage/skill-creator/SKILL.md', 'skill'), 'skills/openpackage/skill-creator');
  assert.equal(deriveResourceFullName('.claude/skills/openpackage/skill-creator/SKILL.md', 'skill'), 'skills/openpackage/skill-creator');
  console.log('✓ deriveResourceFullName skills');
}

// buildMarkerBoundaries + deriveMarkerFullName (boundary-aware grouping)
{
  const paths = [
    'skills/openpackage/skill-creator/SKILL.md',
    'skills/openpackage/skill-creator/agents/foo.md',
    'skills/openpackage/skill-creator/scripts/bar.py',
    'skills/my-skill/SKILL.md',
    'skills/my-skill/readme.md',
  ];
  const boundaries = buildMarkerBoundaries(paths, 'skill');
  assert.deepEqual(boundaries, ['openpackage/skill-creator', 'my-skill']);

  // All nested files group under the correct skill boundary
  assert.equal(deriveMarkerFullName('skills/openpackage/skill-creator/SKILL.md', 'skill', boundaries), 'skills/openpackage/skill-creator');
  assert.equal(deriveMarkerFullName('skills/openpackage/skill-creator/agents/foo.md', 'skill', boundaries), 'skills/openpackage/skill-creator');
  assert.equal(deriveMarkerFullName('skills/openpackage/skill-creator/scripts/bar.py', 'skill', boundaries), 'skills/openpackage/skill-creator');
  assert.equal(deriveMarkerFullName('skills/my-skill/SKILL.md', 'skill', boundaries), 'skills/my-skill');
  assert.equal(deriveMarkerFullName('skills/my-skill/readme.md', 'skill', boundaries), 'skills/my-skill');

  // Also works with platform-prefixed workspace paths
  assert.equal(deriveMarkerFullName('.claude/skills/openpackage/skill-creator/SKILL.md', 'skill', boundaries), 'skills/openpackage/skill-creator');
  assert.equal(deriveMarkerFullName('.cursor/skills/my-skill/readme.md', 'skill', boundaries), 'skills/my-skill');

  // Non-marker types return empty boundaries
  assert.deepEqual(buildMarkerBoundaries(['rules/foo.mdc'], 'rule'), []);
  console.log('✓ buildMarkerBoundaries + deriveMarkerFullName');
}

// deriveResourceFullName - mcp and other
{
  assert.equal(deriveResourceFullName('mcp.json', 'mcp'), 'mcps/configs');
  assert.equal(deriveResourceFullName('anything', 'other'), 'other');
  console.log('✓ deriveResourceFullName mcp and other');
}

console.log('\n✅ All resource-namespace tests passed');
