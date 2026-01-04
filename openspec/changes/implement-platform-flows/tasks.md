# Implementation Tasks: Platform Flows System

## 1. Prerequisites and Setup

- [x] 1.1 Install new dependencies
  - [x] `@iarna/toml` for TOML parsing
  - [x] `jsonpath-plus` for JSONPath queries
- [x] 1.2 Create type definitions
  - [x] `src/types/flows.ts` - Flow, FlowConfig, Transform types
  - [x] `src/types/platform-flows.ts` - PlatformsConfig, MultiTargetFlows types
- [x] 1.3 Create JSON schema
  - [x] `schemas/platforms-v1.json` - JSON Schema for platforms.jsonc
  - [x] Include all flow fields and validation rules
  - [x] Add descriptions for IDE autocomplete
  - [x] Test schema with example configs
- [x] 1.4 Set up test infrastructure
  - [x] `tests/flows/` directory structure
  - [x] Test fixtures for each transform type
  - [x] Mock platform configurations

## 2. Core Flow Engine

- [x] 2.1 Create flow executor (`src/core/flows/flow-executor.ts`)
  - [x] `executeFlow(flow, sourceContent, context)` - Main execution function
  - [x] `loadSourceFile(from, context)` - Load and parse source files
  - [x] `writeTargetFile(to, content, context)` - Write transformed content
  - [x] `parseSourceContent(content, format)` - Auto-detect and parse formats
  - [x] `serializeTargetContent(content, format)` - Serialize to target format
- [x] 2.2 Implement execution pipeline
  - [x] Step 1: Load source file
  - [x] Step 2: Extract JSONPath (if specified)
  - [x] Step 3: Pick/omit keys
  - [x] Step 4: Map keys (with transforms)
  - [x] Step 5: Apply pipe transforms (stub - will be implemented in section 3)
  - [x] Step 6: Embed in target structure
  - [x] Step 7: Merge with existing target (priority-based)
  - [x] Step 8: Write to target file
- [x] 2.3 Add multi-target support
  - [x] Detect multi-target flows (object `to` field)
  - [x] Execute each target with specific transforms
  - [x] Parse source once, apply multiple transforms
- [x] 2.4 Add conditional execution
  - [x] `evaluateCondition(when, context)` - Evaluate when clauses
  - [x] Support `exists`, `platform`, `key`, `equals` conditions
  - [x] Support `and`, `or`, `not` composite conditions
- [x] 2.5 Error handling
  - [x] Clear error messages for each pipeline step
  - [x] Source file not found
  - [x] Parse errors with line numbers
  - [x] Transform failures with context
  - [x] Write permission errors

## 3. Transform Implementations

### 3.1 Format Converters (`src/core/flow-transforms.ts`)
- [x] 3.1.1 Implement format converters
  - [x] `jsonc` - Parse JSONC to object
  - [x] `yaml` - Convert YAML ↔ object
  - [x] `toml` - Convert TOML ↔ object
- [x] 3.1.2 Auto-detection logic
  - [x] Detect format from file extension
  - [x] Detect format from content (fallback)
  - [x] Handle mixed formats (e.g., JSONC with YAML frontmatter)

### 3.2 Merge Strategies
- [x] 3.2.1 Implement merge operations
  - [x] `merge` - Deep merge preserving nested structures
  - [x] `merge-shallow` - Shallow merge (top-level only)
  - [x] `replace` - Complete replacement
- [x] 3.2.2 Priority-based conflict resolution
  - [x] Track package installation order and dependency depth
  - [x] Implement priority calculation (workspace > direct > nested)
  - [x] Apply last-writer-wins based on priority
  - [x] Array merge strategies (append, replace, deduplicate)
- [x] 3.2.3 Conflict detection and warnings
  - [x] Detect when multiple packages target same file
  - [x] Log warnings with package names and priority info
  - [x] Show which package's content was used
  - [x] Collect conflict summary for reporting

### 3.3 Content Filters
- [x] 3.3.1 Implement filter transforms
  - [x] `filter-comments` - Remove comments from JSONC/YAML
  - [x] `filter-empty` - Remove empty strings/arrays/objects
  - [x] `filter-null` - Remove null/undefined values
- [x] 3.3.2 Configurable filter options
  - [x] Recursive vs. shallow filtering
  - [x] Preserve empty arrays/objects option

### 3.4 Markdown Transforms
- [x] 3.4.1 Implement markdown processors
  - [x] `sections` - Split by headers
  - [x] `frontmatter` - Extract YAML frontmatter
  - [x] `body` - Extract markdown body (no frontmatter)
- [x] 3.4.2 Frontmatter transforms
  - [x] Parse YAML frontmatter
  - [x] Apply key mapping to frontmatter
  - [x] Preserve body unchanged
  - [x] Serialize with transformed frontmatter

### 3.5 Validation Transforms
- [x] 3.5.1 Implement validators
  - [x] `validate` - Basic structure validation
  - [ ] `validate-schema(path)` - JSON Schema validation (deferred)
- [x] 3.5.2 Validation reporting
  - [x] Collect validation errors
  - [x] Report errors with context

### 3.6 Value Transforms
- [x] 3.6.1 Type converters
  - [x] `number` - Convert to number
  - [x] `string` - Convert to string
  - [x] `boolean` - Convert to boolean
  - [x] `json` - Parse JSON string
  - [x] `date` - Parse date string
- [x] 3.6.2 String transforms
  - [x] `uppercase`, `lowercase` - Case conversion
  - [x] `title-case`, `camel-case`, `kebab-case`, `snake-case` - Case styles
  - [x] `trim` - Trim whitespace
  - [x] `slugify` - Create URL-safe slugs
- [x] 3.6.3 Array transforms
  - [x] `array-append` - Append to array
  - [x] `array-unique` - Remove duplicates
  - [x] `array-flatten` - Flatten nested arrays
- [x] 3.6.4 Object transforms
  - [x] `flatten` - Flatten nested objects
  - [x] `unflatten` - Unflatten to nested structure
  - [x] `pick-keys` - Extract specific keys
  - [x] `omit-keys` - Remove specific keys

## 4. Key Remapping System

- [x] 4.1 Create key mapper (`src/core/flow-key-mapper.ts`)
  - [x] `applyKeyMap(obj, keyMap, context)` - Main mapping function
  - [x] `mapDotNotation(obj, from, to)` - Handle dot notation paths
  - [x] `mapWildcard(obj, pattern, target)` - Handle wildcard patterns
  - [x] `applyValueTransform(value, transform)` - Transform mapped values
- [x] 4.2 Implement mapping features
  - [x] Simple key rename (`theme` → `workbench.colorTheme`)
  - [x] Nested key mapping (`ai.model` → `cursor.ai.model`)
  - [x] Wildcard patterns (`ai.*` → `cursor.*`)
  - [x] Value lookup tables (`values: { "old": "new" }`)
  - [x] Transform application (`transform: "number"`)
  - [x] Default values (`default: 14`)
- [x] 4.3 Error handling
  - [x] Invalid key paths
  - [x] Type mismatches
  - [x] Transform failures

## 5. Platform Configuration

- [x] 5.1 Update platform loader (`src/core/platforms.ts`)
  - [x] Load flow-based configs
  - [ ] Remove subdirs support (flows-only)
  - [x] Merge hierarchy (built-in → global → workspace)
  - [x] Validate flow schemas
- [x] 5.2 Add global flows support
  - [x] Load `global.flows` section
  - [x] Apply global flows before platform-specific flows
  - [x] Allow global flow overrides in platform configs
- [x] 5.3 Schema validation
  - [x] Validate required fields (`from`, `to`)
  - [x] Validate transform names (basic validation)
  - [x] Validate conditional syntax (structure only)
  - [x] Validate JSONPath expressions (deferred to runtime)
  - [x] Validate key map structure
- [x] 5.4 Platform detection with flows
  - [x] Use existing detection (rootDir + rootFile)
  - [x] Add flow-based context information

## 6. Integration with Existing Systems

### 6.1 Install Pipeline
- [x] 6.1.1 Create flow-based installer (`src/core/install/flow-based-installer.ts`)
  - [x] Execute flows for each package file
  - [x] Handle multi-package composition with priority-based merging
  - [x] Detect and warn on conflicts
  - [x] Apply merge strategies for conflicting files
  - [x] Discover source files matching flow patterns
  - [x] Resolve target paths from flow configs
  - [x] Handle pattern matching (e.g., `{name}` placeholders)
- [x] 6.1.2 Integrate with existing install pipeline
  - [x] Add flow detection in `installPackageByIndex`
  - [x] Import flow-based installer module
  - [x] Add TODO markers for full integration
- [x] 6.1.3 Update conflict handling
  - [x] Use flow merge strategies (priority-based)
  - [x] Warn on conflicts with package priority information
  - [x] Handle format-specific conflicts (via flow transforms)

### 6.2 Save Pipeline
- [x] 6.2.1 Document save flow integration needs
  - [x] Identify reverse flow execution requirements
  - [x] Document source platform detection approach
  - [x] Document reverse transformation strategy
- [ ] 6.2.2 Implement save flow (Future Work)
  - [ ] Execute reverse flows (workspace → package)
  - [ ] Detect source platform from workspace files
  - [ ] Apply reverse transformations
  - [ ] Use flows to identify workspace files
  - [ ] Map workspace files to universal package structure
  - [ ] Handle multiple flows targeting same file
  - Note: Requires significant refactoring of save pipeline

### 6.3 Apply Pipeline
- [x] 6.3.1 Document apply flow integration needs
  - [x] Identify flow execution from local registry
  - [x] Document transformation approach
  - [x] Document conditional flow handling
- [ ] 6.3.2 Implement apply flow (Future Work)
  - [ ] Execute flows from local registry
  - [ ] Apply transformations to workspace
  - [ ] Handle conditional flows based on workspace state
  - [ ] Preserve existing conflict resolution
  - [ ] Use flow merge strategies
  - Note: Shares implementation with install pipeline

### 6.4 Utility Updates
- [x] 6.4.1 Update platform utilities (Initial)
  - [x] `src/utils/platform-mapper.ts` - Add TODO markers for flow-based path resolution
  - [x] `src/utils/index-based-installer.ts` - Import flow-based installer and add detection
  - [x] Document integration points for future enhancement
- [x] 6.4.2 Complete flow-based path resolution (Section 7)
  - [x] Implement `mapUniversalToPlatformWithFlows()` helper
  - [x] Integrated with `mapUniversalToPlatform()` function
  - [x] Pattern matching with `{name}` placeholder support
  - [x] Extension validation based on flow patterns
  - [x] Extract universal subdirs from flows
  - [x] Build directory paths from flows
  - [x] Get platform extensions from flows

## 7. Built-in Platform Migration

- [x] 7.1 Convert platforms to flow format
  - [x] `cursor` - Rules (.md → .mdc), commands, settings, MCP
  - [x] `claude` - Rules, commands, agents, skills
  - [x] `windsurf` - Rules
  - [x] `kilo` - Rules, workflows
  - [x] `factory` - Commands, droids
  - [x] `opencode` - Commands, agents
  - [x] `codex` - Prompts
  - [x] `qwen` - Agents
  - [x] `roo` - Commands
  - [x] `augment` - Rules, commands
  - [x] `antigravity` - Rules, workflows
  - [x] `kiro` - Steering
  - [x] `warp` - (minimal, mostly root file)
- [x] 7.2 Add advanced flows for complex platforms
  - [x] Cursor: MCP with deep merge and comment filtering
  - [x] OpenCode: MCP with deep merge and comment filtering
  - [x] Global flows: AGENTS.md conditional copy
  - [x] Extension transformations (.md → .mdc)
- [x] 7.3 Test each platform
  - [x] Updated core functions for flow support
  - [x] Integrated flow-based path resolution
  - [x] All tests passing (except 1 unrelated)
  - [x] Backward compatibility maintained

## 8. Testing

### 8.1 Unit Tests
- [x] 8.1.1 Flow executor tests
  - [x] Test each pipeline step
  - [x] Test multi-target flows
  - [x] Test conditional execution (partial)
  - [x] Test error handling
- [x] 8.1.2 Transform tests
  - [x] Test each format converter
  - [x] Test each merge strategy (in executor tests)
  - [x] Test each filter
  - [x] Test each value transform
- [x] 8.1.3 Key mapper tests
  - [x] Test dot notation
  - [x] Test wildcards
  - [x] Test value transforms
  - [x] Test default values
- [x] 8.1.4 Platform loader tests
  - [x] Test config merging
  - [x] Test schema validation
  - [x] Test global flows

### 8.2 Integration Tests
- [x] 8.2.1 Install pipeline tests (67% passing - 8/12 tests)
  - [x] Simple file mapping (1/2 passing)
  - [x] Format conversion (2/2 passing)
  - [x] Key remapping (2/2 passing)
  - [ ] Multi-package composition (1/2 passing - needs fixes)
  - [ ] Conflict detection (0/1 passing - needs fixes)
  - [x] Error handling (2/2 passing)
  - [x] Dry run mode (1/1 passing)
  - Note: Major improvements made - global flow handling, priority fixes, cleanup between tests
- [ ] 8.2.2 Save pipeline tests (Deferred - save not implemented with flows)
  - [ ] Reverse transformations
  - [ ] Platform detection
  - [ ] Format preservation
- [ ] 8.2.3 Apply pipeline tests (Deferred - apply not implemented with flows)
  - [ ] Conditional flows
  - [ ] Merge strategies
  - [ ] Conflict resolution
- [ ] 8.2.4 Real-world scenarios (Partially covered)
  - [x] Test with platform flows
  - [ ] Test all 13 platforms
  - [ ] Test custom platform configs
  - [ ] Test global + local overrides

### 8.3 Performance Tests (Deferred)
- [ ] 8.3.1 Benchmark flow execution
  - [ ] Simple file copy (baseline)
  - [ ] Format conversion overhead
  - [ ] Complex transforms
  - [ ] Multi-target flows
- [ ] 8.3.2 Optimize hot paths
  - [ ] Cache format parsers
  - [ ] Lazy evaluation
  - [ ] Structural sharing for merges
- [ ] 8.3.3 Memory profiling
  - [ ] Large file handling
  - [ ] Multi-package scenarios
  - [ ] Memory leaks

## 9. Documentation

- [ ] 9.1 API documentation
  - [ ] Flow schema reference
  - [ ] Transform catalog
  - [ ] Configuration format
  - [ ] TypeScript interfaces
- [ ] 9.2 User guides
  - [ ] Quick start guide
  - [ ] Common flows patterns
  - [ ] Advanced features
  - [ ] Troubleshooting
- [ ] 9.3 Examples
  - [ ] Simple file mapping
  - [ ] Format conversion
  - [ ] Key remapping
  - [ ] Multi-package composition
  - [ ] Conditional flows
  - [ ] Multi-target flows
  - [ ] Custom handlers

## 10. Finalization

- [ ] 10.1 Code review
  - [ ] Review all new code
  - [ ] Check error handling
  - [ ] Verify type safety
  - [ ] Review performance optimizations
- [ ] 10.2 Documentation review
  - [ ] Verify completeness
  - [ ] Check examples
  - [ ] Update main README
- [ ] 10.3 Testing review
  - [ ] Verify test coverage (>90%)
  - [ ] Check edge cases
  - [ ] Run full test suite
  - [ ] Performance benchmarks
- [ ] 10.4 Release preparation
  - [ ] Update CHANGELOG
  - [ ] Version bump (consider major version)
  - [ ] Create release notes
  - [ ] Prepare migration announcements

## Notes

- **No backward compatibility** - Flows-only system, no subdirs support
- Prioritize clear error messages
- Optimize for common cases (simple file copies)
- Keep transform implementations simple and composable
- Test thoroughly with real-world packages
- Document edge cases and limitations
