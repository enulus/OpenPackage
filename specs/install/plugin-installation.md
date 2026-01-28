# Claude Code Plugin Installation

> Specification for installing Claude Code plugins from various sources including marketplaces, individual plugins, and git repositories.

## Overview

OpenPackage CLI supports installing Claude Code plugins through the unified installation pipeline. Plugins are a special package format that includes commands, agents, hooks, MCP servers, and LSP servers for Claude Code.

This document specifies how plugins are detected, transformed, and installed.

## Plugin Detection

### Detection Process

When a package source is loaded, the system detects whether it contains a Claude Code plugin by checking for:

1. **Plugin manifest**: `.claude-plugin/plugin.json` in the root directory
2. **Marketplace manifest**: `.claude-plugin/marketplace.json` in the root directory

```typescript
interface PluginDetection {
  isPlugin: boolean;
  type?: 'individual' | 'marketplace';
  manifestPath?: string;
}
```

### Detection Priority

1. If marketplace manifest exists → `type: 'marketplace'`
2. If plugin manifest exists → `type: 'individual'`
3. Otherwise → `isPlugin: false`

Both manifests can coexist, but marketplace takes priority during detection.

## Plugin Installation Flow

### Individual Plugin Installation

```
User input → Classify source → Load package → Detect plugin
  → Transform to OpenPackage format → Install via unified pipeline
```

#### Source Classification

Plugins can be installed from multiple source types:

1. **Git repository**:
   ```bash
   opkg install github:owner/plugin-repo
   opkg install git:https://gitlab.com/team/plugin.git
   ```

2. **Local path**:
   ```bash
   opkg install ./path/to/plugin
   opkg install /absolute/path/to/plugin
   ```

3. **Git repository subdirectory**:
   ```bash
   opkg install github:owner/repo#main&subdirectory=plugins/my-plugin
   ```

#### Plugin Transformation

The plugin transformer converts Claude Code plugin format to OpenPackage format:

**Input** (`.claude-plugin/plugin.json`):
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "My plugin"
}
```

**Output** (`openpackage.yml`):
```yaml
name: my-plugin
version: 1.0.0
description: My plugin
```

The transformer:
- Copies plugin manifest fields to `openpackage.yml`
- Creates universal content patterns for plugin files
- Maps `.claude-plugin/` directory structure to `.openpackage/`
- Preserves all plugin content (commands, agents, hooks, etc.)

### Marketplace Plugin Installation

Marketplaces are special plugins that contain multiple plugin entries. Each entry specifies where to find a plugin.

```
Load marketplace → Parse manifest → User selects plugins
  → For each selected plugin:
    - Normalize source → Install from source → Track in workspace
```

#### Marketplace Loading

1. Clone/load marketplace repository
2. Parse `.claude-plugin/marketplace.json`
3. Validate manifest structure
4. Validate each plugin entry's source

#### Plugin Selection

Users are presented with an interactive selection prompt:

```
📦 Marketplace: company-tools
   Internal development tools

3 plugins available:

  ◯ code-formatter - Automatic code formatting
  ◯ deployment-tools - Deploy to staging/production
  ◯ commit-hooks - Git commit message validation

Select plugins to install (space to select, enter to confirm):
```

#### Non-Interactive Plugin Selection

For automated environments (CI/CD, scripts), use the `--plugins` flag to bypass interactive selection:

```bash
# Install specific plugins by name
opkg install github:company/marketplace --plugins code-formatter,deployment-tools

# Short flag
opkg install github:company/marketplace -p code-formatter

# With whitespace (shell quoting)
opkg install github:company/marketplace --plugins "code-formatter, deployment-tools"
```

**Behavior**:

1. **Validation**: Plugin names are validated against the marketplace manifest
2. **Error on invalid**: If any plugin name doesn't exist, installation fails with helpful error:
   ```
   Error: The following plugins were not found in marketplace 'company-tools':
     - invalid-plugin
     - typo-plugin

   Available plugins: code-formatter, deployment-tools, commit-hooks
   ```
3. **Deduplication**: Duplicate plugin names are automatically removed
4. **Non-marketplace warning**: If `--plugins` is used with a non-marketplace source, a warning is shown and the flag is ignored

**Implementation**:

```typescript
// Parse comma-separated plugin names
function parsePluginsOption(value: string | undefined): string[] | undefined;

// Validate plugin names against marketplace
function validatePluginNames(
  marketplace: MarketplaceManifest,
  requestedPlugins: string[]
): { valid: string[]; invalid: string[] };
```

#### Per-Plugin Installation

Each selected plugin is installed independently based on its source type:

1. **Relative path sources**: Install from marketplace repository subdirectory
2. **GitHub sources**: Clone external repository and install
3. **Git URL sources**: Clone from URL and install

## Plugin Source Types

### Source Specification

Plugin sources in marketplace manifests support three formats:

#### 1. Relative Path (String)

Points to a subdirectory within the marketplace repository:

```json
{
  "name": "local-plugin",
  "source": "./plugins/my-plugin"
}
```

**Constraints**:
- Must be relative (no leading `/`)
- Cannot traverse upward (`..` not allowed)
- Must exist in marketplace repository
- Must contain valid plugin manifest

#### 2. GitHub Source (Object)

References a plugin in a GitHub repository:

```json
{
  "name": "github-plugin",
  "source": {
    "source": "github",
    "repo": "owner/repository",
    "ref": "v1.0.0",
    "path": "plugins/subfolder"
  }
}
```

**Fields**:
- `source`: Must be `"github"`
- `repo`: **Required**. Format: `"owner/repo"`
- `ref`: Optional. Branch, tag, or SHA
- `path`: Optional. Subdirectory within repository

**Conversion**: Transformed to `https://github.com/owner/repository.git`

#### 3. Git URL Source (Object)

References a plugin in any git repository:

```json
{
  "name": "git-plugin",
  "source": {
    "source": "url",
    "url": "https://gitlab.com/team/plugin.git",
    "ref": "develop",
    "path": "src/plugin"
  }
}
```

**Fields**:
- `source`: Must be `"url"`
- `url`: **Required**. Full git URL (HTTPS, SSH, or git://)
- `ref`: Optional. Branch, tag, or SHA
- `path`: Optional. Subdirectory within repository

**Supported URL formats**:
- HTTPS: `https://gitlab.com/team/plugin.git`
- SSH: `git@gitlab.com:team/plugin.git`
- Git protocol: `git://host/path/to/repo.git`

### Source Normalization

All source types are normalized to a common internal format:

```typescript
interface NormalizedPluginSource {
  type: 'relative-path' | 'git';
  
  // For relative-path
  relativePath?: string;
  
  // For git (both GitHub and Git URL)
  gitUrl?: string;
  gitRef?: string;
  gitSubdirectory?: string;
  
  // Original source for reference
  rawSource: PluginSourceSpec;
}
```

**Normalization rules**:

1. **String sources** → `type: 'relative-path'`
2. **GitHub sources** → `type: 'git'`, repo converted to full URL
3. **Git URL sources** → `type: 'git'`, URL used as-is

### Source Validation

#### Relative Path Validation

```typescript
// ✅ Valid
"./plugins/my-plugin"
"plugins/my-plugin"

// ❌ Invalid
"../plugins/my-plugin"  // Path traversal
"/absolute/path"        // Absolute path
```

#### GitHub Source Validation

```typescript
// ✅ Valid
{ source: 'github', repo: 'owner/repo' }
{ source: 'github', repo: 'owner/repo', ref: 'v1.0.0' }

// ❌ Invalid
{ source: 'github', repo: 'invalid' }        // Missing slash
{ source: 'github', repo: '/repo' }          // Empty owner
{ source: 'github', repo: 'owner/' }         // Empty repo
{ source: 'github' }                         // Missing repo
```

#### Git URL Validation

```typescript
// ✅ Valid
{ source: 'url', url: 'https://gitlab.com/team/plugin.git' }
{ source: 'url', url: 'git@github.com:user/repo.git' }

// ❌ Invalid
{ source: 'url', url: 'not-a-git-url' }      // Invalid URL
{ source: 'url' }                            // Missing url field
```

## Plugin Naming

Plugins installed from git sources get scoped names to ensure uniqueness:

### Naming Strategy

```typescript
function generatePluginName(context: {
  gitUrl?: string;
  subdirectory?: string;
  pluginManifestName?: string;
  marketplaceName?: string;
  repoPath?: string;
}): string
```

**Priority order**:
1. Use `pluginManifestName` if provided
2. Use `marketplaceName` if available
3. Derive from git URL or repo path
4. Fall back to "plugin"

**Examples**:

```typescript
// Marketplace plugin with relative path
{
  gitUrl: 'https://github.com/company/marketplace.git',
  subdirectory: 'plugins/formatter',
  pluginManifestName: 'code-formatter',
  marketplaceName: 'company-tools'
}
// Result: "code-formatter@company-tools"

// External GitHub plugin
{
  gitUrl: 'https://github.com/owner/plugin-repo.git',
  pluginManifestName: 'my-plugin'
}
// Result: "my-plugin@plugin-repo"

// Git subdirectory plugin
{
  gitUrl: 'https://gitlab.com/team/monorepo.git',
  subdirectory: 'packages/plugin-a',
  pluginManifestName: 'plugin-a'
}
// Result: "plugin-a@monorepo"
```

### Naming Rules

1. **Base name**: From manifest, marketplace, or repository
2. **Scope**: From marketplace name or repository name
3. **Format**: `{name}@{scope}`
4. **Uniqueness**: Combination of name and scope must be unique in workspace

## Installation Process

### Relative Path Installation

For plugins in marketplace repository subdirectories:

```
1. Validate subdirectory exists in marketplace repo
2. Validate plugin manifest exists and is parseable
3. Generate scoped plugin name
4. Build git install context with subdirectory
5. Run unified installation pipeline
```

**Context creation**:
```typescript
await buildGitInstallContext(
  cwd,
  marketplaceGitUrl,
  {
    gitRef: marketplaceGitRef,
    gitSubdirectory: pluginSubdir,
    ...options
  }
)
```

### External Git Installation

For plugins from external repositories:

```
1. Generate scoped plugin name
2. Build git install context with external URL
3. Run unified installation pipeline
```

**Context creation**:
```typescript
await buildGitInstallContext(
  cwd,
  externalGitUrl,
  {
    gitRef: ref,
    gitSubdirectory: path,
    ...options
  }
)
```

## Plugin Content Structure

### Directory Layout

After transformation, plugin content follows OpenPackage structure:

```
.openpackage/
├── plugin.json              # Transformed from .claude-plugin/plugin.json
├── commands/                # Command files (Markdown)
│   ├── command1.md
│   └── command2.md
├── agents/                  # Agent files (Markdown)
│   └── agent1.md
├── hooks/                   # Hook files
│   └── hooks.json
└── servers/                 # MCP/LSP servers
    ├── mcp-servers.json
    └── lsp-servers.json
```

### Universal Patterns

Plugin files are marked as universal content:

```yaml
# In openpackage.yml
universal:
  - ".openpackage/**/*"
```

This ensures plugin content is:
- Not transformed by platform flows
- Copied as-is during installation
- Available to all platforms

## Error Handling

### Plugin Detection Errors

```typescript
// Not a plugin
{ isPlugin: false }
// Continue as regular OpenPackage installation

// Plugin manifest invalid
throw ValidationError('Invalid plugin manifest (cannot parse JSON)')

// Marketplace manifest invalid
throw ValidationError('Invalid marketplace manifest')
```

### Source Validation Errors

```typescript
// Missing source field
throw ValidationError("Plugin 'name' missing required 'source' field")

// Invalid GitHub repo
throw ValidationError("Plugin 'name' has invalid source: repo must be in 'owner/repo' format")

// Invalid Git URL
throw ValidationError("Plugin 'name' has invalid Git URL: not-a-url")

// Path traversal
throw ValidationError("Plugin 'name' source path contains '..' which is not allowed")

// Absolute path
throw ValidationError("Plugin 'name' source path must be relative to marketplace root")
```

### Installation Errors

```typescript
// Subdirectory not found
return { success: false, error: "Subdirectory 'path' does not exist" }

// Not a valid plugin
return { success: false, error: "Subdirectory does not contain a valid plugin" }

// Pipeline failure
return { success: false, error: pipelineResult.error }
```

### Error Recovery

Installation continues for other plugins when one fails:

```
Installing 3 plugins...
✓ plugin-a installed successfully
✗ plugin-b failed: subdirectory not found
✓ plugin-c installed successfully

Installation Summary:
✓ Successfully installed (2):
  • plugin-a
  • plugin-c

✗ Failed to install (1):
  • plugin-b: subdirectory not found
```

## Workspace Tracking

### Workspace Index Entry

Installed plugins are tracked in `.openpackage/workspace-index.yml`:

```yaml
packages:
  - name: "code-formatter@company-tools"
    version: "1.0.0"
    content: ".openpackage/opkg-content/code-formatter@company-tools"
    source:
      type: "git"
      url: "https://github.com/company/marketplace.git"
      ref: "main"
      subdirectory: "plugins/formatter"
```

### Source Tracking

Git sources are tracked with full details:
- Repository URL
- Branch/tag/SHA (if specified)
- Subdirectory (if specified)

This enables:
- Update detection
- Version tracking
- Source verification

## Platform Integration

### Plugin Isolation

Plugins are installed as isolated packages:
- Separate content directory per plugin
- Independent versioning
- No cross-plugin dependencies

### Platform Application

Plugins use universal content patterns, so:
- No platform-specific transformations
- Same content for all platforms
- Applied as-is during sync

### Command/Agent Discovery

Claude Code discovers plugin content from:
- `.openpackage/commands/` - Command files
- `.openpackage/agents/` - Agent files
- `.openpackage/hooks/` - Hook configurations
- `.openpackage/servers/` - MCP/LSP server configs

## Security Considerations

### Path Validation

1. **No path traversal**: `..` segments rejected
2. **No absolute paths**: Must be relative to marketplace root
3. **Subdirectory validation**: Must exist in repository

### Git Source Validation

1. **URL parsing**: Must be valid git URL
2. **Repository verification**: Must be accessible
3. **Authentication**: Supports tokens via environment variables

### Manifest Validation

1. **JSON parsing**: Must be valid JSON
2. **Required fields**: name, source must be present
3. **Source normalization**: Must pass validation

## Future Enhancements

### Planned Features

1. **npm source support**: Install plugins from npm registry
2. **Version constraints**: Specify version ranges for plugins
3. **Dependency resolution**: Handle plugin dependencies
4. **Update notifications**: Check for plugin updates
5. **Plugin verification**: Signature validation

### Extensibility

The source normalization system is designed to easily add new source types:

```typescript
// Add new source type
export interface NpmSource {
  source: 'npm';
  package: string;
  version?: string;
}

// Add to union type
export type PluginSourceObject = 
  | GitHubSource 
  | GitUrlSource 
  | NpmSource;

// Add normalization logic
case 'npm':
  return normalizeNpmSource(sourceObj, pluginName);
```

## See Also

- [Plugin Manifest Schema](./plugin-manifest-schema.md)
- [Marketplace Manifest Schema](./marketplace-manifest-schema.md)
- [Git Sources](./git-sources.md)
- [Plugin Transformer](./plugin-transformer.md)
- [Installation Behavior](./install-behavior.md)
