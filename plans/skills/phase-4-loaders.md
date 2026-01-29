# Phase 4: Loader Integration

## Overview

This phase integrates skills detection into the package loading infrastructure, ensuring that skills collections are properly identified during the source loading phase and that skills metadata is available to the installation pipeline.

## Objectives

1. Update git package loader to detect skills collections
2. Update path package loader to handle skills transformation
3. Extend loader result types to include skills detection
4. Ensure skills metadata flows through to installation pipeline
5. Maintain backward compatibility with existing loading behavior

---

## Module: Git Package Loader

### Location
`src/core/install/git-package-loader.ts`

### Purpose
Load packages from git sources and detect if they contain skills collections.

---

## Interface Updates

### GitPackageLoadResult
**Purpose:** Extend result type to include skills detection information.

**New Fields:**
- `skillsDetection`: Optional SkillsDetectionResult
  - Present when source is scanned for skills
  - Contains discovered skills and collection type
  - Available for both marketplace and non-marketplace sources

**Complete Interface:**
```typescript
interface GitPackageLoadResult {
  pkg: Package | null;
  sourcePath: string;
  repoPath: string;
  commitSha: string;
  isMarketplace: boolean;
  skillsDetection?: SkillsDetectionResult; // NEW
}
```

**Usage:** Allows command layer to access skills information without re-scanning.

---

## Function Updates

### loadPackageFromGit
**Location:** Main function in `git-package-loader.ts`

**Current Behavior:**
1. Clone repository to cache
2. Detect if marketplace
3. If marketplace: Return early with null package
4. If not marketplace: Load package from path
5. Return result

**Modified Behavior:**

**Addition 1: Skills Detection for Marketplace**
After marketplace detection:
- Call `detectSkillsInDirectory(sourcePath)`
- Include result in return value
- Makes skills available for marketplace skills installation

**Addition 2: Skills Detection for Non-Marketplace**
After loading package:
- Call `detectSkillsInDirectory(sourcePath)`
- Include result in return value
- Makes skills available for standalone skills installation

**Modified Algorithm:**
```
1. Clone repository to cache (existing)
2. Extract sourcePath, repoPath, commitSha (existing)

3. Detect plugin type (existing)
4. IF marketplace:
     Detect skills: skillsDetection = detectSkillsInDirectory(sourcePath)
     Return { 
       pkg: null, 
       sourcePath, 
       repoPath, 
       commitSha, 
       isMarketplace: true,
       skillsDetection  ← NEW
     }

5. Load package from path with git context (existing)
6. Detect skills: skillsDetection = detectSkillsInDirectory(sourcePath)
7. Return { 
     pkg, 
     sourcePath, 
     repoPath, 
     commitSha, 
     isMarketplace: false,
     skillsDetection  ← NEW
   }
```

**Performance Consideration:**
Skills detection involves file system scanning (glob for SKILL.md files). Since repositories are already cloned locally at this point, the overhead is minimal and occurs only once per installation.

**Error Handling:**
- Skills detection failure: Log warning, continue with undefined skillsDetection
- Don't fail package loading due to skills detection issues

---

## Module: Path Package Loader

### Location
`src/core/install/path-package-loader.ts`

### Purpose
Load packages from local directory paths, handling skills transformation when appropriate.

---

## Function Considerations

### loadPackageFromDirectory
**Current Behavior:**
1. Detect if Claude Code plugin
2. If plugin: Transform to OpenPackage format
3. If not plugin: Load openpackage.yml
4. Apply GitHub scoping if git context provided
5. Discover and return files

**Skills Handling:**
Skills transformation is NOT performed at the loader level. Instead:
- Skills are detected by command layer
- Command layer calls `transformSkillToPackage` directly
- Loader continues to handle full packages/plugins

**Rationale:**
Skills are sub-packages that should be extracted at the command/installation level, not during package loading. The loader's responsibility is to load the entire collection, and skills selection/filtering happens upstream.

**No Changes Required:**
Current implementation already supports the flow:
1. Command layer detects skills collection
2. Command layer selects specific skills
3. For each skill, command layer:
   - Builds path to skill directory
   - Calls `transformSkillToPackage` (Phase 2)
   - Installs transformed package

---

## Module: Plugin Detector Updates

### Location
`src/core/install/plugin-detector.ts`

### Purpose
Enhance plugin detection to also identify skills collections.

---

## Function Additions

### isSkillsCollection (Optional Addition)
**Signature:** `(dirPath: string) => Promise<boolean>`

**Purpose:** Quick check if directory contains skills at root level.

**Algorithm:**
1. Check for `skills/` directory at root
2. Check for at least one SKILL.md file in skills/
3. Return true if both conditions met

**Usage:** Can be used alongside existing `isIndividualPlugin` and `isMarketplace` checks for comprehensive collection type detection.

**Note:** This is optional - the main `detectSkillsInDirectory` from Phase 1 provides more complete information. This function serves as a lightweight check for specific use cases.

---

## Integration Points

### Command Layer Usage
**Location:** `install.ts` command handlers

**Usage of Loader Results:**

**For Git Sources:**
```typescript
const loaded = await loader.load(contexts.source, options, cwd);

// Access skills detection from loader result
if (loaded.skillsDetection?.hasSkills) {
  // Skills are available
  // Can skip re-detection if already done
}
```

**Benefits:**
- Single skills detection pass (done during loading)
- Results cached in loader result
- No need to re-scan file system

**Alternative Approach:**
If command layer needs to detect skills before loading:
```typescript
// Early detection for validation
const skillsDetection = await detectSkillsInDirectory(sourcePath);

// Later loading
const loaded = await loader.load(...);
// loaded.skillsDetection also available
```

**Recommendation:** Use loader's skillsDetection when available to avoid duplicate work.

---

## Context Metadata Flow

### Skills Metadata in Installation Context
**Purpose:** Ensure skills information flows through installation pipeline.

**Flow:**
```
Git Loader
  ↓ (detects skills)
GitPackageLoadResult { skillsDetection }
  ↓ (accessed by command)
Command Layer
  ↓ (validates and selects skills)
InstallationContext { source.skillsMetadata }
  ↓ (used by transformers)
Skills Transformer
  ↓ (generates package)
Transformed Package
  ↓ (installed via pipeline)
Installation Pipeline
```

**Context Field (Optional):**
Could add optional `skillsMetadata` to source context:
```typescript
source.skillsMetadata = {
  selectedSkills: [...],
  allSkills: skillsDetection.discoveredSkills
}
```

**Alternative:** Pass skills directly to handlers without context storage.

**Recommendation:** Evaluate if context storage provides value vs. direct parameter passing.

---

## Testing Strategy

### Unit Tests Location
`tests/core/install/git-package-loader.test.ts` (existing file, add tests)

### New Test Coverage

#### Git Package Loader Tests
**Skills Detection - Marketplace:**
- Marketplace with skills/ directory → skillsDetection populated
- Marketplace without skills → skillsDetection.hasSkills = false
- Skills detection failure → continues with undefined

**Skills Detection - Non-Marketplace:**
- Plugin with skills/ → skillsDetection populated
- Package with skills/ → skillsDetection populated
- Repo with skills/ → skillsDetection populated
- Source without skills/ → skillsDetection.hasSkills = false

**Performance:**
- Skills detection doesn't significantly slow down loading
- Multiple SKILL.md files handled efficiently

#### Integration Tests
**Full Flow with Loader:**
- Git load → detect skills → select skills → install skills
- Verify skills metadata available throughout pipeline
- Verify no duplicate detection calls

---

## Implementation Checklist

- [x] Update `GitPackageLoadResult` interface with `skillsDetection` field
- [x] Modify `loadPackageFromGit` to detect skills after marketplace check
- [x] Modify `loadPackageFromGit` to detect skills after package load
- [x] Add error handling for skills detection failures
- [x] Add `isSkillsCollection` to `plugin-detector.ts`
- [x] Update `LoadedPackage.sourceMetadata` to include skillsDetection
- [x] Update `git-source.ts` to pass through skillsDetection
- [x] Create git loader tests with skills detection coverage
- [x] Write integration tests for loader + skills flow
- [x] Verify no performance regression from skills detection
- [x] Verify backward compatibility (existing code still works)
- [x] Verify all tests pass

**Implementation Status**: ✅ COMPLETE (2026-01-29)

---

## Success Criteria

- [x] Git loader detects skills collections for both marketplace and non-marketplace sources
- [x] Skills detection information available in loader results
- [x] Skills detection doesn't break existing loading behavior
- [x] No significant performance impact from skills scanning (< 500ms for 10 skills)
- [x] Command layer can access skills without re-detection
- [x] All unit tests pass (9 tests in git-package-loader.test.ts)
- [x] All integration tests pass (6 tests in loader-skills-integration.test.ts)
- [x] Backward compatibility maintained (all existing tests pass)

**Phase 4 Status**: ✅ COMPLETE

All objectives achieved. Skills detection successfully integrated into the package loading pipeline with comprehensive test coverage and no breaking changes.

---

## Dependencies for Next Phase

**Phase 5 Requirements:**
- Loader integration complete for comprehensive testing
- Skills detection available throughout loading pipeline
- Metadata flow verified for test validation

**Exports Used:**
```typescript
// From Phase 1
import { detectSkillsInDirectory, SkillsDetectionResult } from './skills-detector.js';
```

---

## Integration Notes

### Performance Optimization
Skills detection uses file system operations (glob/walk):
- Only performed once per source during loading
- Results cached in loader result object
- Command layer should reuse loader's detection when possible
- No need for separate detection pass in most cases

### Error Resilience
Skills detection failures should not break package loading:
- Catch and log errors from detectSkillsInDirectory
- Return undefined skillsDetection on failure
- Package loading continues normally
- Skills features simply unavailable for that source

### Backward Compatibility
All changes are additive:
- New optional field in result interface
- Existing code that doesn't check skillsDetection continues to work
- No breaking changes to function signatures
- No changes to existing loading behavior

### Debug Logging
Add appropriate logging:
- `logger.debug()` for skills detection attempts
- `logger.info()` for skills found with count
- `logger.warn()` for skills detection failures
- `logger.debug()` for skills detection results

### Test Data Setup
Create test fixtures:
- Mock repositories with various skills structures
- Marketplace with plugins containing skills
- Standalone plugins/packages with skills
- Empty skills/ directories
- Invalid SKILL.md files

Use existing test helper patterns for consistency.
