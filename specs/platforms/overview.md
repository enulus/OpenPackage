# Platform System Overview

## What is the Platform System?

The **Platform System** is OpenPackage's solution to the fragmentation problem in AI coding platforms. Each platform (Cursor, Claude, Windsurf, etc.) has its own file formats, directory structures, and configuration schemas. The Platform System provides a **declarative transformation engine** that automatically maps universal package content to platform-specific formats.

### The Problem

Without a platform system:
- Package authors must create separate versions for each platform
- Users manually copy and adapt content between platforms
- Switching platforms means losing your configuration and tools
- Multi-platform workflows require duplicate maintenance

### The Solution

The Platform System provides:
- **Universal package format** - Authors write once, works everywhere
- **Declarative transformations** - JSON configuration handles all mapping
- **Automatic adaptation** - CLI transforms content during install
- **Multi-platform composition** - Merge content from multiple packages safely
- **Zero configuration** - Built-in flows work out of the box

## Core Concepts

### 1. Platforms

A **platform** represents an AI coding assistant with its own file organization:

```typescript
{
  "cursor": {
    "name": "Cursor",
    "rootDir": ".cursor",        // Where files live
    "aliases": ["cursorcli"],    // CLI shortcuts
    "flows": [ /* transforms */ ]
  }
}
```

**Key characteristics:**
- Unique identifier (e.g., `cursor`, `claude`)
- Root directory (e.g., `.cursor`, `.claude`)
- Optional root file (e.g., `CLAUDE.md`)
- Set of transformation flows

### 2. Flows

A **flow** is a declarative transformation rule that maps source content to target format:

```jsonc
{
  "from": "rules/**/*.md",              // Universal source
  "to": ".cursor/rules/**/*.mdc",       // Platform target
  "map": { "theme": "workbench.theme" },  // Key remapping
  "merge": "deep"                          // Merge strategy
}
```

**Flow pipeline:**
```
Source File → Parse → Transform → Merge → Write → Target File
```

### 3. Universal Package Format

Packages use a **platform-agnostic structure**:

```
my-package/
├── rules/
│   ├── code-quality.md
│   └── security.md
├── agents/
│   └── reviewer.md
├── mcp.jsonc
└── settings.jsonc
```

The CLI transforms this into platform-specific layouts during installation.

### 4. Configuration Hierarchy

Three levels of configuration with merge priority:

```
Built-in (ships with CLI)
    ↓ merged with
~/.openpackage/platforms.jsonc (global overrides)
    ↓ merged with
<workspace>/.openpackage/platforms.jsonc (project overrides)
```

**Priority:** workspace > global > built-in (last writer wins)

## How It Works

### Installation Flow

```
1. User: opkg install @user/cursor-rules
2. CLI loads package (universal format)
3. CLI detects platforms (.cursor directory exists)
4. CLI loads platform configuration (built-in + overrides)
5. CLI executes flows for detected platforms
6. Transformed files written to workspace
```

### Example Transformation

**Package content:**
```yaml
# rules/typescript-best-practices.md
---
severity: error
tags: [typescript, quality]
---
Always use strict type checking...
```

**Flow definition:**
```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.mdc",
  "map": {
    "severity": "level",
    "tags": "categories"
  }
}
```

**Result in workspace:**
```yaml
# .cursor/rules/typescript-best-practices.mdc
---
level: error
categories: [typescript, quality]
---
Always use strict type checking...
```

## Platform Detection

Platforms are detected using two signals:

1. **Root directory exists** - `.cursor`, `.claude`, etc.
2. **Root file exists** - `CLAUDE.md`, `GEMINI.md`, etc.

```bash
# Check detected platforms
opkg list
```

**Detection result:**
- Flows execute only for detected platforms
- Conditional flows can check platform presence
- Disabled platforms are skipped

## Multi-Package Composition

When multiple packages target the same file, the system uses **priority-based merging**:

**Priority order:**
1. Workspace content (highest)
2. Direct dependencies
3. Nested dependencies (shallower = higher priority)

**Example:**
```jsonc
// Package A: mcp.jsonc
{ "servers": { "database": { /* config */ } } }

// Package B: mcp.jsonc  
{ "servers": { "api": { /* config */ } } }

// Result: .cursor/mcp.json (with merge: "deep")
{
  "servers": {
    "database": { /* from A */ },
    "api": { /* from B */ }
  }
}
```

**Conflicts:** Last writer wins (by priority), with warnings logged.

## Format Conversion

Automatic bidirectional conversion between formats:

| Source | Target | Conversion |
|--------|--------|------------|
| YAML   | JSON   | Parse YAML → serialize JSON |
| JSONC  | JSON   | Strip comments |
| JSON   | TOML   | Object → TOML sections |
| Markdown | Markdown | Transform frontmatter, preserve body |

**Auto-detection:** Format inferred from file extension or content analysis.

## Key Features

### Declarative Configuration

Everything defined in JSON, no code required:

```jsonc
{
  "cursor": {
    "flows": [
      { "from": "rules/**/*.md", "to": ".cursor/rules/**/*.mdc" },
      { "from": "mcp.jsonc", "to": ".cursor/mcp.json", "merge": "deep" }
    ]
  }
}
```

### Powerful Transformations

- **Key remapping** - Dot notation, wildcards, nested paths
- **Value transforms** - Type conversion, string manipulation
- **Content embedding** - Wrap under keys or TOML sections
- **Conditional execution** - Platform checks, file existence
- **Multi-target flows** - One source → multiple destinations

### Namespace Isolation

Prevent package collisions with automatic namespacing:

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "namespace": true,  // Wraps under packages.{packageName}
  "merge": "deep"
}
```

### Type Safety

- **JSON Schema validation** - IDE autocomplete and error checking
- **Load-time validation** - Clear error messages for invalid configs
- **Strict mode** - Comprehensive validation with `opkg validate platforms`

## Architecture

### Components

```
┌─────────────────────────────────────┐
│     Platform Configuration          │
│  (built-in + global + workspace)    │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│       Platform Detection            │
│   (check rootDir/rootFile exist)    │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│        Flow Executor                │
│  (load → transform → merge → write) │
└──────────────┬──────────────────────┘
               │
               ↓
┌─────────────────────────────────────┐
│      Workspace Files                │
│   (platform-specific formats)       │
└─────────────────────────────────────┘
```

### Key Files

- **`src/core/platforms.ts`** - Configuration loading and merging
- **`src/core/flows/flow-executor.ts`** - Flow execution engine
- **`src/core/flows/flow-transforms.ts`** - Transform implementations
- **`src/core/flows/flow-key-mapper.ts`** - Key mapping logic
- **`src/core/flows/flow-inverter.ts`** - Flow inversion for cross-platform conversion
- **`src/core/flows/platform-converter.ts`** - Universal converter orchestration
- **`src/core/install/format-detector.ts`** - Package format detection
- **`schemas/platforms-v1.json`** - JSON Schema definition

## Universal Platform Converter

**New in:** Commit `a3fdb9f2a846fa8c183bca851812c491aaf5b8e9`

The **Universal Platform Converter** extends the platform system to support **cross-platform package conversion**. This enables installing platform-specific packages (like Claude Code plugins) to any platform.

### Key Capabilities

**1. Format Detection**
- Automatically identifies universal vs platform-specific packages
- Analyzes file paths to determine source format
- Calculates confidence scores based on file distribution

**2. Direct Installation (AS-IS)**
- When source platform = target platform (e.g., Claude plugin → Claude)
- Files copied without transformation for maximum compatibility
- Fastest installation path

**3. Cross-Platform Conversion**
- When source platform ≠ target platform (e.g., Claude plugin → Cursor)
- Automatically inverts source platform flows (platform → universal)
- Then applies target platform flows (universal → platform)
- Enables full interoperability

### Example: Install Claude Plugin to Cursor

```bash
opkg install github:user/claude-plugin --platforms cursor
```

**What happens:**
1. **Detect format:** Plugin has `.claude/` directories → Claude format
2. **Invert Claude flows:** `.claude/commands/*.md` → `commands/*.md`
3. **Apply Cursor flows:** `commands/*.md` → `.cursor/commands/*.md`
4. **Result:** Plugin works in Cursor with proper directory structure

**See:** [Universal Converter](./universal-converter.md) for complete technical documentation.

## Use Cases

### 1. Simple File Mapping
Install rules that work across platforms with different extensions.

### 2. Configuration Translation
Convert universal config format to platform-specific schemas.

### 3. Multi-Package MCP Servers
Compose MCP server configurations from multiple packages without conflicts.

### 4. Agent Definition Conversion
Map universal agent schemas to platform-specific formats.

### 5. Cross-Platform Plugin Installation
Install Claude plugins to Cursor, OpenCode, or any other platform.

### 6. Custom Platform Support
Add flows for new/proprietary platforms via workspace overrides.

## Next Steps

- **Learn flow syntax:** See [Flows](./flows.md)
- **Cross-platform conversion:** See [Universal Converter](./universal-converter.md)
- **View examples:** See [Examples](./examples.md)
- **Configure platforms:** See [Configuration](./configuration.md)
- **Debug issues:** See [Troubleshooting](./troubleshooting.md)
