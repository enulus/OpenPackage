# Platforms Specification - Delta

## MODIFIED Requirements

### Requirement: Platform Configuration Schema

Each platform entry in `platforms.jsonc` SHALL have the following structure:

- `name` (string): Human-readable display name
- `rootDir` (string): Platform root directory (e.g., `.cursor`, `.claude`)
- `rootFile?` (string): Optional root file at project root (e.g., `CLAUDE.md`, `QWEN.md`)
- `aliases?` (string[]): Optional CLI aliases
- `enabled?` (boolean): Whether platform is enabled (default: `true`)
- `flows` (Flow[]): Declarative transformation flows (replaces `subdirs`)

**BREAKING CHANGE**: The `subdirs` array is replaced by `flows` array. During transition period, both formats are supported with deprecation warnings for `subdirs`.

#### Scenario: Load platform with flows configuration

- **WHEN** platform config defines `flows` array instead of `subdirs`
- **THEN** flows are loaded and validated according to flow schema

#### Scenario: Load legacy platform with subdirs

- **WHEN** platform config defines `subdirs` array (legacy format)
- **THEN** subdirs are auto-converted to flows with deprecation warning

#### Scenario: Platform with both subdirs and flows

- **WHEN** platform config defines both `subdirs` and `flows`
- **THEN** `flows` takes precedence and `subdirs` is ignored with warning

#### Scenario: Invalid platform configuration

- **WHEN** platform config is missing required fields or has invalid types
- **THEN** configuration load fails with clear error message

### Requirement: Platform Flow Support

Platforms SHALL define transformations using declarative flows instead of static subdirectory mappings:

- **Flow-based transformations**: Use `flows` array to define source → target transformations
- **Global flows**: Support optional `global.flows` section for universal transformations
- **Per-platform flows**: Each platform defines its own flows for platform-specific behavior
- **Format conversion**: Flows automatically handle format conversion (YAML ↔ JSON ↔ TOML)
- **Key remapping**: Flows support sophisticated key transformations
- **Multi-package composition**: Flows handle namespace isolation and merging

#### Scenario: Platform with format conversion flow

- **WHEN** platform defines flow converting YAML config to JSON
- **THEN** source YAML file is parsed and written as JSON to target

#### Scenario: Platform with key remapping flow

- **WHEN** platform defines flow with key mapping configuration
- **THEN** source keys are remapped to target structure during transformation

#### Scenario: Platform with multi-target flow

- **WHEN** platform defines one source flowing to multiple targets
- **THEN** source is parsed once and transformed differently for each target

#### Scenario: Platform with global flows

- **WHEN** `global.flows` section defines universal transformations
- **THEN** global flows apply to all platforms before platform-specific flows

### Requirement: Configuration Merge Hierarchy

Platform configurations SHALL be loaded and merged from three sources:

1. **Built-in**: Default configurations shipped with CLI
2. **Global**: User overrides in `~/.openpackage/platforms.jsonc`
3. **Workspace**: Project-specific overrides in `<workspace>/.openpackage/platforms.jsonc`

Merge order: workspace > global > built-in (last writer wins)

Merge behavior:
- **Platform-level**: New platforms added, existing platforms merged
- **Flows array**: Later configs replace flows entirely (no array merge)
- **Boolean/string fields**: Last writer wins
- **Validation**: Runs after each merge with clear error messages

#### Scenario: Global override of platform flows

- **WHEN** global config defines flows for existing built-in platform
- **THEN** global flows completely replace built-in flows

#### Scenario: Workspace adds custom platform

- **WHEN** workspace config defines new platform not in built-in or global
- **THEN** custom platform is added and available for use

#### Scenario: Workspace disables built-in platform

- **WHEN** workspace config sets `enabled: false` for built-in platform
- **THEN** platform is skipped during detection and flow execution

#### Scenario: Invalid merged configuration

- **WHEN** merged configuration results in invalid platform definition
- **THEN** configuration load fails with error indicating which source caused issue

### Requirement: Platform Detection with Flows

Platform detection SHALL continue using existing logic while supporting flow-based configurations:

- **Directory detection**: Check if platform `rootDir` exists in workspace
- **Root file detection**: Check if platform `rootFile` exists at project root
- **Enabled flag**: Only detect platforms where `enabled` is `true`
- **Flow execution context**: Detected platforms provide context for conditional flows

#### Scenario: Detect platform by root directory

- **WHEN** platform's `rootDir` exists in workspace
- **THEN** platform is marked as detected and flows can execute

#### Scenario: Detect platform by root file

- **WHEN** platform's `rootFile` exists at project root
- **THEN** platform is marked as detected even without directory structure

#### Scenario: Skip disabled platform

- **WHEN** platform has `enabled: false` in configuration
- **THEN** platform is not detected regardless of file presence

#### Scenario: Flow conditional on platform detection

- **WHEN** flow has `when: { "platform": "cursor" }` condition
- **THEN** flow executes only if Cursor platform is detected in workspace

### Requirement: Backward Compatibility During Transition

The system SHALL maintain compatibility with existing subdirs-based configurations:

- **Support both formats**: Load platforms with either `subdirs` or `flows` arrays
- **Auto-conversion**: Convert simple subdirs to equivalent flows automatically
- **Deprecation warnings**: Log clear warnings when subdirs format is detected
- **Migration path**: Provide tools and guidance for converting subdirs to flows
- **Timeline**: Documented deprecation timeline (v1.x support both, v2.0 remove subdirs)

#### Scenario: Auto-convert simple subdirs to flows

- **WHEN** platform defines subdirs without complex transformations
- **THEN** subdirs are converted to simple file mapping flows

#### Scenario: Deprecation warning for subdirs

- **WHEN** platform config uses subdirs format
- **THEN** warning is logged with migration instructions and timeline

#### Scenario: Complex subdirs not auto-convertible

- **WHEN** platform defines subdirs with complex transformations
- **THEN** warning includes manual migration guidance

## ADDED Requirements

### Requirement: Flow-Based File Resolution

The system SHALL resolve file paths using flow configurations instead of static subdirectory mappings:

- **Pattern matching**: Support `{name}` placeholders in flow patterns
- **Multi-target resolution**: Resolve multiple target paths from single source
- **Conditional resolution**: Skip flows where conditions evaluate to false
- **Format-aware resolution**: Consider target format when resolving paths

#### Scenario: Resolve files matching flow pattern

- **WHEN** flow defines `from: "rules/{name}.md"`
- **THEN** all files matching pattern in package are resolved

#### Scenario: Resolve multi-target flow

- **WHEN** flow defines multiple targets in `to` object
- **THEN** all target paths are resolved for single source file

#### Scenario: Skip conditional flow during resolution

- **WHEN** flow has `when` condition that evaluates to false
- **THEN** flow is excluded from file resolution

### Requirement: Flow Validation Command

The system SHALL provide validation command for platform configurations:

- **CLI command**: `opkg validate platforms`
- **Schema validation**: Check flow schemas for required fields and types
- **Transform validation**: Verify all referenced transforms exist
- **JSONPath validation**: Validate JSONPath expression syntax
- **Circular dependency check**: Detect circular flow dependencies
- **Clear reporting**: Show all errors and warnings with fix suggestions

#### Scenario: Validate valid platform configuration

- **WHEN** `opkg validate platforms` is run on valid configuration
- **THEN** validation passes with success message

#### Scenario: Report missing required fields

- **WHEN** platform flow is missing `from` or `to` field
- **THEN** validation fails with error indicating missing field and location

#### Scenario: Report invalid transform names

- **WHEN** platform flow references non-existent transform
- **THEN** validation fails listing invalid transform and available options

#### Scenario: Report circular dependencies

- **WHEN** flows create circular transformation dependency
- **THEN** validation fails showing dependency cycle

## REMOVED Requirements

### Requirement: Subdirectory Static Mappings

**Reason**: Replaced by declarative flow system which provides more flexibility and power.

**Migration**: Subdirs format continues to work during transition period (v1.x) with deprecation warnings. Users should migrate to flows format. Auto-conversion handles simple cases.

The old `subdirs` array with the following structure is deprecated:

```typescript
interface SubdirConfig {
  universalDir: string
  platformDir: string
  exts?: string[]
  transformations?: Array<{
    packageExt: string
    workspaceExt: string
  }>
}
```

This is replaced by:

```typescript
interface Flow {
  from: string
  to: string | MultiTargetFlows
  // ... extensive transform options
}
```

#### Scenario: Migration from subdirs to flows (example)

**Old subdirs format:**
```json
{
  "subdirs": [{
    "universalDir": "rules",
    "platformDir": "rules",
    "exts": [".mdc", ".md"],
    "transformations": [{
      "packageExt": ".md",
      "workspaceExt": ".mdc"
    }]
  }]
}
```

**New flows format:**
```json
{
  "flows": [{
    "from": "rules/{name}.md",
    "to": ".cursor/rules/{name}.mdc"
  }]
}
```
