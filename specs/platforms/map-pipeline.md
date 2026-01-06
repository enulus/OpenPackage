# Map Pipeline Documentation

## Overview

The **Map Pipeline** is a MongoDB aggregation-inspired transformation system that enables powerful document-level field transformations during package installation. It provides a declarative, composable approach to transforming package content as files flow from source to target.

**Design Philosophy:**
- **MongoDB-inspired:** Familiar `$operation` syntax for developers
- **Sequential execution:** Operations applied in order, each receiving the result of the previous
- **Document-level:** Transforms entire documents (frontmatter, JSON, YAML, TOML)
- **Context-aware:** Access file metadata through `$$` context variables
- **Type-safe:** Full TypeScript support with comprehensive validation

## Implementation

**Commit:** `e464927d2f5d2480c439a83c5cfc2e04053ac22d`

**Core files:**
- `src/core/flows/map-pipeline/index.ts` - Main pipeline executor
- `src/core/flows/map-pipeline/types.ts` - TypeScript type definitions
- `src/core/flows/map-pipeline/operations/` - Individual operation implementations
- `schemas/map-pipeline-v1.json` - JSON Schema validation
- `tests/flows/map-pipeline.test.ts` - Comprehensive test suite

## Architecture

### Pipeline Structure

```jsonc
{
  "map": [
    { "$operation1": config1 },
    { "$operation2": config2 },
    { "$operation3": config3 }
  ]
}
```

### Execution Flow

```
Input Document
    ↓
$operation1 (receives input, produces result1)
    ↓
$operation2 (receives result1, produces result2)
    ↓
$operation3 (receives result2, produces result3)
    ↓
Output Document
```

**Key characteristics:**
- Operations execute sequentially
- Each operation receives full document
- Operations are isolated (no side effects)
- Document is deep-cloned at start to prevent mutations
- All operations use `$` prefix (MongoDB convention)

### Context Variables

Every operation has access to file context:

```typescript
interface MapContext {
  filename: string;  // Filename without extension: "code-reviewer"
  dirname: string;   // Parent directory: "agents"
  path: string;      // Relative path: "agents/code-reviewer.md"
  ext: string;       // Extension with dot: ".md"
}
```

**Usage in operations:**
- Prefix with `$$` to inject: `$$filename`, `$$dirname`, `$$path`, `$$ext`
- Escape literal `$$`: use `\$$` to get literal string `$$filename`

## Six Core Operations

### 1. `$set` - Set Field Values

Sets one or more fields with literal values or context variables.

**Examples:**

```jsonc
// Set from context
{ "$set": { "name": "$$filename" } }

// Set multiple fields
{ "$set": { 
  "name": "$$filename",
  "version": "1.0.0",
  "status": "active"
}}

// Nested fields (dot notation)
{ "$set": { "config.model": "sonnet" } }

// Escaped literal
{ "$set": { "template": "\\$$placeholder" } }
// Results in: { "template": "$$placeholder" }
```

**See:** `src/core/flows/map-pipeline/operations/set.ts`

---

### 2. `$rename` - Rename Fields

Renames fields with support for wildcards.

**Examples:**

```jsonc
// Simple rename
{ "$rename": { "mcp": "mcpServers" } }

// Multiple renames
{ "$rename": { 
  "old1": "new1",
  "old2": "new2"
}}

// Wildcard rename (preserves structure)
{ "$rename": { "mcp.*": "mcpServers.*" } }
```

**Wildcard example:**
```json
// Input
{ "mcp": { "server1": {}, "server2": {} } }

// After { "$rename": { "mcp.*": "mcpServers.*" } }
{ "mcpServers": { "server1": {}, "server2": {} } }
```

**See:** `src/core/flows/map-pipeline/operations/rename.ts`

---

### 3. `$unset` - Remove Fields

Removes one or more fields from the document.

**Examples:**

```jsonc
// Single field
{ "$unset": "deprecated" }

// Multiple fields
{ "$unset": ["legacy", "temp", "internal"] }

// Nested field
{ "$unset": "config.debug.verbose" }
```

**See:** `src/core/flows/map-pipeline/operations/unset.ts`

---

### 4. `$switch` - Pattern-Based Value Replacement

Pattern matching with value replacement (like switch statement).

**Examples:**

```jsonc
// String pattern matching (glob syntax)
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

// Object pattern matching
{
  "$switch": {
    "field": "permission",
    "cases": [
      { 
        "pattern": { "edit": "deny", "bash": "deny" }, 
        "value": "restricted" 
      },
      { 
        "pattern": { "*": "deny" }, 
        "value": "ignore" 
      }
    ]
  }
}
```

**Pattern matching rules:**
- **String patterns:** Use glob syntax (`*`, `?`)
- **Object patterns:** Match object shape (all keys must match)
- **First match wins:** Stops checking after first successful match
- **Default optional:** If provided, used when no patterns match

**See:** `src/core/flows/map-pipeline/operations/switch.ts`

---

### 5. `$transform` - Multi-Step Pipeline Transformation

Transforms a field through multiple steps (typically object → array → string).

**Available steps:**

| Step | Purpose | Input → Output |
|------|---------|----------------|
| `{ "filter": { "value": X } }` | Filter by value | Object → Object (filtered) |
| `{ "filter": { "key": X } }` | Filter by key | Object → Object (filtered) |
| `{ "keys": true }` | Extract keys | Object → Array |
| `{ "values": true }` | Extract values | Object → Array |
| `{ "entries": true }` | To entries | Object → Array of [key, value] |
| `{ "map": "capitalize" }` | Transform elements | Array → Array (transformed) |
| `{ "join": "," }` | Join to string | Array → String |

**Example:**

```jsonc
// Convert tools object to CSV string
{
  "$transform": {
    "field": "tools",
    "steps": [
      { "filter": { "value": true } },   // Keep only true values
      { "keys": true },                   // Extract keys
      { "map": "capitalize" },            // Capitalize each
      { "join": ", " }                    // Join to string
    ]
  }
}
```

**Input:**
```yaml
tools:
  write: false
  edit: false
  bash: true
  read: true
```

**Output:**
```yaml
tools: Bash, Read
```

**Empty result handling:**  
If transformation results in empty string or empty array, the field is automatically removed.

**See:** `src/core/flows/map-pipeline/operations/transform.ts`

---

### 6. `$copy` - Copy Field with Optional Transformation

Copies a field to new location with optional pattern-based transformation.

**Examples:**

```jsonc
// Simple copy
{
  "$copy": {
    "from": "config",
    "to": "settings"
  }
}

// Copy with transformation
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

**See:** `src/core/flows/map-pipeline/operations/copy.ts`

## Complete Examples

### Example 1: Agent Name Injection

```jsonc
{
  "from": "agents/**/*.md",
  "to": ".claude/agents/**/*.md",
  "map": [
    { "$set": { "name": "$$filename" } }
  ]
}
```

**File:** `agents/code-reviewer.md`  
**Result:** Frontmatter gets `name: code-reviewer`

---

### Example 2: Model Simplification

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

**Transforms:**  
`anthropic/claude-sonnet-4-20250514` → `sonnet`

---

### Example 3: Complete Claude Agent Transformation

```jsonc
{
  "from": "agents/**/*.md",
  "to": ".claude/agents/**/*.md",
  "map": [
    // 1. Inject filename as name
    { "$set": { "name": "$$filename" } },
    
    // 2. Simplify model ID
    {
      "$switch": {
        "field": "model",
        "cases": [
          { "pattern": "anthropic/claude-sonnet-*", "value": "sonnet" },
          { "pattern": "anthropic/claude-opus-*", "value": "opus" }
        ],
        "default": "inherit"
      }
    },
    
    // 3. Transform tools object to CSV
    {
      "$transform": {
        "field": "tools",
        "steps": [
          { "filter": { "value": true } },
          { "keys": true },
          { "map": "capitalize" },
          { "join": ", " }
        ]
      }
    },
    
    // 4. Transform permission to mode
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
    
    // 5. Remove original permission field
    { "$unset": "permission" }
  ]
}
```

**Input:**
```yaml
---
model: anthropic/claude-sonnet-4-20250514
tools:
  write: false
  bash: true
  read: true
permission:
  edit: deny
  bash: deny
---
# Code Reviewer
```

**Output:**
```yaml
---
name: code-reviewer
model: sonnet
tools: Bash, Read
permissionMode: plan
---
# Code Reviewer
```

## Validation

Pipelines are validated against `schemas/map-pipeline-v1.json` before execution.

**Valid:**
```jsonc
[
  { "$set": { "name": "$$filename" } },
  { "$rename": { "old": "new" } }
]
```

**Invalid - multiple operations per object:**
```jsonc
[
  { 
    "$set": { "name": "$$filename" },
    "$rename": { "old": "new" }  // Error!
  }
]
```

**Invalid - unknown operation:**
```jsonc
[
  { "$unknown": { "field": "value" } }  // Error!
]
```

## Testing

Comprehensive test suite: `tests/flows/map-pipeline.test.ts`

**Run tests:**
```bash
npm test -- map-pipeline
```

**Test coverage:**
- All 6 operations
- Context variable resolution
- Nested field access
- Wildcard patterns
- Pattern matching
- Empty result handling
- Error cases
- Integration with flow execution

## Best Practices

### 1. Keep Pipelines Simple

```jsonc
// Good
{ "$rename": { "mcp": "mcpServers" } }

// Avoid unnecessary complexity
[
  { "$copy": { "from": "mcp", "to": "temp" } },
  { "$unset": "mcp" },
  { "$rename": { "temp": "mcpServers" } }
]
```

### 2. Order Operations Logically

```jsonc
[
  { "$set": { ... } },       // 1. Add fields
  { "$switch": { ... } },    // 2. Transform values
  { "$transform": { ... } }, // 3. Complex transforms
  { "$copy": { ... } },      // 4. Derive fields
  { "$unset": [...] }        // 5. Cleanup
]
```

### 3. Leverage Context Variables

```jsonc
{ "$set": { 
  "name": "$$filename",
  "source": "$$path",
  "category": "$$dirname"
}}
```

### 4. Document Complex Pipelines

```jsonc
{
  "map": [
    // Extract filename as agent name
    { "$set": { "name": "$$filename" } },
    
    // Convert full model ID to short name for Claude compatibility
    {
      "$switch": {
        "field": "model",
        "cases": [...]
      }
    }
  ]
}
```

### 5. Test Incrementally

```bash
# Preview transformations
opkg install @user/package --dry-run

# Verify specific file
cat .claude/agents/code-reviewer.md
```

## Performance

**Optimized execution:**
- Document cloned once at start (prevents mutations)
- All operations execute in-memory (no I/O)
- Operations are O(1) to O(n) where n = number of fields
- Pattern matching uses optimized glob library
- Transform steps are O(steps × elements)

**Recommendations:**
- Keep pipelines under 10 operations
- Combine multiple `$set` operations into one
- Use `$copy` with transform instead of separate operations

## Related Documentation

- **Implementation Plan:** `plans/platforms-dsl.md` - Complete design specification
- **Type Definitions:** `src/core/flows/map-pipeline/types.ts` - TypeScript types
- **JSON Schema:** `schemas/map-pipeline-v1.json` - Validation schema
- **Tests:** `tests/flows/map-pipeline.test.ts` - Test suite
- **Flow Documentation:** `specs/platforms/flows.md` - Flow system overview
- **Examples:** `specs/platforms/examples.md` - Real-world configurations

## Migration from Old System

**The map pipeline replaces the old key-based mapping system with zero backwards compatibility.**

Old system (deprecated):
```jsonc
{
  "map": {
    "oldKey": "newKey"
  }
}
```

New system (current):
```jsonc
{
  "map": [
    { "$rename": { "oldKey": "newKey" } }
  ]
}
```

**Key differences:**
- Map is now an **array** of operations (not an object)
- All operations use **$ prefix** (MongoDB convention)
- **Sequential execution** (operations in order)
- **Context variables** (`$$filename`, etc.)
- **Rich operation set** (6 operations vs simple rename)

## Summary

The Map Pipeline provides a powerful, MongoDB-inspired transformation system for document-level operations:

✓ **6 core operations:** set, rename, unset, switch, transform, copy  
✓ **Context-aware:** Access file metadata with `$$` variables  
✓ **Sequential execution:** Predictable, composable transformations  
✓ **Type-safe:** Full TypeScript support  
✓ **Validated:** JSON Schema enforcement  
✓ **Tested:** Comprehensive test coverage  
✓ **Performant:** In-memory operations with minimal overhead  

For complete examples and usage patterns, see `plans/platforms-dsl.md` and the test suite.

---

**Map Pipeline v1.0** - Implemented in commit `e464927d2f5d2480c439a83c5cfc2e04053ac22d`
