/**
 * Glob Pattern Tests
 * 
 * Tests glob pattern support in flow execution.
 * Verifies that * patterns work correctly for batch file operations.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { DefaultFlowExecutor } from '../../src/core/flows/flow-executor.js';
import type { Flow, FlowContext } from '../../src/types/flows.js';

// ============================================================================
// Test Setup
// ============================================================================

let testRoot: string;
let packageRoot: string;
let workspaceRoot: string;
let executor: DefaultFlowExecutor;

before(async () => {
  // Create test directories
  testRoot = join(tmpdir(), `opkg-glob-test-${Date.now()}`);
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

describe('Glob Pattern Support', () => {
  
  describe('Basic Glob Patterns', () => {
    it('should match *.md files', async () => {
      await cleanupBetweenTests();
      
      // Create test files
      await createPackageFile('rules/typescript.md', '# TypeScript Rules');
      await createPackageFile('rules/python.md', '# Python Rules');
      await createPackageFile('rules/readme.txt', 'Not a markdown file');
      
      const flow: Flow = {
        from: 'rules/*.md',
        to: '.cursor/rules/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'cursor',
        packageName: '@test/glob',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      // Should succeed
      assert.strictEqual(result.success, true);
      
      // Should copy .md files
      const tsExists = await fileExists('.cursor/rules/typescript.md');
      const pyExists = await fileExists('.cursor/rules/python.md');
      assert.strictEqual(tsExists, true);
      assert.strictEqual(pyExists, true);
      
      // Should NOT copy .txt file
      const txtExists = await fileExists('.cursor/rules/readme.txt');
      assert.strictEqual(txtExists, false);
    });
    
    it('should change file extension with glob', async () => {
      await cleanupBetweenTests();
      
      // Create test files
      await createPackageFile('rules/code-review.md', '# Code Review');
      await createPackageFile('rules/formatting.md', '# Formatting');
      
      const flow: Flow = {
        from: 'rules/*.md',
        to: '.cursor/rules/*.mdc',
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
      
      // Files should have .mdc extension
      const reviewExists = await fileExists('.cursor/rules/code-review.mdc');
      const formatExists = await fileExists('.cursor/rules/formatting.mdc');
      assert.strictEqual(reviewExists, true);
      assert.strictEqual(formatExists, true);
      
      // Should NOT have .md extension
      const mdExists = await fileExists('.cursor/rules/code-review.md');
      assert.strictEqual(mdExists, false);
    });
    
    it('should handle empty glob match', async () => {
      await cleanupBetweenTests();
      
      // Don't create any matching files
      
      const flow: Flow = {
        from: 'rules/*.md',
        to: '.cursor/rules/*.md',
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
      
      // Should succeed with warning
      assert.strictEqual(result.success, true);
      assert.ok(result.warnings);
      assert.ok(result.warnings.some(w => w.includes('No files matched')));
    });
  });
  
  describe('Directory Mapping', () => {
    it('should map commands to workflows', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('commands/deploy.md', '# Deploy Command');
      await createPackageFile('commands/test.md', '# Test Command');
      await createPackageFile('commands/build.md', '# Build Command');
      
      const flow: Flow = {
        from: 'commands/*.md',
        to: '.agent/workflows/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'antigravity',
        packageName: '@test/mapping',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      
      // Check all files mapped correctly
      assert.strictEqual(await fileExists('.agent/workflows/deploy.md'), true);
      assert.strictEqual(await fileExists('.agent/workflows/test.md'), true);
      assert.strictEqual(await fileExists('.agent/workflows/build.md'), true);
    });
    
    it('should map agents to droids', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('agents/code-reviewer.md', '# Code Reviewer Agent');
      await createPackageFile('agents/test-writer.md', '# Test Writer Agent');
      
      const flow: Flow = {
        from: 'agents/*.md',
        to: '.factory/droids/*.md',
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
      assert.strictEqual(await fileExists('.factory/droids/code-reviewer.md'), true);
      assert.strictEqual(await fileExists('.factory/droids/test-writer.md'), true);
    });
  });
  
  describe('Single File Flows', () => {
    it('should copy exact file without glob', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('AGENTS.md', '# Universal Agent Instructions');
      
      const flow: Flow = {
        from: 'AGENTS.md',
        to: 'AGENTS.md',
        when: { exists: 'AGENTS.md' },
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'cursor',
        packageName: '@test/single',
        direction: 'install',
        variables: {},
      };
      
      // Create target file first (condition requirement)
      await fs.writeFile(join(workspaceRoot, 'AGENTS.md'), '# Existing', 'utf8');
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      
      const content = await readWorkspaceFile('AGENTS.md');
      assert.strictEqual(content, '# Universal Agent Instructions');
    });
    
    it('should map AGENTS.md to platform-specific root file', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('AGENTS.md', '# Agent Instructions');
      
      const flow: Flow = {
        from: 'AGENTS.md',
        to: 'CLAUDE.md',
        when: { exists: 'CLAUDE.md' },
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'claude',
        packageName: '@test/claude',
        direction: 'install',
        variables: {},
      };
      
      // Create CLAUDE.md first
      await fs.writeFile(join(workspaceRoot, 'CLAUDE.md'), '# Existing', 'utf8');
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      
      const content = await readWorkspaceFile('CLAUDE.md');
      assert.strictEqual(content, '# Agent Instructions');
    });
  });
  
  describe('Conditional Flows', () => {
    it('should skip flow when condition not met', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('AGENTS.md', '# Agent Instructions');
      
      const flow: Flow = {
        from: 'AGENTS.md',
        to: 'WARP.md',
        when: { exists: 'WARP.md' },
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'warp',
        packageName: '@test/conditional',
        direction: 'install',
        variables: {},
      };
      
      // Don't create WARP.md - condition should fail
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.ok(result.warnings);
      assert.ok(result.warnings.some(w => w.includes('skipped due to condition')));
      
      // File should not exist
      const exists = await fileExists('WARP.md');
      assert.strictEqual(exists, false);
    });
    
    it('should execute flow when condition met', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('AGENTS.md', '# Agent Instructions');
      
      const flow: Flow = {
        from: 'AGENTS.md',
        to: 'QWEN.md',
        when: { exists: 'QWEN.md' },
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'qwen',
        packageName: '@test/conditional-pass',
        direction: 'install',
        variables: {},
      };
      
      // Create QWEN.md - condition should pass
      await fs.writeFile(join(workspaceRoot, 'QWEN.md'), '# Existing', 'utf8');
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      
      const content = await readWorkspaceFile('QWEN.md');
      assert.strictEqual(content, '# Agent Instructions');
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle files with special characters in names', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('rules/my-rule-v2.1.md', '# Rule v2.1');
      await createPackageFile('rules/rule_with_underscores.md', '# Underscores');
      
      const flow: Flow = {
        from: 'rules/*.md',
        to: '.windsurf/rules/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'windsurf',
        packageName: '@test/special',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(await fileExists('.windsurf/rules/my-rule-v2.1.md'), true);
      assert.strictEqual(await fileExists('.windsurf/rules/rule_with_underscores.md'), true);
    });
    
    it('should handle deeply nested directories', async () => {
      await cleanupBetweenTests();
      
      await createPackageFile('skills/code-review/analyze.md', '# Analyze');
      await createPackageFile('skills/code-review/suggest.md', '# Suggest');
      
      // Note: Current implementation handles single-level glob
      // For nested structures, pattern should include path
      const flow: Flow = {
        from: 'skills/code-review/*.md',
        to: '.claude/skills/code-review/*.md',
      };
      
      const context: FlowContext = {
        packageRoot,
        workspaceRoot,
        platform: 'claude',
        packageName: '@test/nested',
        direction: 'install',
        variables: {},
      };
      
      const result = await executor.executeFlow(flow, context);
      
      assert.strictEqual(result.success, true);
      assert.strictEqual(await fileExists('.claude/skills/code-review/analyze.md'), true);
      assert.strictEqual(await fileExists('.claude/skills/code-review/suggest.md'), true);
    });
  });
});
