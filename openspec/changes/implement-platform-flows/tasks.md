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
  - [x] Support both subdirs and flows (transition period)
  - [x] Merge hierarchy (built-in → global → workspace)
  - [x] Validate flow schemas
  - [x] Generate warnings for deprecated subdirs
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
- [ ] 6.2.2 Implement save flow (Deferred to Section 7)
  - [ ] Execute reverse flows (workspace → package)
  - [ ] Detect source platform from workspace files
  - [ ] Apply reverse transformations
  - [ ] Use flows to identify workspace files
  - [ ] Map workspace files to universal package structure
  - [ ] Handle multiple flows targeting same file

### 6.3 Apply Pipeline
- [x] 6.3.1 Document apply flow integration needs
  - [x] Identify flow execution from local registry
  - [x] Document transformation approach
  - [x] Document conditional flow handling
- [ ] 6.3.2 Implement apply flow (Deferred to Section 7)
  - [ ] Execute flows from local registry
  - [ ] Apply transformations to workspace
  - [ ] Handle conditional flows based on workspace state
  - [ ] Preserve existing conflict resolution
  - [ ] Use flow merge strategies

### 6.4 Utility Updates
- [x] 6.4.1 Update platform utilities (Initial)
  - [x] `src/utils/platform-mapper.ts` - Add TODO markers for flow-based path resolution
  - [x] `src/utils/index-based-installer.ts` - Import flow-based installer and add detection
  - [x] Document integration points for future enhancement
- [ ] 6.4.2 Complete flow-based path resolution (Deferred to Section 7)
  - [ ] Implement `mapUniversalToPlatformWithFlows()` helper
  - [ ] Update `src/utils/platform-file.ts` for flow-based operations
  - [ ] Update `src/utils/path-resolution.ts` for flow-based path mapping
  - [ ] Update `src/utils/custom-path-resolution.ts` for flow patterns

## 7. Built-in Platform Migration

- [ ] 7.1 Convert platforms to flow format
  - [ ] `cursor` - Rules (.md → .mdc), commands, settings, MCP
  - [ ] `claude` - Rules, commands, agents (with frontmatter transforms), skills
  - [ ] `windsurf` - Rules
  - [ ] `kilo` - Rules, workflows
  - [ ] `factory` - Commands, droids
  - [ ] `opencode` - Commands, agents
  - [ ] `codex` - Prompts
  - [ ] `qwen` - Agents
  - [ ] `roo` - Commands
  - [ ] `augment` - Rules, commands
  - [ ] `antigravity` - Rules, workflows
  - [ ] `kiro` - Steering
  - [ ] `warp` - (minimal, mostly root file)
- [ ] 7.2 Add advanced flows for complex platforms
  - [ ] Cursor: MCP with priority-based merging
  - [ ] Claude: Agent frontmatter transforms
  - [ ] Multi-target MCP flows (Cursor, OpenCode, Codex)
- [ ] 7.3 Test each platform
  - [ ] Install packages for each platform
  - [ ] Verify file transformations
  - [ ] Test multi-package scenarios
  - [ ] Validate merge behavior

## 8. CLI Commands and Tooling

- [ ] 8.1 Add validation command
  - [ ] `opkg validate platforms` - Validate platform configs
  - [ ] Check flow syntax
  - [ ] Validate transform names
  - [ ] Check for circular dependencies
  - [ ] Report warnings and errors
- [ ] 8.2 Enhance status command
  - [ ] `opkg status` - Show detected platforms
  - [ ] List enabled flows for each platform
  - [ ] Show global flows
  - [ ] Display flow execution summary
- [ ] 8.3 Enhance dry-run mode
  - [ ] `opkg install --dry-run` - Preview flow execution
  - [ ] Show source → target mappings
  - [ ] Display transform pipeline for each file
  - [ ] Preview merge conflicts
- [ ] 8.4 Add debug logging
  - [ ] `DEBUG=opkg:flows` environment variable
  - [ ] Log flow execution steps
  - [ ] Log transform application
  - [ ] Log merge operations
  - [ ] Log conditional evaluation

## 9. Migration Tooling

- [ ] 9.1 Create migration utilities
  - [ ] `convertSubdirsToFlows(platform)` - Auto-convert subdirs to flows
  - [ ] Detect simple mappings
  - [ ] Preserve extension transformations
  - [ ] Generate flow configs
- [ ] 9.2 Add migration warnings
  - [ ] Detect old subdirs format
  - [ ] Show migration instructions
  - [ ] Provide conversion examples
- [ ] 9.3 Create migration guide
  - [ ] Document conversion process
  - [ ] Provide examples for each pattern
  - [ ] Include troubleshooting section

## 10. Testing

### 10.1 Unit Tests
- [ ] 10.1.1 Flow executor tests
  - [ ] Test each pipeline step
  - [ ] Test multi-target flows
  - [ ] Test conditional execution
  - [ ] Test error handling
- [ ] 10.1.2 Transform tests
  - [ ] Test each format converter
  - [ ] Test each merge strategy
  - [ ] Test each filter
  - [ ] Test each value transform
- [ ] 10.1.3 Key mapper tests
  - [ ] Test dot notation
  - [ ] Test wildcards
  - [ ] Test value transforms
  - [ ] Test default values
- [ ] 10.1.4 Platform loader tests
  - [ ] Test config merging
  - [ ] Test schema validation
  - [ ] Test global flows
  - [ ] Test backward compatibility

### 10.2 Integration Tests
- [ ] 10.2.1 Install pipeline tests
  - [ ] Simple file mapping
  - [ ] Format conversion
  - [ ] Key remapping
  - [ ] Multi-package composition
  - [ ] Namespace isolation
- [ ] 10.2.2 Save pipeline tests
  - [ ] Reverse transformations
  - [ ] Platform detection
  - [ ] Format preservation
- [ ] 10.2.3 Apply pipeline tests
  - [ ] Conditional flows
  - [ ] Merge strategies
  - [ ] Conflict resolution
- [ ] 10.2.4 Real-world scenarios
  - [ ] Test with actual packages
  - [ ] Test all 13 platforms
  - [ ] Test custom platform configs
  - [ ] Test global + local overrides

### 10.3 Performance Tests
- [ ] 10.3.1 Benchmark flow execution
  - [ ] Simple file copy (baseline)
  - [ ] Format conversion overhead
  - [ ] Complex transforms
  - [ ] Multi-target flows
- [ ] 10.3.2 Optimize hot paths
  - [ ] Cache format parsers
  - [ ] Lazy evaluation
  - [ ] Structural sharing for merges
- [ ] 10.3.3 Memory profiling
  - [ ] Large file handling
  - [ ] Multi-package scenarios
  - [ ] Memory leaks

### 10.4 Migration Tests
- [ ] 10.4.1 Subdirs to flows conversion
  - [ ] Test auto-conversion
  - [ ] Verify behavior equivalence
  - [ ] Test with custom configs
- [ ] 10.4.2 Backward compatibility
  - [ ] Support both formats during transition
  - [ ] Verify no breaking changes for default configs

## 11. Documentation

- [ ] 11.1 API documentation
  - [ ] Flow schema reference
  - [ ] Transform catalog
  - [ ] Configuration format
  - [ ] TypeScript interfaces
- [ ] 11.2 User guides
  - [ ] Quick start guide
  - [ ] Common patterns
  - [ ] Advanced features
  - [ ] Troubleshooting
- [ ] 11.3 Migration guide
  - [ ] Subdirs to flows conversion
  - [ ] Custom platform migration
  - [ ] Breaking changes
  - [ ] Migration timeline
- [ ] 11.4 Examples
  - [ ] Simple file mapping
  - [ ] Format conversion
  - [ ] Key remapping
  - [ ] Multi-package composition
  - [ ] Conditional flows
  - [ ] Multi-target flows
  - [ ] Custom handlers

## 12. Finalization

- [ ] 12.1 Code review
  - [ ] Review all new code
  - [ ] Check error handling
  - [ ] Verify type safety
  - [ ] Review performance optimizations
- [ ] 12.2 Documentation review
  - [ ] Verify completeness
  - [ ] Check examples
  - [ ] Review migration guide
  - [ ] Update main README
- [ ] 12.3 Testing review
  - [ ] Verify test coverage (>90%)
  - [ ] Check edge cases
  - [ ] Run full test suite
  - [ ] Performance benchmarks
- [ ] 12.4 Release preparation
  - [ ] Update CHANGELOG
  - [ ] Version bump (consider major version)
  - [ ] Create release notes
  - [ ] Prepare migration announcements

## Notes

- Maintain backward compatibility during transition
- Prioritize clear error messages
- Optimize for common cases (simple file copies)
- Keep transform implementations simple and composable
- Test thoroughly with real-world packages
- Document edge cases and limitations
