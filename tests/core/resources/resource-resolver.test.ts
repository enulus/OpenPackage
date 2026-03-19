/**
 * Unit tests for resource-resolver matchCandidates.
 */

import assert from 'node:assert/strict';
import { matchCandidates } from '../../../packages/core/src/core/resources/resource-resolver.js';
import type { WorkspaceResources, ResolvedResource, ResolvedPackage } from '../../../packages/core/src/core/resources/resource-builder.js';

function makeResource(overrides: Partial<ResolvedResource> & Pick<ResolvedResource, 'resourceName' | 'resourceType'>): ResolvedResource {
  return {
    kind: 'tracked',
    sourceKeys: new Set(),
    targetFiles: [],
    scope: 'project',
    ...overrides,
  };
}

function makePackage(overrides: Partial<ResolvedPackage> & { packageName: string }): ResolvedPackage {
  return {
    resourceCount: 0,
    targetFiles: [],
    scope: 'project',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// matchCandidates — resource matching (case-insensitive)
// ---------------------------------------------------------------------------

{
  const workspace: WorkspaceResources = {
    resources: [
      makeResource({ resourceName: 'skill-dev', resourceType: 'skill' }),
    ],
    packages: [],
  };
  const result = matchCandidates(workspace, 'skill-dev');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'resource');
  assert.equal(result[0].resource?.resourceName, 'skill-dev');
  console.log('✓ matchCandidates — matches resource by exact name');
}

{
  const workspace: WorkspaceResources = {
    resources: [
      makeResource({ resourceName: 'Skill-Dev', resourceType: 'skill' }),
    ],
    packages: [],
  };
  const result = matchCandidates(workspace, 'skill-dev');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'resource');
  assert.equal(result[0].resource?.resourceName, 'Skill-Dev');
  console.log('✓ matchCandidates — matches resource case-insensitively');
}

// ---------------------------------------------------------------------------
// matchCandidates — package matching (case-sensitive)
// ---------------------------------------------------------------------------

{
  const workspace: WorkspaceResources = {
    resources: [],
    packages: [
      makePackage({ packageName: 'openpackage' }),
    ],
  };
  const result = matchCandidates(workspace, 'openpackage');
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, 'package');
  assert.equal(result[0].package?.packageName, 'openpackage');
  console.log('✓ matchCandidates — matches package by exact name');
}

{
  const workspace: WorkspaceResources = {
    resources: [],
    packages: [
      makePackage({ packageName: 'OpenPackage' }),
    ],
  };
  const result = matchCandidates(workspace, 'openpackage');
  assert.equal(result.length, 0);
  console.log('✓ matchCandidates — does not match package when case differs');
}

// ---------------------------------------------------------------------------
// matchCandidates — no match
// ---------------------------------------------------------------------------

{
  const workspace: WorkspaceResources = {
    resources: [
      makeResource({ resourceName: 'other-skill', resourceType: 'skill' }),
    ],
    packages: [
      makePackage({ packageName: 'other-package' }),
    ],
  };
  const result = matchCandidates(workspace, 'nonexistent');
  assert.equal(result.length, 0);
  console.log('✓ matchCandidates — returns empty array on no match');
}

// ---------------------------------------------------------------------------
// matchCandidates — multiple matches
// ---------------------------------------------------------------------------

{
  const workspace: WorkspaceResources = {
    resources: [
      makeResource({ resourceName: 'my-thing', resourceType: 'skill', packageName: 'pkg-a' }),
      makeResource({ resourceName: 'my-thing', resourceType: 'agent', packageName: 'pkg-b' }),
    ],
    packages: [],
  };
  const result = matchCandidates(workspace, 'my-thing');
  assert.equal(result.length, 2);
  assert.equal(result[0].resource?.resourceType, 'skill');
  assert.equal(result[1].resource?.resourceType, 'agent');
  console.log('✓ matchCandidates — returns multiple matching resources');
}

// ---------------------------------------------------------------------------
// matchCandidates — resource + package name collision
// ---------------------------------------------------------------------------

{
  const workspace: WorkspaceResources = {
    resources: [
      makeResource({ resourceName: 'openpackage', resourceType: 'skill', packageName: 'openpackage' }),
    ],
    packages: [
      makePackage({ packageName: 'openpackage' }),
    ],
  };
  const result = matchCandidates(workspace, 'openpackage');
  assert.equal(result.length, 2);
  assert.equal(result[0].kind, 'resource');
  assert.equal(result[1].kind, 'package');
  console.log('✓ matchCandidates — returns both resource and package when names collide');
}

console.log('\nAll resource-resolver tests passed.');
