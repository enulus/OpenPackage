/**
 * Tests for universal pattern matching system
 * Validates flow-based filtering for package content
 */

import assert from 'node:assert/strict';
import { isPatternMatch, matchesAnyPattern, extractFirstComponent, isSubdirectoryPattern, extractSubdirectoriesFromPatterns } from '../../../src/core/universal-patterns.js';

// Test exact file matching
assert.equal(isPatternMatch('mcp.jsonc', 'mcp.jsonc'), true, 'exact match: mcp.jsonc');
assert.equal(isPatternMatch('AGENTS.md', 'AGENTS.md'), true, 'exact match: AGENTS.md');
assert.equal(isPatternMatch('mcp.jsonc', 'config.json'), false, 'exact non-match');

// Test single-level wildcard (*)
assert.equal(isPatternMatch('rules/typescript.md', 'rules/*.md'), true, 'single wildcard match');
assert.equal(isPatternMatch('rules/python.md', 'rules/*.md'), true, 'single wildcard match 2');
assert.equal(isPatternMatch('rules/advanced/generics.md', 'rules/*.md'), false, 'single wildcard should not match subdirs');
assert.equal(isPatternMatch('commands/build.md', 'rules/*.md'), false, 'single wildcard wrong dir');

// Test recursive wildcard (**/*)
assert.equal(isPatternMatch('rules/typescript.md', 'rules/**/*.md'), true, 'recursive match: direct child');
assert.equal(isPatternMatch('rules/advanced/generics.md', 'rules/**/*.md'), true, 'recursive match: nested');
assert.equal(isPatternMatch('rules/advanced/types/unions.md', 'rules/**/*.md'), true, 'recursive match: deeply nested');
assert.equal(isPatternMatch('commands/build.md', 'rules/**/*.md'), false, 'recursive wrong dir');
assert.equal(isPatternMatch('rules/config.json', 'rules/**/*.md'), false, 'recursive wrong extension');

// Test all files recursively (**/* - no extension filter)
assert.equal(isPatternMatch('skills/code-review/analyze.md', 'skills/**/*'), true, 'all files: markdown');
assert.equal(isPatternMatch('skills/code-review/config.json', 'skills/**/*'), true, 'all files: json');
assert.equal(isPatternMatch('skills/helpers/utils.ts', 'skills/**/*'), true, 'all files: typescript');
assert.equal(isPatternMatch('skills/test.txt', 'skills/**/*'), true, 'all files: text');
assert.equal(isPatternMatch('rules/test.md', 'skills/**/*'), false, 'all files: wrong dir');

// Test matchesAnyPattern
const patterns = new Set([
  'mcp.jsonc',
  'rules/**/*.md',
  'commands/*.md',
  'skills/**/*'
]);

assert.equal(matchesAnyPattern('mcp.jsonc', patterns), true, 'matches exact pattern in set');
assert.equal(matchesAnyPattern('rules/typescript.md', patterns), true, 'matches recursive pattern');
assert.equal(matchesAnyPattern('commands/build.md', patterns), true, 'matches single-level pattern');
assert.equal(matchesAnyPattern('skills/helper.ts', patterns), true, 'matches all-files pattern');
assert.equal(matchesAnyPattern('config.json', patterns), false, 'no match in set');
assert.equal(matchesAnyPattern('docs/readme.md', patterns), false, 'no match for unspecified dir');

// Test extractFirstComponent
assert.equal(extractFirstComponent('rules/**/*.md'), 'rules', 'extract from recursive pattern');
assert.equal(extractFirstComponent('commands/*.md'), 'commands', 'extract from single-level pattern');
assert.equal(extractFirstComponent('mcp.jsonc'), 'mcp.jsonc', 'extract from root file');
assert.equal(extractFirstComponent('agents/assistant.md'), 'agents', 'extract from simple path');

// Test isSubdirectoryPattern
assert.equal(isSubdirectoryPattern('rules/**/*.md'), true, 'rules is a subdir');
assert.equal(isSubdirectoryPattern('commands/*.md'), true, 'commands is a subdir');
assert.equal(isSubdirectoryPattern('mcp.jsonc'), false, 'mcp.jsonc is a root file');
assert.equal(isSubdirectoryPattern('AGENTS.md'), false, 'AGENTS.md is a root file');
assert.equal(isSubdirectoryPattern('config.json'), false, 'config.json is a root file');

// Test extractSubdirectoriesFromPatterns
const testPatterns = new Set([
  'rules/**/*.md',
  'commands/*.md',
  'mcp.jsonc',
  'agents/**/*.md',
  'AGENTS.md',
  'skills/**/*'
]);

const subdirs = extractSubdirectoriesFromPatterns(testPatterns);
assert.equal(subdirs.size, 4, 'should extract 4 subdirs');
assert.equal(subdirs.has('rules'), true, 'should include rules');
assert.equal(subdirs.has('commands'), true, 'should include commands');
assert.equal(subdirs.has('agents'), true, 'should include agents');
assert.equal(subdirs.has('skills'), true, 'should include skills');
assert.equal(subdirs.has('mcp.jsonc'), false, 'should not include root files');
assert.equal(subdirs.has('AGENTS.md'), false, 'should not include root files');

// Test edge cases
assert.equal(isPatternMatch('', 'test.md'), false, 'empty path');
assert.equal(isPatternMatch('test.md', ''), false, 'empty pattern');
assert.equal(isPatternMatch('rules/test.md', 'rules/*/*.md'), false, 'too many levels for pattern');

// Test pattern normalization
assert.equal(isPatternMatch('rules\\test.md', 'rules/*.md'), true, 'handle backslashes (Windows)');
assert.equal(isPatternMatch('rules/test.md', 'rules\\*.md'), true, 'handle backslashes in pattern');

console.log('✅ All universal pattern matching tests passed');
