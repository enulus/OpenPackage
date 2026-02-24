import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generatePluginName,
  generateMarketplaceName,
  parseScopedPluginName,
  isScopedPluginName,
  detectOldGitHubNaming,
  deriveNamespaceSlug
} from '../../../packages/core/src/utils/plugin-naming.js';

describe('Plugin Naming', () => {
  describe('generatePluginName', () => {
    it('should generate scoped name for GitHub plugin with path', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/claude-code.git',
        path: 'plugins/commit-commands',
        packageName: 'commit-commands'
      });
      
      // Now uses full path for unambiguous naming
      assert.strictEqual(name, 'gh@anthropics/claude-code/plugins/commit-commands');
    });
    
    it('should generate scoped name for GitHub plugin without path', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/my-plugin.git',
        packageName: 'my-plugin'
      });
      
      assert.strictEqual(name, 'gh@anthropics/my-plugin');
    });
    
    it('should generate scoped name using repo name for standalone plugin', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/awesome-plugin.git'
      });
      
      assert.strictEqual(name, 'gh@anthropics/awesome-plugin');
    });
    
    it('should use repo name as fallback when plugin manifest name is undefined', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/user/awesome-plugin.git',
        packageName: undefined
      });
      
      assert.strictEqual(name, 'gh@user/awesome-plugin');
    });
    
    it('should use full path when plugin manifest name is undefined', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/user/repo-name.git',
        path: 'plugins/cool-plugin',
        packageName: undefined
      });
      
      // Full path is used for clarity
      assert.strictEqual(name, 'gh@user/repo-name/plugins/cool-plugin');
    });
    
    it('should always use full path for marketplace plugins', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/user/actual-repo.git',
        path: 'plugins/plugin-a',
        packageName: 'plugin-a'
      });
      
      assert.strictEqual(name, 'gh@user/actual-repo/plugins/plugin-a');
    });
    
    it('should use full path even when marketplace has different name', () => {
      const name = generatePluginName({
        gitUrl: 'https://github.com/anthropics/claude-code-plugins.git',
        path: 'packages/my-plugin',
        packageName: 'my-plugin'
      });
      
      assert.strictEqual(name, 'gh@anthropics/claude-code-plugins/packages/my-plugin');
    });
    
    it('should return plain name for non-GitHub URLs', () => {
      const name = generatePluginName({
        gitUrl: 'https://gitlab.com/user/plugin.git',
        packageName: 'my-plugin'
      });
      
      assert.strictEqual(name, 'my-plugin');
    });
    
    it('should return plain name for local paths (no git URL)', () => {
      const name = generatePluginName({
        packageName: 'local-plugin'
      });
      
      assert.strictEqual(name, 'local-plugin');
    });
    
    it('should use path basename for local paths when manifest name is undefined', () => {
      const name = generatePluginName({
        path: 'path/to/my-plugin',
        packageName: undefined
      });
      
      assert.strictEqual(name, 'my-plugin');
    });
  });
  
  describe('generateMarketplaceName', () => {
    it('should generate scoped name using repo name for GitHub marketplace', () => {
      const name = generateMarketplaceName(
        'https://github.com/anthropics/claude-code.git',
        'claude-code'
      );
      
      assert.strictEqual(name, 'gh@anthropics/claude-code');
    });
    
    it('should always use repo name for GitHub marketplaces', () => {
      const name = generateMarketplaceName(
        'https://github.com/user/actual-repo-name.git',
        'different-marketplace-name'
      );
      
      assert.strictEqual(name, 'gh@user/actual-repo-name');
    });
    
    it('should use repo name as fallback when marketplace name is undefined', () => {
      const name = generateMarketplaceName(
        'https://github.com/user/my-marketplace.git',
        undefined
      );
      
      assert.strictEqual(name, 'gh@user/my-marketplace');
    });
    
    it('should return plain name for non-GitHub URLs', () => {
      const name = generateMarketplaceName(
        'https://gitlab.com/user/marketplace.git',
        'my-marketplace'
      );
      
      assert.strictEqual(name, 'my-marketplace');
    });
    
    it('should return plain name for local paths', () => {
      const name = generateMarketplaceName(
        undefined,
        'local-marketplace'
      );
      
      assert.strictEqual(name, 'local-marketplace');
    });
  });
  
  describe('parseScopedPluginName', () => {
    it('should parse plugin name with path (new format)', () => {
      const parsed = parseScopedPluginName('gh@anthropics/claude-code/commit-commands');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.repo, 'claude-code');
      assert.strictEqual(parsed.plugin, 'commit-commands');
      assert.strictEqual(parsed.isGitHub, true);
    });
    
    it('should parse standalone repo name (new format)', () => {
      const parsed = parseScopedPluginName('gh@anthropics/my-plugin');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.repo, 'my-plugin');
      assert.strictEqual(parsed.plugin, undefined);
      assert.strictEqual(parsed.isGitHub, true);
    });
    
    it('should parse old format plugin name (3 segments)', () => {
      const parsed = parseScopedPluginName('@anthropics/claude-code/commit-commands');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.repo, 'claude-code');
      assert.strictEqual(parsed.plugin, 'commit-commands');
      assert.strictEqual(parsed.isGitHub, false);
    });
    
    it('should parse old format standalone (2 segments)', () => {
      const parsed = parseScopedPluginName('@anthropics/my-plugin');
      
      assert.ok(parsed);
      assert.strictEqual(parsed.username, 'anthropics');
      assert.strictEqual(parsed.repo, 'my-plugin');
      assert.strictEqual(parsed.plugin, undefined);
      assert.strictEqual(parsed.isGitHub, false);
    });
    
    it('should return null for non-scoped names', () => {
      const parsed = parseScopedPluginName('plain-name');
      
      assert.strictEqual(parsed, null);
    });
    
    it('should return null for invalid scoped names', () => {
      const parsed = parseScopedPluginName('@username');
      
      assert.strictEqual(parsed, null);
    });
  });
  
  describe('isScopedPluginName', () => {
    it('should return true for new GitHub format', () => {
      assert.strictEqual(isScopedPluginName('gh@user/repo'), true);
      assert.strictEqual(isScopedPluginName('gh@user/repo/plugin'), true);
    });
    
    it('should return true for old scoped format', () => {
      assert.strictEqual(isScopedPluginName('@user/plugin'), true);
      assert.strictEqual(isScopedPluginName('@user/marketplace/plugin'), true);
    });
    
    it('should return false for non-scoped names', () => {
      assert.strictEqual(isScopedPluginName('plain-name'), false);
      assert.strictEqual(isScopedPluginName('@username'), false);
    });
  });
  
  describe('detectOldGitHubNaming', () => {
    it('should detect old GitHub format and return new format', () => {
      const newName = detectOldGitHubNaming({
        name: '@anthropics/claude-code',
        git: 'https://github.com/anthropics/claude-code.git'
      });
      
      assert.strictEqual(newName, 'gh@anthropics/claude-code');
    });
    
    it('should detect old plugin format and convert to new format', () => {
      const newName = detectOldGitHubNaming({
        name: '@anthropics/claude-code/commit-commands',
        git: 'https://github.com/anthropics/claude-code.git',
        path: 'plugins/commit-commands'
      });
      
      assert.strictEqual(newName, 'gh@anthropics/claude-code/plugins/commit-commands');
    });
    
    it('should return null for new format', () => {
      const newName = detectOldGitHubNaming({
        name: 'gh@anthropics/claude-code',
        git: 'https://github.com/anthropics/claude-code.git'
      });
      
      assert.strictEqual(newName, null);
    });
    
    it('should return null for non-GitHub sources', () => {
      const newName = detectOldGitHubNaming({
        name: '@user/plugin',
        git: 'https://gitlab.com/user/plugin.git'
      });
      
      assert.strictEqual(newName, null);
    });
    
    it('should return null for packages without git source', () => {
      const newName = detectOldGitHubNaming({
        name: '@user/plugin'
      });
      
      assert.strictEqual(newName, null);
    });
  });

  describe('deriveNamespaceSlug', () => {
    // ── Smart leaf detection ──────────────────────────────────────────────

    it('should extract leaf before resource marker (plugins/foo/commands/...)', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/repo/plugins/foo/commands/bar/baz/hello.md'),
        'foo'
      );
    });

    it('should extract leaf before agents marker (plugins/feature-dev/agents/...)', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@anthropics/claude-plugins-official/plugins/feature-dev/agents/code-reviewer.md'),
        'feature-dev'
      );
    });

    it('should extract leaf before rules marker (packages/my-pkg/rules/...)', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/repo/packages/my-pkg/rules/foo.md'),
        'my-pkg'
      );
    });

    it('should extract leaf before skills marker', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/repo/tools/helper/skills/react/SKILL.md'),
        'helper'
      );
    });

    it('should extract leaf before hooks marker', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/repo/ext/my-ext/hooks/pre-commit.sh'),
        'my-ext'
      );
    });

    // ── Resource marker at index 0 → fall back to repo ────────────────────

    it('should fall back to repo when resource marker is first segment (agents/designer.md)', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/my-repo/agents/designer.md'),
        'my-repo'
      );
    });

    it('should fall back to repo when resource marker is first segment (rules/foo.md)', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/my-repo/rules/foo.md'),
        'my-repo'
      );
    });

    // ── Structural prefix detection (plugins/, packages/) ────────────────

    it('should extract leaf after plugins/ prefix when no resource marker', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@anthropics/claude-plugins-official/plugins/code-review'),
        'code-review'
      );
    });

    it('should extract leaf after packages/ prefix when no resource marker', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/mono-repo/packages/my-tool'),
        'my-tool'
      );
    });

    it('should strip extension from structural prefix leaf', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/repo/plugins/my-plugin.md'),
        'my-plugin'
      );
    });

    it('should escalate structural prefix leaf on collision', () => {
      const existing = new Set(['code-review']);
      assert.strictEqual(
        deriveNamespaceSlug('gh@anthropics/claude-plugins-official/plugins/code-review', existing),
        'claude-plugins-official/code-review'
      );
    });

    it('should prefer resource marker over structural prefix when both present', () => {
      // plugins/my-plugin/commands/foo.md → markerIndex=2 > 0, leaf = "my-plugin"
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/repo/plugins/my-plugin/commands/foo.md'),
        'my-plugin'
      );
    });

    // ── No resource marker, no structural prefix → fall back to repo ────

    it('should fall back to repo when no resource marker found (tools/linter)', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/my-repo/tools/linter'),
        'my-repo'
      );
    });

    it('should fall back to repo for single non-marker segment', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/my-repo/some-path'),
        'my-repo'
      );
    });

    // ── Repo-level packages (no sub-path) ─────────────────────────────────

    it('should use repo name for repo-level package', () => {
      assert.strictEqual(
        deriveNamespaceSlug('gh@anthropics/essentials'),
        'essentials'
      );
    });

    it('should use repo name for old format repo-level package', () => {
      assert.strictEqual(
        deriveNamespaceSlug('@anthropics/essentials'),
        'essentials'
      );
    });

    // ── Plain registry names ──────────────────────────────────────────────

    it('should return plain registry name as-is', () => {
      assert.strictEqual(
        deriveNamespaceSlug('my-plain-package'),
        'my-plain-package'
      );
    });

    // ── Old scoped format (@scope/name) ───────────────────────────────────

    it('should use repo for @scope/name without sub-path', () => {
      assert.strictEqual(
        deriveNamespaceSlug('@scope/package-name'),
        'package-name'
      );
    });

    it('should detect leaf in old format with sub-path', () => {
      assert.strictEqual(
        deriveNamespaceSlug('@owner/repo/plugins/feature-dev/agents/x.md'),
        'feature-dev'
      );
    });

    // ── File extension stripping ──────────────────────────────────────────

    it('should strip file extension from leaf segment', () => {
      // Path: src/my-tool.md/agents/... — leaf is "my-tool.md", ext stripped
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/repo/src/my-tool.md/agents/designer.md'),
        'my-tool'
      );
    });

    // ── Escalation for uniqueness ─────────────────────────────────────────

    it('should escalate to repo/leaf on collision with existing slug', () => {
      const existing = new Set(['feature-dev']);
      assert.strictEqual(
        deriveNamespaceSlug('gh@anthropics/claude-plugins/plugins/feature-dev/agents/x.md', existing),
        'claude-plugins/feature-dev'
      );
    });

    it('should escalate to owner/repo/leaf on double collision', () => {
      const existing = new Set(['feature-dev', 'claude-plugins/feature-dev']);
      assert.strictEqual(
        deriveNamespaceSlug('gh@anthropics/claude-plugins/plugins/feature-dev/agents/x.md', existing),
        'anthropics/claude-plugins/feature-dev'
      );
    });

    it('should escalate repo-level to owner/repo on collision', () => {
      const existing = new Set(['essentials']);
      assert.strictEqual(
        deriveNamespaceSlug('gh@anthropics/essentials', existing),
        'anthropics/essentials'
      );
    });

    it('should not escalate when no collision exists', () => {
      const existing = new Set(['other-package']);
      assert.strictEqual(
        deriveNamespaceSlug('gh@anthropics/essentials', existing),
        'essentials'
      );
    });

    it('should not escalate plain registry names even with collisions', () => {
      const existing = new Set(['my-package']);
      // Plain names have no escalation path — returned as-is
      assert.strictEqual(
        deriveNamespaceSlug('my-package', existing),
        'my-package'
      );
    });

    it('should handle empty existingSlugs set without escalating', () => {
      const existing = new Set<string>();
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/repo/plugins/foo/agents/bar.md', existing),
        'foo'
      );
    });

    // ── Escalation when leaf equals repo ──────────────────────────────────

    it('should escalate from repo to owner/repo when leaf=repo and collision', () => {
      const existing = new Set(['my-repo']);
      assert.strictEqual(
        deriveNamespaceSlug('gh@owner/my-repo/agents/designer.md', existing),
        'owner/my-repo'
      );
    });
  });
});
