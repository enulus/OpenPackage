# Platform Flows

## What are Flows?

**Flows** are declarative transformation rules that define bidirectional mappings between universal package content and platform-specific formats. 

**Two types of flows:**
- **Export flows** (`export`): Package → Workspace (used by `install` and `apply`)
- **Import flows** (`import`): Workspace → Package (used by `save`)

**Core concept:** Explicit bidirectional transformations without automatic inversion.

## Flow Types

### Export Flows

Transform package files into workspace files (Package → Workspace).

**Used by:** `opkg install`, `opkg apply`

**Schema:**
```typescript
interface ExportFlow {
  from: string | string[]         // Source pattern in package (required)
  to: string | MultiTarget        // Target path in workspace (required)
  
  // Optional transformation fields
  map?: Operation[]               // Map pipeline operations (includes $pipe for transforms)
  pick?: string[]                 // Extract specific keys
  omit?: string[]                 // Exclude keys
  path?: string                   // JSONPath extraction
  embed?: string                  // Embed under key
  section?: string                // TOML/INI section
  when?: Condition                // Conditional execution
  merge?: "deep"|"shallow"|"replace"|"composite"  // Merge strategy
  namespace?: boolean | string    // Namespace isolation
  handler?: string                // Custom handler
}
```

### Import Flows

Transform workspace files back into package files (Workspace → Package).

**Used by:** `opkg save`, `opkg add`

**Schema:**
```typescript
interface ImportFlow {
  from: string | string[]         // Source pattern in workspace (required)
  to: string | MultiTarget        // Target path in package (required)
  
  // Optional transformation fields (same as export)
  map?: Operation[]               // Map pipeline operations (includes $pipe for transforms)
  pick?: string[]
  omit?: string[]
  path?: string
  embed?: string
  section?: string
  when?: Condition
  merge?: "deep"|"shallow"|"replace"|"composite"
  namespace?: boolean | string
  handler?: string
}
```

**Key differences by command:**
- **`save`**: Only processes files tracked in workspace index (files previously exported)
- **`add`**: Processes any workspace file matching the pattern, regardless of index state

**Example:**
```jsonc
{
  "cursor": {
    "import": [
      {
        "from": ".cursor/commands/**/*.md",
        "to": "commands/**/*.md"
      },
      {
        "from": ".cursor/rules/**/*.mdc",
        "to": "rules/**/*.md"
      }
    ]
  }
}
```

When you run `opkg add .cursor/commands/deploy.md`, it:
1. Matches the file against `.cursor/commands/**/*.md` pattern
2. Extracts the relative path within the pattern (`deploy.md`)
3. Maps to package path `commands/deploy.md`
4. Copies to `.openpackage/commands/deploy.md`

### Required Fields

#### `from` (string)

Source file pattern relative to package root.

**Simple path:**
```jsonc
{ "from": "rules/code-quality.md" }
```

**Single-level glob:**
```jsonc
{ "from": "rules/*.md" }       // All .md files in rules/ only (not subdirs)
```

**Recursive glob:**
```jsonc
{ "from": "rules/**/*.md" }    // All .md files in rules/ and subdirectories
{ "from": "skills/**/*" }      // All files of any type, recursively
```

**Examples:**
```jsonc
{ "from": "config.yaml" }           // Single file
{ "from": "rules/*.md" }            // Top-level only
{ "from": "rules/**/*.md" }         // Recursive with extension filter
{ "from": "skills/**/*" }           // All files recursively
```

**Array with priority (first match wins):**
```jsonc
{ "from": ["mcp.jsonc", "mcp.json"] }  // Prefer .jsonc, fallback to .json
```

When an array of patterns is provided:
- Patterns are tried in order (first = highest priority)
- First matching pattern is used
- Subsequent patterns are skipped
- Warning logged if multiple patterns match
- Useful for format preferences or platform-specific fallbacks

**Array pattern use cases:**
```jsonc
// Format preference
{ "from": ["mcp.jsonc", "mcp.json"] }

// Platform-specific fallback
{ "from": ["config.cursor.json", "config.json"] }

// Version fallback
{ "from": ["config.v2.yaml", "config.yaml"] }
```

#### `to` (string | object)

Target file path relative to workspace root.

**Simple target:**
```jsonc
{ "to": ".cursor/rules/*.mdc" }       // Single-level glob with extension change
```

**Recursive target:**
```jsonc
{ "to": ".cursor/rules/**/*.mdc" }    // Preserves directory structure
```

**Multi-target object:**
```jsonc
{
  "to": {
    ".cursor/mcp.json": { "namespace": true, "merge": "deep" },
    ".opencode/config.json": { "embed": "mcp", "merge": "deep" },
    ".codex/config.toml": { "section": "mcp", "merge": "deep" }
  }
}
```

## Glob Patterns

The flow system supports powerful glob patterns for file matching:

### Single-Level Glob (`*`)

Matches files in a single directory level only:

```jsonc
{
  "from": "rules/*.md",
  "to": ".cursor/rules/*.md"
}
```

**Package structure:**
```
rules/
├── typescript.md     ← Matched
├── python.md         ← Matched
└── advanced/
    └── generics.md   ← NOT matched (in subdirectory)
```

**Result:**
```
.cursor/rules/
├── typescript.md
└── python.md
```

### Recursive Glob (`**`)

Matches files in all subdirectories recursively:

```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.md"
}
```

**Package structure:**
```
rules/
├── typescript.md
├── python.md
└── advanced/
    ├── generics.md
    └── types/
        └── unions.md
```

**Result (preserves structure):**
```
.cursor/rules/
├── typescript.md
├── python.md
└── advanced/
    ├── generics.md
    └── types/
        └── unions.md
```

**Key features:**
- `**` means "any number of directories" (including zero)
- Directory structure is fully preserved in target
- Relative paths maintained

### All Files Recursively (`**/*`)

Matches all files of any type:

```jsonc
{
  "from": "skills/**/*",
  "to": ".claude/skills/**/*"
}
```

**Package structure:**
```
skills/
├── code-review/
│   ├── analyze.md
│   ├── config.json
│   └── helpers/
│       ├── utils.ts
│       └── types.d.ts
└── testing/
    └── test-gen.md
```

**Result (all files copied):**
```
.claude/skills/
├── code-review/
│   ├── analyze.md
│   ├── config.json
│   └── helpers/
│       ├── utils.ts
│       └── types.d.ts
└── testing/
    └── test-gen.md
```

**Use cases:**
- Mixed file types (`.md`, `.json`, `.ts`, etc.)
- Complete directory replication
- Skills, tools, or utility directories

### Extension Mapping with Recursive Globs

Change file extensions while preserving structure:

```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.mdc"
}
```

**Package:**
```
rules/
├── typescript.md
└── advanced/
    └── generics.md
```

**Result:**
```
.cursor/rules/
├── typescript.mdc      ← Extension changed
└── advanced/
    └── generics.mdc    ← Extension changed
```

**Extension mapping rules:**
- Source extension specified: `/**/*.md`
- Target extension specified: `/**/*.mdc`
- All matched files get extension changed
- Works at any depth

### Common Patterns

#### Pattern 1: Recursive Rules with Extension Mapping
```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.mdc"
}
```
Use for: Cursor-style rules with nested structure

#### Pattern 2: Recursive Commands
```jsonc
{
  "from": "commands/**/*.md",
  "to": ".agent/workflows/**/*.md"
}
```
Use for: Commands organized in subdirectories

#### Pattern 3: Complete Skills Directory
```jsonc
{
  "from": "skills/**/*",
  "to": ".claude/skills/**/*"
}
```
Use for: Mixed file types with full structure

#### Pattern 4: Recursive Agents
```jsonc
{
  "from": "agents/**/*.md",
  "to": ".factory/droids/**/*.md"
}
```
Use for: Agent definitions with categories

### Glob Matching Behavior

#### Empty Matches

If no files match the pattern:
- Flow succeeds with warning
- No error thrown
- Warning: "No files matched pattern"

```jsonc
{
  "from": "nonexistent/**/*.md",
  "to": ".cursor/rules/**/*.md"
}
```
**Result:** Success, 0 files processed, warning logged

#### Case Sensitivity

Glob patterns are case-sensitive:
- `Rules/*.md` ≠ `rules/*.md`
- `README.md` ≠ `readme.md`

#### Hidden Files

Glob patterns do NOT match hidden files by default:
- `.gitignore` not matched by `*`
- `.config/**/*` not matched by `**/*`

To match hidden files explicitly:
```jsonc
{ "from": ".config/**/*" }
```

### Best Practices

#### 1. Use `**` for Nested Structures

**Good:**
```jsonc
{ "from": "rules/**/*.md" }
```

**Bad (misses nested files):**
```jsonc
{ "from": "rules/*.md" }
```

#### 2. Match Target Pattern to Source

**Good (consistent structure):**
```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.md"
}
```

**Bad (structure mismatch):**
```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/*.md"  // Wrong: single-level target
}
```

#### 3. Use `**/*` for Mixed Types

**Good (all files):**
```jsonc
{ "from": "skills/**/*" }
```

**Bad (only markdown):**
```jsonc
{ "from": "skills/**/*.md" }
```

#### 4. Prefer Recursive Patterns

Recommended approach:
```jsonc
{ "from": "rules/**/*.md" }
```

## Execution Pipeline

Flows execute through a multi-stage pipeline:

```
1. Load        → Read source file, detect format
2. Extract     → Apply JSONPath if specified
3. Filter      → Apply pick/omit on keys
4. Map         → Transform keys/values (includes $pipe operations)
5. Namespace   → Wrap in namespace if enabled
6. Embed       → Wrap under key/section if specified
7. Merge       → Merge with existing target
8. Write       → Serialize and write to disk
```

### Stage 1: Load

**Auto-detects format** from extension or content:
- `.json`, `.jsonc` → JSON parser
- `.yaml`, `.yml` → YAML parser
- `.toml` → TOML parser
- `.md` → Markdown with frontmatter parser

**Example:**
```yaml
# Source: config.yaml
theme: dark
fontSize: 14
```

### Stage 2: Extract (optional)

Apply **JSONPath** to extract subset:

```jsonc
{
  "from": "config.yaml",
  "to": ".cursor/config.json",
  "path": "$.editor"  // Extract only editor config
}
```

```yaml
# Source
editor:
  theme: dark
  fontSize: 14
terminal:
  shell: bash
```

**Result after extraction:**
```json
{
  "theme": "dark",
  "fontSize": 14
}
```

### Stage 3: Filter (optional)

**Pick** (whitelist) specific keys:
```jsonc
{
  "pick": ["theme", "fontSize"]  // Only include these keys
}
```

**Omit** (blacklist) specific keys:
```jsonc
{
  "omit": ["internal", "debug"]  // Exclude these keys
}
```

**Cannot use both** `pick` and `omit` in same flow.

### Stage 4: Map (optional)

Transform document fields using a **MongoDB-inspired pipeline**:

```jsonc
{
  "map": [
    { "$set": { "name": "$$filename" } },
    { "$rename": { "mcp": "mcpServers" } },
    { "$unset": "deprecated" }
  ]
}
```

**Map Pipeline** is an array of operations that execute sequentially on the document:

**Seven core operations:**
1. **`$set`** - Set field values (supports context variables like `$$filename`)
2. **`$rename`** - Rename fields (supports wildcards)
3. **`$unset`** - Remove fields
4. **`$switch`** - Pattern-based value replacement
5. **`$pipeline`** - Multi-step field transformation (MongoDB-aligned)
6. **`$copy`** - Copy field with optional transformation
7. **`$pipe`** - Apply transform registry operations (format conversions, validations)

**Example transformation:**
```jsonc
{
  "map": [
    { "$set": { "name": "$$filename" } },
    {
      "$switch": {
        "field": "model",
        "cases": [
          { "pattern": "anthropic/claude-sonnet-*", "value": "sonnet" }
        ],
        "default": "inherit"
      }
    }
  ]
}
```

**Before:**
```yaml
model: anthropic/claude-sonnet-4-20250514
```

**After:**
```yaml
name: code-reviewer
model: sonnet
```

See [Map Pipeline](./map-pipeline.md) for complete operation reference and [Flow Reference](./flow-reference.md#map-pipeline) for usage in flows.

### Stage 5: Transform (optional)

Apply **transform registry operations** using the `$pipe` operation within the map pipeline:

```jsonc
{
  "map": [
    { "$rename": { "old": "new" } },
    { "$pipe": ["json-to-toml"] }  // Apply transforms from registry
  ]
}
```

**Available transforms:**
- Format converters: `jsonc`, `yaml`, `toml`, `json-to-toml`, `toml-to-json`, `xml`, `ini`
- Filtering: `filter-comments`, `filter-empty`, `filter-null`
- Markdown: `sections`, `frontmatter`, `body`
- Validation: `validate`, `validate-schema(path)`

See [Map Pipeline](./map-pipeline.md#7-pipe---apply-transform-registry-operations) for `$pipe` details and 
[Flow Reference](./flow-reference.md#built-in-transforms) for all available transforms.

### Stage 6: Namespace (optional)

Wrap content under package-specific namespace:

```jsonc
{
  "namespace": true  // or string for custom namespace key
}
```

**Before:**
```json
{ "servers": { "db": {} } }
```

**After:**
```json
{
  "packages": {
    "@user/package-name": {
      "servers": { "db": {} }
    }
  }
}
```

**Purpose:** Prevent collisions when multiple packages target same file.

### Stage 7: Embed (optional)

Wrap content under specified key:

**JSON embedding:**
```jsonc
{
  "embed": "mcp"
}
```

```json
// Before: { "servers": {} }
// After:  { "mcp": { "servers": {} } }
```

**TOML sections:**
```jsonc
{
  "section": "mcp_servers"
}
```

```toml
# Before: [servers]
# After:  [mcp_servers]
```

### Stage 8: Merge

Combine with existing target file:

**Strategies:**
- `"deep"` - Recursively merge nested objects (default for objects)
- `"shallow"` - Merge only top-level keys
- `"replace"` - Overwrite entire file (default for arrays/primitives)

```jsonc
{
  "merge": "deep"
}
```

**Existing target:**
```json
{ "servers": { "db": {} } }
```

**Source content:**
```json
{ "servers": { "api": {} } }
```

**Result:**
```json
{
  "servers": {
    "db": {},   // Preserved from target
    "api": {}   // Added from source
  }
}
```

### Stage 9: Write

Serialize to target format and write to disk:
- Detects target format from extension
- Creates directories as needed
- Atomic write (temp file + rename)

## Format Conversion

Automatic bidirectional conversion between formats:

### YAML to JSON

```jsonc
{
  "from": "config.yaml",
  "to": ".cursor/config.json"
}
```

**Source (YAML):**
```yaml
theme: dark
fontSize: 14
```

**Target (JSON):**
```json
{
  "theme": "dark",
  "fontSize": 14
}
```

### JSONC to JSON

```jsonc
{
  "from": "settings.jsonc",
  "to": ".cursor/settings.json"
}
```

Comments are automatically stripped:

**Source (JSONC):**
```jsonc
{
  // User theme
  "theme": "dark"
}
```

**Target (JSON):**
```json
{
  "theme": "dark"
}
```

### JSON to TOML

```jsonc
{
  "from": "config.json",
  "to": ".codex/config.toml"
}
```

**Source (JSON):**
```json
{
  "server": {
    "host": "localhost",
    "port": 3000
  }
}
```

**Target (TOML):**
```toml
[server]
host = "localhost"
port = 3000
```

### Markdown Frontmatter

Transforms YAML frontmatter while preserving body:

```jsonc
{
  "from": "agents/**/*.md",
  "to": ".claude/agents/**/*.md",
  "map": {
    "role": "type"
  }
}
```

**Source:**
```markdown
---
role: assistant
model: claude-sonnet-4
---
# Agent Instructions
Help users with code reviews.
```

**Target:**
```markdown
---
type: assistant
model: claude-sonnet-4
---
# Agent Instructions
Help users with code reviews.
```

**Body is unchanged.**

## Merge Strategies

### Deep Merge

Recursively merge nested structures:

```jsonc
{ "merge": "deep" }
```

**Use when:**
- Composing configurations from multiple packages
- Preserving existing nested settings
- Adding keys at any depth

**Example:**
```json
// Target (existing)
{ "editor": { "theme": "dark", "fontSize": 12 } }

// Source (new)
{ "editor": { "fontSize": 14, "tabSize": 2 } }

// Result
{ "editor": { "theme": "dark", "fontSize": 14, "tabSize": 2 } }
```

### Shallow Merge

Merge only top-level keys:

```jsonc
{ "merge": "shallow" }
```

**Use when:**
- Replacing entire nested objects
- Avoiding deep merge complexity
- Clear ownership of nested structures

**Example:**
```json
// Target (existing)
{ "editor": { "theme": "dark" }, "terminal": { "shell": "bash" } }

// Source (new)
{ "editor": { "fontSize": 14 } }

// Result
{ "editor": { "fontSize": 14 }, "terminal": { "shell": "bash" } }
```

Note: `editor` object replaced entirely, `terminal` preserved.

### Replace

Completely overwrite target:

```jsonc
{ "merge": "replace" }
```

**Use when:**
- Source is authoritative
- Target should be discarded
- No composition needed

**Example:**
```json
// Target (existing) - ignored
{ "old": "config" }

// Source (new)
{ "new": "config" }

// Result
{ "new": "config" }
```


### Composite

Compose multiple package contributions using delimiters:

```jsonc
{ "merge": "composite" }
```

**Use when:**
- Multiple packages contribute to same text file
- Each package needs its own section
- Sections should be independently updatable
- Content outside package sections must be preserved

**Supported formats:**
- Markdown files with HTML comment delimiters
- Any text-based format with comment support

**Example:**
```markdown
// Target (existing)
# Instructions

<!-- package: @user/package-a -->
Instructions from Package A
<!-- -->

// Source (new package @user/package-b)
Instructions from Package B

// Result
# Instructions

<!-- package: @user/package-a -->
Instructions from Package A
<!-- -->

<!-- package: @user/package-b -->
Instructions from Package B
<!-- -->
```

**Update behavior:**
```markdown
// Target (existing)
<!-- package: @user/package-a -->
Old instructions from Package A
<!-- -->

<!-- package: @user/package-b -->
Instructions from Package B
<!-- -->

// Source (updated package @user/package-a)
New instructions from Package A

// Result
<!-- package: @user/package-a -->
New instructions from Package A
<!-- -->

<!-- package: @user/package-b -->
Instructions from Package B
<!-- -->
```

**Key features:**
- Each package's content wrapped in `<!-- package: name -->` ... `<!-- -->` markers
- Updates replace only that package's section
- Other packages' sections preserved
- Manual edits outside markers preserved
- Uninstalling removes only that package's section

**Common use cases:**
- Root files (AGENTS.md, CLAUDE.md, QWEN.md, WARP.md)
- Shared instruction files
- Multi-package documentation
- Composable configuration narratives

### Priority-Based Merging

When multiple packages write to same file:

**Priority order:**
1. Workspace content (highest)
2. Direct dependencies
3. Nested dependencies (shallower = higher priority)

**Conflicts:**
- Last writer wins (by priority)
- Warnings logged with package info

**Example:**
```
Package A (direct): { "servers": { "db": { "host": "localhost" } } }
Package B (direct): { "servers": { "db": { "port": 5432 } } }

Result: { "servers": { "db": { "host": "localhost", "port": 5432 } } }
Warning: "Package B merging with Package A in .cursor/mcp.json"
```

## Key Tracking for Uninstall

When flows use `merge: 'deep'` or `merge: 'shallow'`, the system automatically tracks which keys each package contributes to the target file. This enables precise removal during uninstall.

### How It Works

**During installation:**
1. Flow executes and merges content into target file
2. System extracts all top-level and nested keys written
3. Keys stored in workspace index with dot notation
4. Keys represent **transformed** paths (after `map` operations)

**During uninstall:**
1. Read tracked keys from workspace index
2. Load target file
3. Remove only the tracked keys
4. Clean up empty parent objects
5. Delete file if empty, otherwise save updated content

### Example: Key Transformation

Flow with key transformation:

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".opencode/opencode.json",
  "map": {
    "mcpServers.*": "mcp.*"  // Transform keys!
  },
  "merge": "deep"
}
```

**Package source:**
```json
{
  "mcpServers": {
    "server1": { "url": "http://localhost:3000" },
    "server2": { "url": "http://localhost:4000" }
  }
}
```

**Workspace index (after install):**
```yaml
files:
  mcp.jsonc:
    - target: .opencode/opencode.json
      merge: deep
      keys:
        - mcp.server1    # Note: transformed key, not mcpServers.server1
        - mcp.server2
```

**Target file after install:**
```json
{
  "mcp": {
    "server1": { "url": "http://localhost:3000" },
    "server2": { "url": "http://localhost:4000" }
  }
}
```

**On uninstall:**
- Keys `mcp.server1` and `mcp.server2` are removed
- If no other packages contributed to `mcp`, the entire object is removed
- Other top-level keys in the file are preserved

### Why Track Transformed Keys?

**The challenge:** Flows can transform keys using `map`:
- `servers.*` → `database.*`
- `config.*` → `settings.*`
- `mcpServers.*` → `mcp.*`

**The solution:** Track the **output** keys (after transformation), not the input keys. This works regardless of transformation complexity and allows precise removal without needing the original source.

### When Keys Are Tracked

**Keys tracked when:**
- ✅ Flow uses `merge: 'deep'`
- ✅ Flow uses `merge: 'shallow'`
- ✅ Target file will be shared by multiple packages

**Keys NOT tracked when:**
- ❌ `merge: 'replace'` - entire file owned by one package
- ❌ `merge: 'composite'` - delimiter-based tracking used
- ❌ Simple file copy - no merge involved

### Key Notation

Keys use dot notation for nested paths:

```
mcp.server1          → { mcp: { server1: {...} } }
editor.fontSize      → { editor: { fontSize: 14 } }
servers.db.host      → { servers: { db: { host: "..." } } }
```

### Parent Cleanup

When removing keys, empty parent objects are automatically cleaned up:

```json
// Before uninstall
{
  "mcp": {
    "server1": { "url": "..." },
    "server2": { "url": "..." }
  },
  "other": { "config": "..." }
}

// After uninstalling package with keys [mcp.server1, mcp.server2]
{
  "other": { "config": "..." }
}
// Note: entire "mcp" object removed because it became empty
```

### Multi-Package Scenarios

When multiple packages contribute to the same file:

**Package A installed:**
```json
{ "mcp": { "server1": {...}, "server2": {...} } }
```

**Package B installed (same file, different keys):**
```json
{ "mcp": { "server1": {...}, "server2": {...}, "server3": {...} } }
```

**Uninstall Package A:**
- Only removes keys tracked for Package A
- Package B's keys remain intact
- File not deleted because content remains

**Index tracking:**
```yaml
packages:
  package-a:
    files:
      mcp.jsonc:
        - target: .opencode/opencode.json
          merge: deep
          keys: [mcp.server1, mcp.server2]
  
  package-b:
    files:
      mcp.jsonc:
        - target: .opencode/opencode.json
          merge: deep
          keys: [mcp.server3]
```

See [Uninstall](../uninstall/README.md) for complete uninstall behavior.

## Conditional Execution

Execute flows based on conditions:

### Platform Check

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "when": { "platform": "cursor" }
}
```

Flow executes only if Cursor platform is detected.

### File Existence

```jsonc
{
  "from": "config.yaml",
  "to": ".cursor/config.json",
  "when": { "exists": ".cursor" }
}
```

Flow executes only if `.cursor` directory exists.

### Key Check

```jsonc
{
  "from": "settings.jsonc",
  "to": ".cursor/settings.json",
  "when": { "key": "cursor" }
}
```

Flow executes only if source has `cursor` key.

### Value Check

```jsonc
{
  "from": "config.yaml",
  "to": ".cursor/dev.json",
  "when": {
    "key": "env",
    "equals": "development"
  }
}
```

Flow executes only if `env === "development"`.

### Composite Conditions

**AND condition:**
```jsonc
{
  "when": {
    "and": [
      { "platform": "cursor" },
      { "exists": "mcp.jsonc" }
    ]
  }
}
```

**OR condition:**
```jsonc
{
  "when": {
    "or": [
      { "platform": "cursor" },
      { "platform": "claude" }
    ]
  }
}
```

## Multi-Target Flows

One source file can flow to multiple targets with different transforms:

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

**Behavior:**
- Source parsed once
- Each target gets independent transformation
- Failures isolated per target

## Namespace Isolation

Prevent package collisions:

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "namespace": true,
  "merge": "deep"
}
```

**Package A content:**
```json
{ "servers": { "db": {} } }
```

**Package B content:**
```json
{ "servers": { "api": {} } }
```

**Result:**
```json
{
  "packages": {
    "@user/package-a": {
      "servers": { "db": {} }
    },
    "@user/package-b": {
      "servers": { "api": {} }
    }
  }
}
```

**Custom namespace key:**
```jsonc
{ "namespace": "extensions" }
```

```json
{
  "extensions": {
    "@user/package-a": { /* ... */ }
  }
}
```

## Performance Optimizations

### Simple File Copy Bypass

Flows with no transforms skip pipeline:

```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.mdc"
}
```

**Optimized:** Direct file copy for simple extension changes, no content parsing.

### Parser Caching

Format parsers cached per file type within execution context.

### Single Source Parse

Multi-target flows parse source once:

```jsonc
{
  "from": "config.yaml",
  "to": {
    ".cursor/config.json": {},
    ".claude/config.json": {}
  }
}
```

**Optimized:** YAML parsed once, serialized twice.

### Lazy Evaluation

Conditional flows evaluated before loading source:

```jsonc
{
  "from": "large-file.json",
  "to": ".cursor/config.json",
  "when": { "platform": "claude" }  // False for Cursor
}
```

**Optimized:** File not loaded if condition false.

## Error Handling

### Parse Errors

```
Error: Failed to parse config.yaml: Invalid YAML syntax at line 5
```

**Solution:** Fix source file syntax.

### Transform Errors

```
Error: Transform 'unknown-transform' not found in pipe
Available: [jsonc, yaml, toml, merge, ...]
```

**Solution:** Use valid transform name from built-ins.

### Path Errors

```
Error: JSONPath '$.invalid..path' is invalid
```

**Solution:** Fix JSONPath syntax.

### Merge Conflicts

```
Warning: Package @user/b overwrites content from @user/a in .cursor/mcp.json
```

**Solution:** Check priority order or use namespace isolation.

## Best Practices

### 1. Start Simple

```jsonc
{
  "from": "rules/*.md",
  "to": ".cursor/rules/*.md"
}
```

Add transforms only when needed.

### 2. Test Incrementally

```bash
opkg install @user/package --dry-run
```

Preview changes before applying.

### 3. Use Merge for Composition

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "merge": "deep"
}
```

Allow multiple packages to compose content.

### 4. Isolate with Namespaces

```jsonc
{
  "namespace": true,
  "merge": "deep"
}
```

Prevent unintended conflicts.

### 5. Document Complex Flows

```jsonc
{
  // Transform MCP config for Cursor with namespacing
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "namespace": true,
  "merge": "deep"
}
```

## Export/Import Architecture

### Explicit Bidirectional Flows

Instead of automatic flow inversion, OpenPackage uses **explicit export and import flows**:

**Export flow (package → workspace):**
```jsonc
{
  "export": [
    {
      "from": ["mcp.jsonc", "mcp.json"],
      "to": ".claude/.mcp.json",
      "map": [
        { "$rename": { "mcp": "mcpServers" } }
      ]
    }
  ]
}
```

**Import flow (workspace → package):**
```jsonc
{
  "import": [
    {
      "from": [".claude/.mcp.json", ".claude/mcp.json"],
      "to": "mcp.jsonc",
      "map": [{ "$rename": { "mcpServers": "mcp" } }]
    }
  ]
}
```

### Benefits of Explicit Flows

1. **No inversion complexity** - Both directions explicitly defined
2. **Asymmetric transforms** - Different logic per direction (e.g., add metadata on export, strip on import)
3. **Array patterns both ways** - Full support for format preferences in both directions
4. **Lossy transforms** - Can use transforms that can't be automatically inverted
5. **Clear intent** - Reading config shows exactly what happens in each direction

### Universal Converter

The **Universal Platform Converter** allows installing platform-specific packages to any platform using **import flows** instead of flow inversion.

**Example scenario:**
- Install a Claude Code plugin (with `.claude/` directories)
- To Cursor platform (needs `.cursor/` directories)
- System uses Claude's **import flows** to convert `.claude/` → universal
- Then applies Cursor's **export flows** to convert universal → `.cursor/`

**No flow inversion needed** - Import flows are explicitly defined for this purpose.

**See:** [Universal Converter](./universal-converter.md) for complete details on cross-platform conversion.

## Next Steps

- **View complete flow options:** See [Flow Reference](./flow-reference.md)
- **Cross-platform conversion:** See [Universal Converter](./universal-converter.md)
- **See practical examples:** See [Examples](./examples.md)
- **Learn key mapping:** See [Flow Reference](./flow-reference.md#key-mapping)
- **Debug flows:** See [Troubleshooting](./troubleshooting.md)
