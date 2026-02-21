/**
 * Recursive Glob Pattern Tests
 * 
 * Tests ** recursive glob pattern support in flow execution.
 * Verifies that ** glob patterns correctly handle nested directory structures.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DefaultFlowExecutor } from '../../../src/core/flows/flow-executor.js';
import type { Flow, FlowContext } from '../../../src/types/flows.js';

// ============================================================================
// Test Setup
// ============================================================================

let testRoot: string;
let packageRoot: string;
let workspaceRoot: string;
let executor: DefaultFlowExecutor;

before(async () => {
  // Create test directories
  testRoot = join(tmpdir(), `opkg-recursive-glob-test-${Date.now()}`);
  packageRoot = join(testRoot, 'package');
  workspaceRoot = join(testRoot, 'workspace');
  
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  
  // Create executor
  executor = new DefaultFlowExecutor();
});

after(async () => {
  // Cleanup
  try {
    await fs.rm(testRoot, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
});

// ============================================================================
// Helper Functions
// ============================================================================

async function createPackageFile(relativePath: string, content: string): Promise<void> {
  const filePath = join(packageRoot, relativePath);
  await fs.mkdir(join(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function readWorkspaceFile(relativePath: string): Promise<string> {
  const filePath = join(workspaceRoot, relativePath);
  return fs.readFile(filePath, 'utf8');
}

async function fileExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(join(workspaceRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function cleanupBetweenTests(): Promise<void> {
  try {
    // Clean package directory
    const packageEntries = await fs.readdir(packageRoot);
    for (const entry of packageEntries) {
      const fullPath = join(packageRoot, entry);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.unlink(fullPath);
      }
    }
    
    // Clean workspace directory
    const workspaceEntries = await fs.readdir(workspaceRoot);
    for (const entry of workspaceEntries) {
      const fullPath = join(workspaceRoot, entry);
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await fs.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.unlink(fullPath);
      }
    }
  } catch (err) {
    // Ignore errors
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Recursive Glob Patterns (**)', () => {
  
  describe('Nested Directory Structures', () => {
    it('should recursively copy all .md files with **/*.md', async () => {
      await cleanupBetweenTests();
      
      // Create nested structure
      await createPackageFile('rules/typescript.md', '# TypeScript Rules');
      await createPackageFile('rules/advanced/generics.md', '# Generics');
      await createPackageFile('rules/advanced/types/unions.md', '# Unions');
      await createPackageFile('rules/basic/variables.md', '# Variables');
      
      const flow: Flow = {
        from: 'rules/**/*.md',
        to: '.cursor/rules/**/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'cursor',
        packageName: '@test/recursive',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      // Should succeed
      assert.strictEqual(result.success, true, `Expected success but got error: ${result.error?.message}`);
      
      // Should copy all files maintaining directory structure
      assert.strictEqual(await fileExists('.cursor/rules/typescript.md'), true);
      assert.strictEqual(await fileExists('.cursor/rules/advanced/generics.md'), true);
      assert.strictEqual(await fileExists('.cursor/rules/advanced/types/unions.md'), true);
      assert.strictEqual(await fileExists('.cursor/rules/basic/variables.md'), true);
    });
    
    it('should recursively copy with extension change **/*.md -> **/*.mdc', async () => {
      await cleanupBetweenTests();
      
      // Create nested structure
      await createPackageFile('rules/typescript.md', '# TypeScript');
      await createPackageFile('rules/linting/eslint.md', '# ESLint');
      await createPackageFile('rules/linting/prettier.md', '# Prettier');
      
      const flow: Flow = {
        from: 'rules/**/*.md',
        to: '.cursor/rules/**/*.mdc',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'cursor',
        packageName: '@test/extension',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      
      // Should have .mdc extension
      assert.strictEqual(await fileExists('.cursor/rules/typescript.mdc'), true);
      assert.strictEqual(await fileExists('.cursor/rules/linting/eslint.mdc'), true);
      assert.strictEqual(await fileExists('.cursor/rules/linting/prettier.mdc'), true);
      
      // Should NOT have .md extension
      assert.strictEqual(await fileExists('.cursor/rules/typescript.md'), false);
    });
    
    it('should copy all files with **/* pattern', async () => {
      await cleanupBetweenTests();
      
      // Create mixed file types in nested structure
      await createPackageFile('skills/code-review/analyze.md', '# Analyze');
      await createPackageFile('skills/code-review/config.json', '{"enabled": true}');
      await createPackageFile('skills/testing/test.ts', 'export const test = true;');
      await createPackageFile('skills/testing/docs/README.md', '# Testing Docs');
      
      const flow: Flow = {
        from: 'skills/**/*',
        to: '.claude/skills/**/*',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'claude',
        packageName: '@test/mixed',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      
      // Should copy all file types
      assert.strictEqual(await fileExists('.claude/skills/code-review/analyze.md'), true);
      assert.strictEqual(await fileExists('.claude/skills/code-review/config.json'), true);
      assert.strictEqual(await fileExists('.claude/skills/testing/test.ts'), true);
      assert.strictEqual(await fileExists('.claude/skills/testing/docs/README.md'), true);
    });

    it('should preserve nested subdirs when from is concrete and to has **', async () => {
      await cleanupBetweenTests();

      await createPackageFile('skills/testing/docs/README.md', '# Testing Docs');

      const flow: Flow = {
        from: 'skills/testing/docs/README.md',
        to: '.claude/skills/**/*',
      };

      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'claude',
        packageName: '@test/concrete-from',
        direction: 'install',
        variables: {},
      };

      const result = await executor.executeFlow(flow, context);

      assert.strictEqual(result.success, true, `Expected success but got error: ${result.error?.message}`);

      // Should not duplicate the "skills" segment (".claude/skills/skills/...")
      assert.strictEqual(await fileExists('.claude/skills/testing/docs/README.md'), true);
      assert.strictEqual(await fileExists('.claude/skills/skills/testing/docs/README.md'), false);
    });
  });
  
  describe('Directory Mapping', () => {
    it('should map commands to workflows recursively', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('commands/deploy/production.md', '# Deploy Production');
      await createPackageFile('commands/deploy/staging.md', '# Deploy Staging');
      await createPackageFile('commands/test/unit.md', '# Unit Tests');
      await createPackageFile('commands/test/integration/api.md', '# API Integration');
      
      const flow: Flow = {
        from: 'commands/**/*.md',
        to: '.agent/workflows/**/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'antigravity',
        packageName: '@test/workflows',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      
      // Check all files mapped with directory structure
      assert.strictEqual(await fileExists('.agent/workflows/deploy/production.md'), true);
      assert.strictEqual(await fileExists('.agent/workflows/deploy/staging.md'), true);
      assert.strictEqual(await fileExists('.agent/workflows/test/unit.md'), true);
      assert.strictEqual(await fileExists('.agent/workflows/test/integration/api.md'), true);
    });
    
    it('should map agents to droids recursively', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('agents/code-review/reviewer.md', '# Reviewer');
      await createPackageFile('agents/code-review/security.md', '# Security');
      await createPackageFile('agents/testing/test-writer.md', '# Test Writer');
      
      const flow: Flow = {
        from: 'agents/**/*.md',
        to: '.factory/droids/**/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'factory',
        packageName: '@test/factory',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(await fileExists('.factory/droids/code-review/reviewer.md'), true);
      assert.strictEqual(await fileExists('.factory/droids/code-review/security.md'), true);
      assert.strictEqual(await fileExists('.factory/droids/testing/test-writer.md'), true);
    });
  });
  
  describe('Content Preservation', () => {
    it('should preserve file content through recursive copy', async () => {
      await cleanupBetweenTests();
      
      const content = '# Test Rule\n\nThis is a test rule with content.';
      await createPackageFile('rules/nested/deep/test.md', content);
      
      const flow: Flow = {
        from: 'rules/**/*.md',
        to: '.windsurf/rules/**/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'windsurf',
        packageName: '@test/content',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      
      const copiedContent = await readWorkspaceFile('.windsurf/rules/nested/deep/test.md');
      assert.strictEqual(copiedContent, content);
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle empty nested directories', async () => {
      await cleanupBetweenTests();
      
      // Create directory with no matching files
      await fs.mkdir(join(packageRoot, 'rules/empty'), { recursive: true });
      await createPackageFile('rules/test.md', '# Test');
      
      const flow: Flow = {
        from: 'rules/**/*.md',
        to: '.cursor/rules/**/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'cursor',
        packageName: '@test/empty',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(await fileExists('.cursor/rules/test.md'), true);
    });
    
    it('should handle deeply nested structures (5+ levels)', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('rules/a/b/c/d/e/deep.md', '# Deep File');
      
      const flow: Flow = {
        from: 'rules/**/*.md',
        to: '.claude/rules/**/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'claude',
        packageName: '@test/deep',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(await fileExists('.claude/rules/a/b/c/d/e/deep.md'), true);
    });
    
    it('should handle files with special characters in nested paths', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('rules/my-rules/v2.1/rule_test.md', '# Rule');
      await createPackageFile('rules/my-rules/v2.1/sub-dir/another.md', '# Another');
      
      const flow: Flow = {
        from: 'rules/**/*.md',
        to: '.opencode/command/**/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'opencode',
        packageName: '@test/special',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(await fileExists('.opencode/command/my-rules/v2.1/rule_test.md'), true);
      assert.strictEqual(await fileExists('.opencode/command/my-rules/v2.1/sub-dir/another.md'), true);
    });
    
    it('should not match files in non-matching directories', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('rules/valid.md', '# Valid');
      await createPackageFile('other/invalid.md', '# Invalid');
      await createPackageFile('rules/nested/valid2.md', '# Valid 2');
      
      const flow: Flow = {
        from: 'rules/**/*.md',
        to: '.cursor/rules/**/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'cursor',
        packageName: '@test/filter',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(await fileExists('.cursor/rules/valid.md'), true);
      assert.strictEqual(await fileExists('.cursor/rules/nested/valid2.md'), true);
      
      // Should NOT copy files from 'other' directory
      assert.strictEqual(await fileExists('.cursor/rules/invalid.md'), false);
      assert.strictEqual(await fileExists('.cursor/other/invalid.md'), false);
    });
  });
});
