# OpenPackage Map Transformation System

## Executive Summary

Replace current `map` system with MongoDB aggregation-inspired pipeline for field transformations. **Zero backwards compatibility** - clean slate implementation.

---

## Core Concept

```jsonc
{
  "map": [
    { "$operation": config },
    { "$operation": config },
    ...
  ]
}
```

**Key Principles:**
1. Map is a **document-level pipeline** (array of operations)
2. Operations execute **sequentially** on the entire document
3. All operations use **MongoDB $ prefix**
4. **Dot notation** for nested field access
5. **Simple and intuitive** - custom operations optimized for common use cases

---

## 6 Core Operations

### 1. `$set` - Set field value(s)

```jsonc
// Single field with context variable
{ "$set": { "name": "$$filename" } }

// Multiple fields
{ "$set": { 
  "name": "$$filename",
  "source": "$$path",
  "version": "1.0.0"
}}

// Literal values
{ "$set": { "status": "active" } }
```

**Context Variables** (use `$$` prefix):
- `$$filename` - filename without extension
- `$$dirname` - parent directory name
- `$$path` - full relative path
- `$$ext` - file extension

**Syntax Rule:**
- `$$variableName` = context variable (inject value)
- `anything else` = literal value
- `\$$` = escaped literal (if you need literal "$$filename" string)

---

### 2. `$rename` - Rename field(s)

```jsonc
// Single rename
{ "$rename": { "oldName": "newName" } }

// Multiple renames
{ "$rename": { 
  "old1": "new1",
  "old2": "new2"
}}

// Nested dot notation
{ "$rename": { "config.ai.model": "settings.model" } }
```

---

### 3. `$unset` - Remove field(s)

```jsonc
// Single field
{ "$unset": "permission" }

// Multiple fields
{ "$unset": ["permission", "legacy", "temp"] }

// Nested fields
{ "$unset": "config.deprecated.field" }
```

---

### 4. `$switch` - Pattern matching (conditional replacement)

```jsonc
{
  "$switch": {
    "field": "model",           // Field to check and replace
    "cases": [
      { "pattern": "anthropic/claude-sonnet-*", "value": "sonnet" },
      { "pattern": "anthropic/claude-opus-*", "value": "opus" },
      { "pattern": "anthropic/claude-haiku-*", "value": "haiku" }
    ],
    "default": "inherit"        // Optional fallback
  }
}
```

**Pattern Matching:**
- **String patterns**: Use glob syntax (`*`, `?`)
- **Object patterns**: Match object shape
  ```jsonc
  { "pattern": { "edit": "deny", "bash": "deny" }, "value": "result" }
  ```
- **Wildcard `*`**: Matches anything (use as default case)

**First match wins** - stops checking after first successful match (like switch statement).

---

### 5. `$transform` - Pipeline transformation

```jsonc
{
  "$transform": {
    "field": "tools",
    "steps": [
      { "filter": { "value": true } },     // Keep only true values
      { "keys": true },                     // Extract keys
      { "map": "capitalize" },              // Capitalize each
      { "join": ", " }                      // Join to string
    ]
  }
}
```

**Transform Steps:**

| Step | Purpose | Example |
|------|---------|---------|
| `{ "filter": { "value": X } }` | Keep entries where value equals X | `{ "filter": { "value": true } }` |
| `{ "filter": { "key": X } }` | Keep entries where key equals X | `{ "filter": { "key": "enabled" } }` |
| `{ "keys": true }` | Extract object keys to array | `{ a: 1, b: 2 }` → `["a", "b"]` |
| `{ "values": true }` | Extract object values to array | `{ a: 1, b: 2 }` → `[1, 2]` |
| `{ "entries": true }` | Convert to entries array | `{ a: 1 }` → `[["a", 1]]` |
| `{ "map": "transform" }` | Transform each element | `capitalize`, `uppercase`, `lowercase` |
| `{ "join": "separator" }` | Join array to string | `{ "join": ", " }` |

---

### 6. `$copy` - Copy field with optional transformation

```jsonc
{
  "$copy": {
    "from": "permission",
    "to": "permissionMode",
    "transform": {
      "cases": [
        { "pattern": { "edit": "deny", "bash": "deny" }, "value": "plan" },
        { "pattern": { "*": "deny" }, "value": "ignore" },
        { "pattern": { "*": "allow" }, "value": "dontAsk" }
      ],
      "default": "default"
    }
  }
}
```

**Use Cases:**
- Transform one field to another with pattern matching
- Create derived fields based on source field value
- Combine with `$unset` to replace fields

---

## Complete Examples

### Example 1: Simple MCP Rename

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".mcp.json",
  "pipe": ["filter-comments"],
  "map": [
    { "$rename": { "mcp": "mcpServers" } }
  ],
  "merge": "deep"
}
```

**Input:**
```json
{ "mcp": { "server1": { "url": "..." } } }
```

**Output:**
```json
{ "mcpServers": { "server1": { "url": "..." } } }
```

---

### Example 2: Agent Name from Filename

```jsonc
{
  "from": "agents/**/*.md",
  "to": ".claude/agents/**/*.md",
  "map": [
    { "$set": { "name": "$$filename" } }
  ]
}
```

**Context:** File `agents/code-reviewer.md`

**Output:**
```yaml
name: code-reviewer
```

---

### Example 3: Model Transformation with Pattern Matching

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
          { "pattern": "anthropic/claude-opus-*", "value": "opus" },
          { "pattern": "anthropic/claude-haiku-*", "value": "haiku" }
        ],
        "default": "inherit"
      }
    }
  ]
}
```

**Input:**
```yaml
model: anthropic/claude-sonnet-4-20250514
```

**Output:**
```yaml
name: code-reviewer
model: sonnet
```

---

### Example 4: Tools Pipeline (Object → CSV String)

```jsonc
{
  "from": "agents/**/*.md",
  "to": ".claude/agents/**/*.md",
  "map": [
    { "$set": { "name": "$$filename" } },
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
    }
  ]
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
name: code-reviewer
tools: Bash, Read
```

---

### Example 5: Permission Transformation

```jsonc
{
  "from": "agents/**/*.md",
  "to": ".claude/agents/**/*.md",
  "map": [
    { "$set": { "name": "$$filename" } },
    {
      "$copy": {
        "from": "permission",
        "to": "permissionMode",
        "transform": {
          "cases": [
            { "pattern": { "edit": "deny", "bash": "deny" }, "value": "plan" },
            { "pattern": { "*": "deny" }, "value": "ignore" },
            { "pattern": { "*": "allow" }, "value": "dontAsk" }
          ],
          "default": "default"
        }
      }
    },
    { "$unset": "permission" }
  ]
}
```

**Input:**
```yaml
permission:
  edit: deny
  bash: deny
```

**Output:**
```yaml
name: code-reviewer
permissionMode: plan
```

---

### Example 6: Complete Claude Platform Configuration

```jsonc
{
  "claude": {
    "name": "Claude Code",
    "rootDir": ".claude",
    "rootFile": "CLAUDE.md",
    "flows": [
      {
        "from": "AGENTS.md",
        "to": "CLAUDE.md",
        "merge": "composite"
      },
      {
        "from": "rules/**/*.md",
        "to": ".claude/rules/**/*.md"
      },
      {
        "from": "commands/**/*.md",
        "to": ".claude/commands/**/*.md"
      },
      {
        "from": "agents/**/*.md",
        "to": ".claude/agents/**/*.md",
        "map": [
          // Set name from context
          { "$set": { "name": "$$filename" } },
          
          // Transform model
          {
            "$switch": {
              "field": "model",
              "cases": [
                { "pattern": "anthropic/claude-sonnet-*", "value": "sonnet" },
                { "pattern": "anthropic/claude-opus-*", "value": "opus" },
                { "pattern": "anthropic/claude-haiku-*", "value": "haiku" }
              ],
              "default": "inherit"
            }
          },
          
          // Transform tools
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
          
          // Transform permission
          {
            "$copy": {
              "from": "permission",
              "to": "permissionMode",
              "transform": {
                "cases": [
                  { "pattern": { "edit": "deny", "bash": "deny" }, "value": "plan" },
                  { "pattern": { "*": "deny" }, "value": "ignore" },
                  { "pattern": { "*": "allow" }, "value": "dontAsk" }
                ],
                "default": "default"
              }
            }
          },
          { "$unset": "permission" }
        ]
      },
      {
        "from": "skills/**/*",
        "to": ".claude/skills/**/*"
      },
      {
        "from": "mcp.jsonc",
        "to": ".mcp.json",
        "pipe": ["filter-comments"],
        "map": [
          { "$rename": { "mcp": "mcpServers" } }
        ],
        "merge": "deep"
      }
    ]
  }
}
```

---

## Current Platforms Converted

### All MCP Configurations

```jsonc
{
  // Claude
  "claude": {
    "flows": [{
      "from": "mcp.jsonc",
      "to": ".mcp.json",
      "pipe": ["filter-comments"],
      "map": [
        { "$rename": { "mcp": "mcpServers" } }
      ],
      "merge": "deep"
    }]
  },

  // Codex
  "codex": {
    "flows": [{
      "from": "mcp.jsonc",
      "to": ".codex/mcp-servers.toml",
      "pipe": ["filter-comments", "json-to-toml"],
      "map": [
        { "$rename": { "mcp": "mcp_servers" } }
      ],
      "merge": "deep"
    }]
  },

  // Cursor
  "cursor": {
    "flows": [{
      "from": "mcp.jsonc",
      "to": ".cursor/mcp.json",
      "pipe": ["filter-comments"],
      "map": [
        { "$rename": { "mcp": "mcpServers" } }
      ],
      "merge": "deep"
    }]
  },

  // Kilo
  "kilo": {
    "flows": [{
      "from": "mcp.jsonc",
      "to": ".kilocode/mcp.json",
      "pipe": ["filter-comments"],
      "map": [
        { "$rename": { "mcp": "mcpServers" } }
      ],
      "merge": "deep"
    }]
  },

  // OpenCode (reverse mapping)
  "opencode": {
    "flows": [{
      "from": "mcp.jsonc",
      "to": ".opencode/opencode.json",
      "pipe": ["filter-comments"],
      "map": [
        { "$rename": { "mcpServers": "mcp" } }
      ],
      "merge": "deep"
    }]
  },

  // Roo
  "roo": {
    "flows": [{
      "from": "mcp.jsonc",
      "to": ".roo/mcp.json",
      "pipe": ["filter-comments"],
      "map": [
        { "$rename": { "mcp": "mcpServers" } }
      ],
      "merge": "deep"
    }]
  }
}
```

---

## Operation Reference (Quick)

| Operation | Purpose | Syntax |
|-----------|---------|--------|
| `$set` | Set field values | `{ "$set": { "field": "value" } }` |
| `$rename` | Rename fields | `{ "$rename": { "old": "new" } }` |
| `$unset` | Remove fields | `{ "$unset": "field" }` |
| `$switch` | Pattern match & replace | `{ "$switch": { "field": "x", "cases": [...] } }` |
| `$transform` | Pipeline transform | `{ "$transform": { "field": "x", "steps": [...] } }` |
| `$copy` | Copy & transform | `{ "$copy": { "from": "x", "to": "y" } }` |


---

## Implementation Plan

### Phase 1: Core Engine (Week 1)

**File**: `src/core/flows/flow-map-pipeline.ts`

```typescript
type MapPipeline = Operation[];

type Operation =
  | SetOperation
  | RenameOperation
  | UnsetOperation
  | SwitchOperation
  | TransformOperation
  | CopyOperation;

interface SetOperation {
  $set: Record<string, any>;
}

interface RenameOperation {
  $rename: Record<string, string>;
}

interface UnsetOperation {
  $unset: string | string[];
}

interface SwitchOperation {
  $switch: {
    field: string;
    cases: Array<{
      pattern: string | object;
      value: any;
    }>;
    default?: any;
  };
}

interface TransformOperation {
  $transform: {
    field: string;
    steps: TransformStep[];
  };
}

type TransformStep =
  | { filter: { value?: any; key?: any } }
  | { keys: true }
  | { values: true }
  | { entries: true }
  | { map: 'capitalize' | 'uppercase' | 'lowercase' }
  | { join: string };

interface CopyOperation {
  $copy: {
    from: string;
    to: string;
    transform?: {
      cases: Array<{
        pattern: string | object;
        value: any;
      }>;
      default?: any;
    };
  };
}

interface Context {
  filename: string;
  dirname: string;
  path: string;
  ext: string;
}
```

**Core Function:**
```typescript
export function applyMapPipeline(
  document: any,
  pipeline: MapPipeline,
  context: Context
): any {
  let result = { ...document };
  
  for (const operation of pipeline) {
    if ('$set' in operation) {
      result = executeSet(result, operation.$set, context);
    } else if ('$rename' in operation) {
      result = executeRename(result, operation.$rename);
    } else if ('$unset' in operation) {
      result = executeUnset(result, operation.$unset);
    } else if ('$switch' in operation) {
      result = executeSwitch(result, operation.$switch);
    } else if ('$transform' in operation) {
      result = executeTransform(result, operation.$transform);
    } else if ('$copy' in operation) {
      result = executeCopy(result, operation.$copy);
    }
  }
  
  return result;
}
```

### Phase 2: Operation Implementations (Week 1)

**File**: `src/core/flows/flow-map-operations.ts`

```typescript
function executeSet(doc: any, fields: Record<string, any>, context: Context): any {
  const result = { ...doc };
  
  for (const [field, value] of Object.entries(fields)) {
    const resolvedValue = resolveValue(value, context);
    setNestedValue(result, field, resolvedValue);
  }
  
  return result;
}

function resolveValue(value: any, context: Context): any {
  if (typeof value === 'string' && value.startsWith('$$')) {
    const varName = value.substring(2);
    return context[varName] || value;
  }
  if (typeof value === 'string' && value.startsWith('\\$$')) {
    return value.substring(1);
  }
  if (typeof value === 'object' && value !== null) {
    const result: any = Array.isArray(value) ? [] : {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = resolveValue(v, context);
    }
    return result;
  }
  return value;
}

function executeRename(doc: any, mappings: Record<string, string>): any {
  const result = { ...doc };
  
  for (const [oldPath, newPath] of Object.entries(mappings)) {
    if (oldPath.includes('*')) {
      // Handle wildcard patterns
      result = executeWildcardRename(result, oldPath, newPath);
    } else {
      // Simple rename
      const value = getNestedValue(result, oldPath);
      if (value !== undefined) {
        setNestedValue(result, newPath, value);
        deleteNestedValue(result, oldPath);
      }
    }
  }
  
  return result;
}

function executeSwitch(doc: any, config: SwitchConfig): any {
  const result = { ...doc };
  const currentValue = getNestedValue(result, config.field);
  
  for (const { pattern, value } of config.cases) {
    if (matchPattern(currentValue, pattern)) {
      setNestedValue(result, config.field, value);
      return result;
    }
  }
  
  if (config.default !== undefined) {
    setNestedValue(result, config.field, config.default);
  }
  
  return result;
}

function executeTransform(doc: any, config: TransformConfig): any {
  const result = { ...doc };
  let value = getNestedValue(result, config.field);
  
  for (const step of config.steps) {
    if ('filter' in step) {
      value = filterEntries(value, step.filter);
    } else if ('keys' in step) {
      value = Object.keys(value);
    } else if ('values' in step) {
      value = Object.values(value);
    } else if ('entries' in step) {
      value = Object.entries(value);
    } else if ('map' in step) {
      value = value.map(applyMapTransform(step.map));
    } else if ('join' in step) {
      value = value.join(step.join);
    }
  }
  
  setNestedValue(result, config.field, value);
  return result;
}

function executeCopy(doc: any, config: CopyConfig): any {
  const result = { ...doc };
  const sourceValue = getNestedValue(result, config.from);
  
  let targetValue = sourceValue;
  
  if (config.transform) {
    for (const { pattern, value } of config.transform.cases) {
      if (matchPattern(sourceValue, pattern)) {
        targetValue = value;
        break;
      }
    }
    
    if (targetValue === sourceValue && config.transform.default !== undefined) {
      targetValue = config.transform.default;
    }
  }
  
  setNestedValue(result, config.to, targetValue);
  return result;
}
```

### Phase 3: Integration (Week 2)

**Update**: `src/core/flows/flow-executor.ts`

```typescript
import { applyMapPipeline } from './flow-map-pipeline';

export async function executeFlow(flow: Flow, context: FlowContext) {
  // ... existing pipe execution
  
  // Apply map pipeline to frontmatter
  if (flow.map && context.frontmatter) {
    context.frontmatter = applyMapPipeline(
      context.frontmatter,
      flow.map,
      {
        filename: path.basename(context.sourcePath, path.extname(context.sourcePath)),
        dirname: path.basename(path.dirname(context.sourcePath)),
        path: context.sourcePath,
        ext: path.extname(context.sourcePath)
      }
    );
  }
  
  // ... rest of flow execution
}
```

### Phase 4: Testing (Week 2)

**File**: `tests/flows/map-pipeline.test.ts`

```typescript
describe('Map Pipeline', () => {
  test('$set with context variables', () => {
    const result = applyMapPipeline(
      {},
      [{ $set: { name: '$$filename' } }],
      { filename: 'test', dirname: 'agents', path: 'agents/test.md', ext: '.md' }
    );
    expect(result.name).toBe('test');
  });
  
  test('$rename simple', () => {
    const result = applyMapPipeline(
      { mcp: { server1: {} } },
      [{ $rename: { mcp: 'mcpServers' } }],
      getContext()
    );
    expect(result.mcpServers).toBeDefined();
    expect(result.mcp).toBeUndefined();
  });
  
  test('$switch with patterns', () => {
    const result = applyMapPipeline(
      { model: 'anthropic/claude-sonnet-4' },
      [{
        $switch: {
          field: 'model',
          cases: [
            { pattern: 'anthropic/claude-sonnet-*', value: 'sonnet' }
          ]
        }
      }],
      getContext()
    );
    expect(result.model).toBe('sonnet');
  });
  
  test('$transform pipeline', () => {
    const result = applyMapPipeline(
      { tools: { write: false, read: true, bash: true } },
      [{
        $transform: {
          field: 'tools',
          steps: [
            { filter: { value: true } },
            { keys: true },
            { map: 'capitalize' },
            { join: ', ' }
          ]
        }
      }],
      getContext()
    );
    expect(result.tools).toBe('Read, Bash');
  });
  
  test('$copy with transform', () => {
    const result = applyMapPipeline(
      { permission: { edit: 'deny', bash: 'deny' } },
      [
        {
          $copy: {
            from: 'permission',
            to: 'permissionMode',
            transform: {
              cases: [
                { pattern: { edit: 'deny', bash: 'deny' }, value: 'plan' }
              ]
            }
          }
        },
        { $unset: 'permission' }
      ],
      getContext()
    );
    expect(result.permissionMode).toBe('plan');
    expect(result.permission).toBeUndefined();
  });
  
  // ... 20+ more tests covering all operations
});
```

### Phase 5: Documentation (Week 2)

**File**: `docs/map-pipeline.md`

Structure:
1. Introduction (MongoDB-inspired, document-level pipeline)
2. Core concepts (6 operations)
3. Context variable injection with `$$` prefix
4. Complete transformation examples
5. Pattern matching guide
6. Wildcard support
7. Common patterns library

### Phase 6: Schema Validation (Week 3)

**File**: `schemas/map-pipeline.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "oneOf": [
      {
        "required": ["$set"],
        "properties": {
          "$set": { "type": "object" }
        }
      },
      {
        "required": ["$rename"],
        "properties": {
          "$rename": { "type": "object" }
        }
      },
      {
        "required": ["$unset"],
        "properties": {
          "$unset": {
            "oneOf": [
              { "type": "string" },
              { "type": "array", "items": { "type": "string" } }
            ]
          }
        }
      },
      {
        "required": ["$switch"],
        "properties": {
          "$switch": {
            "type": "object",
            "required": ["field", "cases"],
            "properties": {
              "field": { "type": "string" },
              "cases": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["pattern", "value"],
                  "properties": {
                    "pattern": {},
                    "value": {}
                  }
                }
              },
              "default": {}
            }
          }
        }
      },
      {
        "required": ["$transform"],
        "properties": {
          "$transform": {
            "type": "object",
            "required": ["field", "steps"],
            "properties": {
              "field": { "type": "string" },
              "steps": { "type": "array" }
            }
          }
        }
      },
      {
        "required": ["$copy"],
        "properties": {
          "$copy": {
            "type": "object",
            "required": ["from", "to"],
            "properties": {
              "from": { "type": "string" },
              "to": { "type": "string" },
              "transform": {
                "type": "object",
                "properties": {
                  "cases": { "type": "array" },
                  "default": {}
                }
              }
            }
          }
        }
      }
    ]
  }
}
```

---

## File Changes

### New Files
- `src/core/flows/flow-map-pipeline.ts` - Core engine
- `src/core/flows/flow-map-operations.ts` - Operation implementations
- `tests/flows/map-pipeline.test.ts` - Comprehensive tests
- `docs/map-pipeline.md` - User documentation
- `schemas/map-pipeline.json` - JSON schema validation

### Modified Files
- `src/core/flows/flow-executor.ts` - Integrate new pipeline
- `platforms.jsonc` - Update all platform mappings
- `schemas/platforms-v1.json` - Update map schema

### Removed Files
- Any old map transformation logic (if exists)

---

## Success Criteria

1. ✅ All 6 operations implemented and tested
2. ✅ Dot notation for nested fields working
3. ✅ Pattern matching with wildcards functional
4. ✅ Claude platform fully converted
5. ✅ 100% test coverage on operations
6. ✅ Documentation complete with examples
7. ✅ JSON schema validation in place
8. ✅ Zero backwards compatibility code

---

## Timeline

- **Week 1**: Core engine + operations (Phase 1-2)
- **Week 2**: Integration + testing (Phase 3-4)
- **Week 3**: Documentation + schema (Phase 5-6)

**Total: 3 weeks to production-ready**

---

## Future Extensions

Operations to add later (not in MVP):
- `$merge` - Deep merge objects
- `$group` - Group by field values
- `$sort` - Sort arrays
- `$unwind` - Flatten arrays
- `$lookup` - Join/reference other fields
- `$cond` - Ternary conditional

Keep architecture extensible for easy additions.

---

**End of Plan** ✅
