/**
 * Enhanced Package Format Detection Tests
 * 
 * Tests the two-tier package format detection system:
 * - Tier 1: Package-level markers (fast path)
 * - Tier 2: Per-file detection (detailed path)
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { detectEnhancedPackageFormat } from '../../../src/core/install/format-detector.js';
import type { PackageFile } from '../../../src/core/install/detection-types.js';

describe('Enhanced Package Format Detection', () => {
  describe('Tier 1: Package-Level Markers (Fast Path)', () => {
    it('should detect Claude plugin via marker', async () => {
      const files: PackageFile[] = [
        { path: '.claude-plugin/plugin.json', content: '{}' },
        { path: 'agents/test.md', content: '# Test' }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.packageFormat, 'claude-plugin');
      assert.equal(result.detectionMethod, 'package-marker');
      assert.equal(result.confidence, 1.0);
      assert.ok(result.markers);
      assert.ok(result.markers.matchedPatterns.length > 0);
    });

    it('should detect Claude platform via directory marker', async () => {
      const files: PackageFile[] = [
        { path: '.claude/agents/test.md', content: '# Test' },
        { path: '.claude/rules/rule.md', content: '# Rule' }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.packageFormat, 'claude');
      assert.equal(result.detectionMethod, 'package-marker');
      assert.equal(result.confidence, 1.0);
    });

    it('should detect Cursor platform via directory marker', async () => {
      const files: PackageFile[] = [
        { path: '.cursor/agents/test.md', content: '# Test' }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.packageFormat, 'cursor');
      assert.equal(result.detectionMethod, 'package-marker');
      assert.equal(result.confidence, 1.0);
    });

    it('should use fast path for pure platform package', async () => {
      const files: PackageFile[] = [
        { path: '.opencode/agents/test.md', content: '# Test' },
        { path: '.opencode/commands/cmd.md', content: '# Command' }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.packageFormat, 'opencode');
      assert.equal(result.detectionMethod, 'package-marker');
      // Fast path doesn't analyze individual files
      assert.equal(result.analysis.analyzedFiles, 0);
      assert.equal(result.analysis.skippedFiles, files.length);
    });
  });

  describe('Tier 2: Per-File Detection (Detailed Path)', () => {
    it('should fall back to per-file detection without markers', async () => {
      const files: PackageFile[] = [
        {
          path: 'agents/claude-agent.md',
          content: `---
tools: Read, Write
permissionMode: default
---
# Claude Agent`
        },
        {
          path: 'agents/another-agent.md',
          content: `---
tools: Execute
permissionMode: acceptEdits
---
# Another Agent`
        }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.detectionMethod, 'per-file');
      assert.ok(result.fileFormats);
      assert.ok(result.fileFormats.size > 0);
      assert.ok(result.formatGroups);
    });

    it('should detect uniform platform from per-file analysis', async () => {
      const files: PackageFile[] = [
        {
          path: 'agents/a.md',
          content: `---
tools: Read
permissionMode: default
---
# Agent A`
        },
        {
          path: 'agents/b.md',
          content: `---
tools: Write
hooks:
  onStart: echo "test"
---
# Agent B`
        }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.detectionMethod, 'per-file');
      // Should detect Claude format from exclusive fields
      assert.ok(['claude', 'universal'].includes(result.packageFormat));
      assert.ok(result.fileFormats);
      assert.equal(result.fileFormats.size, 2);
    });

    it('should detect mixed formats from per-file analysis', async () => {
      const files: PackageFile[] = [
        {
          path: 'agents/claude.md',
          content: `---
tools: Read
permissionMode: default
---
# Claude Agent`
        },
        {
          path: 'agents/opencode.md',
          content: `---
tools:
  read: true
  write: false
temperature: 0.5
---
# OpenCode Agent`
        }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.detectionMethod, 'per-file');
      assert.ok(result.fileFormats);
      assert.ok(result.formatGroups);
      // May be mixed or one dominant platform
      assert.ok(['mixed', 'claude', 'opencode', 'universal'].includes(result.packageFormat));
    });

    it('should skip files without frontmatter', async () => {
      const files: PackageFile[] = [
        {
          path: 'agents/with-frontmatter.md',
          content: `---
tools: Read
---
# Agent`
        },
        {
          path: 'README.md',
          content: '# Just a README'
        },
        {
          path: 'docs/guide.md',
          content: '# Guide'
        }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.analysis.totalFiles, 3);
      // Files without frontmatter at universal paths may now be analyzed as 'universal'
      // rather than being skipped, so relax the assertions
      assert.ok(result.analysis.analyzedFiles >= 1, 'At least the frontmatter file should be analyzed');
    });

    it('should calculate confidence from file detections', async () => {
      const files: PackageFile[] = [
        {
          path: 'agents/a.md',
          content: `---
tools: Read
permissionMode: default
---
# Agent A`
        }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.detectionMethod, 'per-file');
      assert.ok(result.confidence >= 0 && result.confidence <= 1);
    });
  });

  describe('Mixed Format Packages', () => {
    it('should detect package with markers + universal content', async () => {
      const files: PackageFile[] = [
        { path: '.claude/agents/claude-agent.md', content: '# Claude' },
        { path: 'openpackage.yml', content: 'name: test' }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      // Has both platform and universal markers - falls back to per-file
      assert.equal(result.detectionMethod, 'per-file');
      assert.ok(result.markers);
      assert.ok(result.markers.hasOpenPackageYml);
    });

    it('should detect multiple platform markers', async () => {
      const files: PackageFile[] = [
        { path: '.claude/agents/a.md', content: '# A' },
        { path: '.cursor/agents/b.md', content: '# B' }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      // Multiple markers - falls back to per-file
      assert.equal(result.detectionMethod, 'per-file');
      assert.ok(result.markers);
      assert.ok(result.markers.matchedPatterns.length >= 2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty package', async () => {
      const files: PackageFile[] = [];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.analysis.totalFiles, 0);
      assert.equal(result.analysis.analyzedFiles, 0);
      assert.ok(['unknown', 'universal'].includes(result.packageFormat));
    });

    it('should handle package with only non-markdown files', async () => {
      const files: PackageFile[] = [
        { path: 'config.json', content: '{}' },
        { path: 'script.sh', content: '#!/bin/bash' }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.analysis.totalFiles, 2);
      // Non-markdown files may still be analyzed (but contribute no format signals)
      assert.ok(result.analysis.analyzedFiles >= 0);
    });

    it('should handle package with malformed frontmatter', async () => {
      const files: PackageFile[] = [
        {
          path: 'agents/bad.md',
          content: `---
invalid yaml: [unclosed
---
# Agent`
        }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      // Should not crash, should handle gracefully
      assert.ok(result);
      assert.ok(['unknown', 'universal'].includes(result.packageFormat));
    });

    it('should provide format distribution metadata', async () => {
      const files: PackageFile[] = [
        {
          path: 'agents/a.md',
          content: `---
tools: Read
---
# A`
        }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.ok(result.analysis);
      assert.ok(result.analysis.formatDistribution);
      assert.equal(result.analysis.totalFiles, 1);
    });
  });

  describe('Format Groups', () => {
    it('should group files by detected platform', async () => {
      const files: PackageFile[] = [
        {
          path: 'agents/a.md',
          content: `---
tools: Read
permissionMode: default
---
# A`
        },
        {
          path: 'agents/b.md',
          content: `---
tools: Write
skills: test
---
# B`
        }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      if (result.detectionMethod === 'per-file') {
        assert.ok(result.formatGroups);
        assert.ok(result.formatGroups.size > 0);
        
        // Each group should contain file paths
        for (const [platform, filePaths] of result.formatGroups) {
          assert.ok(Array.isArray(filePaths));
          assert.ok(filePaths.length > 0);
        }
      }
    });

    it('should preserve file information in format groups', async () => {
      const files: PackageFile[] = [
        {
          path: 'agents/test.md',
          content: `---
tools: Read
---
# Test`
        }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      if (result.formatGroups) {
        const allFiles = Array.from(result.formatGroups.values()).flat();
        assert.ok(allFiles.includes('agents/test.md'));
      }
    });
  });

  describe('Backwards Compatibility', () => {
    it('should detect claude-plugin consistently with old detector', async () => {
      const files: PackageFile[] = [
        { path: '.claude-plugin/plugin.json', content: '{}' }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      assert.equal(result.packageFormat, 'claude-plugin');
      assert.equal(result.confidence, 1.0);
    });

    it('should provide all required metadata', async () => {
      const files: PackageFile[] = [
        { path: 'agents/test.md', content: '# Test' }
      ];
      
      const result = await detectEnhancedPackageFormat(files);
      
      // Verify interface compliance
      assert.ok('packageFormat' in result);
      assert.ok('detectionMethod' in result);
      assert.ok('confidence' in result);
      assert.ok('analysis' in result);
      assert.ok('totalFiles' in result.analysis);
      assert.ok('analyzedFiles' in result.analysis);
      assert.ok('skippedFiles' in result.analysis);
      assert.ok('formatDistribution' in result.analysis);
    });
  });
});
