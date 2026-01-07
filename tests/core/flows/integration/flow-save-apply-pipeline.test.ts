/**
 * Flow-Based Save and Apply Pipeline Integration Tests
 * 
 * Tests the complete save and apply pipelines with flow-based transformations.
 * Covers:
 * - 8.2.2: Save pipeline tests (reverse transformations, platform detection, format preservation)
 * - 8.2.3: Apply pipeline tests (conditional flows, merge strategies, conflict resolution)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { 
  saveWorkspaceFilesWithFlows,
  shouldUseFlowsForSave,
  getFlowSaveStatistics,
  type FlowSaveOptions
} from '../../../../../src/core/save/flow-based-saver.js';
import { 
  installPackageWithFlows,
  type FlowInstallContext 
} from '../../../../../src/core/install/flow-based-installer.js';
import { runApplyPipeline } from '../../../../../src/core/apply/apply-pipeline.js';
import { clearPlatformsCache } from '../../../../../src/core/platforms.js';
import type { SaveCandidate } from '../../../../../src/core/save/save-types.js';
import type { Platform } from '../../../../../src/core/platforms.js';
import { writeWorkspaceIndex } from '../../../../../src/utils/workspace-index-yml.js';

// ============================================================================
// Test Setup
// ============================================================================

let testRoot: string;
let workspaceRoot: string;
let packageRootA: string;
let packageRootB: string;
let registryRoot: string;

before(async () => {
  // Create test directories
  testRoot = join(tmpdir(), `opkg-flow-save-apply-test-${Date.now()}`);
  workspaceRoot = join(testRoot, 'workspace');
  packageRootA = join(testRoot, 'packages', 'package-a');
  packageRootB = join(testRoot, 'packages', 'package-b');
  registryRoot = join(testRoot, 'registry');
  
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(packageRootA, { recursive: true });
  await fs.mkdir(packageRootB, { recursive: true });
  await fs.mkdir(registryRoot, { recursive: true });
  
  // Create test platform configuration with flows
  const platformConfig = {
    "global": {
      "flows": [
        {
          "from": "AGENTS.md",
          "to": "AGENTS.md",
          "when": {
            "exists": "AGENTS.md"
          }
        }
      ]
    },
    "test-platform": {
      "name": "Test Platform",
      "rootDir": ".test",
      "rootFile": "TEST.md",
      "flows": [
        {
          "from": "rules/{name}.md",
          "to": ".test/rules/{name}.mdc"
        },
        {
          "from": "commands/{name}.md",
          "to": ".test/commands/{name}.md"
        },
        {
          "from": "settings.json",
          "to": ".test/settings.json",
          "merge": "deep"
        },
        {
          "from": "config.yaml",
          "to": "config.json",
          "pipe": ["yaml"]
        }
      ]
    },
    "cursor": {
      "name": "Cursor",
      "rootDir": ".cursor",
      "rootFile": "CURSOR.md",
      "flows": [
        {
          "from": "rules/{name}.md",
          "to": ".cursor/rules/{name}.mdc"
        }
      ]
    }
  };
  
  // Write platform config to workspace .openpackage directory
  const openpackageDir = join(workspaceRoot, '.openpackage');
  await fs.mkdir(openpackageDir, { recursive: true });
  const platformsPath = join(openpackageDir, 'platforms.jsonc');
  await fs.writeFile(platformsPath, JSON.stringify(platformConfig, null, 2), 'utf8');
  
  // Create workspace index
  await writeWorkspaceIndex({
    index: {
      packages: {},
      sources: []
    },
    path: join(workspaceRoot, '.openpackage', 'openpackage.index.yml')
  });
});

after(async () => {
  // Cleanup
  try {
    await fs.rm(testRoot, { recursive: true, force: true });
  } catch (err) {
    // Ignore cleanup errors
  }
});

// Clean up between tests
async function cleanTestDirectories(): Promise<void> {
  try {
    clearPlatformsCache();
    
    const dirs = [packageRootA, packageRootB, registryRoot];
    for (const dir of dirs) {
      const entries = await fs.readdir(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          await fs.unlink(fullPath);
        }
      }
    }
    
    // Clean workspace files except .openpackage
    const workspaceEntries = await fs.readdir(workspaceRoot);
    for (const entry of workspaceEntries) {
      if (entry !== '.openpackage') {
        const fullPath = join(workspaceRoot, entry);
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await fs.rm(fullPath, { recursive: true, force: true });
        } else {
          await fs.unlink(fullPath);
        }
      }
    }
  } catch (err) {
    // Ignore errors
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function createWorkspaceFile(relativePath: string, content: string): Promise<void> {
  const filePath = join(workspaceRoot, relativePath);
  await fs.mkdir(join(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function createPackageFile(packageRoot: string, relativePath: string, content: string): Promise<void> {
  const filePath = join(packageRoot, relativePath);
  await fs.mkdir(join(filePath, '..'), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function readFile(fullPath: string): Promise<string> {
  return fs.readFile(fullPath, 'utf8');
}

async function fileExists(fullPath: string): Promise<boolean> {
  try {
    await fs.access(fullPath);
    return true;
  } catch {
    return false;
  }
}

async function getFileMtime(fullPath: string): Promise<Date> {
  const stats = await fs.stat(fullPath);
  return stats.mtime;
}

// ============================================================================
// 8.2.2 Save Pipeline Tests
// ============================================================================

describe('Flow-Based Save Pipeline', () => {
  
  describe('Basic Save Operations', () => {
    it('should detect platforms that use flows', async () => {
      await cleanTestDirectories();
      
      const useFlows = shouldUseFlowsForSave('test-platform' as Platform, workspaceRoot);
      assert.strictEqual(useFlows, true);
      
      const noFlows = shouldUseFlowsForSave(undefined, workspaceRoot);
      assert.strictEqual(noFlows, false);
    });
    
    it('should save workspace file to package using reverse flow', async () => {
      await cleanTestDirectories();
      
      // Create workspace file matching a flow pattern
      const workspaceFilePath = join(workspaceRoot, '.test', 'rules', 'typescript.mdc');
      await createWorkspaceFile('.test/rules/typescript.mdc', '# TypeScript Rules\n\nNo any types allowed.');
      
      const mtime = await getFileMtime(workspaceFilePath);
      
      // Create save candidate
      const candidates: SaveCandidate[] = [
        {
          source: 'workspace',
          registryPath: 'rules/typescript.md',
          fullPath: workspaceFilePath,
          content: '# TypeScript Rules\n\nNo any types allowed.',
          contentHash: 'hash123',
          mtime,
          displayPath: '.test/rules/typescript.mdc',
          platform: 'test-platform' as Platform,
          isMarkdown: true
        }
      ];
      
      // Execute save
      const result = await saveWorkspaceFilesWithFlows(
        candidates,
        registryRoot,
        workspaceRoot,
        { force: false, dryRun: false }
      );
      
      // Verify
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.filesWritten, 1);
      assert.strictEqual(result.errors.length, 0);
      
      // Check file was written to registry with correct path
      const registryFilePath = join(registryRoot, 'rules', 'typescript.md');
      const exists = await fileExists(registryFilePath);
      assert.strictEqual(exists, true);
      
      const content = await readFile(registryFilePath);
      assert.strictEqual(content, '# TypeScript Rules\n\nNo any types allowed.');
    });
    
    it('should handle dry run mode', async () => {
      await cleanTestDirectories();
      
      const workspaceFilePath = join(workspaceRoot, '.test', 'commands', 'build.md');
      await createWorkspaceFile('.test/commands/build.md', '# Build Command');
      
      const mtime = await getFileMtime(workspaceFilePath);
      
      const candidates: SaveCandidate[] = [
        {
          source: 'workspace',
          registryPath: 'commands/build.md',
          fullPath: workspaceFilePath,
          content: '# Build Command',
          contentHash: 'hash456',
          mtime,
          displayPath: '.test/commands/build.md',
          platform: 'test-platform' as Platform,
          isMarkdown: true
        }
      ];
      
      // Execute with dry run
      const result = await saveWorkspaceFilesWithFlows(
        candidates,
        registryRoot,
        workspaceRoot,
        { force: false, dryRun: true }
      );
      
      // Verify - should process but not write
      assert.strictEqual(result.filesProcessed, 1);
      
      // File should NOT exist in registry
      const registryFilePath = join(registryRoot, 'commands', 'build.md');
      const exists = await fileExists(registryFilePath);
      assert.strictEqual(exists, false);
    });
  });
  
  describe('Reverse Transformations', () => {
    it('should map workspace path back to universal package path', async () => {
      await cleanTestDirectories();
      
      // Create workspace file with pattern matching
      const workspaceFilePath = join(workspaceRoot, '.test', 'rules', 'python.mdc');
      await createWorkspaceFile('.test/rules/python.mdc', '# Python Rules');
      
      const mtime = await getFileMtime(workspaceFilePath);
      
      const candidates: SaveCandidate[] = [
        {
          source: 'workspace',
          registryPath: 'rules/python.md',
          fullPath: workspaceFilePath,
          content: '# Python Rules',
          contentHash: 'hash789',
          mtime,
          displayPath: '.test/rules/python.mdc',
          platform: 'test-platform' as Platform,
          isMarkdown: true
        }
      ];
      
      const result = await saveWorkspaceFilesWithFlows(
        candidates,
        registryRoot,
        workspaceRoot,
        { force: false, dryRun: false }
      );
      
      // Verify correct reverse mapping
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.filesWritten, 1);
      
      // File should be saved as rules/python.md (not python.mdc)
      const registryFilePath = join(registryRoot, 'rules', 'python.md');
      const exists = await fileExists(registryFilePath);
      assert.strictEqual(exists, true);
    });
    
    it('should handle files without matching reverse flow', async () => {
      await cleanTestDirectories();
      
      // Create workspace file that doesn't match any flow
      const workspaceFilePath = join(workspaceRoot, '.test', 'random', 'file.txt');
      await createWorkspaceFile('.test/random/file.txt', 'Random content');
      
      const mtime = await getFileMtime(workspaceFilePath);
      
      const candidates: SaveCandidate[] = [
        {
          source: 'workspace',
          registryPath: 'random/file.txt',
          fullPath: workspaceFilePath,
          content: 'Random content',
          contentHash: 'hash999',
          mtime,
          displayPath: '.test/random/file.txt',
          platform: 'test-platform' as Platform,
          isMarkdown: false
        }
      ];
      
      const result = await saveWorkspaceFilesWithFlows(
        candidates,
        registryRoot,
        workspaceRoot,
        { force: false, dryRun: false }
      );
      
      // Should skip files without matching flows
      assert.strictEqual(result.filesSkipped, 1);
      assert.strictEqual(result.filesWritten, 0);
    });
  });
  
  describe('Platform Detection', () => {
    it('should skip files without platform information', async () => {
      await cleanTestDirectories();
      
      const workspaceFilePath = join(workspaceRoot, 'some-file.txt');
      await createWorkspaceFile('some-file.txt', 'Content');
      
      const mtime = await getFileMtime(workspaceFilePath);
      
      const candidates: SaveCandidate[] = [
        {
          source: 'workspace',
          registryPath: 'some-file.txt',
          fullPath: workspaceFilePath,
          content: 'Content',
          contentHash: 'hash111',
          mtime,
          displayPath: 'some-file.txt',
          platform: undefined, // No platform
          isMarkdown: false
        }
      ];
      
      const result = await saveWorkspaceFilesWithFlows(
        candidates,
        registryRoot,
        workspaceRoot,
        { force: false, dryRun: false }
      );
      
      // Should skip
      assert.strictEqual(result.filesSkipped, 1);
      assert.strictEqual(result.fileResults[0].skipReason, 'No platform detected for file');
    });
    
    it('should skip files from platforms without flows', async () => {
      await cleanTestDirectories();
      
      const workspaceFilePath = join(workspaceRoot, 'file.txt');
      await createWorkspaceFile('file.txt', 'Content');
      
      const mtime = await getFileMtime(workspaceFilePath);
      
      const candidates: SaveCandidate[] = [
        {
          source: 'workspace',
          registryPath: 'file.txt',
          fullPath: workspaceFilePath,
          content: 'Content',
          contentHash: 'hash222',
          mtime,
          displayPath: 'file.txt',
          platform: 'unknown-platform' as Platform,
          isMarkdown: false
        }
      ];
      
      const result = await saveWorkspaceFilesWithFlows(
        candidates,
        registryRoot,
        workspaceRoot,
        { force: false, dryRun: false }
      );
      
      // Should skip or error for unknown platform
      assert.strictEqual(result.filesSkipped, 1);
    });
  });
  
  describe('Statistics and Reporting', () => {
    it('should provide accurate statistics', async () => {
      await cleanTestDirectories();
      
      // Create multiple workspace files
      await createWorkspaceFile('.test/rules/rule1.mdc', '# Rule 1');
      await createWorkspaceFile('.test/rules/rule2.mdc', '# Rule 2');
      await createWorkspaceFile('.test/commands/cmd1.md', '# Command 1');
      
      const mtime = new Date();
      
      const candidates: SaveCandidate[] = [
        {
          source: 'workspace',
          registryPath: 'rules/rule1.md',
          fullPath: join(workspaceRoot, '.test', 'rules', 'rule1.mdc'),
          content: '# Rule 1',
          contentHash: 'hash1',
          mtime,
          displayPath: '.test/rules/rule1.mdc',
          platform: 'test-platform' as Platform,
          isMarkdown: true
        },
        {
          source: 'workspace',
          registryPath: 'rules/rule2.md',
          fullPath: join(workspaceRoot, '.test', 'rules', 'rule2.mdc'),
          content: '# Rule 2',
          contentHash: 'hash2',
          mtime,
          displayPath: '.test/rules/rule2.mdc',
          platform: 'test-platform' as Platform,
          isMarkdown: true
        },
        {
          source: 'workspace',
          registryPath: 'commands/cmd1.md',
          fullPath: join(workspaceRoot, '.test', 'commands', 'cmd1.md'),
          content: '# Command 1',
          contentHash: 'hash3',
          mtime,
          displayPath: '.test/commands/cmd1.md',
          platform: 'test-platform' as Platform,
          isMarkdown: true
        }
      ];
      
      const result = await saveWorkspaceFilesWithFlows(
        candidates,
        registryRoot,
        workspaceRoot,
        { force: false, dryRun: false }
      );
      
      const stats = getFlowSaveStatistics(result);
      
      assert.strictEqual(stats.total, 3);
      assert.strictEqual(stats.written, 3);
      assert.strictEqual(stats.skipped, 0);
      assert.strictEqual(stats.errors, 0);
    });
  });
});

// ============================================================================
// 8.2.3 Apply Pipeline Tests
// ============================================================================

describe('Flow-Based Apply Pipeline', () => {
  
  describe('Conditional Flows', () => {
    it('should apply conditional flow when condition is met', async () => {
      await cleanTestDirectories();
      
      // Create package with AGENTS.md (matching global flow condition)
      await createPackageFile(packageRootA, 'AGENTS.md', '# Test Agent\n\nAgent description.');

      // Global flow condition is `when: { exists: "AGENTS.md" }` (workspace-relative),
      // so create a placeholder file so the conditional flow applies.
      await fs.writeFile(join(workspaceRoot, 'AGENTS.md'), '# Placeholder\n', 'utf8');
      
      // Create workspace index entry
      await writeWorkspaceIndex({
        index: {
          packages: {
            '@test/conditional': {
              path: packageRootA,
              version: '1.0.0',
              files: {}
            }
          },
          sources: []
        },
        path: join(workspaceRoot, '.openpackage', 'openpackage.index.yml')
      });
      
      // Install first to create workspace files
      const context: FlowInstallContext = {
        packageName: '@test/conditional',
        packageRoot: packageRootA,
        workspaceRoot,
        platform: 'test-platform',
        packageVersion: '1.0.0',
        priority: 100,
        dryRun: false
      };
      
      await installPackageWithFlows(context);
      
      // Verify AGENTS.md was installed
      const agentsExists = await fileExists(join(workspaceRoot, 'AGENTS.md'));
      assert.strictEqual(agentsExists, true);
      
      // Now test apply
      // Modify the installed file
      await fs.writeFile(join(workspaceRoot, 'AGENTS.md'), '# Modified Agent\n\nUpdated.', 'utf8');
      
      // Re-apply should restore original
      const result = await runApplyPipeline('@test/conditional', {
        force: true,
        dryRun: false
      });
      
      assert.strictEqual(result.success, true);
      
      const content = await readFile(join(workspaceRoot, 'AGENTS.md'));
      assert.strictEqual(content, '# Test Agent\n\nAgent description.');
    });
  });
  
  describe('Merge Strategies', () => {
    it('should use deep merge strategy for settings', async () => {
      await cleanTestDirectories();
      
      // Create two packages with settings that should merge
      const settingsA = {
        editor: {
          fontSize: 14,
          tabSize: 2
        },
        theme: 'dark'
      };
      
      const settingsB = {
        editor: {
          wordWrap: 'on'
        },
        terminal: {
          fontSize: 12
        }
      };
      
      await createPackageFile(packageRootA, 'settings.json', JSON.stringify(settingsA, null, 2));
      await createPackageFile(packageRootB, 'settings.json', JSON.stringify(settingsB, null, 2));
      
      // Install package A
      const contextA: FlowInstallContext = {
        packageName: '@test/package-a',
        packageRoot: packageRootA,
        workspaceRoot,
        platform: 'test-platform',
        packageVersion: '1.0.0',
        priority: 100,
        dryRun: false
      };
      
      await installPackageWithFlows(contextA);
      
      // Install package B (should merge with A)
      const contextB: FlowInstallContext = {
        packageName: '@test/package-b',
        packageRoot: packageRootB,
        workspaceRoot,
        platform: 'test-platform',
        packageVersion: '1.0.0',
        priority: 90,
        dryRun: false
      };
      
      await installPackageWithFlows(contextB);
      
      // Verify deep merge
      const settingsPath = join(workspaceRoot, '.test', 'settings.json');
      const exists = await fileExists(settingsPath);
      assert.strictEqual(exists, true);
      
      const content = await readFile(settingsPath);
      const merged = JSON.parse(content);
      
      // Should have deep merged editor settings
      assert.strictEqual(merged.editor.fontSize, 14);
      assert.strictEqual(merged.editor.tabSize, 2);
      assert.strictEqual(merged.editor.wordWrap, 'on');
      assert.strictEqual(merged.theme, 'dark');
      assert.strictEqual(merged.terminal.fontSize, 12);
    });
  });
  
  describe('Conflict Resolution', () => {
    it('should handle conflicts with priority-based resolution', async () => {
      await cleanTestDirectories();
      
      // Create two packages with conflicting rules
      await createPackageFile(packageRootA, 'rules/conflict.md', '# Rule from Package A');
      await createPackageFile(packageRootB, 'rules/conflict.md', '# Rule from Package B');
      
      // Install with different priorities
      const contextA: FlowInstallContext = {
        packageName: '@test/package-a',
        packageRoot: packageRootA,
        workspaceRoot,
        platform: 'test-platform',
        packageVersion: '1.0.0',
        priority: 100, // Higher priority
        dryRun: false
      };
      
      await installPackageWithFlows(contextA);
      
      const contextB: FlowInstallContext = {
        packageName: '@test/package-b',
        packageRoot: packageRootB,
        workspaceRoot,
        platform: 'test-platform',
        packageVersion: '1.0.0',
        priority: 90, // Lower priority
        dryRun: false
      };
      
      const resultB = await installPackageWithFlows(contextB);
      
      // Should report conflict
      assert.strictEqual(resultB.conflicts.length, 1);
      
      // Package A (higher priority) should win
      const conflictPath = join(workspaceRoot, '.test', 'rules', 'conflict.mdc');
      const content = await readFile(conflictPath);
      assert.strictEqual(content, '# Rule from Package A');
    });
    
    it('should allow force override during apply', async () => {
      await cleanTestDirectories();
      
      // Install package
      await createPackageFile(packageRootA, 'rules/override.md', '# Original Rule');
      
      const context: FlowInstallContext = {
        packageName: '@test/override',
        packageRoot: packageRootA,
        workspaceRoot,
        platform: 'test-platform',
        packageVersion: '1.0.0',
        priority: 100,
        dryRun: false
      };
      
      await installPackageWithFlows(context);
      
      // Manually modify workspace file
      const workspacePath = join(workspaceRoot, '.test', 'rules', 'override.mdc');
      await fs.writeFile(workspacePath, '# Modified Rule', 'utf8');
      
      // Create workspace index
      await writeWorkspaceIndex({
        index: {
          packages: {
            '@test/override': {
              path: packageRootA,
              version: '1.0.0',
              files: {}
            }
          },
          sources: []
        },
        path: join(workspaceRoot, '.openpackage', 'openpackage.index.yml')
      });
      
      // Apply with force should restore original
      const result = await runApplyPipeline('@test/override', {
        force: true,
        dryRun: false
      });
      
      assert.strictEqual(result.success, true);
      
      const content = await readFile(workspacePath);
      assert.strictEqual(content, '# Original Rule');
    });
  });
  
  describe('Multi-Package Apply', () => {
    it('should apply all packages when no package name specified', async () => {
      await cleanTestDirectories();
      
      // Create multiple packages
      await createPackageFile(packageRootA, 'rules/ruleA.md', '# Rule A');
      await createPackageFile(packageRootB, 'rules/ruleB.md', '# Rule B');
      
      // Install both packages
      const contextA: FlowInstallContext = {
        packageName: '@test/pkg-a',
        packageRoot: packageRootA,
        workspaceRoot,
        platform: 'test-platform',
        packageVersion: '1.0.0',
        priority: 100,
        dryRun: false
      };
      
      await installPackageWithFlows(contextA);
      
      const contextB: FlowInstallContext = {
        packageName: '@test/pkg-b',
        packageRoot: packageRootB,
        workspaceRoot,
        platform: 'test-platform',
        packageVersion: '1.0.0',
        priority: 90,
        dryRun: false
      };
      
      await installPackageWithFlows(contextB);
      
      // Modify both workspace files
      await fs.writeFile(join(workspaceRoot, '.test', 'rules', 'ruleA.mdc'), '# Modified A', 'utf8');
      await fs.writeFile(join(workspaceRoot, '.test', 'rules', 'ruleB.mdc'), '# Modified B', 'utf8');
      
      // Create workspace index with both packages
      await writeWorkspaceIndex({
        index: {
          packages: {
            '@test/pkg-a': {
              path: packageRootA,
              version: '1.0.0',
              files: {}
            },
            '@test/pkg-b': {
              path: packageRootB,
              version: '1.0.0',
              files: {}
            }
          },
          sources: []
        },
        path: join(workspaceRoot, '.openpackage', 'openpackage.index.yml')
      });
      
      // Apply all packages
      const result = await runApplyPipeline(undefined, {
        force: true,
        dryRun: false
      });
      
      assert.strictEqual(result.success, true);
      
      // Both files should be restored
      const contentA = await readFile(join(workspaceRoot, '.test', 'rules', 'ruleA.mdc'));
      const contentB = await readFile(join(workspaceRoot, '.test', 'rules', 'ruleB.mdc'));
      assert.strictEqual(contentA, '# Rule A');
      assert.strictEqual(contentB, '# Rule B');
    });
  });
});

console.log('✓ Flow-Based Save and Apply Pipeline Integration Tests');
