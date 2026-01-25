# Platform Configuration

## Configuration File

The platform system is configured through a single file: **`platforms.jsonc`**

### File Locations

Three configuration files are merged in priority order:

1. **Built-in** (lowest priority)
   - Location: `<cli-install>/platforms.jsonc`
   - Contains: Default configurations for 13 platforms
   - Ships with: CLI installation

2. **Global** (middle priority)
   - Location: `~/.openpackage/platforms.jsonc` or `~/.openpackage/platforms.json`
   - Purpose: User-wide customizations
   - Use case: Personal preferences, custom platforms

3. **Workspace** (highest priority)
   - Location: `<workspace>/.openpackage/platforms.jsonc` or `<workspace>/.openpackage/platforms.json`
   - Purpose: Project-specific overrides
   - Use case: Disable platforms, custom flows, team standards

### File Format

Supports both JSONC (with comments) and JSON:

```jsonc
// platforms.jsonc
{
  "$schema": "./node_modules/opkg-cli/schemas/platforms-v1.json",
  
  "global": {
    "export": [ /* universal export flows */ ],
    "import": [ /* universal import flows */ ]
  },
  
  "cursor": {
    "name": "Cursor",
    "rootDir": ".cursor",
    "export": [ /* package → workspace flows */ ],
    "import": [ /* workspace → package flows */ ]
  }
}
```

**Note:** If both `.jsonc` and `.json` exist, `.jsonc` takes precedence.

## Configuration Schema

### Top-Level Structure

```typescript
interface PlatformsConfig {
  $schema?: string                    // Optional: JSON Schema reference
  global?: {                          // Optional: Universal flows
    export?: Flow[]                   // Package → Workspace
    import?: Flow[]                   // Workspace → Package
  }
  [platformId: string]: {             // Per-platform definitions
    name: string
    rootDir: string
    rootFile?: string
    aliases?: string[]
    enabled?: boolean
    export?: Flow[]                   // Package → Workspace
    import?: Flow[]                   // Workspace → Package
  }
}
```

### Platform Entry

Each platform is defined by a top-level key (lowercase, kebab-case):

```jsonc
{
  "cursor": {                          // Platform ID (required, unique)
    "name": "Cursor",                  // Display name (required)
    "rootDir": ".cursor",              // Root directory (required)
    "rootFile": "CURSOR.md",           // Optional root file
    "aliases": ["cursorcli"],          // Optional CLI shortcuts
    "enabled": true,                   // Optional (default: true)
    "export": [                        // Export flows (package → workspace)
      { "from": "...", "to": "..." }
    ],
    "import": [                        // Import flows (workspace → package)
      { "from": "...", "to": "..." }
    ]
  }
}
```

#### Required Fields

- **`name`** (string) - Human-readable display name
  - Example: `"Cursor"`, `"Claude Code"`, `"Windsurf"`

- **`rootDir`** (string) - Platform root directory
  - Example: `".cursor"`, `".claude"`, `".windsurf"`
  - Used for: Detection and file path resolution

#### Optional Fields

- **`export`** (array) - Export flows (package → workspace, used by install/apply)
  - Minimum: Empty array `[]` (no install/apply transformations)
  - See: [Flows](./flows.md) for flow schema

- **`import`** (array) - Import flows (workspace → package, used by save)
  - Minimum: Empty array `[]` (no save transformations)
  - See: [Flows](./flows.md) for flow schema

**Note:** At least one of `export`, `import`, or `rootFile` must be defined.

#### Optional Fields

- **`rootFile`** (string) - Root file at project root
  - Example: `"CLAUDE.md"`, `"GEMINI.md"`
  - Used for: Additional detection signal

- **`aliases`** (string[]) - CLI-friendly shortcuts
  - Example: `["cursorcli", "cursor-editor"]`
  - Case-insensitive matching

- **`enabled`** (boolean) - Platform activation flag
  - Default: `true`
  - Use case: Disable built-in platforms without removing config

### Global Flows

Optional section for universal transformations that apply to all platforms:

```jsonc
{
  "global": {
    "flows": [
      { "from": "AGENTS.md", "to": "AGENTS.md" },
      { "from": "README.md", "to": "README.md" }
    ]
  }
}
```

**Execution order:**
1. Global flows execute first
2. Platform-specific flows execute second

**Use cases:**
- Universal documentation files
- Shared configuration files
- Cross-platform root files

## Merge Behavior

### Merge Strategy

Configurations are **deep merged** with last-writer-wins semantics:

```
workspace config
  ↓ merges over
global config
  ↓ merges over
built-in config
```

### Platform-Level Merging

**Add new platform:**
```jsonc
// workspace/.openpackage/platforms.jsonc
{
  "my-custom-platform": {
    "name": "My Platform",
    "rootDir": ".myplatform",
    "flows": [ /* ... */ ]
  }
}
```

**Override existing platform:**
```jsonc
// workspace/.openpackage/platforms.jsonc
{
  "cursor": {
    "flows": [
      // Completely replaces built-in flows
      { "from": "rules/*.md", "to": ".cursor/custom/*.md" }
    ]
  }
}
```

**Disable platform:**
```jsonc
// workspace/.openpackage/platforms.jsonc
{
  "windsurf": {
    "enabled": false  // Platform exists but won't execute
  }
}
```

### Field-Level Merging

| Field | Merge Behavior | Example |
|-------|----------------|---------|
| `name` | Replace | Workspace value replaces built-in |
| `rootDir` | Replace | Workspace value replaces built-in |
| `rootFile` | Replace | Workspace value replaces built-in |
| `aliases` | Replace | Workspace array replaces built-in array |
| `enabled` | Replace | Workspace boolean replaces built-in |
| `flows` | Replace | Workspace flows replace built-in flows entirely |

**Important:** Flows are **not merged** at array level. The entire `flows` array is replaced.

### Global Flows Merging

Global flows are merged at the array level:

```jsonc
// built-in
{ "global": { "flows": [A, B] } }

// workspace override
{ "global": { "flows": [C] } }

// result
{ "global": { "flows": [C] } }  // Workspace replaces built-in
```

## Validation

### Load-Time Validation

Configurations are validated when loaded:

- **Required fields** - Must be present and non-empty
- **Type checking** - Fields must match expected types
- **Unique IDs** - Platform IDs must be unique
- **Flow schema** - Each flow must be valid

**On error:**
```
Error: Platform 'cursor': missing required field 'rootDir'
Error: Platform 'claude': invalid flow at index 2: missing 'from' field
```

### Manual Validation

Validate configuration explicitly:

```bash
# Validate current workspace configuration
opkg validate platforms

# Strict mode (comprehensive checks)
opkg validate platforms --strict
```

**Validation checks:**
- Schema compliance
- Required fields present
- Valid transform names
- Valid JSONPath expressions
- No circular dependencies

## Schema Versioning

### JSON Schema Reference

Reference the JSON Schema for IDE support:

```jsonc
{
  "$schema": "./node_modules/opkg-cli/schemas/platforms-v1.json",
  
  "cursor": { /* ... */ }
}
```

**Benefits:**
- Autocomplete in VS Code, Cursor, etc.
- Inline error detection
- Field documentation on hover

### Schema Versions

- **v1** - Current version with flows-based configuration
- Version inferred from schema path or CLI version

### Schema Location Options

**Relative to node_modules:**
```jsonc
{ "$schema": "./node_modules/opkg-cli/schemas/platforms-v1.json" }
```

**Relative to workspace:**
```jsonc
{ "$schema": "./schemas/platforms-v1.json" }
```

**Absolute URL (for global config):**
```jsonc
{ "$schema": "https://cdn.openpackage.ai/schemas/platforms-v1.json" }
```

## Common Configuration Patterns

### Pattern 1: Global Override

Customize a built-in platform for all projects:

```jsonc
// ~/.openpackage/platforms.jsonc
{
  "cursor": {
    "flows": [
      {
        "from": "rules/*.md",
        "to": ".cursor/my-rules/*.mdc"
      }
    ]
  }
}
```

### Pattern 2: Workspace Customization

Override for specific project:

```jsonc
// <workspace>/.openpackage/platforms.jsonc
{
  "cursor": {
    "rootDir": ".cursor-custom",  // Non-standard directory
    "flows": [
      { "from": "rules/*.md", "to": ".cursor-custom/rules/*.md" }
    ]
  }
}
```

### Pattern 3: Custom Platform

Add support for proprietary platform:

```jsonc
// <workspace>/.openpackage/platforms.jsonc
{
  "my-ai-platform": {
    "name": "My AI Platform",
    "rootDir": ".myai",
    "rootFile": "MYAI.md",
    "flows": [
      { "from": "rules/*.md", "to": ".myai/prompts/*.md" },
      { "from": "agents/*.md", "to": ".myai/assistants/*.yaml" }
    ]
  }
}
```

### Pattern 4: Disable Platforms

Prevent flows from executing:

```jsonc
// <workspace>/.openpackage/platforms.jsonc
{
  "windsurf": { "enabled": false },
  "cline": { "enabled": false },
  "roo-code": { "enabled": false }
}
```

### Pattern 5: Minimal Override

Keep built-in flows but change one setting:

```jsonc
// <workspace>/.openpackage/platforms.jsonc
{
  "cursor": {
    "rootDir": ".cursor-v2"
    // Note: Must re-specify flows or they'll be lost
  }
}
```

**Warning:** Partial overrides require re-specifying `flows` array.

## Adding Custom Platforms

### Step 1: Define Platform

Create workspace config:

```jsonc
// <workspace>/.openpackage/platforms.jsonc
{
  "my-platform": {
    "name": "My Platform",
    "rootDir": ".myplatform",
    "flows": []  // Start with empty flows
  }
}
```

### Step 2: Create Platform Directory

```bash
mkdir .myplatform
```

### Step 3: Add Flows

```jsonc
{
  "my-platform": {
    "name": "My Platform",
    "rootDir": ".myplatform",
    "flows": [
      {
        "from": "rules/*.md",
        "to": ".myplatform/rules/*.md"
      }
    ]
  }
}
```

### Step 4: Test

```bash
# Validate configuration
opkg validate platforms

# Test with dry-run
opkg install @user/some-package --dry-run
```

### Step 5: Iterate

Add more flows as needed. See [Flow Reference](./flow-reference.md) for all options.

## Configuration Tips

### 1. Start Simple

Begin with minimal flows and add complexity incrementally:

```jsonc
{
  "flows": [
    { "from": "rules/*.md", "to": ".platform/rules/*.md" }
  ]
}
```

### 2. Test Changes

Always validate and dry-run:

```bash
opkg validate platforms --strict
opkg install @user/package --dry-run
```

### 3. Version Control

Commit workspace config to share with team:

```bash
git add .openpackage/platforms.jsonc
```

### 4. Document Overrides

Add comments explaining why you override:

```jsonc
{
  "cursor": {
    // Custom directory structure for monorepo
    "rootDir": ".cursor-workspace",
    "flows": [ /* ... */ ]
  }
}
```

### 5. Use Schema

Reference schema for IDE support:

```jsonc
{
  "$schema": "./node_modules/opkg-cli/schemas/platforms-v1.json"
}
```

## Troubleshooting

### Configuration Not Loading

**Check file location:**
```bash
ls -la ~/.openpackage/platforms.jsonc
ls -la .openpackage/platforms.jsonc
```

**Check JSON syntax:**
```bash
opkg validate platforms
```

### Flows Not Executing

**Check platform detection:**
```bash
opkg list  # Shows detected platforms
```

**Check enabled flag:**
```jsonc
{
  "cursor": {
    "enabled": true  // Must be true or omitted
  }
}
```

### Merge Not Working

**Remember:** Flows array is replaced entirely, not merged.

**Solution:** Copy built-in flows if you want to extend:
```jsonc
{
  "cursor": {
    "flows": [
      // Copy built-in flows here
      { "from": "rules/*.md", "to": ".cursor/rules/*.mdc" },
      // Add your custom flow
      { "from": "custom/*.md", "to": ".cursor/custom/*.md" }
    ]
  }
}
```

### Schema Errors

**Update schema path** if moved:
```jsonc
{
  "$schema": "./node_modules/opkg-cli/schemas/platforms-v1.json"
}
```

**Reinstall CLI** if schema missing:
```bash
npm install -g opkg-cli
```

## Next Steps

- **Learn flow syntax:** See [Flows](./flows.md)
- **View flow options:** See [Flow Reference](./flow-reference.md)
- **See examples:** See [Examples](./examples.md)
