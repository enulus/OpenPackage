# Phase 2: Marketplace Integration

## Overview

This phase implements marketplace-specific skills handling, enabling users to discover, select, and install skills from plugins within a Claude Plugin marketplace. It extends the existing marketplace infrastructure to support skills as first-class installation targets.

## Objectives

1. Create marketplace skills handler module for discovery and installation
2. Implement skill discovery within marketplace plugins
3. Build interactive skill selection with plugin grouping
4. Add non-interactive skill validation and filtering
5. Create skill-specific installation pipeline for marketplace sources

## Module: Skills Marketplace Handler

### Location
`src/core/install/skills-marketplace-handler.ts` (NEW FILE)

### Purpose
Handles all marketplace-specific skills operations, including discovery across multiple plugins, user selection, and coordinated installation.

---

## Interfaces

### SkillsCollectionMap
Organizes discovered skills by their parent plugin.

**Fields:**
- `marketplace`: Reference to parsed marketplace manifest
- `pluginSkills`: Map from plugin name to array of discovered skills

**Purpose:** Provides structured view of all available skills across selected plugins.

**Usage:** Passed to prompt function for grouped display, and validation functions for skill lookup.

### SkillSelectionResult
Represents user's skill selections organized by plugin.

**Fields:**
- `selections`: Array of objects containing:
  - `pluginName`: Name of plugin containing skills
  - `pluginEntry`: Full marketplace entry for the plugin
  - `skills`: Array of DiscoveredSkill objects user selected

**Purpose:** Encapsulates user choices for downstream installation processing.

**Design Rationale:** Groups skills by plugin to enable efficient batch installation per plugin source.

---

## Core Functions

### parseSkillsFromMarketplace
**Signature:** `(marketplaceDir: string, marketplace: MarketplaceManifest, selectedPlugins: string[]) => Promise<SkillsCollectionMap>`

**Purpose:** Discover all skills within selected marketplace plugins.

**Algorithm:**
1. Initialize empty `pluginSkills` map
2. For each plugin name in `selectedPlugins`:
   - Resolve plugin entry from marketplace manifest
   - Normalize plugin source using `normalizePluginSource` (reuse existing function)
   - Determine plugin directory path:
     - For relative path sources: `join(marketplaceDir, relativePath)`
     - For git sources: Handle separately (skip skills discovery, will be handled during installation)
   - Verify plugin directory exists
   - Call `detectSkillsInDirectory(pluginDir)` from Phase 1
   - If skills found: Add to `pluginSkills` map with plugin name as key
   - If no skills: Continue (will handle validation later)
3. Return complete `SkillsCollectionMap`

**Error Handling:**
- Plugin directory not found: Log warning, continue with other plugins
- Skills detection failure: Log error, continue with other plugins
- Empty skills in all plugins: Caller handles error display

**Dependencies:**
- `detectSkillsInDirectory` from `skills-detector.ts`
- `normalizePluginSource` from `plugin-sources.ts`
- Marketplace parsing utilities from `marketplace-handler.ts`

---

### promptSkillSelection
**Signature:** `(skillsCollection: SkillsCollectionMap) => Promise<SkillSelectionResult>`

**Purpose:** Interactive multi-select prompt for skill selection with plugin grouping.

**Algorithm:**
1. Display marketplace name and description header
2. Build choices array with grouping:
   - For each plugin in `pluginSkills` map:
     - Add plugin name as group separator/header
     - For each skill in plugin:
       - Create choice: `{ title: skillName, value: uniqueKey, description: skillDescription }`
       - Use unique key format: `pluginName:skillName`
3. Call `safePrompts` with multiselect type:
   - Message: "Select skills to install (space to select, enter to confirm):"
   - Minimum selections: 0 (allow cancel)
   - Enable grouping by plugin
4. Parse selected keys back to plugin/skill associations
5. Build and return `SkillSelectionResult`

**Display Format:**
```
✓ Marketplace: awesome-marketplace
  Comprehensive collection of development tools

Available skills:

[essentials]
  git - Git workflow automation
  docker - Docker container management

[utilities]
  linter - Code quality checking
  formatter - Code formatting tools
```

**Error Handling:**
- User cancellation: Return empty selections
- No skills available: Return empty selections
- Prompt failure: Re-throw as UserCancellationError

**Dependencies:**
- `safePrompts` from `prompts.ts`
- `UserCancellationError` from `errors.ts`

---

### validateSkillSelections
**Signature:** `(skillsCollection: SkillsCollectionMap, requestedSkills: string[]) => { valid: SkillSelectionResult; invalid: string[] }`

**Purpose:** Validate and locate requested skills across marketplace plugins for non-interactive mode.

**Algorithm:**
1. Initialize `valid` selections structure and `invalid` array
2. For each requested skill name:
   - Search across all plugins in `pluginSkills` map:
     - For each plugin's skills array:
       - Call `findSkillByName(pluginSkills, requestedSkillName)` from Phase 1
       - If found: Add to `valid.selections` under appropriate plugin
       - Break after first match (skill names should be unique per marketplace)
   - If not found in any plugin: Add to `invalid` array
3. Return `{ valid, invalid }`

**Skill Name Matching:**
- Uses `findSkillByName` from Phase 1 for consistent matching logic
- Supports both frontmatter name and directory name matching
- Case-insensitive comparison

**Usage:** Called by command layer when `--skills` values are provided on CLI.

---

### installMarketplaceSkills
**Signature:** `(marketplaceDir: string, selections: SkillSelectionResult, marketplaceGitUrl: string, marketplaceGitRef: string | undefined, marketplaceCommitSha: string, options: InstallOptions, cwd: string) => Promise<CommandResult>`

**Purpose:** Orchestrate installation of all selected skills from marketplace plugins.

**Algorithm:**
1. Display installation header with skill count
2. Initialize results tracking array
3. For each plugin in `selections`:
   - For each skill in that plugin:
     - Call `installSingleSkill(...)` with skill-specific context
     - Collect installation result
     - Update progress display
4. Aggregate results:
   - Count successful installations
   - Count failures
   - Collect error messages
5. Display summary with `displayInstallationSummary` helper
6. Return overall `CommandResult`:
   - Success: true if at least one skill installed
   - Data: Installation counts and details
   - Error: Message if all installations failed

**Progress Display:**
```
Installing 3 skills...
✓ git (from essentials)
✓ docker (from essentials)
❌ linter (from utilities): Invalid SKILL.md format

✓ Successfully installed: 2 skills
❌ Failed: 1 skill
  linter: Invalid SKILL.md format
```

**Error Handling:**
- Individual skill installation failure: Log error, continue with remaining
- All skills fail: Return failure result with aggregated errors
- Partial success: Return success with warnings about failures

**Dependencies:**
- `installSingleSkill` (see below)
- `CommandResult` type from `types/index.ts`
- Display helpers (can reuse from `marketplace-handler.ts`)

---

### installSingleSkill
**Signature:** `(marketplaceDir: string, pluginEntry: MarketplacePluginEntry, skill: DiscoveredSkill, gitContext: GitSourceContext, options: InstallOptions, cwd: string) => Promise<CommandResult>`

**Purpose:** Install a single skill from a marketplace plugin.

**Algorithm:**
1. Compute full skill directory path:
   - Normalize plugin source to get relative path
   - Combine: `marketplaceDir + pluginSubdir + skill.skillPath`
2. Verify skill directory exists
3. Build install context using `buildPathInstallContext`:
   - Source path: Full skill directory path
   - Options: `{ ...options, sourceType: 'directory' }`
4. Set `gitSourceOverride` on context for manifest recording:
   - `gitUrl`: marketplaceGitUrl
   - `gitRef`: marketplaceGitRef
   - `gitPath`: Combined plugin subdir + skill path
5. Set `pluginMetadata` on context:
   - `isPlugin`: false (it's a skill, not a plugin)
   - `marketplaceEntry`: pluginEntry
   - `skillMetadata`: skill frontmatter and metadata
6. Use `Spinner` for progress indication
7. Call `runUnifiedInstallPipeline(context)`
8. Return installation result

**Context Configuration:**
The context setup ensures:
- Package is loaded from local path (already cloned marketplace)
- Git source is recorded in manifest for future updates
- Skill metadata is available for transformation/naming
- Marketplace origin is preserved for tracking

**Error Handling:**
- Skill directory not found: Return failure with clear error message
- Pipeline failure: Propagate error with skill context
- Transformation failure: Log and return failure

**Dependencies:**
- `buildPathInstallContext` from `unified/context-builders.ts`
- `runUnifiedInstallPipeline` from `unified/pipeline.ts`
- `Spinner` from `spinner.ts`
- `normalizePluginSource` from `plugin-sources.ts`

---

## Skill Transformation Integration

### Skills Transformer Module
**Location:** `src/core/install/skills-transformer.ts` (NEW FILE - see below)

**Purpose:** Transform individual skills into OpenPackage format packages.

**Called By:** Path package loader when detecting skill content with marketplace metadata.

---

## Module: Skills Transformer

### Location
`src/core/install/skills-transformer.ts` (NEW FILE)

### Purpose
Transform skills into OpenPackage package format, parallel to plugin transformer but specialized for skill content.

---

## Interfaces

### SkillTransformContext
Context information for transforming a skill.

**Fields:**
- `gitUrl`: Optional git repository URL
- `path`: Required - skill path from repository root
- `repoPath`: Optional - absolute path to repository
- `marketplaceEntry`: Optional - marketplace plugin entry if from marketplace
- `pluginName`: Optional - parent plugin name for logging
- `skillName`: Required - skill name for logging and debugging

**Purpose:** Provides all information needed to generate scoped package name and track origin.

---

## Core Functions

### transformSkillToPackage
**Signature:** `(skillDir: string, skillMetadata: SkillMetadata, context: SkillTransformContext) => Promise<PackageWithContext>`

**Purpose:** Transform a skill directory into an OpenPackage package with conversion context.

**Algorithm:**
1. Generate scoped package name:
   - Call `generateGitHubPackageName` from `plugin-naming.ts`
   - Pass context.gitUrl, context.path, skill name, and context.repoPath
   - Result format: `gh@user/repo/skills/skill-name` or `gh@user/repo/plugins/plugin1/skills/skill-name`
2. Create OpenPackage metadata:
   - Name: Generated scoped name
   - Version: Extract using Phase 1 version precedence logic
   - Description: From skill frontmatter
   - Keywords, license, homepage: From skill frontmatter
   - Author: From skill frontmatter if present
3. Call `extractSkillFiles(skillDir)` to collect all files
4. Detect package format using `detectPackageFormat(files)`
5. Create conversion context:
   - Type: 'skills' or detected platform
   - Confidence: From format detection
6. Build and return `PackageWithContext`

**Naming Examples:**
- Marketplace plugin skill: `gh@user/marketplace/plugins/essentials/skills/git`
- Standalone plugin skill: `gh@user/plugin/skills/docker`
- Repo skill: `gh@user/skills-repo/skills/coding`
- Nested skill: `gh@user/repo/skills/git/commit`

**Version Handling:**
- Use `extractSkillVersion` from Phase 1
- Default to '0.0.0' if undefined (for consistency with plugin transformer)

**Error Handling:**
- Name generation failure: Use skill name as fallback
- File extraction failure: Re-throw with skill context
- Format detection failure: Use default format

**Dependencies:**
- `generateGitHubPackageName` from `plugin-naming.ts`
- `extractSkillFiles` (see below)
- `detectPackageFormat` from `format-detector.ts`
- `createPlatformContext` from `conversion-context/index.ts`

---

### extractSkillFiles
**Signature:** `(skillDir: string) => Promise<PackageFile[]>`

**Purpose:** Collect all files from skill directory, preserving structure.

**Algorithm:**
1. Initialize empty files array
2. Use `walkFiles(skillDir)` to iterate all files
3. For each file:
   - Compute relative path from skillDir
   - Skip if junk file (use `isJunk()` on path parts)
   - Skip if in `.git/` directory
   - Read file content using `readTextFile`
   - Add to files array as `PackageFile` object
4. Return files array

**Path Preservation:**
All paths are relative to skill directory root. During installation, platform flows will map these to appropriate target locations.

Example:
- Skill file: `skillDir/helper.sh`
- Relative path in package: `helper.sh`
- Installed to (cursor): `.cursor/skills/git/helper.sh` (full path preserved)

**Error Handling:**
- File read failure: Log warning, skip file
- Directory walk failure: Throw ValidationError with skill context
- Empty skill directory: Return empty array (validation handled elsewhere)

**Dependencies:**
- `walkFiles` from `fs.ts`
- `readTextFile` from `fs.ts`
- `isJunk` from `junk` library
- `ValidationError` from `errors.ts`

---

## Integration with Existing Marketplace Handler

### Reuse Patterns
This module follows similar patterns to `marketplace-handler.ts`:

1. **Plugin Source Resolution:**
   - Use `normalizePluginSource` for consistent source handling
   - Handle both relative path and git sources

2. **Directory Path Construction:**
   - Follow same logic as `installRelativePathPlugin` for path resolution
   - Validate directories exist before processing

3. **Installation Context Building:**
   - Use `buildPathInstallContext` for consistent context creation
   - Set `gitSourceOverride` for manifest recording

4. **Progress Display:**
   - Use `Spinner` for individual operations
   - Use console output for summaries
   - Follow same formatting as plugin installation

5. **Error Aggregation:**
   - Collect results per item (skill vs plugin)
   - Display summary with success/failure counts
   - Return overall result based on any success

### Differences from Plugin Installation

1. **Selection Scope:**
   - Plugins: Selected from marketplace manifest
   - Skills: Selected from discovered skills within plugins

2. **Path Construction:**
   - Plugins: Direct to plugin directory
   - Skills: Plugin directory + skill path

3. **Content Filter:**
   - Plugins: All content in plugin directory
   - Skills: Only content in skill directory

4. **Naming:**
   - Plugins: Plugin name or scoped name
   - Skills: Always scoped with full path

---

## Testing Strategy

### Unit Tests Location
`tests/core/install/skills-marketplace.test.ts`

### Test Coverage

#### parseSkillsFromMarketplace Tests
- **Happy Path:**
  - Single plugin with multiple skills
  - Multiple plugins each with skills
  - Plugin with deeply nested skills
  
- **Edge Cases:**
  - Plugin with no skills directory
  - Plugin with empty skills directory
  - Mix of plugins with and without skills
  - Plugin directory not found
  
- **Error Cases:**
  - Invalid plugin source
  - Unreadable plugin directory
  - Skills detection failure

#### validateSkillSelections Tests
- **Validation:**
  - All requested skills found
  - Some found, some not found
  - Duplicate skill names across plugins
  - Case-insensitive matching
  
- **Edge Cases:**
  - Empty requested array
  - Skill name with special characters
  - Very long skill names

#### installMarketplaceSkills Tests
- **Installation:**
  - Single skill installation
  - Multiple skills from same plugin
  - Multiple skills from different plugins
  - Partial installation success
  
- **Error Cases:**
  - All installations fail
  - Individual skill installation failure
  - Invalid skill directory path

### Integration Tests
- **Full Marketplace Flow:**
  - Parse marketplace → discover skills → select skills → install skills
  - Test with mock marketplace structure
  - Verify manifest and index entries created correctly

---

## Implementation Checklist

- [x] Create `skills-marketplace-handler.ts` with interfaces
- [x] Implement `parseSkillsFromMarketplace` function
- [x] Implement `promptSkillSelection` with grouped display
- [x] Implement `validateSkillSelections` function
- [x] Implement `installMarketplaceSkills` orchestration function
- [x] Implement `installSingleSkill` function
- [x] Create `skills-transformer.ts` with interfaces
- [x] Implement `transformSkillToPackage` function
- [x] Implement `extractSkillFiles` function
- [x] Create `skills-marketplace.test.ts` with unit tests
- [x] Create `skills-transformer.test.ts` with unit tests
- [x] Write integration tests for full marketplace skills flow
- [x] Verify all tests pass

**Status**: ✅ All checklist items completed (2026-01-29)

---

## Success Criteria

- [x] Skills can be discovered within marketplace plugins
- [x] Interactive selection displays skills grouped by plugin
- [x] Non-interactive validation correctly identifies valid/invalid skills
- [x] Individual skills install correctly with proper scoping
- [x] Multiple skills can be installed in single operation
- [x] Git source information preserved in manifest
- [x] Installation summary displays accurate results
- [x] All marketplace patterns reused appropriately
- [x] All unit and integration tests pass
- [x] No regressions in existing marketplace functionality

**Status**: ✅ All success criteria met (2026-01-29)

---

## Dependencies for Next Phase

**Phase 3 Requirements:**
- `parseSkillsFromMarketplace` for marketplace skills discovery
- `promptSkillSelection` for interactive mode
- `validateSkillSelections` for non-interactive mode
- `installMarketplaceSkills` for marketplace skills installation
- `transformSkillToPackage` for skill package transformation

**Exports Required:**
```typescript
// From skills-marketplace-handler.ts
export { SkillsCollectionMap, SkillSelectionResult };
export { parseSkillsFromMarketplace };
export { promptSkillSelection };
export { validateSkillSelections };
export { installMarketplaceSkills };

// From skills-transformer.ts
export { SkillTransformContext };
export { transformSkillToPackage };
export { extractSkillFiles };
```

---

## Integration Notes

### Spinner Usage
Follow existing patterns:
```
const spinner = new Spinner('Loading marketplace skills');
spinner.start();
// ... operation ...
spinner.stop();
```

### Prompt Styling
Use existing prompt configuration:
- Type: 'multiselect'
- Enable grouping for plugin organization
- Minimum: 0 (allow cancellation)
- Clear instructions in hint text

### Error Message Formatting
Follow existing patterns from marketplace-handler.ts:
- Clear error descriptions
- Available options listed
- Actionable suggestions

### Path Construction
Always use `join()` for cross-platform compatibility:
```typescript
const skillPath = join(marketplaceDir, pluginSubdir, skill.skillPath);
```

Normalize paths for comparison and validation.
