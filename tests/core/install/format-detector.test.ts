import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  detectPackageFormat,
  isPlatformSpecific,
  needsConversion
} from '../../../src/core/install/format-detector.js';
import type { PackageFile } from '../../../src/types/index.js';

describe('Format Detector', () => {
  describe('detectPackageFormat', () => {
    it('should detect universal format from commands/ structure', () => {
      const files: PackageFile[] = [
        { path: 'commands/review.md', content: '', encoding: 'utf8' },
        { path: 'commands/test.md', content: '', encoding: 'utf8' },
        { path: 'agents/helper.md', content: '', encoding: 'utf8' },
        { path: 'rules/typescript.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'universal');
      assert.strictEqual(format.platform, undefined);
      assert.ok(format.confidence > 0.7);
    });

    it('should detect Claude platform-specific format', () => {
      const files: PackageFile[] = [
        { path: '.claude/commands/review.md', content: '', encoding: 'utf8' },
        { path: '.claude/commands/test.md', content: '', encoding: 'utf8' },
        { path: '.claude/agents/helper.md', content: '', encoding: 'utf8' },
        { path: '.claude/rules/typescript.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'platform-specific');
      assert.strictEqual(format.platform, 'claude');
      assert.ok(format.confidence > 0.7);
    });

    it('should detect Cursor platform-specific format', () => {
      const files: PackageFile[] = [
        { path: '.cursor/commands/review.md', content: '', encoding: 'utf8' },
        { path: '.cursor/rules/typescript.mdc', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'platform-specific');
      assert.strictEqual(format.platform, 'cursor');
    });

    it('should detect platform suffix in filenames', () => {
      const files: PackageFile[] = [
        { path: 'mcp.claude.jsonc', content: '', encoding: 'utf8' },
        { path: 'config.claude.yaml', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'platform-specific');
      assert.strictEqual(format.platform, 'claude');
    });

    it('should handle mixed files with universal majority', () => {
      const files: PackageFile[] = [
        { path: 'commands/review.md', content: '', encoding: 'utf8' },
        { path: 'commands/test.md', content: '', encoding: 'utf8' },
        { path: 'commands/format.md', content: '', encoding: 'utf8' },
        { path: '.claude/commands/special.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'universal');
    });

    it('should handle empty file list', () => {
      const files: PackageFile[] = [];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'universal');
      assert.strictEqual(format.confidence, 0);
    });
  });

  describe('isPlatformSpecific', () => {
    it('should return true for platform-specific format', () => {
      const format = {
        type: 'platform-specific' as const,
        platform: 'claude' as const,
        confidence: 0.9,
        analysis: {
          universalFiles: 0,
          platformSpecificFiles: 10,
          detectedPlatforms: new Map([['claude', 10]]),
          totalFiles: 10,
          samplePaths: { universal: [], platformSpecific: ['.claude/commands/test.md'] }
        }
      };

      assert.strictEqual(isPlatformSpecific(format), true);
    });

    it('should return false for universal format', () => {
      const format = {
        type: 'universal' as const,
        confidence: 0.9,
        analysis: {
          universalFiles: 10,
          platformSpecificFiles: 0,
          detectedPlatforms: new Map(),
          totalFiles: 10,
          samplePaths: { universal: ['commands/test.md'], platformSpecific: [] }
        }
      };

      assert.strictEqual(isPlatformSpecific(format), false);
    });
  });

  describe('needsConversion', () => {
    it('should return false for universal format', () => {
      const format = {
        type: 'universal' as const,
        confidence: 0.9,
        analysis: {
          universalFiles: 10,
          platformSpecificFiles: 0,
          detectedPlatforms: new Map(),
          totalFiles: 10,
          samplePaths: { universal: ['commands/test.md'], platformSpecific: [] }
        }
      };

      assert.strictEqual(needsConversion(format, 'claude'), false);
      assert.strictEqual(needsConversion(format, 'cursor'), false);
    });

    it('should return false when source = target platform', () => {
      const format = {
        type: 'platform-specific' as const,
        platform: 'claude' as const,
        confidence: 0.9,
        analysis: {
          universalFiles: 0,
          platformSpecificFiles: 10,
          detectedPlatforms: new Map([['claude', 10]]),
          totalFiles: 10,
          samplePaths: { universal: [], platformSpecific: ['.claude/commands/test.md'] }
        }
      };

      assert.strictEqual(needsConversion(format, 'claude'), false);
    });

    it('should return true when source != target platform', () => {
      const format = {
        type: 'platform-specific' as const,
        platform: 'claude' as const,
        confidence: 0.9,
        analysis: {
          universalFiles: 0,
          platformSpecificFiles: 10,
          detectedPlatforms: new Map([['claude', 10]]),
          totalFiles: 10,
          samplePaths: { universal: [], platformSpecific: ['.claude/commands/test.md'] }
        }
      };

      assert.strictEqual(needsConversion(format, 'cursor'), true);
      assert.strictEqual(needsConversion(format, 'opencode'), true);
    });
  });

  describe('Analysis details', () => {
    it('should provide detailed analysis', () => {
      const files: PackageFile[] = [
        { path: 'commands/review.md', content: '', encoding: 'utf8' },
        { path: 'commands/test.md', content: '', encoding: 'utf8' },
        { path: '.claude/agents/helper.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.ok(format.analysis);
      assert.strictEqual(format.analysis.totalFiles, 3);
      assert.strictEqual(format.analysis.universalFiles, 2);
      assert.strictEqual(format.analysis.platformSpecificFiles, 1);
      assert.ok(format.analysis.detectedPlatforms.has('claude'));
      assert.strictEqual(format.analysis.detectedPlatforms.get('claude'), 1);
    });

    it('should provide sample paths', () => {
      const files: PackageFile[] = [
        { path: 'commands/review.md', content: '', encoding: 'utf8' },
        { path: '.claude/agents/helper.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.ok(format.analysis.samplePaths.universal.length > 0);
      assert.ok(format.analysis.samplePaths.platformSpecific.length > 0);
    });
  });

  describe('Skills Format Detection', () => {
    it('should detect skills collection format', () => {
      const files: PackageFile[] = [
        { path: 'skills/git/SKILL.md', content: '', encoding: 'utf8' },
        { path: 'skills/git/workflow.md', content: '', encoding: 'utf8' },
        { path: 'skills/docker/SKILL.md', content: '', encoding: 'utf8' },
        { path: 'skills/docker/compose.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'universal');
      assert.ok(format.confidence >= 0.8);
      assert.ok(format.analysis.universalFiles > 0);
    });

    it('should detect single skill', () => {
      const files: PackageFile[] = [
        { path: 'skills/coding/SKILL.md', content: '', encoding: 'utf8' },
        { path: 'skills/coding/guidelines.md', content: '', encoding: 'utf8' },
        { path: 'skills/coding/examples.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'universal');
      assert.ok(format.confidence >= 0.8);
      assert.strictEqual(format.analysis.universalFiles, files.length);
    });

    it('should detect deeply nested skills', () => {
      const files: PackageFile[] = [
        { path: 'skills/git/commit/advanced/SKILL.md', content: '', encoding: 'utf8' },
        { path: 'skills/git/commit/advanced/guide.md', content: '', encoding: 'utf8' },
        { path: 'skills/docker/compose/SKILL.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'universal');
      assert.ok(format.confidence >= 0.8);
    });

    it('should handle skills with other universal content', () => {
      const files: PackageFile[] = [
        { path: 'commands/test.md', content: '', encoding: 'utf8' },
        { path: 'agents/helper.md', content: '', encoding: 'utf8' },
        { path: 'skills/git/SKILL.md', content: '', encoding: 'utf8' },
        { path: 'skills/git/workflow.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'universal');
      assert.ok(format.confidence > 0.7);
    });

    it('should handle skills directory without SKILL.md files', () => {
      const files: PackageFile[] = [
        { path: 'skills/git/workflow.md', content: '', encoding: 'utf8' },
        { path: 'skills/docker/compose.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      // Should still be classified as universal due to skills/ directory
      assert.strictEqual(format.type, 'universal');
    });

    it('should prioritize Claude plugin format over skills', () => {
      const files: PackageFile[] = [
        { path: '.claude-plugin/plugin.json', content: '', encoding: 'utf8' },
        { path: 'skills/git/SKILL.md', content: '', encoding: 'utf8' },
        { path: 'skills/git/workflow.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      // Claude plugin manifest takes precedence
      assert.strictEqual(format.type, 'platform-specific');
      assert.strictEqual(format.platform, 'claude-plugin');
      assert.strictEqual(format.confidence, 1.0);
    });

    it('should detect mixed skills and platform-specific content', () => {
      const files: PackageFile[] = [
        { path: 'skills/git/SKILL.md', content: '', encoding: 'utf8' },
        { path: 'skills/git/workflow.md', content: '', encoding: 'utf8' },
        { path: '.cursor/rules/typescript.mdc', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      // Skills should dominate with 2/3 files
      assert.strictEqual(format.type, 'universal');
    });

    it('should handle empty skills directory', () => {
      const files: PackageFile[] = [
        { path: 'commands/test.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'universal');
      assert.ok(format.confidence > 0.7);
    });
  });
});
