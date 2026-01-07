import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createPlatformConverter } from '../../../src/core/flows/platform-converter.js';
import { detectPackageFormat } from '../../../src/core/install/format-detector.js';
import type { Package, PackageFile } from '../../../src/types/index.js';

describe('Platform Converter', () => {
  let testDir: string;
  let workspaceRoot: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'opkg-converter-test-'));
    workspaceRoot = join(testDir, 'workspace');
    await mkdir(workspaceRoot, { recursive: true });
  });

  afterEach(async () => {
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('Format Detection', () => {
    it('should detect Claude plugin format', () => {
      const files: PackageFile[] = [
        { path: '.claude/commands/review.md', content: '# Review', encoding: 'utf8' },
        { path: '.claude/agents/helper.md', content: '# Helper', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'platform-specific');
      assert.strictEqual(format.platform, 'claude');
      assert.ok(format.confidence > 0.7);
    });

    it('should detect universal format', () => {
      const files: PackageFile[] = [
        { path: 'commands/review.md', content: '# Review', encoding: 'utf8' },
        { path: 'agents/helper.md', content: '# Helper', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(files);

      assert.strictEqual(format.type, 'universal');
    });
  });

  describe('Conversion Pipeline', () => {
    it('should build conversion pipeline for Claude → Cursor', () => {
      const converter = createPlatformConverter(workspaceRoot);
      
      const sourceFormat = {
        type: 'platform-specific' as const,
        platform: 'claude' as const,
        confidence: 0.9,
        analysis: {
          universalFiles: 0,
          platformSpecificFiles: 5,
          detectedPlatforms: new Map([['claude', 5]]),
          totalFiles: 5,
          samplePaths: { universal: [], platformSpecific: ['.claude/commands/test.md'] }
        }
      };

      const pipeline = converter.buildPipeline(sourceFormat, 'cursor');

      assert.strictEqual(pipeline.needsConversion, true);
      assert.ok(pipeline.stages.length > 0);
      assert.strictEqual(pipeline.stages[0].name, 'platform-to-universal');
      assert.strictEqual(pipeline.stages[0].inverted, true);
    });

    it('should not build pipeline for matching formats', () => {
      const converter = createPlatformConverter(workspaceRoot);
      
      const sourceFormat = {
        type: 'platform-specific' as const,
        platform: 'claude' as const,
        confidence: 0.9,
        analysis: {
          universalFiles: 0,
          platformSpecificFiles: 5,
          detectedPlatforms: new Map([['claude', 5]]),
          totalFiles: 5,
          samplePaths: { universal: [], platformSpecific: ['.claude/commands/test.md'] }
        }
      };

      const pipeline = converter.buildPipeline(sourceFormat, 'claude');

      assert.strictEqual(pipeline.needsConversion, false);
      assert.strictEqual(pipeline.stages.length, 0);
    });

    it('should not build pipeline for universal format', () => {
      const converter = createPlatformConverter(workspaceRoot);
      
      const sourceFormat = {
        type: 'universal' as const,
        confidence: 0.9,
        analysis: {
          universalFiles: 5,
          platformSpecificFiles: 0,
          detectedPlatforms: new Map(),
          totalFiles: 5,
          samplePaths: { universal: ['commands/test.md'], platformSpecific: [] }
        }
      };

      const pipeline = converter.buildPipeline(sourceFormat, 'claude');

      assert.strictEqual(pipeline.needsConversion, false);
      assert.strictEqual(pipeline.stages.length, 0);
    });
  });

  describe('Package Conversion', () => {
    it('should return package unchanged for matching format', async () => {
      const converter = createPlatformConverter(workspaceRoot);
      
      const pkg: Package = {
        metadata: {
          name: 'test-plugin',
          version: '1.0.0'
        },
        files: [
          { path: '.claude/commands/test.md', content: '# Test', encoding: 'utf8' }
        ],
        _format: {
          type: 'platform-specific',
          platform: 'claude',
          confidence: 0.9,
          analysis: {
            universalFiles: 0,
            platformSpecificFiles: 1,
            detectedPlatforms: new Map([['claude', 1]]),
            totalFiles: 1,
            samplePaths: { universal: [], platformSpecific: ['.claude/commands/test.md'] }
          }
        }
      };

      const result = await converter.convert(pkg, 'claude', { dryRun: true });

      assert.strictEqual(result.success, true);
      assert.ok(result.convertedPackage);
      assert.strictEqual(result.convertedPackage.files.length, 1);
      assert.strictEqual(result.stages.length, 0);
    });

    it('should handle universal format (no conversion needed)', async () => {
      const converter = createPlatformConverter(workspaceRoot);
      
      const pkg: Package = {
        metadata: {
          name: 'test-package',
          version: '1.0.0'
        },
        files: [
          { path: 'commands/test.md', content: '# Test', encoding: 'utf8' }
        ],
        _format: {
          type: 'universal',
          confidence: 0.9,
          analysis: {
            universalFiles: 1,
            platformSpecificFiles: 0,
            detectedPlatforms: new Map(),
            totalFiles: 1,
            samplePaths: { universal: ['commands/test.md'], platformSpecific: [] }
          }
        }
      };

      const result = await converter.convert(pkg, 'claude', { dryRun: true });

      assert.strictEqual(result.success, true);
      assert.ok(result.convertedPackage);
      assert.strictEqual(result.stages.length, 0);
    });
  });

  describe('Integration', () => {
    it('should detect and report format correctly', () => {
      const claudeFiles: PackageFile[] = [
        { path: '.claude/commands/review.md', content: '# Review', encoding: 'utf8' },
        { path: '.claude/commands/test.md', content: '# Test', encoding: 'utf8' },
        { path: '.claude/agents/helper.md', content: '# Helper', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(claudeFiles);

      assert.strictEqual(format.type, 'platform-specific');
      assert.strictEqual(format.platform, 'claude');
      assert.strictEqual(format.analysis.platformSpecificFiles, 3);
      assert.strictEqual(format.analysis.universalFiles, 0);
      assert.ok(format.confidence > 0.7);
    });

    it('should provide detailed analysis', () => {
      const mixedFiles: PackageFile[] = [
        { path: 'commands/universal.md', content: '', encoding: 'utf8' },
        { path: '.claude/commands/specific.md', content: '', encoding: 'utf8' }
      ];

      const format = detectPackageFormat(mixedFiles);

      assert.ok(format.analysis);
      assert.strictEqual(format.analysis.totalFiles, 2);
      assert.strictEqual(format.analysis.universalFiles, 1);
      assert.strictEqual(format.analysis.platformSpecificFiles, 1);
      assert.ok(format.analysis.samplePaths.universal.length > 0);
      assert.ok(format.analysis.samplePaths.platformSpecific.length > 0);
    });
  });
});
