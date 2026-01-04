# Change: Implement Platform Flows System

## Why

The current platform system uses a subdirectory-based approach (`subdirs` array) that is limited to simple path mappings and basic extension transformations. This model cannot handle:

- **Format conversions** (YAML ↔ JSON ↔ TOML ↔ JSONC)
- **Key remapping** (transforming object keys and values)
- **Multi-package composition** (merging content from multiple packages)
- **Conditional transformations** (apply based on context)
- **Content embedding** (wrapping data in specific structures)
- **Multi-target outputs** (one source → many destinations)
- **Complex file types** (markdown frontmatter, INI sections, TOML tables)

The Platform Flows system introduces a **declarative transformation engine** that handles all these scenarios through structured JSON configurations, enabling OpenPackage to support diverse AI platforms with varying file formats and conventions.

## What Changes

### Core Architecture
- **Replace** `subdirs` array with declarative `flows` array in `platforms.jsonc`
- **Add** flow execution engine (`src/core/flow-executor.ts`)
- **Add** transform pipeline system (`src/core/flow-transforms.ts`)
- **Add** global flows support (apply to all platforms)
- **Add** merge hierarchy (built-in → global → workspace overrides)
- **Maintain** backward compatibility during transition period

### Configuration Format
- **Flow schema**: `from` (source pattern) → `to` (target path/multi-target)
- **Transform options**: `pipe`, `map`, `pick`, `omit`, `path`, `embed`, `section`, `when`, `merge`, `handler`
- **Multi-target support**: One source can map to multiple destinations with different transforms
- **Conditional execution**: `when` clauses for context-aware flows
- **Priority-based merging**: Conflicts resolved by dependency depth (workspace > direct deps > nested deps)

### Built-in Transforms
- **Format converters**: `jsonc`, `yaml`, `toml`
- **Merge strategies**: `merge`, `merge-shallow`, `replace`
- **Filters**: `filter-comments`, `filter-empty`, `filter-null`
- **Markdown**: `sections`, `frontmatter`, `body`
- **Validation**: `validate`, `validate-schema(path)`

### Value Transforms
- **Type converters**: `number`, `string`, `boolean`, `json`, `date`
- **String transforms**: `uppercase`, `lowercase`, `title-case`, `camel-case`, `kebab-case`, `snake-case`, `trim`, `slugify`
- **Array operations**: `array-append`, `array-unique`, `array-flatten`
- **Object operations**: `flatten`, `unflatten`, `pick-keys`, `omit-keys`

### Key Remapping
- **Dot notation support**: Map nested keys (`theme` → `workbench.colorTheme`)
- **Wildcard mapping**: Pattern-based remapping (`ai.*` → `cursor.*`)
- **Value transforms**: Apply transforms during mapping
- **Default values**: Fallback values for missing keys
- **Value lookup tables**: Map values to platform-specific equivalents

### Platform Detection
- **Keep** existing detection (rootDir + rootFile)
- **Add** flow-based conditional execution
- **Add** platform-specific transform contexts

### Migration Strategy
- Phase 1: Add flow support alongside existing subdirs
- Phase 2: Convert built-in platforms to flows
- Phase 3: Deprecate subdirs (with migration warnings)
- Phase 4: Remove subdirs support (major version bump)

### CLI Commands
- **Add** `opkg validate platforms` - Validate platform configurations
- **Enhance** `opkg status` - Show detected platforms and flows
- **Enhance** `opkg install --dry-run` - Preview flow execution
- **Add** `DEBUG=opkg:flows` - Debug flow execution

### Impact Areas
- **Affected systems**: Platform loading, file discovery, install/uninstall, save/apply
- **Affected files**:
  - `src/core/platforms.ts` - Load and merge flow configs
  - `src/core/flow-executor.ts` - NEW: Execute flow transformations
  - `src/core/flow-transforms.ts` - NEW: Built-in transform implementations
  - `src/core/install/*.ts` - Use flows for file transformations
  - `src/core/save/*.ts` - Use flows for reverse transformations
  - `src/core/apply/*.ts` - Use flows for workspace application
  - `src/utils/platform-*.ts` - Adapt to flow-based system
  - `platforms.jsonc` - Convert to flow format
  - Tests for all affected areas

## Impact

### Breaking Changes
- **BREAKING**: platforms.jsonc format changes (subdirs → flows)
- **BREAKING**: Custom platform configs need migration
- **BREAKING**: Platform path resolution logic changes
- Migration path: Support both formats during transition, warn on old format

### Benefits
- **Declarative**: No code changes needed for new platforms
- **Powerful**: Handles complex transformations out-of-box
- **Composable**: Multi-package content merges automatically
- **Extensible**: Custom handlers for edge cases
- **Type-safe**: Schema validation with IDE autocomplete
- **Testable**: Flows are data, easy to test
- **Format-agnostic**: Works with any text format

### Performance Considerations
- Simple file copies bypass transformation pipeline
- Format parsers cached per file type
- Multi-target flows parse source once
- Lazy evaluation of conditional flows
- Structural sharing for object merges

### Documentation
- Full flow schema reference
- Migration guide from subdirs to flows
- Common pattern examples
- Troubleshooting guide
- Performance best practices

### Testing Requirements
- Unit tests for each transform
- Integration tests for flow execution
- Migration tests (subdirs → flows)
- Performance benchmarks
- Real-world platform scenarios (13 platforms)

### User Experience
- Zero config for built-in platforms
- Clear validation errors
- Dry-run mode for testing
- Debug logging for troubleshooting
- Automatic format detection

## Affected Specs

### New Capabilities
- `platform-flows` - Core flow system specification
- `flow-transforms` - Transform implementations

### Modified Capabilities
- `platforms` - Platform configuration and detection
- `install` - Flow-based file installation
- `save` - Reverse flow transformations
- `apply` - Flow-based workspace application

## Dependencies

### External
- `js-yaml` - YAML parsing (already present)
- `@iarna/toml` - TOML parsing (new)
- `jsonc-parser` - JSONC parsing (already present)
- `jsonpath-plus` - JSONPath queries (new)

### Internal
- Markdown frontmatter parser (already present)
- File system utilities (already present)
- Error handling framework (already present)

## Migration Timeline

### Phase 1: Foundation (Week 1-2)
- Implement flow executor core
- Implement basic transforms
- Add schema validation
- Write unit tests

### Phase 2: Integration (Week 3-4)
- Integrate with install pipeline
- Integrate with save pipeline
- Integrate with apply pipeline
- Add multi-target support

### Phase 3: Advanced Features (Week 5-6)
- Implement key remapping
- Implement conditional flows
- Implement priority-based merging
- Add custom handlers

### Phase 4: Migration (Week 7-8)
- Convert built-in platforms to flows
- Create migration tooling
- Write migration guide
- Add deprecation warnings

### Phase 5: Cleanup (Week 9-10)
- Performance optimization
- Documentation completion
- Integration testing
- User acceptance testing

## Success Metrics

- All 13 built-in platforms work with flows
- No performance regression (<10% overhead)
- Zero breaking changes for end users (default configs)
- 100% test coverage for transforms
- Clear migration path for custom platforms
- Positive user feedback on flexibility

## Design Decisions

### 1. Transform Plugins: Inline Only

**Decision:** Support only inline `pipe` arrays for v1. No custom transform composition or plugins.

**Rationale:**
- Keeps configuration simple and minimal
- Reduces complexity for initial implementation
- Can add named transforms in future if needed
- Handler escape hatch available for truly custom logic

---

### 2. Flow Direction: Unidirectional (Package → Workspace)

**Decision:** Flow configurations are strictly defined as **package-to-workspace direction** only.

**Rationale:**
- Flows execute during install/apply (package → workspace)
- Save operation uses **reverse lookup** (workspace → package)
- No circular dependencies possible by design
- Clear mental model: flows transform from universal format to platform-specific

**Implementation:**
- Flow `from` is always relative to package root
- Flow `to` is always relative to workspace root
- Save operation reverses the transformation automatically

---

### 3. Multi-Package Conflicts: Priority-Based Merge (No Namespacing)

**Decision:** Remove namespace isolation feature entirely. Handle conflicts through **priority-based merging**.

**Priority Order (highest to lowest):**
1. Workspace-defined content (manual edits)
2. Direct dependencies (as listed in manifest)
3. Nested dependencies (depth-first, shallower = higher priority)

**Behavior:**
- When multiple packages target same file, last writer wins based on priority
- Show **warning** when conflicts occur: "Package @scope/b overwrites content from @scope/a in .cursor/mcp.json"
- Log which package's content was used

**Breaking Changes from Original Proposal:**
- Remove `namespace` field from flow schema
- Remove namespace wrapping logic
- Remove multi-package composition examples that relied on namespacing
- Update merge strategy to be priority-based instead of namespace-based

---

### 4. Debugging: CLI Logging Only

**Decision:** Use CLI logging with `DEBUG=opkg:flows` environment variable. No UI needed for v1.

**Rationale:**
- Simple to implement and maintain
- Works everywhere (no platform dependencies)
- Sufficient for debugging most issues
- Can add UI later if user feedback demands it

**Features:**
- Structured logging showing pipeline stages
- Clear error messages with context
- `--dry-run` for previewing transformations

---

### 5. Async Transforms: Not Supported

**Decision:** No async transforms in v1. Keep all transforms synchronous.

**Rationale:**
- Simpler implementation and debugging
- Better performance (no network delays)
- Works offline
- No security concerns with API calls
- Can defer to v2 if compelling use cases emerge

---

### 6. Schema Versioning: Local JSON Schema

**Decision:** Use explicit `$schema` field referencing local JSON schema file.

**Format:**
```jsonc
{
  "$schema": "./node_modules/opkg-cli/schemas/platforms-v1.json",
  "cursor": { ... }
}
```

**Rationale:**
- Clear version identification
- Enables IDE validation and autocomplete
- Local file (no remote dependency)
- Can be bundled with CLI package
- Supports offline development

**Schema Location:**
- Bundled in CLI: `schemas/platforms-v1.json`
- Relative path from config: `./node_modules/opkg-cli/schemas/platforms-v1.json`
- Or workspace-relative: `./.openpackage/schemas/platforms-v1.json`

**Backward Compatibility:**
- Schema version optional (defaults to current CLI version)
- CLI validates against specified schema
- Breaking changes only in major versions
=======

## Risks and Mitigations

### Risk: Performance overhead
- **Mitigation**: Benchmark and optimize hot paths, cache parsers, lazy evaluation

### Risk: Complex migration
- **Mitigation**: Support both formats during transition, provide migration tooling

### Risk: User confusion
- **Mitigation**: Excellent documentation, clear error messages, working examples

### Risk: Breaking existing workflows
- **Mitigation**: Maintain backward compatibility, gradual deprecation

### Risk: Edge cases in transforms
- **Mitigation**: Comprehensive testing, custom handler escape hatch

## Alternatives Considered

### 1. Keep subdirs, add transformation layer
- **Rejected**: Still limited to predefined subdirectories, not flexible enough

### 2. Code-based platform handlers
- **Rejected**: Requires code changes for new platforms, not user-extensible

### 3. Plugin system with JavaScript/TypeScript
- **Rejected**: Too complex for most use cases, security concerns

### 4. External transformation tools (e.g., jq)
- **Rejected**: Platform-specific dependencies, harder to distribute

## References

- Design specification: `specs/platforms-new.md`
- Current implementation: `src/core/platforms.ts`
- Current config: `platforms.jsonc`
- Related specs: `specs/platforms.md`, `specs/install/*.md`, `specs/save/*.md`
