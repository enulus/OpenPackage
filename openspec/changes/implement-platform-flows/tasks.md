# Implementation Tasks: Platform Flows System

## 1. Prerequisites and Setup

- [ ] 1.1 Install new dependencies
  - [ ] `@iarna/toml` for TOML parsing
  - [ ] `jsonpath-plus` for JSONPath queries
- [ ] 1.2 Create type definitions
  - [ ] `src/types/flows.ts` - Flow, FlowConfig, Transform types
  - [ ] `src/types/platform-flows.ts` - PlatformsConfig, MultiTargetFlows types
- [ ] 1.3 Create JSON schema
  - [ ] `schemas/platforms-v1.json` - JSON Schema for platforms.jsonc
  - [ ] Include all flow fields and validation rules
  - [ ] Add descriptions for IDE autocomplete
  - [ ] Test schema with example configs
- [ ] 1.4 Set up test infrastructure
  - [ ] `tests/flows/` directory structure
  - [ ] Test fixtures for each transform type
  - [ ] Mock platform configurations

## 2. Core Flow Engine

- [ ] 2.1 Create flow executor (`src/core/flow-executor.ts`)
  - [ ] `executeFlow(flow, sourceContent, context)` - Main execution function
  - [ ] `loadSourceFile(from, context)` - Load and parse source files
  - [ ] `writeTargetFile(to, content, context)` - Write transformed content
  - [ ] `parseSourceContent(content, format)` - Auto-detect and parse formats
  - [ ] `serializeTargetContent(content, format)` - Serialize to target format
- [ ] 2.2 Implement execution pipeline
  - [ ] Step 1: Load source file
  - [ ] Step 2: Extract JSONPath (if specified)
  - [ ] Step 3: Pick/omit keys
  - [ ] Step 4: Map keys (with transforms)
  - [ ] Step 5: Apply pipe transforms
  - [ ] Step 6: Embed in target structure
  - [ ] Step 7: Merge with existing target (priority-based)
  - [ ] Step 8: Write to target file
- [ ] 2.3 Add multi-target support
  - [ ] Detect multi-target flows (object `to` field)
  - [ ] Execute each target with specific transforms
  - [ ] Parse source once, apply multiple transforms
- [ ] 2.4 Add conditional execution
  - [ ] `evaluateCondition(when, context)` - Evaluate when clauses
  - [ ] Support `exists`, `platform`, `key`, `equals` conditions
  - [ ] Support `and`, `or` composite conditions
- [ ] 2.5 Error handling
  - [ ] Clear error messages for each pipeline step
  - [ ] Source file not found
  - [ ] Parse errors with line numbers
  - [ ] Transform failures with context
  - [ ] Write permission errors

## 3. Transform Implementations

### 3.1 Format Converters (`src/core/flow-transforms.ts`)
- [ ] 3.1.1 Implement format converters
  - [ ] `jsonc` - Parse JSONC to object
  - [ ] `yaml` - Convert YAML ↔ object
  - [ ] `toml` - Convert TOML ↔ object
- [ ] 3.1.2 Auto-detection logic
  - [ ] Detect format from file extension
  - [ ] Detect format from content (fallback)
  - [ ] Handle mixed formats (e.g., JSONC with YAML frontmatter)

### 3.2 Merge Strategies
- [ ] 3.2.1 Implement merge operations
  - [ ] `merge` - Deep merge preserving nested structures
  - [ ] `merge-shallow` - Shallow merge (top-level only)
  - [ ] `replace` - Complete replacement
- [ ] 3.2.2 Priority-based conflict resolution
  - [ ] Track package installation order and dependency depth
  - [ ] Implement priority calculation (workspace > direct > nested)
  - [ ] Apply last-writer-wins based on priority
  - [ ] Array merge strategies (append, replace, deduplicate)
- [ ] 3.2.3 Conflict detection and warnings
  - [ ] Detect when multiple packages target same file
  - [ ] Log warnings with package names and priority info
  - [ ] Show which package's content was used
  - [ ] Collect conflict summary for reporting

### 3.3 Content Filters
- [ ] 3.3.1 Implement filter transforms
  - [ ] `filter-comments` - Remove comments from JSONC/YAML
  - [ ] `filter-empty` - Remove empty strings/arrays/objects
  - [ ] `filter-null` - Remove null/undefined values
- [ ] 3.3.2 Configurable filter options
  - [ ] Recursive vs. shallow filtering
  - [ ] Preserve empty arrays/objects option

### 3.4 Markdown Transforms
- [ ] 3.4.1 Implement markdown processors
  - [ ] `sections` - Split by headers
  - [ ] `frontmatter` - Extract YAML frontmatter
  - [ ] `body` - Extract markdown body (no frontmatter)
- [ ] 3.4.2 Frontmatter transforms
  - [ ] Parse YAML frontmatter
  - [ ] Apply key mapping to frontmatter
  - [ ] Preserve body unchanged
  - [ ] Serialize with transformed frontmatter

### 3.5 Validation Transforms
- [ ] 3.5.1 Implement validators
  - [ ] `validate` - Basic structure validation
  - [ ] `validate-schema(path)` - JSON Schema validation
- [ ] 3.5.2 Validation reporting
  - [ ] Collect validation errors
  - [ ] Report errors with context

### 3.6 Value Transforms
- [ ] 3.6.1 Type converters
  - [ ] `number` - Convert to number
  - [ ] `string` - Convert to string
  - [ ] `boolean` - Convert to boolean
  - [ ] `json` - Parse JSON string
  - [ ] `date` - Parse date string
- [ ] 3.6.2 String transforms
  - [ ] `uppercase`, `lowercase` - Case conversion
  - [ ] `title-case`, `camel-case`, `kebab-case`, `snake-case` - Case styles
  - [ ] `trim` - Trim whitespace
  - [ ] `slugify` - Create URL-safe slugs
- [ ] 3.6.3 Array transforms
  - [ ] `array-append` - Append to array
  - [ ] `array-unique` - Remove duplicates
  - [ ] `array-flatten` - Flatten nested arrays
- [ ] 3.6.4 Object transforms
  - [ ] `flatten` - Flatten nested objects
  - [ ] `unflatten` - Unflatten to nested structure
  - [ ] `pick-keys` - Extract specific keys
  - [ ] `omit-keys` - Remove specific keys

## 4. Key Remapping System

- [ ] 4.1 Create key mapper (`src/core/flow-key-mapper.ts`)
  - [ ] `applyKeyMap(obj, keyMap, context)` - Main mapping function
  - [ ] `mapDotNotation(obj, from, to)` - Handle dot notation paths
  - [ ] `mapWildcard(obj, pattern, target)` - Handle wildcard patterns
  - [ ] `applyValueTransform(value, transform)` - Transform mapped values
- [ ] 4.2 Implement mapping features
  - [ ] Simple key rename (`theme` → `workbench.colorTheme`)
  - [ ] Nested key mapping (`ai.model` → `cursor.ai.model`)
  - [ ] Wildcard patterns (`ai.*` → `cursor.*`)
  - [ ] Value lookup tables (`values: { "old": "new" }`)
  - [ ] Transform application (`transform: "number"`)
  - [ ] Default values (`default: 14`)
- [ ] 4.3 Error handling
  - [ ] Invalid key paths
  - [ ] Type mismatches
  - [ ] Transform failures

## 5. Platform Configuration

- [ ] 5.1 Update platform loader (`src/core/platforms.ts`)
  - [ ] Load flow-based configs
  - [ ] Support both subdirs and flows (transition period)
  - [ ] Merge hierarchy (built-in → global → workspace)
  - [ ] Validate flow schemas
  - [ ] Generate warnings for deprecated subdirs
- [ ] 5.2 Add global flows support
  - [ ] Load `global.flows` section
  - [ ] Apply global flows before platform-specific flows
  - [ ] Allow global flow overrides in platform configs
- [ ] 5.3 Schema validation
  - [ ] Validate required fields (`from`, `to`)
  - [ ] Validate transform names
  - [ ] Validate conditional syntax
  - [ ] Validate JSONPath expressions
  - [ ] Validate key map structure
- [ ] 5.4 Platform detection with flows
  - [ ] Use existing detection (rootDir + rootFile)
  - [ ] Add flow-based context information

## 6. Integration with Existing Systems

### 6.1 Install Pipeline
- [ ] 6.1.1 Update install flow (`src/core/install/install-pipeline.ts`)
  - [ ] Replace subdirs resolution with flow execution
  - [ ] Execute flows for each package file
  - [ ] Handle multi-package composition with priority-based merging
  - [ ] Detect and warn on conflicts
  - [ ] Apply merge strategies for conflicting files
- [ ] 6.1.2 Update file discovery (`src/core/install/install-file-discovery.ts`)
  - [ ] Discover source files matching flow patterns
  - [ ] Resolve target paths from flow configs
  - [ ] Handle pattern matching (e.g., `{name}` placeholders)
- [ ] 6.1.3 Update conflict handling (`src/utils/install-conflict-handler.ts`)
  - [ ] Use flow merge strategies (priority-based)
  - [ ] Warn on conflicts with package priority information
  - [ ] Handle format-specific conflicts

### 6.2 Save Pipeline
- [ ] 6.2.1 Update save flow (`src/core/save/save-pipeline.ts`)
  - [ ] Execute reverse flows (workspace → package)
  - [ ] Detect source platform from workspace files
  - [ ] Apply reverse transformations
- [ ] 6.2.2 Update file discovery (`src/core/save/save-file-discovery.ts`)
  - [ ] Use flows to identify workspace files
  - [ ] Map workspace files to universal package structure
  - [ ] Handle multiple flows targeting same file

### 6.3 Apply Pipeline
- [ ] 6.3.1 Update apply flow (`src/core/apply/apply-pipeline.ts`)
  - [ ] Execute flows from local registry
  - [ ] Apply transformations to workspace
  - [ ] Handle conditional flows based on workspace state
- [ ] 6.3.2 Integration with existing apply logic
  - [ ] Preserve existing conflict resolution
  - [ ] Use flow merge strategies

### 6.4 Utility Updates
- [ ] 6.4.1 Update platform utilities
  - [ ] `src/utils/platform-mapper.ts` - Use flows for path resolution
  - [ ] `src/utils/platform-file.ts` - Flow-based file operations
  - [ ] `src/utils/platform-utils.ts` - Flow-aware platform queries
- [ ] 6.4.2 Update path resolution
  - [ ] `src/utils/path-resolution.ts` - Flow-based path mapping
  - [ ] `src/utils/custom-path-resolution.ts` - Support flow patterns

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
