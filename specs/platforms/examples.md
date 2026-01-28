# Platform Examples

Practical examples and common patterns for platform flows.

## Quick Start

### Zero Configuration Installation

Built-in flows work out of the box:

```bash
# Install package - flows execute automatically
opkg install @username/cursor-rules
```

**What happens:**
1. CLI detects platforms (`.cursor`, `.claude`, etc.)
2. Loads built-in flow configurations
3. Transforms universal content to platform-specific formats
4. Writes files to workspace

**No configuration needed** for standard use cases.

## Simple Patterns

### Pattern 1: File Copy with Extension Change (Recursive)

```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "rules/**/*.md",
        "to": ".cursor/rules/**/*.mdc"
      }
    ]
  }
}
```

**Package content:**
```
rules/
├── typescript.md
├── python.md
└── advanced/
    ├── generics.md
    └── types/
        └── unions.md
```

**Result in workspace:**
```
.cursor/rules/
├── typescript.mdc
├── python.mdc
└── advanced/
    ├── generics.mdc
    └── types/
        └── unions.mdc
```

**Key features:**
- `**` recursively matches all subdirectories
- Directory structure is preserved
- Extension mapping applies to all files

### Pattern 2: Format Conversion

```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "config.yaml",
        "to": ".cursor/config.json"
      }
    ]
  }
}
```

**Package: config.yaml**
```yaml
theme: dark
fontSize: 14
tabSize: 2
```

**Workspace: .cursor/config.json**
```json
{
  "theme": "dark",
  "fontSize": 14,
  "tabSize": 2
}
```

### Pattern 3: Copy All Files Recursively (Mixed Types)

```jsonc
{
  "claude": {
    "flows": [
      {
        "from": "skills/**/*",
        "to": ".claude/skills/**/*"
      }
    ]
  }
}
```

**Package content:**
```
skills/
├── code-review/
│   ├── analyze.md
│   ├── config.json
│   └── helpers/
│       ├── utils.ts
│       └── types.d.ts
└── testing/
    ├── test-gen.md
    └── coverage.json
```

**Result in workspace:**
```
.claude/skills/
├── code-review/
│   ├── analyze.md
│   ├── config.json
│   └── helpers/
│       ├── utils.ts
│       └── types.d.ts
└── testing/
    ├── test-gen.md
    └── coverage.json
```

**Key features:**
- `**/*` matches all file types
- Complete directory structure preserved
- No extension mapping (copies as-is)

### Pattern 4: Simple Key Remapping

```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "settings.jsonc",
        "to": ".cursor/settings.json",
        "map": {
          "theme": "workbench.colorTheme",
          "fontSize": "editor.fontSize"
        }
      }
    ]
  }
}
```

**Package: settings.jsonc**
```json
{
  "theme": "dark",
  "fontSize": 14
}
```

**Workspace: .cursor/settings.json**
```json
{
  "workbench": {
    "colorTheme": "dark"
  },
  "editor": {
    "fontSize": 14
  }
}
```

## Multi-Package Composition

### Pattern 5: Merge Multiple Packages

**Setup:**
```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "mcp.jsonc",
        "to": ".cursor/mcp.json",
        "merge": "deep"
      }
    ]
  }
}
```

**Package A: mcp.jsonc**
```json
{
  "servers": {
    "database": {
      "command": "mcp-db",
      "args": ["--port", "5432"]
    }
  }
}
```

**Package B: mcp.jsonc**
```json
{
  "servers": {
    "api": {
      "command": "mcp-api",
      "args": ["--host", "localhost"]
    }
  }
}
```

**Result: .cursor/mcp.json**
```json
{
  "servers": {
    "database": {
      "command": "mcp-db",
      "args": ["--port", "5432"]
    },
    "api": {
      "command": "mcp-api",
      "args": ["--host", "localhost"]
    }
  }
}
```

### Pattern 6: Namespace Isolation

**Setup:**
```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "mcp.jsonc",
        "to": ".cursor/mcp.json",
        "namespace": true,
        "merge": "deep"
      }
    ]
  }
}
```

**Package A (@user/db-tools): mcp.jsonc**
```json
{
  "servers": {
    "db": { "command": "mcp-db" }
  }
}
```

**Package B (@user/api-tools): mcp.jsonc**
```json
{
  "servers": {
    "api": { "command": "mcp-api" }
  }
}
```

**Result: .cursor/mcp.json**
```json
{
  "packages": {
    "@user/db-tools": {
      "servers": {
        "db": { "command": "mcp-db" }
      }
    },
    "@user/api-tools": {
      "servers": {
        "api": { "command": "mcp-api" }
      }
    }
  }
}
```


### Pattern 7: Composite Merge for Root Files

**Setup:**
```jsonc
{
  "global": {
    "flows": [
      {
        "from": "AGENTS.md",
        "to": "AGENTS.md",
        "when": { "exists": "AGENTS.md" },
        "merge": "composite"
      }
    ]
  }
}
```

**Package A (@user/db-tools): AGENTS.md**
```markdown
# Database Tools

Use these tools for database management.
```

**Package B (@user/api-tools): AGENTS.md**
```markdown
# API Tools

Use these tools for API development.
```

**Result: AGENTS.md**
```markdown
<!-- package: @user/db-tools -->
# Database Tools

Use these tools for database management.
<!-- -->

<!-- package: @user/api-tools -->
# API Tools

Use these tools for API development.
<!-- -->
```

**Update Package A:**
```markdown
# Database Tools - Updated

Enhanced database management tools with new features.
```

**Result after update: AGENTS.md**
```markdown
<!-- package: @user/db-tools -->
# Database Tools - Updated

Enhanced database management tools with new features.
<!-- -->

<!-- package: @user/api-tools -->
# API Tools

Use these tools for API development.
<!-- -->
```

**Key benefit:** Each package maintains its own section. Updates don't overwrite other packages.

## Advanced Transformations

### Pattern 8: Markdown Frontmatter Transform

```jsonc
{
  "claude": {
    "flows": [
      {
        "from": "agents/*.md",
        "to": ".claude/agents/*.md",
        "map": {
          "role": "type",
          "model": {
            "values": {
              "anthropic/claude-sonnet-4.5": "claude-sonnet-4.5",
              "openai/gpt-4": "gpt-4"
            }
          }
        }
      }
    ]
  }
}
```

**Package: agents/reviewer.md**
```markdown
---
role: assistant
model: anthropic/claude-sonnet-4.5
temperature: 0.7
---
# Code Reviewer

Help review code for quality and security.
```

**Workspace: .claude/agents/reviewer.md**
```markdown
---
type: assistant
model: claude-sonnet-4.5
temperature: 0.7
---
# Code Reviewer

Help review code for quality and security.
```

**Note:** Body unchanged, only frontmatter transformed.

### Pattern 9: Content Embedding

```jsonc
{
  "opencode": {
    "flows": [
      {
        "from": "mcp.jsonc",
        "to": ".opencode/opencode.json",
        "embed": "mcp",
        "merge": "deep"
      }
    ]
  }
}
```

**Package: mcp.jsonc**
```json
{
  "servers": {
    "db": { "command": "mcp-db" }
  }
}
```

**Workspace: .opencode/opencode.json (existing)**
```json
{
  "version": "1.0",
  "other": "config"
}
```

**Result: .opencode/opencode.json**
```json
{
  "version": "1.0",
  "other": "config",
  "mcp": {
    "servers": {
      "db": { "command": "mcp-db" }
    }
  }
}
```

### Pattern 10: TOML Sections

```jsonc
{
  "codex": {
    "flows": [
      {
        "from": "mcp.jsonc",
        "to": ".codex/config.toml",
        "path": "$.servers",
        "section": "mcp_servers",
        "merge": "deep"
      }
    ]
  }
}
```

**Package: mcp.jsonc**
```json
{
  "servers": {
    "db": {
      "command": "mcp-db",
      "args": ["--port", "5432"]
    }
  }
}
```

**Workspace: .codex/config.toml**
```toml
[general]
version = "1.0"

[mcp_servers.db]
command = "mcp-db"
args = ["--port", "5432"]
```

### Pattern 11: Multi-Target with Different Formats

```jsonc
{
  "from": "mcp.jsonc",
  "to": {
    ".cursor/mcp.json": {
      "namespace": true,
      "merge": "deep"
    },
    ".opencode/opencode.json": {
      "embed": "mcp",
      "merge": "deep"
    },
    ".codex/config.toml": {
      "path": "$.servers",
      "section": "mcp_servers",
      "merge": "deep"
    }
  }
}
```

**Single source file** → **Three different formats/structures**

## Conditional Flows

### Pattern 12: Platform-Specific Flow

```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "cursor-specific.jsonc",
        "to": ".cursor/config.json",
        "when": { "platform": "cursor" }
      }
    ]
  }
}
```

Executes only when Cursor is detected.

### Pattern 13: Development vs Production

```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "config-dev.yaml",
        "to": ".cursor/config.json",
        "when": {
          "key": "env",
          "equals": "development"
        }
      },
      {
        "from": "config-prod.yaml",
        "to": ".cursor/config.json",
        "when": {
          "key": "env",
          "equals": "production"
        }
      }
    ]
  }
}
```

### Pattern 14: Multi-Platform Conditional

```jsonc
{
  "flows": [
    {
      "from": "shared-config.yaml",
      "to": ".ai/config.json",
      "when": {
        "or": [
          { "platform": "cursor" },
          { "platform": "claude" },
          { "platform": "windsurf" }
        ]
      }
    }
  ]
}
```

Executes if **any** of the platforms are detected.

## Complete Platform Configurations

### Example 1: Cursor Configuration

```jsonc
{
  "cursor": {
    "name": "Cursor",
    "rootDir": ".cursor",
    "rootFile": "AGENTS.md",
    "aliases": ["cursorcli"],
    "flows": [
      // Rules with extension change (recursive)
      {
        "from": "rules/**/*.md",
        "to": ".cursor/rules/**/*.mdc"
      },
      
      // Commands (recursive, no extension change)
      {
        "from": "commands/**/*.md",
        "to": ".cursor/commands/**/*.md"
      },
      
      // MCP with namespacing
      {
        "from": "mcp.jsonc",
        "to": ".cursor/mcp.json",
        "pipe": ["filter-comments"],
        "merge": "deep"
      }
    ]
  }
}
```

### Example 2: Claude Configuration

```jsonc
{
  "claude": {
    "name": "Claude Code",
    "rootDir": ".claude",
    "rootFile": "CLAUDE.md",
    "aliases": ["claudecode"],
    "flows": [
      // Root file with composite merge
      {
        "from": "AGENTS.md",
        "to": "CLAUDE.md",
        "merge": "composite"
      },
      
      // Rules (recursive)
      {
        "from": "rules/**/*.md",
        "to": ".claude/rules/**/*.md"
      },
      
      // Commands (recursive)
      {
        "from": "commands/**/*.md",
        "to": ".claude/commands/**/*.md"
      },
      
      // Agents (recursive)
      {
        "from": "agents/**/*.md",
        "to": ".claude/agents/**/*.md"
      },
      
      // Skills (all files, recursive)
      {
        "from": "skills/**/*",
        "to": ".claude/skills/**/*"
      }
    ]
  }
}
```

### Example 3: Multi-Platform Package

```jsonc
{
  "global": {
    "flows": [
      // Universal root file with composite merge
      {
        "from": "AGENTS.md",
        "to": "AGENTS.md",
        "when": { "exists": "AGENTS.md" },
        "merge": "composite"
      }
    ]
  },
  
  "cursor": {
    "name": "Cursor",
    "rootDir": ".cursor",
    "rootFile": "AGENTS.md",
    "flows": [
      // Recursive rules with extension change
      { "from": "rules/**/*.md", "to": ".cursor/rules/**/*.mdc" },
      // MCP config
      {
        "from": "mcp.jsonc",
        "to": ".cursor/mcp.json",
        "pipe": ["filter-comments"],
        "merge": "deep"
      }
    ]
  },
  
  "claude": {
    "name": "Claude Code",
    "rootDir": ".claude",
    "rootFile": "CLAUDE.md",
    "flows": [
      { "from": "AGENTS.md", "to": "CLAUDE.md", "merge": "composite" },
      { "from": "rules/**/*.md", "to": ".claude/rules/**/*.md" },
      { "from": "agents/**/*.md", "to": ".claude/agents/**/*.md" },
      { "from": "skills/**/*", "to": ".claude/skills/**/*" }
    ]
  },
  
  "windsurf": {
    "name": "Windsurf",
    "rootDir": ".windsurf",
    "flows": [
      { "from": "rules/**/*.md", "to": ".windsurf/rules/**/*.md" }
    ]
  }
}
```

## Custom Platform Examples

### Example 4: Add Custom Platform

```jsonc
// workspace/.openpackage/platforms.jsonc
{
  "my-ai-platform": {
    "name": "My AI Platform",
    "rootDir": ".myai",
    "rootFile": "MYAI.md",
    "flows": [
      // Root file with composite merge
      {
        "from": "AGENTS.md",
        "to": "MYAI.md",
        "merge": "composite"
      },
      
      // Rules → prompts (recursive)
      {
        "from": "rules/**/*.md",
        "to": ".myai/prompts/**/*.md"
      },
      
      // Agents → assistants with format conversion (recursive)
      {
        "from": "agents/**/*.md",
        "to": ".myai/assistants/**/*.yaml"
      },
      
      // Skills → all files (recursive)
      {
        "from": "skills/**/*",
        "to": ".myai/skills/**/*"
      },
      
      // Config with custom structure
      {
        "from": "mcp.jsonc",
        "to": ".myai/config/mcp.yaml",
        "path": "$.servers",
        "merge": "deep"
      }
    ]
  }
}
```

### Example 5: Override Built-in Platform

```jsonc
// workspace/.openpackage/platforms.jsonc
{
  "cursor": {
    "flows": [
      // Custom directory structure (recursive)
      {
        "from": "rules/**/*.md",
        "to": ".cursor/custom-rules/**/*.mdc"
      },
      
      // Additional transform (recursive)
      {
        "from": "custom/**/*.jsonc",
        "to": ".cursor/custom/**/*.json",
        "pick": ["public"],
        "merge": "deep"
      }
    ]
  }
}
```

### Example 6: Disable Platforms

```jsonc
// workspace/.openpackage/platforms.jsonc
{
  // Disable unused platforms for performance
  "windsurf": { "enabled": false },
  "cline": { "enabled": false },
  "roo-code": { "enabled": false },
  "void": { "enabled": false }
}
```

## Testing and Validation

### Test with Dry-Run

```bash
# Preview what would happen
opkg install @user/package --dry-run
```

**Output:**
```
Would create:
  .cursor/rules/typescript.mdc
  .cursor/rules/python.mdc
  .cursor/mcp.json (merged)
  
Would skip:
  .windsurf/ (not detected)
```

### Validate Configuration

```bash
# Check configuration validity
opkg validate platforms --strict
```

**Output:**
```
✓ Configuration valid
✓ All flows valid
✓ All transforms found
✓ No circular dependencies
```

### Debug Flow Execution

```bash
# Enable debug logging
DEBUG=opkg:flows opkg install @user/package
```

**Output:**
```
[flows] Executing flow: rules/**/*.md → .cursor/rules/**/*.mdc
[flows] Matched: rules/typescript.md
[flows] Transform: extension .md → .mdc
[flows] Write: .cursor/rules/typescript.mdc
[flows] Matched: rules/advanced/generics.md
[flows] Transform: extension .md → .mdc
[flows] Write: .cursor/rules/advanced/generics.mdc
```

## Common Use Cases

### Use Case 1: Company-Wide Standards

**Global override for all projects:**

```jsonc
// ~/.openpackage/platforms.jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "rules/*.md",
        "to": ".cursor/company-rules/*.mdc"
      }
    ]
  }
}
```

### Use Case 2: Monorepo Setup

**Workspace-specific paths:**

```jsonc
// monorepo/.openpackage/platforms.jsonc
{
  "cursor": {
    "rootDir": ".cursor-workspace",
    "flows": [
      {
        "from": "rules/*.md",
        "to": ".cursor-workspace/shared-rules/*.mdc"
      }
    ]
  }
}
```

### Use Case 3: Development vs Production

**Environment-specific configs:**

```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "config.dev.yaml",
        "to": ".cursor/config.json",
        "when": { "key": "env", "equals": "development" },
        "merge": "deep"
      },
      {
        "from": "config.prod.yaml",
        "to": ".cursor/config.json",
        "when": { "key": "env", "equals": "production" },
        "merge": "replace"
      }
    ]
  }
}
```

### Use Case 4: Plugin System

**Compose plugins from multiple packages:**

```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "plugin.jsonc",
        "to": ".cursor/plugins.json",
        "namespace": true,
        "merge": "deep"
      }
    ]
  }
}
```

**Result:**
```json
{
  "packages": {
    "@user/plugin-a": { /* plugin A config */ },
    "@user/plugin-b": { /* plugin B config */ },
    "@user/plugin-c": { /* plugin C config */ }
  }
}
```

## Cross-Platform Conversion Examples

**New in:** Commit `a3fdb9f2a846fa8c183bca851812c491aaf5b8e9`

The **Universal Platform Converter** enables installing platform-specific packages to any platform.

### Example 1: Install Claude Plugin to Claude (Direct AS-IS)

```bash
opkg install github:user/claude-plugin --platforms claude
```

**Source format:** Claude-specific (`.claude/` directories)  
**Target platform:** claude  
**Strategy:** Direct installation (no conversion)

**Console output:**
```
🔌 Detected Claude Code plugin
📦 Installing plugin: my-plugin@1.0.0
✓ Installing my-plugin AS-IS for claude platform (matching format)
✓ Added files: 5
   ├── .claude/commands/review.md
   ├── .claude/commands/test.md
   └── ...
```

**Why AS-IS:** Source and target platforms match, so no transformation is needed. This is the fastest and most compatible installation method.

### Example 2: Install Claude Plugin to Cursor (Cross-Platform)

```bash
opkg install gh@user/claude-plugin --platforms cursor
```

**Source format:** Claude-specific (`.claude/` directories)  
**Target platform:** cursor  
**Strategy:** Convert via universal

**Conversion pipeline:**
1. **Detect format:** Identifies Claude platform-specific structure
2. **Invert Claude flows:** `.claude/commands/*.md` → `commands/*.md`
3. **Apply Cursor flows:** `commands/*.md` → `.cursor/commands/*.md`

**Console output:**
```
🔌 Detected Claude Code plugin
📦 Installing plugin: my-plugin@1.0.0
🔄 Converting my-plugin from claude to cursor format
✓ Conversion stage: platform-to-universal (5 files)
✓ Applying cursor platform flows
✓ Added files: 5
   ├── .cursor/commands/review.md
   ├── .cursor/commands/test.md
   └── ...
```

### Example 3: Install to Multiple Platforms (Mixed Strategies)

```bash
opkg install github:user/claude-plugin --platforms claude,cursor,opencode
```

**Result:** Plugin installed to all three platforms with appropriate strategies:
- **claude:** Direct AS-IS installation
- **cursor:** Converted from Claude format
- **opencode:** Converted from Claude format

**Console output:**
```
🔌 Detected Claude Code plugin
📦 Installing plugin: my-plugin@1.0.0
✓ Installing AS-IS for claude platform (matching format)
🔄 Converting to cursor format
🔄 Converting to opencode format
✓ Added 15 files across 3 platforms
```

### Example 4: Universal Package to All Platforms

```bash
opkg install @user/universal-rules --platforms cursor claude opencode
```

**Source format:** Universal (standard `commands/`, `agents/` structure)  
**Strategy:** Standard flow-based installation (existing behavior)

**No conversion needed** - universal packages work with the standard flow system.

### How It Works

The converter uses **flow inversion** to reverse platform transformations:

**Original Claude flow:**
```jsonc
{
  "from": "commands/**/*.md",
  "to": ".claude/commands/**/*.md"
}
```

**Automatically inverted for conversion:**
```jsonc
{
  "from": ".claude/commands/**/*.md",
  "to": "commands/**/*.md"
}
```

This inverted flow converts Claude-specific files back to universal format, which can then be transformed to any target platform.

**See:** [Universal Converter](./universal-converter.md) for complete technical details.

## Best Practices

### 1. Start Simple

Begin with basic flows:
```jsonc
{
  "from": "rules/*.md",
  "to": ".cursor/rules/*.md"
}
```

Add complexity as needed.

### 2. Use Merge for Composition

Enable multi-package workflows:
```jsonc
{
  "merge": "deep"
}
```

### 3. Namespace for Safety

Prevent conflicts:
```jsonc
{
  "namespace": true,
  "merge": "deep"
}
```

### 4. Test Incrementally

Test each flow individually:
```bash
opkg install @user/package --dry-run
```

### 5. Document Custom Flows

Add comments explaining intent:
```jsonc
{
  // Transform MCP config for multi-package composition
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "namespace": true,
  "merge": "deep"
}
```

## Next Steps

- **Learn flow syntax:** [Flows](./flows.md)
- **Cross-platform conversion:** [Universal Converter](./universal-converter.md)
- **View flow options:** [Flow Reference](./flow-reference.md)
- **Configure platforms:** [Configuration](./configuration.md)
- **Debug issues:** [Troubleshooting](./troubleshooting.md)
