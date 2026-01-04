# Design: Platform Flows System

## Context

The current platform system uses a subdirectory-based approach where each platform defines a static array of subdirectories with simple path mappings and extension transformations. While this works for basic scenarios, it cannot handle:

- **Format transformations** (YAML ↔ JSON ↔ TOML)
- **Content restructuring** (key remapping, embedding, sectioning)
- **Multi-package composition** (priority-based merging with conflict warnings)
- **Conditional transformations** (platform-aware, context-dependent)
- **Complex file types** (markdown frontmatter, TOML sections)

The Platform Flows system introduces a **declarative transformation engine** that processes files through configurable pipelines, enabling sophisticated content transformations without code changes.

## Goals / Non-Goals

### Goals
- **Declarative configuration**: All transformations defined in JSON, no code changes
- **Powerful transforms**: Handle format conversion, key remapping, content embedding
- **Multi-package composition**: Safely merge content from multiple packages
- **Backward compatible**: Support existing subdirs during transition
- **Type-safe**: Full TypeScript types with IDE autocomplete
- **Testable**: Pure functions, easy to test and debug
- **Performant**: Optimize common cases, cache parsers
- **Extensible**: Support custom handlers for edge cases

### Non-Goals
- **Not** a general-purpose transformation language (use specialized tools for complex logic)
- **Not** supporting arbitrary JavaScript execution (security risk)
- **Not** a build system (flows execute at install/save/apply time)
- **Not** supporting async transforms initially (keep synchronous for v1)

## Architecture

### High-Level Design

```
Package (.opkg registry)          Platform Flows Engine          Workspace
┌─────────────────────┐          ┌─────────────────────┐          ┌─────────────────────┐
│ Universal Format    │          │                     │          │ Platform-Specific   │
│ ├── rules/          │ ───────▶ │  Flow Executor      │ ───────▶ │ ├── .cursor/rules/  │
│ ├── commands/       │          │                     │          │ ├── .claude/agents/ │
│ ├── agents/         │          │  Transforms         │          │ ├── .codex/prompts/ │
│ └── mcp.jsonc       │          │  ├── Format         │          │ └── ...             │
└─────────────────────┘          │  ├── KeyMap         │          └─────────────────────┘
                                 │  ├── Merge          │
                                 │  └── Filter         │
                                 └─────────────────────┘
```

### Core Components

#### 1. Flow Executor (`src/core/flow-executor.ts`)

Main orchestration engine that executes flows through a multi-stage pipeline:

```typescript
interface FlowExecutor {
  executeFlow(flow: Flow, context: FlowContext): Promise<FlowResult>
  executeFlows(flows: Flow[], context: FlowContext): Promise<FlowResult[]>
  executeMultiTarget(flow: Flow, context: FlowContext): Promise<FlowResult[]>
}

interface FlowContext {
  workspaceRoot: string
  packageRoot: string
  platform: string
  packageName: string
  variables: Record<string, any>
}

interface FlowResult {
  source: string
  target: string | string[]
  success: boolean
  transformed: boolean
  error?: Error
}
```

**Pipeline Stages:**
1. **Load**: Read source file, auto-detect format
2. **Extract**: Apply JSONPath if specified
3. **Filter**: Pick/omit keys
4. **Map**: Transform keys and values
5. **Transform**: Apply pipe transforms
6. **Embed**: Wrap in target structure
7. **Merge**: Merge with existing target (priority-based)
8. **Write**: Serialize and write to target

**Optimizations:**
- Skip pipeline for simple file copies (no transforms)
- Parse source once for multi-target flows
- Cache format parsers per file type
- Lazy evaluation of conditional flows

#### 2. Transform System (`src/core/flow-transforms.ts`)

Modular transform implementations:

```typescript
interface Transform {
  name: string
  execute(input: any, options?: any): any
  validate(options?: any): boolean
}

interface TransformRegistry {
  register(transform: Transform): void
  get(name: string): Transform | undefined
  execute(name: string, input: any, options?: any): any
}
```

**Transform Categories:**

**Format Converters:**
- `jsonc`, `yaml`, `toml` - Bidirectional format conversion
- Auto-detect from file extension or content

**Merge Strategies:**
- `merge` - Deep merge preserving nested structures
- `merge-shallow` - Top-level merge only
- `replace` - Complete replacement

**Content Filters:**
- `filter-comments` - Remove comments
- `filter-empty` - Remove empty values
- `filter-null` - Remove null/undefined

**Markdown Processors:**
- `sections` - Split by headers
- `frontmatter` - Extract/transform YAML frontmatter
- `body` - Extract body without frontmatter

**Value Transforms:**
- Type converters: `number`, `string`, `boolean`, `json`, `date`
- String transforms: `uppercase`, `lowercase`, `camel-case`, `kebab-case`, etc.
- Array transforms: `array-append`, `array-unique`, `array-flatten`
- Object transforms: `flatten`, `unflatten`, `pick-keys`, `omit-keys`

#### 3. Key Mapper (`src/core/flow-key-mapper.ts`)

Sophisticated key remapping with dot notation and wildcards:

```typescript
interface KeyMapper {
  applyKeyMap(obj: any, keyMap: KeyMap): any
}

interface KeyMap {
  [sourceKey: string]: string | KeyMapConfig
}

interface KeyMapConfig {
  to: string                    // Target key path
  transform?: string            // Value transform
  default?: any                 // Default value
  values?: Record<string, any>  // Value lookup table
}
```

**Features:**
- **Dot notation**: `theme` → `workbench.colorTheme`
- **Wildcards**: `ai.*` → `cursor.*`
- **Value transforms**: Apply transforms during mapping
- **Value tables**: Map values to platform-specific equivalents
- **Default values**: Fallback for missing keys

**Examples:**

```typescript
// Simple rename
{ "theme": "workbench.colorTheme" }

// Wildcard mapping
{ "ai.*": "cursor.*" }

// With transform and default
{
  "fontSize": {
    "to": "editor.fontSize",
    "transform": "number",
    "default": 14
  }
}

// Value lookup
{
  "model": {
    "to": "ai.model",
    "values": {
      "anthropic/claude-sonnet-4.5": "claude-sonnet-4.5"
    }
  }
}
```

#### 4. Platform Configuration Loader (`src/core/platforms.ts`)

Handles configuration loading, merging, and validation:

```typescript
interface PlatformLoader {
  loadPlatforms(): PlatformsConfig
  mergePlatforms(base, override): PlatformsConfig
  validatePlatforms(config): ValidationResult
}

interface PlatformsConfig {
  global?: {
    flows: Flow[]
  }
  [platformId: string]: PlatformConfig
}

interface PlatformConfig {
  name: string
  rootDir: string
  rootFile?: string
  aliases?: string[]
  enabled?: boolean
  flows: Flow[]
}
```

**Merge Hierarchy:**
```
Built-in (ships with CLI)
  ↓ deep merge
~/.openpackage/platforms.jsonc (global overrides)
  ↓ deep merge
<workspace>/.openpackage/platforms.jsonc (workspace overrides)
```

**Merge Behavior:**
- Platform-level: New platforms added, existing merged
- Flows array: Later configs replace entirely (no array merge)
- Boolean/string fields: Last writer wins
- Validation runs after each merge

#### 5. Flow Schema

Complete flow schema with all options:

```typescript
interface Flow {
  // Required
  from: string                              // Source pattern (supports {name} placeholders)
  to: string | MultiTargetFlows             // Target path or multi-target config
  
  // Transformation pipeline
  pipe?: string[]                           // Transform names to apply in order
  map?: KeyMap                              // Key mapping configuration
  pick?: string[]                           // Keys to include (whitelist)
  omit?: string[]                           // Keys to exclude (blacklist)
  path?: string                             // JSONPath extraction
  
  // Structure manipulation
  embed?: string                            // Embed content under key
  section?: string                          // TOML section name
  
  // Control flow
  when?: Condition                          // Conditional execution
  merge?: "deep" | "shallow" | "replace"    // Merge strategy (priority-based)
  handler?: string                          // Custom handler name
}

interface MultiTargetFlows {
  [targetPath: string]: Partial<Flow>      // Per-target transform overrides
}

interface Condition {
  exists?: string                           // File/directory exists
  platform?: string                         // Platform is enabled
  key?: string                              // Key exists in source
  equals?: any                              // Key equals value
  and?: Condition[]                         // All conditions true
  or?: Condition[]                          // Any condition true
}
```

## Data Flow

### Install Flow (Package → Workspace)

```
1. Load package from registry (.opkg/packages/@scope/name/)
2. Detect workspace platforms (check rootDir, rootFile)
3. Load platform configs (built-in + global + workspace)
4. For each detected platform:
   a. Get platform flows
   b. Filter applicable flows (check 'when' conditions)
   c. For each flow:
      - Match source files (from pattern)
      - Execute flow pipeline
      - Write transformed content to target
5. Handle multi-package composition:
   - Merge using priority-based strategy (dependency order)
   - Warn on conflicts
   - Log which package won
```

### Save Flow (Workspace → Package)

```
1. Discover workspace files (all detected platforms)
2. Load platform configs (built-in + global + workspace)
3. For each workspace file:
   a. Determine source platform (from path)
   b. Find matching flow (reverse lookup from 'to' → 'from')
   c. Execute reverse pipeline:
      - Load workspace file
      - Reverse key mapping
      - Reverse format conversion
      - Write to package universal format
4. Deduplicate files (if multiple platforms target same source)
5. Write to local registry
```

### Apply Flow (Local Registry → Workspace)

```
1. Load package from local registry (.opkg/)
2. Detect workspace platforms
3. Load platform configs
4. Execute flows (same as install)
5. Use merge strategies to update existing files
```

## Decisions

### Decision 1: Declarative JSON vs. Code-based Handlers

**Chosen:** Declarative JSON configuration with optional custom handlers for edge cases

**Rationale:**
- **Pros:**
  - User-extensible without code changes
  - Easy to validate and test
  - Can be version-controlled and shared
  - IDE autocomplete via JSON schema
  - No security concerns (no arbitrary code execution)
- **Cons:**
  - Limited to predefined transforms
  - Complex logic requires custom handlers

**Alternative:** Pure code-based system with TypeScript/JavaScript handlers
- Rejected: Security concerns, requires code changes, harder for users to customize

**Mitigation:** Provide `handler` escape hatch for truly custom logic

### Decision 2: Flow Execution Model

**Chosen:** Synchronous pipeline with lazy evaluation

**Rationale:**
- **Pros:**
  - Simpler to implement and debug
  - Predictable execution order
  - No async/await complexity
  - Easier to test
- **Cons:**
  - Cannot support async transforms (e.g., API calls)
  - May block on slow operations

**Alternative:** Fully async pipeline
- Deferred: Add async support in v2 if needed

**Mitigation:** Optimize hot paths, cache parsers, lazy evaluation

### Decision 3: Multi-Target Flow Syntax

**Chosen:** Object-based multi-target with per-target overrides

```typescript
{
  "from": "mcp.jsonc",
  "to": {
    ".cursor/mcp.json": { "merge": "deep" },
    ".opencode/opencode.json": { "embed": "mcp", "merge": "deep" },
    ".codex/config.toml": { "path": "$.servers", "section": "mcp_servers" }
  }
}
```

**Rationale:**
- **Pros:**
  - Clear and explicit
  - Easy to validate
  - Per-target customization
  - Source parsed once
- **Cons:**
  - More verbose than array syntax

**Alternative:** Array of flows with same source
- Rejected: Loses optimization opportunity (parse source once)

### Decision 4: Merge Strategy Defaults

**Chosen:** No merge by default (replace), opt-in with `merge` field

**Rationale:**
- **Pros:**
  - Predictable behavior (no surprising merges)
  - Explicit intent required
  - Safer for most use cases
- **Cons:**
  - Requires explicit configuration for merges

**Alternative:** Deep merge by default
- Rejected: Can cause unexpected behavior, harder to debug

### Decision 5: Multi-Package Conflicts (Priority-Based Merge)

**Chosen:** No namespace isolation. Handle conflicts through priority-based merging with warnings.

**Priority Order (highest to lowest):**
1. Workspace-defined content (manual user edits)
2. Direct dependencies (as listed in manifest)
3. Nested dependencies (depth-first, shallower = higher priority)

**Rationale:**
- **Pros:**
  - Simple and predictable
  - No nested package structure forced on platforms
  - Clear conflict resolution
  - Warnings alert users to collisions
- **Cons:**
  - Last writer wins (data may be overwritten)
  - Requires careful package ordering

**Behavior:**
```json
// Package A defines:
{ "servers": { "my-server": {...} } }

// Package B defines:
{ "servers": { "my-server": {...} } }

// Result: Package with higher priority wins
// Warning: "Package @scope/b overwrites content from @scope/a in .cursor/mcp.json"
```

### Decision 6: Key Mapping Precedence

**Chosen:** Explicit mappings override wildcards, later mappings override earlier

**Rationale:**
- **Pros:**
  - Predictable resolution
  - Allows refinement of wildcards
  - Follows CSS/specificity patterns
- **Cons:**
  - Order-dependent (but explicit in config)

**Example:**
```json
{
  "map": {
    "ai.*": "cursor.*",           // Wildcard: maps all ai.* to cursor.*
    "ai.model": "cursor.ai.model" // Explicit: overrides wildcard
  }
}
```

### Decision 7: Backward Compatibility Strategy

**Chosen:** Support both subdirs and flows during transition, with deprecation warnings

**Timeline:**
- **Phase 1** (v1.0): Add flow support, keep subdirs working
- **Phase 2** (v1.5): Deprecate subdirs, show migration warnings
- **Phase 3** (v2.0): Remove subdirs support (breaking change)

**Rationale:**
- Gives users time to migrate
- Allows testing flows in production
- Clear migration path

## Risks / Trade-offs

### Risk 1: Performance Overhead

**Concern:** Complex transforms may slow down install/save operations

**Mitigation:**
- Benchmark hot paths
- Cache format parsers (singleton instances)
- Skip pipeline for simple file copies
- Parse source once for multi-target flows
- Lazy evaluation of conditional flows
- Structural sharing for object merges

**Target:** <10% overhead for common cases, <50% for complex transforms

### Risk 2: User Confusion

**Concern:** Complex flow syntax may be hard to understand

**Mitigation:**
- Excellent documentation with examples
- Built-in flows cover 90% of use cases
- Clear validation errors with helpful messages
- Dry-run mode to preview transformations
- Debug logging for troubleshooting

### Risk 3: Breaking Changes

**Concern:** Moving from subdirs to flows may break existing workflows

**Mitigation:**
- Support both formats during transition
- Provide migration tooling
- Clear migration guide
- Gradual deprecation timeline
- Maintain backward compatibility for built-in platforms

### Risk 4: Edge Cases in Transforms

**Concern:** Complex data structures may not transform correctly

**Mitigation:**
- Comprehensive test suite
- Test with real-world packages
- Custom handler escape hatch
- Clear error messages
- Community feedback during beta

### Risk 5: Circular Dependencies

**Concern:** Flows may create circular transformation dependencies

**Mitigation:**
- Detect cycles during validation
- Fail fast with clear error
- Document best practices
- Simple mental model (one direction: package → workspace)

## Migration Plan

### Phase 1: Foundation (Week 1-2)
- Implement core flow executor
- Implement basic transforms (format, merge, filter)
- Add schema validation
- Write unit tests

### Phase 2: Advanced Features (Week 3-4)
- Implement key mapping system
- Add conditional flows
- Add namespace isolation
- Add multi-target support

### Phase 3: Integration (Week 5-6)
- Integrate with install pipeline
- Integrate with save pipeline
- Integrate with apply pipeline
- Update platform utilities

### Phase 4: Migration (Week 7-8)
- Convert built-in platforms to flows
- Test all 13 platforms
- Create migration tooling
- Write migration guide

### Phase 5: Cleanup & Release (Week 9-10)
- Performance optimization
- Documentation completion
- Integration testing
- Beta release for feedback

## Open Questions

1. **Custom transform plugins**: Should we support loading custom transforms from packages?
   - **Leaning:** No for v1, evaluate for v2 based on user feedback
   - **Risk:** Security implications of running package code

2. **Async transforms**: Do we need async support (e.g., API calls during transformation)?
   - **Leaning:** No for v1, most transforms are synchronous
   - **Future:** Add async support if compelling use cases emerge

3. **Flow debugging UI**: Should we build a visual flow debugger?
   - **Leaning:** Start with CLI logging, build UI if needed
   - **Reason:** Most users comfortable with CLI, avoid UI complexity

4. **Schema versioning**: How do we version flow schemas for backward compatibility?
   - **Leaning:** Use semver, validate schema version during load
   - **Migration:** Auto-upgrade old schemas where possible

5. **Circular flow detection**: Should we support intentional circular flows?
   - **Leaning:** No, treat as error
   - **Reason:** Almost always a mistake, hard to reason about

6. **Transform composition**: Should transforms be composable (e.g., `transform: "trim | lowercase"`)?
   - **Leaning:** Use `pipe` array instead for clarity
   - **Example:** `"pipe": ["trim", "lowercase"]`

## Alternatives Considered

### Alternative 1: Keep subdirs, add transformation hooks

**Description:** Keep current subdirs array, add optional `transform` field

**Rejected because:**
- Still limited to predefined subdirectories
- Doesn't handle multi-package composition
- Harder to express complex transformations
- Less declarative (mixing structure and transformation)

### Alternative 2: External transformation tools (e.g., jq, yq)

**Description:** Shell out to external tools for transformations

**Rejected because:**
- Platform-specific dependencies
- Harder to distribute and install
- Inconsistent behavior across platforms
- Security concerns (shell injection)
- Harder to test and debug

### Alternative 3: Plugin system with JavaScript/TypeScript

**Description:** Allow users to write custom transform plugins in JS/TS

**Rejected because:**
- Security concerns (arbitrary code execution)
- Complexity for users
- Requires build step for TypeScript
- Harder to validate and test
- Use custom `handler` escape hatch instead for edge cases

### Alternative 4: GraphQL-style transformation language

**Description:** Create custom DSL for transformations

**Rejected because:**
- Learning curve for new language
- Maintenance burden
- Limited ecosystem
- JSON is familiar and well-supported
- Existing JSONPath covers query needs

## References

- **Inspiration:** Webpack loaders, Babel transforms, jq filters
- **Format parsers:** js-yaml, @iarna/toml, jsonc-parser
- **JSONPath:** jsonpath-plus (standardized query language)
- **Existing systems:** Helm templates, Kustomize, Ansible

## Success Criteria

1. **Functional:**
   - All 13 built-in platforms work with flows
   - Multi-package composition works correctly
   - Key remapping handles all documented cases
   - Format conversion works for all supported formats

2. **Performance:**
   - <10% overhead for simple file copies
   - <50% overhead for complex transforms
   - No memory leaks in multi-package scenarios

3. **Usability:**
   - Zero config for built-in platforms
   - Clear error messages for all failure modes
   - Dry-run mode provides useful previews
   - Migration from subdirs takes <30 minutes per custom platform

4. **Quality:**
   - >90% test coverage
   - Zero critical bugs in beta
   - Positive user feedback on flexibility
   - Clear and complete documentation
