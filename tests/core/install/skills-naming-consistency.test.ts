/**
 * Skills Naming Consistency Test
 * 
 * Validates that manifest and index use identical package names for skills.
 * This test specifically addresses the bug where skills from marketplace plugins
 * had different names in openpackage.yml vs openpackage.index.yml.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillContextBuilder } from '../../../src/core/install/naming-context-builder.js';
import { PackageNameService } from '../../../src/core/install/package-name-service.js';

describe('Skills Naming Consistency', () => {
  let tempDir: string;
  
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'opkg-test-'));
  });
  
  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
  
  describe('PackageNameService', () => {
    it('should generate consistent names for skills with full path', () => {
      // Build context for a skill
      const context = new SkillContextBuilder()
        .withGit(
          'https://github.com/wshobson/agents.git',
          'main',
          'plugins/ui-design/skills/mobile-ios-design'  // Full path
        )
        .withPhysical(join(tempDir, 'plugins/ui-design'))
        .withSkillInfo(
          'mobile-ios-design',
          'plugins/ui-design',
          'skills/mobile-ios-design'
        )
        .build();
      
      const name = PackageNameService.resolvePackageName(context);
      
      // Should include the full path
      assert.equal(
        name,
        'gh@wshobson/agents/plugins/ui-design/skills/mobile-ios-design',
        'Skill name should include complete path'
      );
    });
    
    it('should generate same name regardless of how context is built', () => {
      // Method 1: Direct full path
      const context1 = new SkillContextBuilder()
        .withGit(
          'https://github.com/wshobson/agents.git',
          'main',
          'plugins/ui-design/skills/mobile-ios-design'
        )
        .withPhysical(join(tempDir, 'cache'))
        .withSkillInfo(
          'mobile-ios-design',
          'plugins/ui-design',
          'skills/mobile-ios-design'
        )
        .build();
      
      // Method 2: withSkillInfo auto-computes path
      const context2 = new SkillContextBuilder()
        .withGitUrl('https://github.com/wshobson/agents.git')
        .withGitRef('main')
        .withPhysical(join(tempDir, 'cache'))
        .withSkillInfo(
          'mobile-ios-design',
          'plugins/ui-design',
          'skills/mobile-ios-design'
        )
        .build();
      
      const name1 = PackageNameService.resolvePackageName(context1);
      const name2 = PackageNameService.resolvePackageName(context2);
      
      assert.equal(name1, name2, 'Both methods should produce identical names');
    });
    
    it('should reject contexts with incomplete skill paths', () => {
      // This context has plugin path but not the skill subdirectory
      assert.throws(
        () => {
          new SkillContextBuilder()
            .withGit(
              'https://github.com/wshobson/agents.git',
              'main',
              'plugins/ui-design'  // ❌ Missing /skills/mobile-ios-design
            )
            .withPhysical(join(tempDir, 'cache'))
            .withSkillInfo(
              'mobile-ios-design',
              'plugins/ui-design',
              'skills/mobile-ios-design'
            )
            .build();
        },
        /must end with skill relative path/,
        'Should reject skill context with incomplete Git path'
      );
    });
    
    it('should reject contexts with duplicate skill paths', () => {
      assert.throws(
        () => {
          new SkillContextBuilder()
            .withGit(
              'https://github.com/wshobson/agents.git',
              'main',
              'plugins/ui-design/skills/mobile/skills/mobile'  // ❌ Duplicate
            )
            .withPhysical(join(tempDir, 'cache'))
            .withSkillInfo(
              'mobile',
              'plugins/ui-design',
              'skills/mobile'
            )
            .build();
        },
        /Duplicate skill path segment/,
        'Should reject context with duplicate /skills/ segments'
      );
    });
  });
  
  describe('Manifest and Index Consistency', () => {
    it('should use same name in both manifest and index', () => {
      // Validate the service produces correct names for manifest and index
      
      const context = new SkillContextBuilder()
        .withGit(
          'https://github.com/wshobson/agents.git',
          'main',
          'plugins/ui-design/skills/mobile-ios-design'
        )
        .withPhysical(join(tempDir, 'cache'))
        .withSkillInfo(
          'mobile-ios-design',
          'plugins/ui-design',
          'skills/mobile-ios-design'
        )
        .withMarketplace('agents-marketplace', 'abc123', 'ui-design')
        .build();
      
      // Generate both manifest and index entries
      const manifestEntry = PackageNameService.buildManifestEntry(context, '0.0.0');
      const indexEntry = PackageNameService.buildIndexEntry(
        context,
        '0.0.0',
        join(tempDir, 'cache/plugins/ui-design')
      );
      
      // Validate they have the same package name
      assert.equal(
        manifestEntry.name,
        indexEntry.packageName,
        'Manifest and index should have identical package names'
      );
      
      // Validate the name includes the full path
      assert.equal(
        manifestEntry.name,
        'gh@wshobson/agents/plugins/ui-design/skills/mobile-ios-design'
      );
    });
    
    it('should preserve correctly-set skill names during index migration', async () => {
      // This tests the specific bug: migration was overwriting correct skill names
      const { readWorkspaceIndex, writeWorkspaceIndex } = await import(
        '../../../src/utils/workspace-index-yml.js'
      );
      
      // Create a workspace index with a correctly-named skill
      const indexRecord = {
        path: join(tempDir, '.openpackage', 'openpackage.index.yml'),
        index: {
          packages: {
            'gh@wshobson/agents/plugins/ui-design/skills/mobile-ios-design': {
              path: '~/.openpackage/cache/git/abc123/def456/plugins/ui-design',
              version: '0.0.0',
              files: {}
            }
          }
        }
      };
      
      // Write the index (this triggers migration)
      await writeWorkspaceIndex(indexRecord);
      
      // Read it back
      const readBack = await readWorkspaceIndex(tempDir);
      
      // Verify the name was NOT "migrated" to the truncated form
      const packageNames = Object.keys(readBack.index.packages);
      assert.ok(
        packageNames.includes('gh@wshobson/agents/plugins/ui-design/skills/mobile-ios-design'),
        'Should preserve full skill path in package name'
      );
      assert.ok(
        !packageNames.includes('gh@wshobson/agents/plugins/ui-design'),
        'Should NOT truncate to plugin path'
      );
    });
    
    it('should include marketplace metadata in index entry', () => {
      const context = new SkillContextBuilder()
        .withGit(
          'https://github.com/wshobson/agents.git',
          'main',
          'plugins/ui-design/skills/mobile-ios-design'
        )
        .withPhysical(join(tempDir, 'cache'))
        .withSkillInfo(
          'mobile-ios-design',
          'plugins/ui-design',
          'skills/mobile-ios-design'
        )
        .withMarketplace('agents-marketplace', 'abc123def', 'ui-design')
        .build();
      
      const indexEntry = PackageNameService.buildIndexEntry(
        context,
        '0.0.0',
        join(tempDir, 'cache')
      );
      
      assert.ok(indexEntry.marketplace, 'Index entry should have marketplace metadata');
      assert.equal(indexEntry.marketplace?.commitSha, 'abc123def');
      assert.equal(indexEntry.marketplace?.pluginName, 'ui-design');
    });
  });
  
  describe('Context Validation', () => {
    it('should validate skill context completeness', () => {
      // Valid context should not throw
      assert.doesNotThrow(() => {
        new SkillContextBuilder()
          .withGit(
            'https://github.com/user/repo.git',
            'main',
            'plugins/test/skills/example'
          )
          .withPhysical('/path/to/plugin')
          .withSkillInfo('example', 'plugins/test', 'skills/example')
          .build();
      });
    });
    
    it('should require Git URL for skill contexts', () => {
      assert.throws(
        () => {
          new SkillContextBuilder()
            .withGitPath('plugins/test/skills/example')
            .withPhysical('/path/to/plugin')
            .withSkillInfo('example', 'plugins/test', 'skills/example')
            .build();
        },
        /missing Git URL/,
        'Should require Git URL for skill contexts'
      );
    });
    
    it('should require Git path for skill contexts', () => {
      assert.throws(
        () => {
          new SkillContextBuilder()
            .withGitUrl('https://github.com/user/repo.git')
            .withPhysical('/path/to/plugin')
            .withSkillInfo('example', 'plugins/test', 'skills/example')
            // Note: gitPath is auto-computed from withSkillInfo, but let's test explicit case
            .withCompleteGitPath(undefined as any)
            .build();
        },
        /missing Git path/,
        'Should require Git path for skill contexts'
      );
    });
  });
});
