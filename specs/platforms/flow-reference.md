# Flow Reference

Complete technical reference for all flow fields, transforms, and options.

## Flow Schema

```typescript
interface Flow {
  // Required
  from: string
  to: string | MultiTargetFlows
  
  // Optional transforms
  map?: Operation[]  // Map pipeline (includes $pipe for transform registry ops)
  pick?: string[]
  omit?: string[]
  path?: string
  embed?: string
  section?: string
  when?: Condition
  merge?: "deep" | "shallow" | "replace" | "composite"
  namespace?: boolean | string
  handler?: string
}
```

## Required Fields

### `from` (string)

Source file pattern relative to package root.

**Pattern syntax:**
```jsonc
"rules/typescript.md"          // Exact file
"rules/*.md"                   // Single-level glob (files in rules/ only)
"rules/**/*.md"                // Recursive glob (all .md files in rules/ and subdirs)
"skills/**/*"                  // Recursive glob (all files in skills/ and subdirs)
```

**Glob pattern usage:**
```jsonc
// Single-level glob
{
  "from": "rules/*.md",
  "to": ".cursor/rules/*.mdc"  // * matches filename, changes extension
}

// Recursive glob with nested directories
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.mdc"  // Preserves nested directory structure
}

// All files recursively
{
  "from": "skills/**/*",
  "to": ".claude/skills/**/*"  // Copies all file types with full structure
}
```

**Examples:**
```jsonc
"config.yaml"                  // Single file
"rules/**/*.md"                // All markdown in rules/ and subdirectories
"agents/**/*.md"               // All agents, including nested directories
"commands/**/*.md"             // All commands with full directory structure
"skills/**/*"                  // All files in skills/, any type, nested
```

### `to` (string | object)

Target path(s) relative to workspace root.

**Single target with glob:**
```jsonc
{
  "to": ".cursor/rules/*.mdc"  // * matches source filename
}
```

**Recursive target with glob:**
```jsonc
{
  "to": ".cursor/rules/**/*.mdc"  // ** preserves directory structure
}
```

**Exact file mapping:**
```jsonc
{
  "to": "CLAUDE.md"  // Specific target file
}
```

**Multi-target:**
```jsonc
{
  "to": {
    ".cursor/mcp.json": {
      "namespace": true,
      "merge": "deep"
    },
    ".claude/config.json": {
      "embed": "mcp",
      "merge": "deep"
    }
  }
}
```

**Multi-target options:**
Each target key maps to an object with any flow options except `from`, `to`, and `handler`.

## Transform Fields

### `$pipe` (Map Operation)

Apply transform registry operations within the map pipeline using the `$pipe` operation.

**Example:**
```jsonc
{
  "map": [
    { "$rename": { "old": "new" } },
    { "$pipe": ["json-to-toml"] }
  ]
}
```

**Built-in transforms:**

#### Format Converters
- `jsonc` - Parse JSON with comments
- `json` - Parse/stringify JSON
- `yaml` - Parse/stringify YAML
- `toml` - Parse/stringify TOML
- `json-to-toml` - Convert JSON object to TOML string
- `toml-to-json` - Convert TOML string to JSON object
- `xml` - Parse/emit XML
- `ini` - Parse/emit INI

#### Filtering
- `filter-comments` - Remove comments from strings
- `filter-empty` - Remove empty objects/arrays
- `filter-null` - Remove null values

#### Markdown
- `sections` - Extract markdown sections
- `frontmatter` - Extract only frontmatter
- `body` - Extract only body content

#### Validation
- `validate` - Validate against basic schema
- `validate-schema(path)` - Validate against JSON schema at path

**Custom transforms:**
Register via `handler` field for complex logic.

### `map` (array)

MongoDB-inspired transformation pipeline for document field operations.

**Pipeline structure:**
```jsonc
{
  "map": [
    { "$operation1": config },
    { "$operation2": config },
    ...
  ]
}
```

**Core concept:** Map is an **array of operations** that execute sequentially on the entire document. Each operation performs a specific transformation.

#### Operation 1: `$set` - Set Field Values

Set one or more field values with context variable support:

```jsonc
// Single field with context variable
{ "$set": { "name": "$$filename" } }

// Multiple fields
{ "$set": { 
  "name": "$$filename",
  "version": "1.0.0"
}}

// Nested fields (dot notation)
{ "$set": { "config.model": "sonnet" } }
```

**Context variables** (use `$$` prefix):
- `$$filename` - Filename without extension
- `$$dirname` - Parent directory name
- `$$path` - Full relative path
- `$$ext` - File extension (including dot)
- `$$platform` - Target platform being installed to (e.g., "claude", "cursor")
- `$$source` - Source platform/format of the package (e.g., "claude-plugin", "openpackage")
- `$$targetRoot` - Absolute path where files are being installed (e.g., `/Users/john/project` or `/Users/john` for global)

#### Operation 2: `$rename` - Rename Fields

Rename fields with wildcard support:

```jsonc
// Simple rename
{ "$rename": { "oldName": "newName" } }

// Multiple renames
{ "$rename": { 
  "old1": "new1",
  "old2": "new2"
}}

// Nested paths
{ "$rename": { "config.ai.model": "settings.model" } }
```

**Before:**
```json
{ "mcp": { "server1": {}, "server2": {} } }
```

**After:**
```json
{ "mcpServers": { "server1": {}, "server2": {} } }
```

#### Operation 3: `$unset` - Remove Fields

Remove one or more fields:

```jsonc
// Single field
{ "$unset": "permission" }

// Multiple fields
{ "$unset": ["permission", "legacy", "temp"] }

// Nested field
{ "$unset": "config.deprecated" }
```

#### Operation 4: `$switch` - Pattern Matching

Conditional field replacement based on patterns. **First match wins.**

```jsonc
{
  "$switch": {
    "field": "model",
    "cases": [
      { "pattern": "anthropic/claude-sonnet-*", "value": "sonnet" },
      { "pattern": "anthropic/claude-opus-*", "value": "opus" }
    ],
    "default": "inherit"
  }
}
```

**Pattern types:**
- **String patterns**: Glob syntax (`*`, `?`)
- **Object patterns**: Match object shape
  - `{ "edit": "deny", "bash": "deny" }` - exact match
  - `{ "*": "deny" }` - all values must be "deny"
- **Wildcard**: `"*"` matches anything

**Before:**
```yaml
model: anthropic/claude-sonnet-4-20250514
```

**After:**
```yaml
model: sonnet
```

#### Operation 5: `$pipeline` - Field Transformation Pipeline

Transform a field through a pipeline of MongoDB-aligned operations:

```jsonc
{
  "$pipeline": {
    "field": "tools",
    "operations": [
      { "$filter": { "match": { "value": true } } },
      { "$objectToArray": { "extract": "keys" } },
      { "$map": { "each": "capitalize" } },
      { "$reduce": { "type": "join", "separator": ", " } }
    ]
  }
}
```

**Pipeline operations:**

| Operation | Purpose | Example |
|-----------|---------|---------|
| `{ "$filter": { "match": { "value": X } } }` | Keep entries where value equals X | Filter true values |
| `{ "$filter": { "match": { "key": X } } }` | Keep entries where key equals X | Filter by key name |
| `{ "$objectToArray": { "extract": "keys" } }` | Extract object keys to array | `{a:1, b:2}` → `["a","b"]` |
| `{ "$objectToArray": { "extract": "values" } }` | Extract values to array | `{a:1, b:2}` → `[1,2]` |
| `{ "$objectToArray": { "extract": "entries" } }` | Convert to entries | `{a:1}` → `[["a",1]]` |
| `{ "$map": { "each": "capitalize" } }` | Transform each element | Capitalize strings |
| `{ "$map": { "each": "uppercase" } }` | Transform each element | Uppercase strings |
| `{ "$map": { "each": "lowercase" } }` | Transform each element | Lowercase strings |
| `{ "$reduce": { "type": "join", "separator": "," } }` | Join array to string | Join with separator |
| `{ "$reduce": { "type": "split", "separator": "," } }` | Split string to array | Split by separator |
| `{ "$arrayToObject": { "value": X } }` | Array to object | `["a","b"]` → `{a:X, b:X}` |
| `{ "$replace": { "pattern": "...", "with": "..." } }` | Regex replace | String transformation |

**Before:**
```yaml
tools:
  write: false
  bash: true
  read: true
```

**After:**
```yaml
tools: Bash, Read
```

#### Operation 6: `$copy` - Copy with Transformation

Copy a field with optional pattern-based transformation:

```jsonc
{
  "$copy": {
    "from": "permission",
    "to": "permissionMode",
    "transform": {
      "cases": [
        { "pattern": { "edit": "deny", "bash": "deny" }, "value": "plan" },
        { "pattern": { "*": "deny" }, "value": "ignore" }
      ],
      "default": "default"
    }
  }
}
```

**Combine with `$unset` to replace fields:**

```jsonc
[
  { "$copy": { "from": "old", "to": "new" } },
  { "$unset": "old" }
]
```

#### Complete Pipeline Example

```jsonc
{
  "from": "agents/**/*.md",
  "to": ".claude/agents/**/*.md",
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
    },
    {
      "$pipeline": {
        "field": "tools",
        "operations": [
          { "$filter": { "match": { "value": true } } },
          { "$objectToArray": { "extract": "keys" } },
          { "$map": { "each": "capitalize" } },
          { "$reduce": { "type": "join", "separator": ", " } }
        ]
      }
    },
    {
      "$copy": {
        "from": "permission",
        "to": "permissionMode",
        "transform": {
          "cases": [
            { "pattern": { "edit": "deny", "bash": "deny" }, "value": "plan" }
          ],
          "default": "default"
        }
      }
    },
    { "$unset": "permission" }
  ]
}
```

**Schema:** Map pipelines are validated against `schemas/map-pipeline-v1.json`.

**See also:** [Map Pipeline Guide](./map-pipeline.md) for comprehensive documentation and examples.

### `pick` (string[])

Whitelist specific keys (extract only these).

**Example:**
```jsonc
{
  "pick": ["theme", "fontSize", "tabSize"]
}
```

**Before:**
```json
{
  "theme": "dark",
  "fontSize": 14,
  "internal": "debug",
  "deprecated": true
}
```

**After:**
```json
{
  "theme": "dark",
  "fontSize": 14
}
```

**Nested keys:**
```jsonc
{
  "pick": ["editor.theme", "editor.fontSize"]
}
```

**Cannot use with `omit`.**

### `omit` (string[])

Blacklist specific keys (exclude these).

**Example:**
```jsonc
{
  "omit": ["internal", "debug", "deprecated"]
}
```

**Before:**
```json
{
  "theme": "dark",
  "fontSize": 14,
  "internal": "debug"
}
```

**After:**
```json
{
  "theme": "dark",
  "fontSize": 14
}
```

**Cannot use with `pick`.**

### `path` (string)

JSONPath expression to extract subset of data.

**Syntax:** JSONPath (subset of XPath for JSON)

**Example:**
```jsonc
{
  "path": "$.editor"
}
```

**Before:**
```json
{
  "editor": {
    "theme": "dark",
    "fontSize": 14
  },
  "terminal": {
    "shell": "bash"
  }
}
```

**After:**
```json
{
  "theme": "dark",
  "fontSize": 14
}
```

**Common expressions:**
```jsonc
"$.editor"           // Extract editor object
"$.servers.*"        // All servers
"$.servers[0]"       // First server
"$.servers[?(@.enabled)]"  // Servers where enabled=true
```

**Libraries:** Typically uses `jsonpath-plus` or similar.

### `embed` (string)

Wrap content under specified key.

**Example:**
```jsonc
{
  "embed": "mcp"
}
```

**Before:**
```json
{ "servers": { "db": {} } }
```

**After:**
```json
{
  "mcp": {
    "servers": { "db": {} }
  }
}
```

**Use case:** Embed package content in larger configuration structure.

**With merge:**
```jsonc
{
  "embed": "mcp",
  "merge": "deep"
}
```

**Existing target:**
```json
{ "other": "config" }
```

**Result:**
```json
{
  "other": "config",
  "mcp": {
    "servers": { "db": {} }
  }
}
```

### `section` (string)

TOML section name for embedding.

**Example:**
```jsonc
{
  "section": "mcp_servers"
}
```

**Before (JSON):**
```json
{ "host": "localhost", "port": 5432 }
```

**After (TOML):**
```toml
[mcp_servers]
host = "localhost"
port = 5432
```

**Use case:** Convert JSON/YAML to TOML sections.

### `when` (object)

Conditional execution based on context.

**Condition types:**

#### Platform check
```jsonc
{
  "when": { "platform": "cursor" }
}
```

Executes only if Cursor platform detected.

#### File existence
```jsonc
{
  "when": { "exists": ".cursor" }
}
```

Executes only if `.cursor` directory exists.

#### Key existence
```jsonc
{
  "when": { "key": "servers" }
}
```

Executes only if source has `servers` key.

#### Value equality
```jsonc
{
  "when": {
    "key": "env",
    "equals": "production"
  }
}
```

Executes only if `env` field equals `"production"`.

#### Variable equality ($eq)
```jsonc
{
  "when": {
    "$eq": ["$$platform", "claude"]
  }
}
```

Compare two values for equality. Supports context variables with `$$` prefix.

**Path-aware comparison:**
When either value looks like a filesystem path, automatic path comparison is used:
- Tilde expansion (`~/` → home directory)
- Path normalization
- Glob pattern matching

**Examples:**
```jsonc
// Check if installing to home directory
{ "when": { "$eq": ["$$targetRoot", "~/"] } }

// Check if installing to specific path
{ "when": { "$eq": ["$$targetRoot", "/opt/config"] } }

// Glob pattern matching
{ "when": { "$eq": ["$$targetRoot", "/tmp/*"] } }

// Platform check
{ "when": { "$eq": ["$$platform", "claude"] } }
```

#### Variable inequality ($ne)
```jsonc
{
  "when": {
    "$ne": ["$$targetRoot", "~/"]
  }
}
```

Compare two values for inequality. Uses same path-aware logic as `$eq`.

**Example:**
```jsonc
// Only execute if NOT installing to home directory
{ "when": { "$ne": ["$$targetRoot", "~/"] } }
```

#### Composite AND
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

All conditions must be true.

**Example with path check:**
```jsonc
{
  "when": {
    "and": [
      { "$eq": ["$$platform", "claude"] },
      { "$eq": ["$$targetRoot", "~/"] }
    ]
  }
}
```

#### Composite OR
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

Any condition can be true.

**Schema:**
```typescript
type Condition = 
  | { platform: string }
  | { exists: string }
  | { key: string; equals?: any }
  | { $eq: [string, string] }  // Variable equality with path awareness
  | { $ne: [string, string] }  // Variable inequality with path awareness
  | { and: Condition[] }
  | { or: Condition[] }
  | { not: Condition }
```

### `merge` (string)

Merge strategy when target file exists.

**Options:**
- `"deep"` - Recursive merge (default for objects)
- `"shallow"` - Top-level merge only
- `"replace"` - Overwrite entirely (default for primitives/arrays)
- `"composite"` - Compose multiple packages using delimiters

**Deep merge:**
```jsonc
{ "merge": "deep" }
```

**Existing:**
```json
{
  "servers": {
    "db": { "host": "localhost" }
  }
}
```

**New:**
```json
{
  "servers": {
    "db": { "port": 5432 },
    "api": { "host": "api.example.com" }
  }
}
```

**Result:**
```json
{
  "servers": {
    "db": { "host": "localhost", "port": 5432 },
    "api": { "host": "api.example.com" }
  }
}
```

**Shallow merge:**
```jsonc
{ "merge": "shallow" }
```

**Result (shallow):**
```json
{
  "servers": {
    "db": { "port": 5432 },
    "api": { "host": "api.example.com" }
  }
}
```

Note: `db` object replaced entirely.

**Replace:**
```jsonc
{ "merge": "replace" }
```

**Result:**
```json
{
  "servers": {
    "db": { "port": 5432 },
    "api": { "host": "api.example.com" }
  }
}
```

Entire file replaced.

### `namespace` (boolean | string)

Wrap content under package-specific namespace.

**Boolean (auto-generate key):**
```jsonc
{
  "namespace": true
}
```

**Result:**
```json
{
  "packages": {
    "@user/package-name": {
      /* content */
    }
  }
}
```

**String (custom namespace key):**
```jsonc
{
  "namespace": "extensions"
}
```

**Result:**
```json
{
  "extensions": {
    "@user/package-name": {
      /* content */
    }
  }
}
```

**Use case:** Prevent collisions when multiple packages write to same file.

**With merge:**
```jsonc
{
  "namespace": true,
  "merge": "deep"
}
```

Merges namespaced content from multiple packages.

### `handler` (string)

Custom handler function for complex transformations.

**Example:**
```jsonc
{
  "handler": "custom-mcp-transform"
}
```

**Use case:** Complex logic not expressible via declarative options.

**Registration:**
```typescript
// In CLI code
registerHandler("custom-mcp-transform", (source, context) => {
  // Custom transformation logic
  return transformed;
});
```

**Not available in user configurations** - requires CLI code changes.

## Value Transforms

Used in `map` field for value transformations.

### Type Converters

- `number` - Convert to number
- `string` - Convert to string
- `boolean` - Convert to boolean
- `json` - Parse JSON string to object
- `date` - Parse date string to Date

**Example:**
```jsonc
{
  "map": {
    "fontSize": {
      "to": "editor.fontSize",
      "transform": "number"
    }
  }
}
```

### String Transforms

- `uppercase` - Convert to UPPERCASE
- `lowercase` - Convert to lowercase
- `title-case` - Convert To Title Case
- `camel-case` - Convert to camelCase
- `kebab-case` - Convert to kebab-case
- `snake-case` - Convert to snake_case
- `trim` - Remove leading/trailing whitespace
- `slugify` - Create URL-safe slug

**Example:**
```jsonc
{
  "map": {
    "name": {
      "to": "id",
      "transform": "kebab-case"
    }
  }
}
```

**Before:**
```json
{ "name": "My Custom Rule" }
```

**After:**
```json
{ "id": "my-custom-rule" }
```

### Array Transforms

- `array-append` - Append to existing array
- `array-unique` - Remove duplicates
- `array-flatten` - Flatten nested arrays

**Example:**
```jsonc
{
  "map": {
    "tags": {
      "to": "categories",
      "transform": "array-unique"
    }
  }
}
```

**Before:**
```json
{ "tags": ["typescript", "quality", "typescript"] }
```

**After:**
```json
{ "categories": ["typescript", "quality"] }
```

### Object Transforms

- `flatten` - Flatten nested object to dot notation
- `unflatten` - Expand dot notation to nested object
- `pick-keys` - Extract specific keys
- `omit-keys` - Remove specific keys

**Flatten example:**
```jsonc
{
  "map": {
    "config": {
      "to": "settings",
      "transform": "flatten"
    }
  }
}
```

**Before:**
```json
{
  "config": {
    "editor": { "theme": "dark" }
  }
}
```

**After:**
```json
{
  "settings": {
    "editor.theme": "dark"
  }
}
```

## Complete Examples

### Example 1: Simple File Copy with Extension Change

```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.mdc"
}
```

**Behavior:**
- Recursively copies all `.md` files from `rules/` directory and subdirectories
- Preserves nested directory structure
- Changes extension from `.md` to `.mdc`
- No content transformation

**Example structure:**
```
Package:                      Workspace:
rules/                        .cursor/rules/
├── typescript.md      →      ├── typescript.mdc
├── advanced/          →      ├── advanced/
│   └── generics.md    →      │   └── generics.mdc
└── basic/             →      └── basic/
    └── variables.md   →          └── variables.mdc
```

### Example 2: Format Conversion with Key Mapping

```jsonc
{
  "from": "settings.yaml",
  "to": ".cursor/settings.json",
  "map": {
    "theme": "workbench.colorTheme",
    "fontSize": "editor.fontSize"
  },
  "merge": "deep"
}
```

**Behavior:**
- Converts YAML to JSON
- Remaps keys to nested paths
- Deep merges with existing settings

### Example 3: Multi-Package MCP Composition

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "namespace": true,
  "merge": "deep"
}
```

**Behavior:**
- Wraps content under `packages.{packageName}`
- Merges with other packages
- Prevents naming conflicts

### Example 4: Conditional Platform Flow

```jsonc
{
  "from": "config.yaml",
  "to": ".cursor/config.json",
  "when": {
    "and": [
      { "platform": "cursor" },
      { "exists": "config.yaml" }
    ]
  },
  "merge": "deep"
}
```

**Behavior:**
- Executes only for Cursor platform
- Checks source file exists
- Deep merges configuration

### Example 5: Multi-Target with Different Transforms

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
- Parses source once
- Cursor: Namespaced JSON
- OpenCode: Embedded in JSON
- Codex: Extracted servers in TOML section

### Example 6: Markdown Frontmatter Transform

```jsonc
{
  "from": "agents/**/*.md",
  "to": ".claude/agents/**/*.md",
  "map": [
    { "$set": { "name": "$$filename" } },
    {
      "$switch": {
        "field": "model",
        "cases": [
          { "pattern": "anthropic/claude-sonnet-*", "value": "sonnet" },
          { "pattern": "anthropic/claude-opus-*", "value": "opus" }
        ],
        "default": "inherit"
      }
    }
  ]
}
```

**Behavior:**
- Transforms YAML frontmatter using map pipeline
- Sets `name` from filename
- Transforms model field using pattern matching
- Preserves markdown body

### Example 7: Recursive Directory Copy with Mixed File Types

```jsonc
{
  "from": "skills/**/*",
  "to": ".claude/skills/**/*"
}
```

**Behavior:**
- Recursively copies all files from `skills/` directory
- Preserves all file types (.md, .ts, .json, etc.)
- Maintains complete directory structure
- No content transformation

**Example structure:**
```
Package:                           Workspace:
skills/                            .claude/skills/
├── code-review/            →      ├── code-review/
│   ├── analyze.md          →      │   ├── analyze.md
│   ├── config.json         →      │   ├── config.json
│   └── helpers/            →      │   └── helpers/
│       └── utils.ts        →      │       └── utils.ts
└── testing/                →      └── testing/
    └── test-gen.md         →          └── test-gen.md
```

### Example 8: Complex Map Pipeline

```jsonc
{
  "from": "config.jsonc",
  "to": ".cursor/config.json",
  "pick": ["editor", "terminal"],
  "map": [
    { "$rename": { "editor.theme": "workbench.colorTheme" } },
    { "$pipe": ["filter-empty", "filter-null"] }
  ],
  "merge": "deep"
}
```

**Behavior:**
- Extracts only `editor` and `terminal` keys
- Renames nested theme key using map pipeline
- Filters empty/null values using $pipe operation
- Deep merges result

### Example 9: Conditional Installation Based on Target Directory

```jsonc
{
  "from": ["mcp.jsonc", "mcp.json"],
  "to": ".mcp.json",
  "when": {
    "$ne": ["$$targetRoot", "~/"]
  },
  "merge": "deep"
},
{
  "from": ["mcp.jsonc", "mcp.json"],
  "to": ".claude.json",
  "when": {
    "$eq": ["$$targetRoot", "~/"]
  },
  "merge": "deep"
}
```

**Behavior:**
- First flow: Install to `.mcp.json` when NOT in home directory (workspace installation)
- Second flow: Install to `.claude.json` when in home directory (global installation with `--global` flag)
- Uses path-aware comparison with tilde expansion
- Enables different configuration files based on installation scope

**Usage:**
```bash
# Workspace installation → .mcp.json
opkg install claude-mcp-plugin

# Global installation → .claude.json  
opkg install --global claude-mcp-plugin
```

## Best Practices

### 1. Keep Flows Simple

Start with minimal options:
```jsonc
{ "from": "rules/**/*.md", "to": ".platform/rules/**/*.md" }
```

Add complexity only when needed.

### 2. Use Merge for Composition

Enable multiple packages to coexist:
```jsonc
{ "merge": "deep" }
```

### 3. Namespace for Safety

Prevent conflicts:
```jsonc
{ "namespace": true, "merge": "deep" }
```

### 4. Test Conditionals

Ensure conditions work as expected:
```bash
opkg install @user/package --dry-run
```

### 5. Document Complex Flows

Add comments explaining intent:
```jsonc
{
  // Transform MCP config with namespacing for multi-package support
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "namespace": true,
  "merge": "deep"
}
```

### 6. Validate Configurations

Always validate before deploying:
```bash
opkg validate platforms --strict
```

## Performance Tips

- **Simple flows are fastest** - Direct copy when possible
- **Avoid deep merges** if shallow merge sufficient
- **Use conditionals** to skip unnecessary work
- **Multi-target flows reuse parsing** - More efficient than separate flows

## Troubleshooting

### Flow Not Executing

**Check conditions:**
```bash
opkg list  # Shows detected platforms
```

**Check syntax:**
```bash
opkg validate platforms
```

### Merge Not Working

**Remember merge strategy:**
- Default is `replace` for arrays/primitives
- Use `"merge": "deep"` explicitly for objects

### Keys Not Mapping

**Check dot notation:**
```jsonc
"theme": "workbench.colorTheme"  // Correct
"theme": "workbench/colorTheme"  // Wrong
```

### Transform Not Found

**Check transform name:**
```bash
opkg validate platforms --strict
```

Shows available transforms.

## Next Steps

- **See practical examples:** [Examples](./examples.md)
- **Learn platform detection:** [Detection](./detection.md)
- **Debug issues:** [Troubleshooting](./troubleshooting.md)
