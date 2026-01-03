# Platform Flows System

## Overview

The **Platform Flows** system is OpenPackage's declarative transformation engine that maps universal package content to platform-specific formats. It handles file transformations, format conversions, key remapping, and multi-package composition through structured JSON configurations.

**Core Concept:** Data flows through a pipeline: `source → transforms → target`

---

## Configuration

### File: `platforms.jsonc`

Single unified configuration file with a merge hierarchy:

```
Built-in (ships with CLI, 13 platforms)
  ↓ merged with
~/.openpackage/platforms.jsonc (global overrides)
  ↓ merged with
<workspace>/.openpackage/platforms.jsonc (project overrides)
```

### Structure

```typescript
{
  // Optional: Global flows (apply to all platforms)
  "global"?: {
    "flows": Flow[]
  },

  // Per-platform definitions
  [platformId: string]: {
    "name": string,           // Display name
    "rootDir": string,         // Platform root (e.g., ".cursor")
    "rootFile"?: string,       // Optional root file
    "aliases"?: string[],      // CLI aliases
    "enabled"?: boolean,       // Default: true
    "flows": Flow[]
  }
}
```

**Platform Detection:** A platform is detected if its `rootDir` exists OR its `rootFile` exists.

---

## Flow Schema

### Basic Flow

```typescript
interface Flow {
  from: string                    // Source pattern (required)
  to: string | MultiTarget        // Target path (required)
  
  // Transformations (all optional)
  pipe?: string[]                 // Transform pipeline
  map?: KeyMap                    // Key mapping/transformation
  pick?: string[]                 // Extract specific keys
  omit?: string[]                 // Exclude keys
  path?: string                   // JSONPath extraction
  embed?: string                  // Embed under key
  section?: string                // TOML/INI section
  when?: Condition                // Conditional execution
  merge?: "deep"|"shallow"|"replace"  // Merge strategy
  namespace?: boolean | string    // Namespace isolation
  handler?: string                // Custom handler
}
```

### Execution Pipeline

```
1. Load source file
2. Extract path (if specified)
3. Pick/omit keys
4. Map keys
5. Apply transforms (pipe)
6. Wrap namespace
7. Embed in target structure
8. Merge with existing target
9. Write to target file
```

---

## Common Patterns

### 1. Simple File Mapping

```jsonc
{
  "from": "rules/{name}.md",
  "to": ".cursor/rules/{name}.mdc"
}
```

Maps files with extension transformation.

### 2. Format Conversion

```jsonc
{
  "from": "config.yaml",
  "to": ".cursor/config.json"
}
```

Auto-detects and converts formats (YAML/JSON/TOML/JSONC).

### 3. Key Remapping

```jsonc
{
  "from": "settings.jsonc",
  "to": ".cursor/settings.json",
  "map": {
    "theme": "workbench.colorTheme",
    "ai.*": "cursor.*",               // Wildcard mapping
    "fontSize": {
      "to": "editor.fontSize",
      "transform": "number",
      "default": 14
    }
  },
  "merge": "deep"
}
```

Supports dot notation, wildcards, and value transforms.

### 4. Markdown Frontmatter Transforms

```jsonc
{
  "from": "agents/{name}.md",
  "to": ".claude/agents/{name}.md",
  "map": {
    "role": "type",
    "model": {
      "values": {
        "anthropic/claude-sonnet-4.5": "claude-sonnet-4.5"
      }
    }
  }
}
```

Transforms YAML frontmatter, preserves markdown body unchanged.

### 5. Multi-Package Composition

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "namespace": true,
  "merge": "deep"
}
```

Prevents collisions by wrapping content under `packages.{packageName}`.

### 6. Content Embedding

**JSON:**
```jsonc
{
  "from": "mcp.jsonc",
  "to": ".opencode/opencode.json",
  "embed": "mcp",
  "merge": "deep"
}
```

**TOML:**
```jsonc
{
  "from": "mcp.jsonc",
  "to": ".codex/config.toml",
  "path": "$.servers",
  "section": "mcp_servers",
  "merge": "deep"
}
```

### 7. Multi-Target Flows

One source → multiple targets with different transformations:

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

---

## Transform Features

### Built-in Pipe Transforms

**Format converters:** `jsonc`, `yaml`, `toml`, `xml`, `ini`  
**Merging:** `merge`, `merge-shallow`, `replace`  
**Filtering:** `filter-comments`, `filter-empty`, `filter-null`  
**Markdown:** `sections`, `frontmatter`, `body`  
**Validation:** `validate`, `validate-schema(path)`

### Value Transforms

**Type converters:** `number`, `string`, `boolean`, `json`, `date`  
**String transforms:** `uppercase`, `lowercase`, `title-case`, `camel-case`, `kebab-case`, `snake-case`, `trim`, `slugify`  
**Array transforms:** `array-append`, `array-unique`, `array-flatten`  
**Object transforms:** `flatten`, `unflatten`, `pick-keys`, `omit-keys`

### Conditional Flows

```jsonc
{
  "from": "config.jsonc",
  "to": ".cursor/config.json",
  "when": {
    "exists": ".cursor",          // File/dir exists
    "platform": "cursor",         // Platform enabled
    "key": "env",                 // Key value condition
    "equals": "development"
  }
}
```

Supports `and`, `or` for composite conditions.

---

## Complete Example

```jsonc
{
  "global": {
    "flows": [
      { "from": "AGENTS.md", "to": "AGENTS.md", "pipe": ["sections"] },
      { "from": "README.md", "to": "README.md" }
    ]
  },

  "cursor": {
    "name": "Cursor",
    "rootDir": ".cursor",
    "aliases": ["cursorcli"],
    "flows": [
      { "from": "rules/{name}.md", "to": ".cursor/rules/{name}.mdc" },
      { "from": "commands/{name}.md", "to": ".cursor/commands/{name}.md" },
      {
        "from": "mcp.jsonc",
        "to": ".cursor/mcp.json",
        "namespace": true,
        "merge": "deep"
      },
      {
        "from": "settings.jsonc",
        "to": ".cursor/settings.json",
        "map": {
          "theme": "workbench.colorTheme",
          "ai.*": "cursor.*"
        },
        "merge": "deep"
      }
    ]
  },

  "claude": {
    "name": "Claude Code",
    "rootDir": ".claude",
    "rootFile": "CLAUDE.md",
    "flows": [
      { "from": "rules/{name}.md", "to": ".claude/rules/{name}.md" },
      {
        "from": "agents/{name}.md",
        "to": ".claude/agents/{name}.md",
        "map": {
          "role": "type",
          "model": {
            "values": {
              "anthropic/claude-sonnet-4.5": "claude-sonnet-4.5"
            }
          }
        }
      }
    ]
  }
}
```

---

## Usage Examples

### Quick Start (Zero Config)

```bash
# Install package - built-in flows run automatically
opkg install @username/cursor-rules
```

Built-in flows handle all 13 supported platforms automatically.

### Global Override

Create `~/.openpackage/platforms.jsonc`:

```jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "rules/{name}.md",
        "to": ".cursor/custom-rules/{name}.mdc"
      }
    ]
  },

  "my-ai-platform": {
    "name": "My AI Platform",
    "rootDir": ".myai",
    "flows": [
      { "from": "rules/{name}.md", "to": ".myai/prompts/{name}.md" }
    ]
  }
}
```

### Project Override

Create `<workspace>/.openpackage/platforms.jsonc`:

```jsonc
{
  "windsurf": { "enabled": false },

  "cursor": {
    "flows": [
      {
        "from": "agents/{name}.md",
        "to": ".cursor/agents/{name}.md",
        "map": { "role": "agentType" }
      }
    ]
  }
}
```

### Validation

```bash
opkg validate platforms
```

### Testing

```bash
opkg install @username/package --dry-run
```

---

## Key Features

- ✅ **Declarative:** JSON configuration, not code
- ✅ **Type-safe:** IDE autocomplete + schema validation
- ✅ **Powerful:** Handles simple to complex transformations
- ✅ **Composable:** Multi-package content merging
- ✅ **Format-agnostic:** JSON, YAML, TOML, JSONC, Markdown
- ✅ **Extensible:** Custom handlers for edge cases
- ✅ **Single file:** One configuration file with merge hierarchy

---

## Implementation Notes

### Key Files

- `src/core/platforms.ts` - Platform configuration loading, merging, validation
- `src/core/flow-executor.ts` - Flow execution engine
- `src/core/flow-transforms.ts` - Built-in transform implementations

### TypeScript Interfaces

```typescript
interface PlatformsConfig {
  global?: { flows: Flow[] }
  [platformId: string]: {
    name: string
    rootDir: string
    rootFile?: string
    aliases?: string[]
    enabled?: boolean
    flows: Flow[]
  }
}

interface Flow {
  from: string
  to: string | MultiTargetFlows
  pipe?: string[]
  map?: KeyMap
  pick?: string[]
  omit?: string[]
  path?: string
  embed?: string
  section?: string
  when?: Condition
  merge?: "deep" | "shallow" | "replace"
  namespace?: boolean | string
  handler?: string
}
```

### Performance

- Simple file copies bypass transformation
- Format parsers cached per file type
- Multi-target flows parse source once
- Lazy namespace wrapping
- Structural sharing for merges

---

## Best Practices

1. Start with built-in flows, customize only what's needed
2. Use `global` section for universal files
3. Test with `--dry-run` before applying
4. Validate after configuration changes
5. Version control your overrides
6. Use meaningful platform IDs (lowercase, kebab-case)
7. Prefer simple flows over custom handlers
8. Test incrementally (one flow at a time)

---

## Troubleshooting

**Flows not executing:**
```bash
opkg status  # Check detected platforms
```

**Files in wrong location:**
```bash
opkg validate platforms
opkg show platforms --platform=cursor
```

**Debug flow execution:**
```bash
DEBUG=opkg:flows opkg install @username/package
```

---

## Summary

Platform Flows provides a powerful, declarative system for transforming universal package content into platform-specific formats. Through a single configuration file with a merge hierarchy, it handles everything from simple file copies to complex multi-format transformations with key remapping, namespace isolation, and multi-package composition—all validated at load time with clear error messages.
