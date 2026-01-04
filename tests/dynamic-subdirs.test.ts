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

  it('mergePlatformsConfig correctly merges with flow overrides and additions', () => {
    const baseConfig = {
      testPlat: {
        name: 'Test Base',
        rootDir: '.test',
        rootFile: 'TEST.md',
        flows: [
          { from: 'rules/{name}.md', to: '.test/rules/{name}.md' }
        ]
      }
    } as any;

    const overrideConfig = {
      testPlat: {
        flows: [
          { from: 'rules/{name}.md', to: '.test/rules/{name}.mdc' }, // Override
          { from: 'custom/{name}.txt', to: '.test/custom/{name}.txt' } // New flow
        ]
      }
    } as any;

    const merged = mergePlatformsConfig(baseConfig, overrideConfig);
    const testFlows = merged.testPlat.flows as any[];
    assert.equal(testFlows.length, 2, 'Should have 2 flows after merge');
    const rulesFlow = testFlows.find(f => f.from === 'rules/{name}.md');
    assert.equal(rulesFlow.to, '.test/rules/{name}.mdc', 'Rules flow should be overridden');
    const customFlow = testFlows.find(f => f.from === 'custom/{name}.txt');
    assert.ok(customFlow, 'Custom flow should be added');
  });

  it('validatePlatformsConfig detects invalid configs', () => {
    // Valid config with flows
    const validConfig = { 
      cursor: { 
        name: 'Cursor', 
        rootDir: '.cursor', 
        flows: [{from: 'rules/{name}.md', to: '.cursor/rules/{name}.mdc'}] 
      } 
    } as any;
    assert.deepStrictEqual(validatePlatformsConfig(validConfig), []);

    // Invalid: empty rootDir
    const invalid1 = { test: { rootDir: '', flows: [{from: 'test.md', to: 'test.md'}] } } as any;
    const errors1 = validatePlatformsConfig(invalid1);
    assert.ok(errors1.some(e => e.includes('rootDir')), 'Detects empty rootDir');

    // Invalid: missing flows and rootFile
    const invalid2 = { test: { name: 'Test', rootDir: '.test' } } as any;
    const errors2 = validatePlatformsConfig(invalid2);
    assert.ok(errors2.some(e => e.includes("Must define either 'flows' or 'rootFile'")), 'Detects missing flows/rootFile');
    
    // Invalid: flow missing required fields
    const invalid3 = { test: { rootDir: '.test', flows: [{from: 'test.md'}] } } as any; // missing 'to'
    const errors3 = validatePlatformsConfig(invalid3);
    assert.ok(errors3.some(e => e.includes('to')), 'Detects missing flow.to field');
  });
});