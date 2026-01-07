import assert from 'node:assert/strict';
import { mergeInlinePlatformOverride } from '../../../src/utils/platform-yaml-merge.js';

const inlineFrontmatter = `---
name: yaml-test
description: "Universal description"
globs:
  - "**/*.md"
openpackage:
  cursor:
    description: "Cursor-optimized description"
    globs:
      - "src/**/*.ts"
  claudecode:
    alwaysApply: true
    temperature: 0.3
---

# Universal Agent

This is the universal agent content.
`;

// Test 1: Target platform receives merged common + override block (no platform blocks emitted)
const mergedCursor = mergeInlinePlatformOverride(inlineFrontmatter, 'cursor');

assert.ok(
  mergedCursor.includes('Cursor-optimized description'),
  'Cursor merge should include cursor-specific description'
);
assert.ok(
  mergedCursor.includes('src/**/*.ts'),
  'Cursor merge should include cursor-specific globs'
);
assert.ok(
  !mergedCursor.includes('openpackage:'),
  'Merged output should not emit openpackage override blocks'
);

console.log('✓ Inline merge applies platform block and drops platform sections');

// Test 2: Alias key is recognized (claudecode -> claude)
const mergedClaude = mergeInlinePlatformOverride(inlineFrontmatter, 'claude');
assert.ok(
  mergedClaude.includes('temperature: 0.3'),
  'Alias block should apply to canonical platform id'
);

console.log('✓ Alias platform keys are resolved correctly');

// Test 3: Non-object platform override is ignored
const inlineWithNonObject = `---
name: yaml-test
openpackage:
  cursor: "not-an-object"
---
Body
`;
const mergedWithNonObject = mergeInlinePlatformOverride(inlineWithNonObject, 'cursor');
assert.ok(!mergedWithNonObject.includes('openpackage'), 'Non-object override should be dropped');

console.log('✓ Non-object platform overrides are ignored');

// Test 4: Non-markdown content is returned unchanged
const nonMarkdownContent = 'plain text content without frontmatter';
assert.strictEqual(
  mergeInlinePlatformOverride(nonMarkdownContent, 'cursor'),
  nonMarkdownContent,
  'Non-markdown content should return unchanged'
);

console.log('\n✅ All inline frontmatter override merge tests passed!');

