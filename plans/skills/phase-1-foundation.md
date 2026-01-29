# Phase 1: Foundation

## Overview

This phase establishes the foundational components for the skills feature, including core types, constants, and the skills detection module. These building blocks will be used by all subsequent phases.

## Objectives

1. Define type structures for skills data and detection results
2. Add necessary constants for skills file patterns
3. Create the skills detection module with discovery and validation logic
4. Update format detection to recognize skills content

## Module: Core Types

### Location
`src/types/index.ts`

### Changes Required

#### InstallOptions Interface
Add new optional field to support skills selection:
- Field: `skills` (array of strings, optional)
- Purpose: Store requested skill names from CLI `--skills` option
- Usage: Space-separated values like `--plugins`

### Design Rationale
Follows existing pattern for `plugins` option, maintaining consistency in CLI option handling.

---

## Module: Constants

### Location
`src/constants/index.ts`

### Changes Required

#### FILE_PATTERNS Object
Add new constant for skill manifest file:
- Name: `SKILL_MD`
- Value: `'SKILL.md'`
- Purpose: Standard name for skill manifest files

### Design Rationale
Centralizes file pattern definitions, following existing pattern for `PLUGIN_JSON`, `MARKETPLACE_JSON`, etc.

---

## Module: Skills Detector

### Location
`src/core/install/skills-detector.ts` (NEW FILE)

### Purpose
Central module for discovering, validating, and managing skills within a collection.

### Interfaces

#### SkillsDetectionResult
Comprehensive result of skills detection in a directory.

**Fields:**
- `hasSkills`: Boolean indicating if collection contains skills
- `collectionTypes`: Array of collection types detected (can be multiple)
- `discoveredSkills`: Array of all discovered skills with metadata

**Purpose:** Provides complete picture of skills available in a source.

#### DiscoveredSkill
Detailed information about a single discovered skill.

**Fields:**
- `name`: Skill name (from frontmatter or directory fallback)
- `version`: Optional version (from frontmatter)
- `skillPath`: Relative path to skill directory (parent of SKILL.md)
- `manifestPath`: Relative path to SKILL.md file itself
- `directoryName`: Parent directory name (used as fallback name)
- `frontmatter`: Parsed frontmatter object from SKILL.md

**Purpose:** Contains all metadata needed for skill identification, transformation, and installation.

#### SkillMetadata
Typed structure for SKILL.md frontmatter.

**Fields:**
- `name`: Optional string
- `version`: Optional string
- `metadata.version`: Optional string (alternative version field)
- Additional fields: Extensible for other frontmatter data

**Purpose:** Type-safe access to skill manifest frontmatter.

### Core Functions

#### detectSkillsInDirectory
**Signature:** `(dirPath: string) => Promise<SkillsDetectionResult>`

**Purpose:** Primary entry point for skills detection in any directory.

**Algorithm:**
1. Check if `skills/` directory exists at root
2. Glob for all `skills/**/SKILL.md` files (any nesting depth)
3. For each discovered SKILL.md:
   - Read file content
   - Parse frontmatter using `splitFrontmatter` from `markdown-frontmatter.ts`
   - Extract name: `frontmatter.name || parentDirectoryName`
   - Extract version: `frontmatter.version || frontmatter['metadata.version'] || undefined`
   - Compute skill path (parent directory path)
   - Compute directory name (basename of parent)
4. Determine collection types (check for plugin.json, openpackage.yml)
5. Return complete detection result

**Error Handling:**
- SKILL.md parse failures: Log warning, use directory name as fallback
- Invalid frontmatter: Continue with partial data
- Empty skills/ directory: Return `hasSkills: false`

**Dependencies:**
- `fs` for file system operations
- `glob` or `walkFiles` for file discovery
- `splitFrontmatter` from `markdown-frontmatter.ts`
- `path` utilities for path manipulation

#### isSkillsCollection
**Signature:** `(dirPath: string) => Promise<boolean>`

**Purpose:** Quick check if directory is a skills collection.

**Algorithm:**
1. Check for `skills/` directory at root
2. Check for at least one `skills/**/SKILL.md` file
3. Return true if both conditions met

**Usage:** Early validation before attempting full detection.

#### findSkillByName
**Signature:** `(skills: DiscoveredSkill[], searchName: string) => DiscoveredSkill | null`

**Purpose:** Locate a skill by name with fallback to directory name.

**Algorithm:**
1. Normalize search name (trim, lowercase for comparison)
2. First pass: Exact match on `skill.name` (frontmatter name)
3. Second pass: Exact match on `skill.directoryName` (directory name)
4. Return first match or null

**Comparison:** Case-insensitive to handle user input variations.

#### validateSkillExists
**Signature:** `(skills: DiscoveredSkill[], requestedNames: string[]) => { valid: DiscoveredSkill[]; invalid: string[] }`

**Purpose:** Validate that all requested skills exist in the collection.

**Algorithm:**
1. For each requested name:
   - Call `findSkillByName`
   - If found: Add to `valid` array
   - If not found: Add to `invalid` array
2. Return both arrays for downstream processing

**Usage:** Used by command layer to validate user input and provide helpful error messages.

### Helper Functions

#### parseSkillFrontmatter
**Signature:** `(manifestPath: string) => Promise<SkillMetadata>`

**Purpose:** Parse SKILL.md frontmatter with error handling.

**Algorithm:**
1. Read SKILL.md file content
2. Use `splitFrontmatter<SkillMetadata>()` to parse
3. Return parsed metadata
4. On error: Return empty object with warning log

**Error Recovery:** Graceful degradation - missing frontmatter doesn't block detection.

#### extractSkillName
**Signature:** `(frontmatter: SkillMetadata, directoryName: string) => string`

**Purpose:** Determine skill name with fallback logic.

**Algorithm:**
1. Check `frontmatter.name` - return if present and non-empty
2. Fallback to `directoryName`
3. Log info message if using fallback

**Ensures:** Every skill has a name for identification.

#### extractSkillVersion
**Signature:** `(frontmatter: SkillMetadata) => string | undefined`

**Purpose:** Determine skill version with precedence rules.

**Algorithm:**
1. Check `frontmatter.version` - return if present
2. Check `frontmatter['metadata.version']` - return if present
3. Return `undefined` (not defaulting to 0.0.0 here - let transformer decide)

**Flexibility:** Allows transformer to decide default version behavior.

### Dependencies

**Existing Modules:**
- `markdown-frontmatter.ts`: For SKILL.md frontmatter parsing
- `fs.ts`: For file system operations with error handling
- `logger.ts`: For debug/info/warning logging
- `errors.ts`: For ValidationError and error handling patterns

**External Libraries:**
- `glob` or existing `walkFiles` utility for file discovery
- `path` for directory/file path manipulation

---

## Module: Format Detector Updates

### Location
`src/core/install/format-detector.ts`

### Changes Required

#### detectPackageFormat Function
Add skills format detection to existing logic.

**Detection Logic:**
1. Check for presence of `skills/` directory in file paths
2. Check for `SKILL.md` files matching `skills/**/SKILL.md` pattern
3. If both present: Return format type 'skills'

**Format Result:**
- Type: `'skills'`
- Platform: `'universal'`
- Confidence: `0.8`
- Indicators: `['skills/ directory', 'SKILL.md files']`

### Design Rationale
Skills are detected as a format type, similar to how plugins are detected. This allows the installation pipeline to handle skills appropriately.

### Integration Point
Add detection before or alongside plugin detection, as skills can coexist with other content.

---

## Testing Strategy

### Unit Tests Location
`tests/core/install/skills-detector.test.ts`

### Test Coverage

#### detectSkillsInDirectory Tests
- **Happy Path:**
  - Directory with single skill at `skills/git/SKILL.md`
  - Directory with multiple skills at various depths
  - Directory with deeply nested skills
  
- **Edge Cases:**
  - Empty `skills/` directory (no SKILL.md files)
  - No `skills/` directory at all
  - SKILL.md at `skills/SKILL.md` (skill in root of skills/)
  - Multiple SKILL.md files with same name in different paths
  
- **Error Cases:**
  - SKILL.md with invalid/unparseable frontmatter
  - SKILL.md with missing name field (should use directory fallback)
  - SKILL.md with empty frontmatter
  - Unreadable SKILL.md file

#### findSkillByName Tests
- **Name Matching:**
  - Exact match on frontmatter name
  - Exact match on directory name (fallback)
  - Case-insensitive matching
  - No match found (return null)
  
- **Priority:**
  - Frontmatter name takes precedence over directory name
  - First match wins when duplicates exist

#### validateSkillExists Tests
- **Validation:**
  - All requested skills found
  - Some skills found, some not found
  - No skills found
  - Empty requested array
  
- **Output:**
  - Verify valid array contains correct DiscoveredSkill objects
  - Verify invalid array contains correct missing names

### Test Helpers

#### Mock Skill Structure
Create helper to generate mock file structures for testing:
- Temporary directory with skills/ folder
- Mock SKILL.md files with configurable frontmatter
- Easy cleanup after tests

#### Assertion Helpers
- `assertSkillDiscovered(result, expectedName)`
- `assertSkillNotDiscovered(result, unexpectedName)`
- `assertValidationResult(result, expectedValid, expectedInvalid)`

---

## Implementation Checklist

- [x] Add `skills?: string[]` field to `InstallOptions` in `types/index.ts`
- [x] Add `SKILL_MD` constant to `FILE_PATTERNS` in `constants/index.ts`
- [x] Create `skills-detector.ts` with all interfaces and type definitions
- [x] Implement `detectSkillsInDirectory` function
- [x] Implement `isSkillsCollection` function
- [x] Implement `findSkillByName` function
- [x] Implement `validateSkillExists` function
- [x] Implement helper functions (parseSkillFrontmatter, extractSkillName, extractSkillVersion)
- [x] Update `format-detector.ts` to recognize skills format
- [x] Create `skills-detector.test.ts` with comprehensive test coverage
- [x] Write unit tests for all detection functions
- [x] Write edge case and error handling tests
- [x] Verify all tests pass

**Status**: ✅ All checklist items completed (2026-01-28)

---

## Success Criteria

- [x] Skills detection correctly identifies SKILL.md files at any nesting level under `skills/`
- [x] Name resolution works with both frontmatter and directory name fallback
- [x] Version extraction follows precedence rules (version → metadata.version → undefined)
- [x] Validation functions accurately identify valid and invalid skill names
- [x] Format detection recognizes skills content in packages
- [x] All unit tests pass with 100% coverage of detection logic
- [x] No regressions in existing format detection behavior

**Status**: ✅ All success criteria met (2026-01-28)

---

## Dependencies for Next Phase

**Phase 2 Requirements:**
- `DiscoveredSkill` interface for skill metadata
- `detectSkillsInDirectory` for marketplace plugin skill discovery
- `validateSkillExists` for marketplace skill validation
- `findSkillByName` for skill selection matching

**Exports Required:**
```typescript
// From skills-detector.ts
export { SkillsDetectionResult, DiscoveredSkill, SkillMetadata };
export { detectSkillsInDirectory, isSkillsCollection };
export { findSkillByName, validateSkillExists };
```

---

## Integration Notes

### Parallel to Plugin Detection
Skills detection follows similar patterns to plugin detection but operates independently:
- Plugin detection: Looks for `.claude-plugin/plugin.json` or `marketplace.json`
- Skills detection: Looks for `skills/**/SKILL.md` at root

Both can be present simultaneously in a collection.

### Glob Pattern Consistency
Use the same file walking utilities as existing code:
- Prefer `walkFiles` utility if already used
- Fallback to `glob` library for pattern matching
- Ensure junk file filtering (use `isJunk()` helper)

### Error Logging Strategy
Follow existing patterns:
- Use `logger.debug()` for discovery details
- Use `logger.info()` for skill detection results
- Use `logger.warn()` for recoverable errors (bad frontmatter)
- Use `logger.error()` for critical failures

### Path Handling
All paths should be:
- Relative to the collection root (dirPath parameter)
- Use POSIX-style separators (forward slashes)
- Normalized using `path` utilities for cross-platform compatibility
