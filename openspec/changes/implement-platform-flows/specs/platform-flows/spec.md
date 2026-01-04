# Platform Flows Specification

## ADDED Requirements

### Requirement: Flow Configuration Schema

The system SHALL support declarative flow configurations in `platforms.jsonc` with the following structure:

- **Global flows**: Optional `global.flows` array that applies to all platforms
- **Platform flows**: Per-platform `flows` array defining transformations
- **Flow schema**: Each flow MUST have `from` (source pattern) and `to` (target path or multi-target object)
- **Transform options**: Optional `pipe`, `map`, `pick`, `omit`, `path`, `embed`, `section`, `when`, `merge`, `handler` fields
- **Multi-target**: Support object-based `to` field mapping one source to multiple targets
- **Validation**: Validate flow schemas on load with clear error messages

#### Scenario: Simple file mapping flow

- **WHEN** a flow defines `{ "from": "rules/{name}.md", "to": ".cursor/rules/{name}.mdc" }`
- **THEN** files matching the pattern are copied with extension transformation

#### Scenario: Multi-target flow with different transforms

- **WHEN** a flow defines multiple targets with different transform options
- **THEN** source is parsed once and transformed differently for each target

#### Scenario: Invalid flow schema

- **WHEN** a flow is missing required fields or has invalid types
- **THEN** configuration load fails with clear error indicating the issue

### Requirement: Flow Execution Pipeline

The system SHALL execute flows through a multi-stage pipeline:

1. **Load**: Read source file and auto-detect format (YAML, JSON, JSONC, TOML, Markdown)
2. **Extract**: Apply JSONPath extraction if `path` is specified
3. **Filter**: Apply `pick` (whitelist) or `omit` (blacklist) key filters
4. **Map**: Transform keys and values using `map` configuration
5. **Transform**: Apply pipe transforms in order
6. **Embed**: Wrap content under specified key if `embed` is set
7. **Merge**: Merge with existing target file using priority-based strategy
8. **Write**: Serialize to target format and write to disk

#### Scenario: Simple format conversion

- **WHEN** a YAML file flows to JSON target with no transforms
- **THEN** content is parsed as YAML, converted to JSON, and written

#### Scenario: Complex transformation pipeline

- **WHEN** a flow defines `path`, `map`, `pipe`, and `embed` options
- **THEN** transformations are applied in pipeline order

#### Scenario: Pipeline stage failure

- **WHEN** any pipeline stage fails (parse error, transform error, write error)
- **THEN** execution stops and error is reported with context

### Requirement: Format Conversion Transforms

The system SHALL support bidirectional format conversion for common configuration formats:

- **JSONC**: Parse JSON with comments, strip comments when converting to strict JSON
- **YAML**: Convert between YAML and JSON object representations
- **TOML**: Convert between TOML and JSON object representations
- **Auto-detection**: Detect format from file extension or content analysis

#### Scenario: YAML to JSON conversion

- **WHEN** source is YAML and target is JSON
- **THEN** content is parsed as YAML and serialized as JSON

#### Scenario: JSONC to JSON conversion

- **WHEN** source is JSONC and target is JSON
- **THEN** comments are stripped during conversion

#### Scenario: Format auto-detection

- **WHEN** file extension is ambiguous or missing
- **THEN** format is detected by parsing content with multiple parsers

### Requirement: Merge Strategies

The system SHALL support multiple merge strategies when combining content:

- **Deep merge** (`merge: "deep"`): Recursively merge nested objects and arrays
- **Shallow merge** (`merge: "shallow"`): Merge only top-level keys
- **Replace** (default): Completely replace target content with source
- **Array handling**: Configurable strategies (append, replace, deduplicate)

#### Scenario: Deep merge of nested objects

- **WHEN** two JSON files are merged with `merge: "deep"`
- **THEN** nested objects are recursively merged, preserving non-overlapping keys

#### Scenario: Shallow merge of top-level keys

- **WHEN** two JSON files are merged with `merge: "shallow"`
- **THEN** only top-level keys are merged, nested objects are replaced

#### Scenario: Replace strategy (default)

- **WHEN** no merge strategy is specified
- **THEN** target file is completely replaced with source content

### Requirement: Key Mapping and Remapping

The system SHALL support sophisticated key transformations:

- **Dot notation**: Map flat or nested keys using dot paths (`theme` → `workbench.colorTheme`)
- **Wildcard patterns**: Map multiple keys using wildcards (`ai.*` → `cursor.*`)
- **Value transforms**: Apply type or string transforms to values during mapping
- **Value lookup tables**: Map values to platform-specific equivalents
- **Default values**: Provide fallback values for missing keys
- **Precedence**: Explicit mappings override wildcards, later mappings override earlier

#### Scenario: Simple key rename with dot notation

- **WHEN** map defines `{ "theme": "workbench.colorTheme" }`
- **THEN** key `theme` is moved to nested path `workbench.colorTheme`

#### Scenario: Wildcard key mapping

- **WHEN** map defines `{ "ai.*": "cursor.*" }`
- **THEN** all keys under `ai` are moved under `cursor` key path

#### Scenario: Value transformation during mapping

- **WHEN** map defines `{ "fontSize": { "to": "editor.fontSize", "transform": "number" } }`
- **THEN** value is converted to number and moved to target key

#### Scenario: Value lookup table

- **WHEN** map defines a `values` lookup table
- **THEN** source values are replaced with corresponding target values from table

#### Scenario: Default value for missing key

- **WHEN** map defines `default` and source key is missing
- **THEN** default value is used in target

### Requirement: Markdown Frontmatter Transforms

The system SHALL support transforming YAML frontmatter in Markdown files while preserving body:

- **Parse frontmatter**: Extract YAML frontmatter from Markdown
- **Transform frontmatter**: Apply key mapping and transforms to frontmatter only
- **Preserve body**: Keep Markdown body content unchanged
- **Serialize**: Reconstruct file with transformed frontmatter and original body

#### Scenario: Transform agent frontmatter

- **WHEN** an agent Markdown file has frontmatter with `role` and `model` keys
- **AND** map defines transformations for these keys
- **THEN** frontmatter keys/values are transformed and body is preserved

#### Scenario: Add frontmatter keys

- **WHEN** map defines new keys with default values
- **THEN** new keys are added to frontmatter without affecting body

#### Scenario: Remove frontmatter keys

- **WHEN** omit list includes frontmatter keys
- **THEN** specified keys are removed from frontmatter without affecting body

### Requirement: Multi-Package Composition with Priority-Based Merging

The system SHALL support composition of content from multiple packages using priority-based conflict resolution:

- **Priority order**: Workspace content > direct dependencies > nested dependencies (shallower = higher priority)
- **Conflict detection**: Detect when multiple packages write to same file paths
- **Conflict warnings**: Log warnings when conflicts occur with package information
- **Last-writer-wins**: Package with highest priority overwrites conflicting content
- **Merge strategies**: Apply deep/shallow/replace merge based on flow configuration

#### Scenario: Direct dependency priority

- **WHEN** two direct dependencies define conflicting content for same target
- **THEN** package listed later in manifest wins (higher priority)
- **AND** warning is logged: "Package @scope/b overwrites content from @scope/a in .cursor/mcp.json"

#### Scenario: Nested vs direct dependency priority

- **WHEN** direct dependency and its nested dependency target same file
- **THEN** direct dependency wins (shallower = higher priority)
- **AND** warning is logged with dependency depth information

#### Scenario: Workspace content preservation

- **WHEN** workspace has manually-edited content in target file
- **THEN** workspace content is preserved (highest priority)
- **AND** package content does not overwrite manual edits

#### Scenario: Multi-package deep merge with priority

- **WHEN** multiple packages define flows to same target with `merge: "deep"`
- **THEN** content is deeply merged according to priority order
- **AND** conflicts at leaf nodes are resolved by priority (last-writer-wins)

### Requirement: Conditional Flow Execution

The system SHALL support conditional flow execution based on context:

- **Existence checks**: Execute flow only if file/directory exists (`exists: ".cursor"`)
- **Platform checks**: Execute flow only if platform is enabled (`platform: "cursor"`)
- **Key checks**: Execute flow only if source key exists (`key: "servers"`)
- **Value checks**: Execute flow only if key equals value (`equals: "production"`)
- **Composite conditions**: Support `and` and `or` operators for complex conditions

#### Scenario: Platform-conditional flow

- **WHEN** flow has `when: { "platform": "cursor" }`
- **THEN** flow executes only when Cursor platform is detected

#### Scenario: File existence check

- **WHEN** flow has `when: { "exists": ".cursor" }`
- **THEN** flow executes only if `.cursor` directory exists

#### Scenario: Composite AND condition

- **WHEN** flow has `when: { "and": [{ "platform": "cursor" }, { "exists": "mcp.jsonc" }] }`
- **THEN** flow executes only if both conditions are true

#### Scenario: Composite OR condition

- **WHEN** flow has `when: { "or": [{ "platform": "cursor" }, { "platform": "claude" }] }`
- **THEN** flow executes if either condition is true

### Requirement: Content Embedding and Sectioning

The system SHALL support embedding content within target structures:

- **JSON embedding**: Wrap content under specified key with `embed: "key"`
- **TOML sections**: Place content in TOML section with `section: "section_name"`
- **Merge with embedding**: Combine embedding with merge strategies

#### Scenario: Embed in JSON structure

- **WHEN** flow defines `embed: "mcp"` for JSON target
- **THEN** source content is wrapped under `{ "mcp": <content> }`

#### Scenario: TOML section embedding

- **WHEN** flow defines `section: "mcp_servers"` for TOML target
- **THEN** content is placed under `[mcp_servers]` section

#### Scenario: Embed and deep merge

- **WHEN** flow defines both `embed` and `merge: "deep"`
- **THEN** embedded content is merged with existing embedded section

### Requirement: Built-in Value Transforms

The system SHALL provide a comprehensive set of built-in value transforms:

**Type Converters:**
- `number`: Convert value to number
- `string`: Convert value to string
- `boolean`: Convert value to boolean
- `json`: Parse JSON string to object
- `date`: Parse date string to Date object

**String Transforms:**
- `uppercase`, `lowercase`: Case conversion
- `title-case`, `camel-case`, `kebab-case`, `snake-case`: Case style conversion
- `trim`: Remove leading/trailing whitespace
- `slugify`: Create URL-safe slug

**Array Transforms:**
- `array-append`: Append to existing array
- `array-unique`: Remove duplicate values
- `array-flatten`: Flatten nested arrays

**Object Transforms:**
- `flatten`: Flatten nested object to dot notation
- `unflatten`: Expand dot notation to nested object
- `pick-keys`: Extract specific keys
- `omit-keys`: Remove specific keys

#### Scenario: Type conversion transform

- **WHEN** transform is `number` and value is string "42"
- **THEN** value is converted to number 42

#### Scenario: String case transform

- **WHEN** transform is `kebab-case` and value is "helloWorld"
- **THEN** value is converted to "hello-world"

#### Scenario: Array deduplication

- **WHEN** transform is `array-unique` and value is `[1, 2, 2, 3]`
- **THEN** value is converted to `[1, 2, 3]`

#### Scenario: Object flattening

- **WHEN** transform is `flatten` and value is `{ "a": { "b": 1 } }`
- **THEN** value is converted to `{ "a.b": 1 }`

### Requirement: Configuration Merge Hierarchy

The system SHALL support a three-level merge hierarchy for platform configurations:

1. **Built-in**: Default configurations shipped with CLI (13 platforms)
2. **Global**: User overrides in `~/.openpackage/platforms.jsonc`
3. **Workspace**: Project-specific overrides in `<workspace>/.openpackage/platforms.jsonc`

Merge order: workspace > global > built-in (last writer wins)

#### Scenario: Global override of platform flows

- **WHEN** global config defines flows for "cursor" platform
- **THEN** global flows completely replace built-in flows for that platform

#### Scenario: Workspace override of specific platform

- **WHEN** workspace config defines flows for "cursor" platform
- **THEN** workspace flows override both global and built-in flows

#### Scenario: Add custom platform in workspace

- **WHEN** workspace config defines new platform not in built-in
- **THEN** custom platform is added with specified flows

#### Scenario: Disable platform in workspace

- **WHEN** workspace config sets `enabled: false` for platform
- **THEN** platform is skipped during flow execution

### Requirement: Flow Validation and Error Reporting

The system SHALL validate flow configurations and provide clear error messages:

- **Schema validation**: Validate required fields and types
- **Transform validation**: Verify transform names exist
- **JSONPath validation**: Validate JSONPath expression syntax
- **Circular dependency detection**: Detect and report circular flow dependencies
- **Context-rich errors**: Include file path, line number, and fix suggestions

#### Scenario: Missing required field

- **WHEN** flow is missing `from` or `to` field
- **THEN** validation fails with error "Flow missing required field 'from'"

#### Scenario: Invalid transform name

- **WHEN** flow references non-existent transform in `pipe`
- **THEN** validation fails with error "Unknown transform 'xyz'. Available: [list]"

#### Scenario: Invalid JSONPath expression

- **WHEN** flow defines invalid JSONPath in `path` field
- **THEN** validation fails with error "Invalid JSONPath expression: ..."

#### Scenario: Circular dependency detection

- **WHEN** flows create circular transformation dependency
- **THEN** validation fails with error "Circular dependency detected: A → B → A"

### Requirement: Performance Optimization

The system SHALL optimize flow execution for common cases:

- **Simple file copy bypass**: Skip pipeline for flows with no transforms
- **Parser caching**: Cache format parsers per file type
- **Single source parse**: Parse source once for multi-target flows
- **Lazy evaluation**: Evaluate conditional flows only when needed
- **Structural sharing**: Share unchanged object structures during merges

#### Scenario: Simple file copy optimization

- **WHEN** flow has no transforms (just `from` and `to`)
- **THEN** file is copied directly without parsing or pipeline

#### Scenario: Multi-target source caching

- **WHEN** flow has multiple targets from same source
- **THEN** source is parsed once and result is reused for all targets

#### Scenario: Conditional flow lazy evaluation

- **WHEN** flow has `when` condition that evaluates to false
- **THEN** flow is skipped without loading or parsing source

### Requirement: Backward Compatibility with Subdirs

The system SHALL maintain backward compatibility during transition period:

- **Support both formats**: Load platforms with either `subdirs` or `flows` arrays
- **Migration warnings**: Log warnings when old `subdirs` format is detected
- **Auto-conversion**: Automatically convert simple subdirs to flows internally
- **Deprecation timeline**: Clear timeline for subdirs removal

#### Scenario: Load platform with subdirs format

- **WHEN** platform config uses old `subdirs` array format
- **THEN** config loads successfully with deprecation warning

#### Scenario: Auto-convert subdirs to flows

- **WHEN** platform defines subdirs without complex transformations
- **THEN** subdirs are automatically converted to equivalent flows

#### Scenario: Mixed subdirs and flows

- **WHEN** platform defines both `subdirs` and `flows`
- **THEN** flows take precedence and subdirs are ignored with warning

### Requirement: Debug and Dry-Run Support

The system SHALL provide debugging and preview capabilities:

- **Debug logging**: Detailed logging with `DEBUG=opkg:flows` environment variable
- **Dry-run mode**: Preview flow execution without writing files
- **Execution summary**: Show source → target mappings and transforms applied
- **Transform preview**: Display intermediate results after each pipeline stage

#### Scenario: Debug logging enabled

- **WHEN** `DEBUG=opkg:flows` is set
- **THEN** detailed logs show each pipeline stage and transform application

#### Scenario: Dry-run preview

- **WHEN** install runs with `--dry-run` flag
- **THEN** flow execution is simulated and results are displayed without writing

#### Scenario: Execution summary

- **WHEN** flows complete execution
- **THEN** summary shows which flows executed, files transformed, and any errors

### Requirement: Unidirectional Flow Configuration (Package → Workspace)

The system SHALL define all flows as unidirectional transformations from package to workspace:

- **Flow direction**: All flows transform from universal package format to platform-specific workspace format
- **Source (`from`)**: Always relative to package root (universal format)
- **Target (`to`)**: Always relative to workspace root (platform-specific format)
- **Save operation**: Uses reverse lookup and inverse transformation (workspace → package)
- **No circular dependencies**: Flows cannot reference each other in cycles

#### Scenario: Install flow execution

- **WHEN** installing a package with flows
- **THEN** flows execute in forward direction (package → workspace)
- **AND** source files are in universal package format

#### Scenario: Save operation reverse lookup

- **WHEN** saving workspace files to package
- **THEN** system performs reverse lookup (target → source)
- **AND** applies inverse transformations (workspace → package)

#### Scenario: Circular dependency detection

- **WHEN** flows would create circular dependency within same direction
- **THEN** validation fails with error showing cycle path

### Requirement: Schema Versioning with Local JSON Schema

The system SHALL support schema versioning using local JSON schema files:

- **Schema field**: Optional `$schema` field in platforms.jsonc referencing local schema
- **Local schema path**: `./node_modules/opkg-cli/schemas/platforms-v1.json` or workspace-relative
- **IDE support**: Enable validation and autocomplete via JSON schema
- **Version detection**: Infer version from schema path or default to current CLI version
- **Backward compatibility**: Support multiple schema versions simultaneously
- **Validation**: Validate config against specified schema version

#### Scenario: Explicit schema version

- **WHEN** platforms.jsonc includes `$schema: "./node_modules/opkg-cli/schemas/platforms-v1.json"`
- **THEN** config is validated against v1 schema
- **AND** IDE provides v1 autocomplete

#### Scenario: Missing schema field

- **WHEN** platforms.jsonc has no `$schema` field
- **THEN** defaults to current CLI version schema
- **AND** validation uses latest schema

#### Scenario: Schema version mismatch

- **WHEN** config uses v1 schema with v2 CLI features
- **THEN** validation fails with clear error indicating version mismatch

#### Scenario: Schema location options

- **WHEN** schema path can be relative to workspace or node_modules
- **THEN** system resolves path correctly for IDE and CLI validation

### Requirement: Custom Handler Escape Hatch

The system SHALL support custom handlers for edge cases:

- **Handler registration**: Register custom handler functions
- **Handler invocation**: Invoke handler when `handler: "name"` is specified
- **Handler context**: Provide full flow context to custom handlers
- **Handler errors**: Report handler errors clearly

#### Scenario: Custom handler for complex transformation

- **WHEN** flow defines `handler: "custom-mcp-transform"`
- **AND** handler is registered in system
- **THEN** handler function is invoked with source content and context

#### Scenario: Handler not found

- **WHEN** flow references unregistered handler
- **THEN** execution fails with error "Handler 'xyz' not found"

#### Scenario: Handler error

- **WHEN** custom handler throws error during execution
- **THEN** error is caught and reported with handler name and context
