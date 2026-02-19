/**
 * Unit tests for resource namespace derivation
 */

import assert from 'node:assert/strict';
import {
  deriveResourceFullName,
  getPathUnderCategory
} from '../../../src/core/resources/resource-namespace.js';

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

// deriveResourceFullName - rules
{
  assert.equal(deriveResourceFullName('rules/custom-rules.mdc', 'rule'), 'rules/custom-rules');
  assert.equal(deriveResourceFullName('rules/basics/custom-rules.mdc', 'rule'), 'rules/basics/custom-rules');
  assert.equal(deriveResourceFullName('.cursor/rules/custom-rules.mdc', 'rule'), 'rules/custom-rules');
  assert.equal(deriveResourceFullName('.cursor/rules/basics/custom-rules.mdc', 'rule'), 'rules/basics/custom-rules');
  console.log('✓ deriveResourceFullName rules');
}

// deriveResourceFullName - agents
{
  assert.equal(deriveResourceFullName('agents/agent-creator.md', 'agent'), 'agents/agent-creator');
  assert.equal(deriveResourceFullName('.opencode/agents/foo.md', 'agent'), 'agents/foo');
  console.log('✓ deriveResourceFullName agents');
}

// deriveResourceFullName - skills
{
  assert.equal(deriveResourceFullName('skills/my-skill/readme.md', 'skill'), 'skills/my-skill');
  assert.equal(deriveResourceFullName('skills/foo/SKILL.md', 'skill'), 'skills/foo');
  console.log('✓ deriveResourceFullName skills');
}

// deriveResourceFullName - mcp and other
{
  assert.equal(deriveResourceFullName('mcp.json', 'mcp'), 'mcps/MCP Server Configuration');
  assert.equal(deriveResourceFullName('anything', 'other'), 'other/uncategorized');
  console.log('✓ deriveResourceFullName mcp and other');
}

console.log('\n✅ All resource-namespace tests passed');
