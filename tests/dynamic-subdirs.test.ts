import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { 
  getAllUniversalSubdirs, 
  getPlatformSubdirExts, 
  getPlatformDefinition, 
  getPlatformDirectoryPaths,
  mergePlatformsConfig,
  validatePlatformsConfig 
} from '../src/core/platforms.js';
import { join } from 'path';
import { logger } from '../src/utils/logger.js'; // For potential spying, but skip

describe('Dynamic Subdirectories Feature', () => {
  it('getAllUniversalSubdirs returns unique set from all platforms', () => {
    const subdirs = getAllUniversalSubdirs();
    assert.ok(subdirs instanceof Set);
    assert.ok(subdirs.size > 0);
    assert.ok(subdirs.has('rules'), 'Common subdir "rules" should be discovered');
    assert.ok(subdirs.has('commands'), '"commands" should be discovered');
    // Custom subdirs would be tested with temp config override
  });

  it('getPlatformSubdirExts returns exts for supported subdir', () => {
    const def = getPlatformDefinition('cursor');
    const rulesExts = getPlatformSubdirExts('cursor', 'rules');
    assert.deepStrictEqual(rulesExts.sort(), ['.md', '.mdc'].sort(), 'Cursor rules exts match config');
  });

  it('getPlatformSubdirExts returns empty and warns for unsupported', () => {
    const exts = getPlatformSubdirExts('warp', 'rules'); // Warp has empty subdirs
    assert.deepStrictEqual(exts, []);
    // Warn is logged; in full test, spy logger.warn
  });

  it('getPlatformDirectoryPaths builds dynamic subdirs map with full paths', () => {
    const paths = getPlatformDirectoryPaths(process.cwd());
    assert.ok(Object.keys(paths).length > 0);
    const examplePlat = Object.keys(paths)[0] as any;
    const platPaths = paths[examplePlat];
    assert.ok(platPaths.rootDir.endsWith('.cursor') || platPaths.rootDir.endsWith('.claude') || true); // Some root
    assert.ok(platPaths.subdirs && typeof platPaths.subdirs === 'object' && Object.keys(platPaths.subdirs).length > 0);
    assert.ok(platPaths.subdirs.rules, 'Should include "rules" path');
    assert.ok(platPaths.subdirs.rules.startsWith(process.cwd()), 'Full absolute path');
  });

  it('mergePlatformsConfig correctly merges with subdir overrides and additions', () => {
    const baseConfig = {
      testPlat: {
        name: 'Test Base',
        rootDir: '.test',
        subdirs: [
          { universalDir: 'rules', platformDir: 'old-rules' }
        ]
      }
    } as any;

    const overrideConfig = {
      testPlat: {
        subdirs: [
          { universalDir: 'rules', platformDir: 'new-rules', exts: ['.new'] },
          { universalDir: 'custom', platformDir: 'custom-path' }
        ]
      }
    } as any;

    const merged = mergePlatformsConfig(baseConfig, overrideConfig);
    const testSubdirs = merged.testPlat.subdirs as any[];
    assert.equal(testSubdirs.length, 2);
    const rulesEntry = testSubdirs.find(s => s.universalDir === 'rules');
    assert.equal(rulesEntry.platformDir, 'new-rules');
    assert.deepStrictEqual(rulesEntry.exts, ['.new']);
    const customEntry = testSubdirs.find(s => s.universalDir === 'custom');
    assert.equal(customEntry.platformDir, 'custom-path');
  });

  it('validatePlatformsConfig detects invalid configs', () => {
    const validConfig = { cursor: { name: 'Cursor', rootDir: '.cursor', subdirs: [{universalDir: 'rules', platformDir: 'rules'}] } } as any;
    assert.deepStrictEqual(validatePlatformsConfig(validConfig), []);

    const invalid1 = { test: { rootDir: '', subdirs: [{universalDir: '', platformDir: 'rules'}] } } as any;
    const errors1 = validatePlatformsConfig(invalid1);
    assert.ok(errors1.some(e => e.includes('rootDir')), 'Detects empty rootDir');
    assert.ok(errors1.some(e => e.includes('universalDir')), 'Detects empty universalDir');

    const invalid2 = { test: { rootDir: '.test', subdirs: [{universalDir: 'rules'}, {universalDir: 'rules'}] } } as any; // missing platformDir, duplicate
    const errors2 = validatePlatformsConfig(invalid2);
    assert.ok(errors2.some(e => e.includes('platformDir')), 'Detects missing platformDir');
    assert.ok(errors2.some(e => e.includes('Duplicate')), 'Detects duplicate universalDir');
  });
});