# Implementation Plan Outline: Resource Installation

This document provides a high-level outline of the implementation plan for the resource-based installation system as specified in [INTENDED_BEHAVIOR.md](./INTENDED_BEHAVIOR.md).

---

## Related Documents

| Document | Description |
|----------|-------------|
| [01-CURRENT_ARCHITECTURE.md](./01-CURRENT_ARCHITECTURE.md) | Analysis of current install command implementation |
| [02-BASE_DETECTION.md](./02-BASE_DETECTION.md) | Base detection algorithm specification |
| [03-RESOURCE_PARSING.md](./03-RESOURCE_PARSING.md) | Resource argument parsing specification |
| [04-CONVENIENCE_OPTIONS.md](./04-CONVENIENCE_OPTIONS.md) | `--plugins`, `--agents`, `--skills` options |
| [05-AMBIGUITY_HANDLING.md](./05-AMBIGUITY_HANDLING.md) | Ambiguous base resolution and user prompts |
| [06-PIPELINE_INTEGRATION.md](./06-PIPELINE_INTEGRATION.md) | Integration with unified install pipeline |

---

## Summary

The resource installation system shifts from a package-centric model to a resource-centric model. The key innovation is the **base detection algorithm** that determines the installation root within a path, enabling direct installation of specific agents, skills, or resources from arbitrary repository structures.

### Key Features

1. **Unified resource argument parsing** - URLs, `gh@` shorthand, registry names, and filepaths
2. **Algorithmic base detection** - Find the installation root using manifest markers or pattern matching
3. **Deepest match resolution** - Prefer the most specific pattern match when multiple apply
4. **Convenience options** - Filter installations with `--agents`, `--skills`, `--plugins`
5. **Ambiguity handling** - User prompts with manifest storage for reproducibility
6. **Backwards compatible** - Existing package installs continue to work

---

## Implementation Phases

### Phase 1: Foundation (Core Utilities)

**Goal:** Build the foundational utilities that the rest of the system depends on.

**New Files:**
- `src/utils/resource-arg-parser.ts` - Unified resource argument parsing
- `src/utils/pattern-matcher.ts` - Pattern matching against platforms.jsonc
- `src/core/install/base-detector.ts` - Base detection algorithm

**Key Work:**
1. Create `ResourceSpec` interface and parsing functions
2. Extract all "from" patterns from platforms.jsonc
3. Implement segment-indexed pattern matching
4. Implement deepest match resolution
5. Create `BaseDetectionResult` interface and detection function

**Dependencies:** None (builds on existing utilities)

**Testing Focus:** Unit tests for parsing edge cases and pattern matching logic

---

### Phase 2: Source Loader Integration

**Goal:** Integrate base detection into the source loading flow.

**Modified Files:**
- `src/core/install/sources/git-source.ts` - Add resource path handling
- `src/core/install/sources/path-source.ts` - Add pattern-based validation
- `src/core/install/unified/context.ts` - Extend interfaces

**Key Work:**
1. Modify git source loader to detect base after cloning
2. Modify path source loader to validate patterns
3. Add `detectedBase`, `baseRelative`, `matchedPattern` to context
4. Handle "no match" error case for paths

**Dependencies:** Phase 1 (base-detector.ts)

**Testing Focus:** Integration tests with mock repos

---

### Phase 3: Command Layer Updates

**Goal:** Update install command to use new parsing and handle ambiguity prompts.

**Modified Files:**
- `src/commands/install.ts` - Integrate resource parsing, add prompts
- `src/core/install/unified/context-builders.ts` - Support resource model

**New Files:**
- `src/core/install/convenience-matchers.ts` - Agent/skill matching logic

**Key Work:**
1. Replace `classifyPackageInput()` with `parseResourceArg()` at command entry
2. Add ambiguity prompts before pipeline execution
3. Implement convenience option filtering (--agents, --skills)
4. Update context builders for resource model

**Dependencies:** Phase 2

**Testing Focus:** E2E tests for CLI parsing and prompts

---

### Phase 4: Pipeline & Flow Integration

**Goal:** Modify pipeline phases to work with detected base and filtered resources.

**Modified Files:**
- `src/core/install/unified/phases/load-package.ts` - Use detected base
- `src/core/install/unified/phases/execute.ts` - Support filtered installs
- `src/core/install/unified/phases/manifest.ts` - Record base field
- `src/core/install/helpers/file-discovery.ts` - Pattern-based filtering
- `src/utils/flow-index-installer.ts` - Pass filter information

**Key Work:**
1. Use `ctx.detectedBase` as effective content root in load phase
2. Add filtered resource execution path in execute phase
3. Record `base` field in manifest for user-selected bases
4. Filter file discovery by matched pattern or resource list

**Dependencies:** Phase 3

**Testing Focus:** Integration tests for full install flows

---

### Phase 5: Manifest & Bulk Install

**Goal:** Update manifest handling and bulk install to respect base field.

**Modified Files:**
- `src/utils/package-yml.ts` - Add base field support
- `src/core/install/unified/context-builders.ts` - Read base from manifest

**Key Work:**
1. Parse `base` field from dependencies
2. Use manifest base during bulk install (skip detection if present)
3. Migrate existing dependencies on write (if needed)

**Dependencies:** Phase 4

**Testing Focus:** Bulk install with mixed manifest entries

---

### Phase 6: Edge Cases & Polish

**Goal:** Handle remaining edge cases and improve error messages.

**Key Work:**
1. Empty directory handling (record in manifest, show 0 installs)
2. Version placement validation (error on sub-path versions)
3. Improved error messages with pattern suggestions
4. Non-interactive mode defaults
5. CI/CD logging improvements

**Dependencies:** Phase 5

**Testing Focus:** Edge case unit tests, error message verification

---

## File Structure Summary

### New Files

| File | Purpose |
|------|---------|
| `src/utils/resource-arg-parser.ts` | Parse resource arguments (URL, shorthand, path) |
| `src/utils/pattern-matcher.ts` | Match paths against platforms.jsonc patterns |
| `src/core/install/base-detector.ts` | Detect installation base from resource path |
| `src/core/install/convenience-matchers.ts` | Match agents/skills by name |

### Modified Files

| File | Changes |
|------|---------|
| `src/commands/install.ts` | Resource parsing, ambiguity prompts, convenience options |
| `src/core/install/unified/context.ts` | Extended interfaces for resource model |
| `src/core/install/unified/context-builders.ts` | Build contexts from resource specs |
| `src/core/install/sources/git-source.ts` | Base detection after clone |
| `src/core/install/sources/path-source.ts` | Pattern validation for local paths |
| `src/core/install/unified/phases/*.ts` | Pipeline phase modifications |
| `src/core/install/helpers/file-discovery.ts` | Pattern-based file filtering |
| `src/utils/package-yml.ts` | Base field in dependencies |
| `src/utils/flow-index-installer.ts` | Filter information passing |

---

## Testing Strategy

### Unit Tests

- Resource argument parsing (all formats)
- Pattern matching (glob patterns, segment indexing)
- Deepest match resolution
- Base detection priority order
- Convenience matching (agents, skills)
- Frontmatter parsing

### Integration Tests

- GitHub URL to deep path installation
- GitHub shorthand with sub-path
- Local filepath installation
- Marketplace plugin selection
- Ambiguous base with user prompt
- Bulk install with base field
- Empty directory handling

### E2E Tests

- Full install from various input formats
- `--agents` and `--skills` filtering
- `--plugins` combined with agent/skill filtering
- Non-interactive mode with `--force`
- Error cases (not found, no pattern match)

### Test Fixtures

- Mock repositories with mixed content
- Marketplace manifests
- Agent files with frontmatter
- Skill directories with SKILL.md
- Various directory structures for pattern matching

---

## Corrections from Initial Outline

### Section 1: Resource Argument Parsing
- **Correction:** `git-url-detection.ts` already correctly separates repo from path. New parser should reuse these utilities rather than reimplementing.

### Section 2: Base Detection Algorithm
- **Correction:** Detection should happen in source loaders, not as a separate pipeline phase. This keeps the pipeline simple and allows pre-pipeline ambiguity handling.

### Section 4: Platform-Based File Filtering
- **Clarification:** Filtering happens at two levels:
  1. Pattern-based (from base detection) - automatic
  2. Convenience-based (from --agents/--skills) - optional
  
### Section 5: Convenience Options
- **Correction:** The current `--plugins` option is for marketplace filtering, not general plugin matching. The new `--plugins` extends this to work with `--agents`/`--skills` for scoped filtering.

### Section 7: Resource Versioning
- **Clarification:** Version placement validation should happen during parsing, not as a separate phase.

### Section 8: Installation Execution
- **Correction:** Empty directories should still record in manifest (as specified in INTENDED_BEHAVIOR.md). Initial outline didn't emphasize this.

---

## Risk Assessment

### Low Risk
- Resource argument parsing (well-defined formats)
- Pattern extraction from platforms.jsonc (static configuration)
- Manifest base field (simple schema addition)

### Medium Risk
- Base detection accuracy (edge cases in pattern matching)
- Convenience option matching (frontmatter parsing variability)
- Pipeline integration (many touchpoints)

### High Risk
- Backwards compatibility (must not break existing installs)
- Performance with large repos (pattern matching at scale)
- User experience for ambiguous cases (prompt quality)

### Mitigation Strategies
- Comprehensive test coverage before each phase merge
- Feature flag for gradual rollout (if needed)
- Extensive real-world testing with popular repos
- Clear error messages guiding users to correct syntax
