/**
 * Unit tests for resource-spec classification and resolution.
 */

import assert from 'node:assert/strict';
import { classifyResourceSpec } from '../../../packages/core/src/core/resources/resource-spec.js';

// ---------------------------------------------------------------------------
// classifyResourceSpec — explicit paths
// ---------------------------------------------------------------------------

{
  const result = classifyResourceSpec('./foo');
  assert.equal(result.kind, 'explicit-path');
  console.log('✓ classifyResourceSpec — ./foo → explicit-path');
}

{
  const result = classifyResourceSpec('../foo');
  assert.equal(result.kind, 'explicit-path');
  console.log('✓ classifyResourceSpec — ../foo → explicit-path');
}

{
  const result = classifyResourceSpec('/absolute/path');
  assert.equal(result.kind, 'explicit-path');
  console.log('✓ classifyResourceSpec — /absolute/path → explicit-path');
}

{
  const result = classifyResourceSpec('~/foo');
  assert.equal(result.kind, 'explicit-path');
  console.log('✓ classifyResourceSpec — ~/foo → explicit-path');
}

{
  const result = classifyResourceSpec('.');
  assert.equal(result.kind, 'explicit-path');
  console.log('✓ classifyResourceSpec — . → explicit-path');
}

{
  const result = classifyResourceSpec('~');
  assert.equal(result.kind, 'explicit-path');
  console.log('✓ classifyResourceSpec — ~ → explicit-path');
}

// ---------------------------------------------------------------------------
// classifyResourceSpec — trailing slash → other
// ---------------------------------------------------------------------------

{
  const result = classifyResourceSpec('agents/');
  assert.equal(result.kind, 'other');
  console.log('✓ classifyResourceSpec — agents/ → other (trailing slash)');
}

// ---------------------------------------------------------------------------
// classifyResourceSpec — resource-ref (type-qualified)
// ---------------------------------------------------------------------------

{
  const result = classifyResourceSpec('agents/ui-designer');
  assert.equal(result.kind, 'resource-ref');
  if (result.kind === 'resource-ref') {
    assert.equal(result.query.typeFilter, 'agent');
    assert.equal(result.query.name, 'ui-designer');
  }
  console.log('✓ classifyResourceSpec — agents/ui-designer → resource-ref (agent)');
}

{
  const result = classifyResourceSpec('skills/my-skill');
  assert.equal(result.kind, 'resource-ref');
  if (result.kind === 'resource-ref') {
    assert.equal(result.query.typeFilter, 'skill');
    assert.equal(result.query.name, 'my-skill');
  }
  console.log('✓ classifyResourceSpec — skills/my-skill → resource-ref (skill)');
}

{
  const result = classifyResourceSpec('rules/basics/custom-rules');
  assert.equal(result.kind, 'resource-ref');
  if (result.kind === 'resource-ref') {
    assert.equal(result.query.typeFilter, 'rule');
    assert.equal(result.query.name, 'basics/custom-rules');
  }
  console.log('✓ classifyResourceSpec — rules/basics/custom-rules → resource-ref (rule, nested)');
}

{
  const result = classifyResourceSpec('commands/my-cmd');
  assert.equal(result.kind, 'resource-ref');
  if (result.kind === 'resource-ref') {
    assert.equal(result.query.typeFilter, 'command');
    assert.equal(result.query.name, 'my-cmd');
  }
  console.log('✓ classifyResourceSpec — commands/my-cmd → resource-ref (command)');
}

{
  const result = classifyResourceSpec('hooks/my-hook');
  assert.equal(result.kind, 'resource-ref');
  if (result.kind === 'resource-ref') {
    assert.equal(result.query.typeFilter, 'hook');
    assert.equal(result.query.name, 'my-hook');
  }
  console.log('✓ classifyResourceSpec — hooks/my-hook → resource-ref (hook)');
}

// ---------------------------------------------------------------------------
// classifyResourceSpec — other (non-resource patterns)
// ---------------------------------------------------------------------------

{
  const result = classifyResourceSpec('src/components');
  assert.equal(result.kind, 'other');
  console.log('✓ classifyResourceSpec — src/components → other (unknown type prefix)');
}

{
  const result = classifyResourceSpec('essentials');
  assert.equal(result.kind, 'other');
  console.log('✓ classifyResourceSpec — essentials → other (bare name, no slash)');
}

{
  const result = classifyResourceSpec('essentials@1.0');
  assert.equal(result.kind, 'other');
  console.log('✓ classifyResourceSpec — essentials@1.0 → other (version specifier)');
}

{
  const result = classifyResourceSpec('gh@owner/repo');
  assert.equal(result.kind, 'other');
  console.log('✓ classifyResourceSpec — gh@owner/repo → other (git shorthand)');
}

{
  const result = classifyResourceSpec('@scope/package');
  assert.equal(result.kind, 'other');
  console.log('✓ classifyResourceSpec — @scope/package → other (scoped package)');
}

console.log('\n✅ All resource-spec tests passed');
