# Phase 2: Platform Awareness & Analysis

## Status

**✅ COMPLETED**

- Implementation Date: February 6, 2026
- Files Created:
  - `src/core/save/save-platform-handler.ts` (~112 LOC)
  - `src/core/save/save-conflict-analyzer.ts` (~309 LOC)
  - `tests/core/save/save-platform-handler.test.ts` (~311 LOC)
  - `tests/core/save/save-conflict-analyzer.test.ts` (~466 LOC)
- Total LOC: ~421 (core) + ~777 (tests) = ~1,198 LOC
- Test Results: ✅ All 36 tests passing (7 platform handler + 29 conflict analyzer)

## Overview

Implement platform-specific file handling and conflict detection logic. This phase adds intelligence to determine what action is needed for each candidate group.

**Estimated Effort**: 1 day  
**LOC**: ~450 (core) + ~250 (tests)

## Objectives

1. Implement platform pruning to avoid overwriting existing platform files
2. Build conflict analyzer to classify groups and recommend strategies
3. Implement candidate deduplication and sorting algorithms
4. Establish decision logic for auto-resolution vs user interaction

## Modules

### 1. `save-platform-handler.ts`

**Purpose**: Manage platform-specific candidate lifecycle

**Architecture**:
```
pruneExistingPlatformCandidates(packageRoot, groups)
└── For each group
    └── For each workspace candidate with platform
        ├── Construct platform-specific path
        ├── Check if exists in source
        └── Remove candidate if exists
```

**Key Functions**:

#### `pruneExistingPlatformCandidates(packageRoot, groups)`
Remove workspace candidates that have existing platform files in source

**Rationale**: Don't prompt user to save a platform-specific file if it already exists in source with different content. The existing platform file takes precedence.

**Algorithm**:
1. For each group in groups:
   - Skip if no local candidate (no platform files could exist yet)
   - Filter workspace candidates:
     - Keep non-platform candidates (platform is undefined or 'ai')
     - For platform candidates:
       - Call `createPlatformSpecificRegistryPath(registryPath, platform)`
       - Check if file exists at `packageRoot + platformPath`
       - If exists: Skip candidate (prune)
       - If not exists: Keep candidate
   - Replace group.workspace with filtered array
2. Mutates groups in-place

**Example**:
```
registryPath: tools/search.md
workspace candidates:
  - .cursor/tools/search.md (platform: cursor)
  - .claude/tools/search.md (platform: claude)

packageRoot structure:
  tools/search.md (universal)
  .cursor/tools/search.md (exists!)

Result: Prune .cursor candidate, keep .claude candidate
Reason: .cursor/tools/search.md already exists in source
```

**Integration**:
- Uses `createPlatformSpecificRegistryPath()` from `platform-specific-paths.ts`
- Uses `exists()` from `fs.ts`
- Logs debug messages for pruned candidates

---

### 2. `save-conflict-analyzer.ts`

**Purpose**: Classify candidate groups and recommend resolution strategies

**Architecture**:
```
analyzeGroup(group, force) → ConflictAnalysis
├── Check workspace candidate count
├── Detect root files
├── Detect platform candidates
├── Deduplicate by content hash
├── Check parity with local
└── Determine analysis type and strategy
```

**Key Types**:

#### ConflictAnalysisType
Classification of conflict scenarios:
- `no-action-needed`: No workspace candidates
- `no-change-needed`: Workspace matches source exactly
- `auto-write`: Can auto-resolve (single or identical)
- `needs-resolution`: Multiple differing candidates

#### ConflictAnalysis
Output of analysis:
- `registryPath`: Path being analyzed
- `type`: ConflictAnalysisType
- `workspaceCandidateCount`: Total workspace candidates
- `uniqueWorkspaceCandidates`: Deduplicated candidates
- `hasLocalCandidate`: Whether source file exists
- `localMatchesWorkspace`: Whether source matches workspace
- `isRootFile`: Root package file flag
- `hasPlatformCandidates`: Any platform-specific candidates
- `recommendedStrategy`: ResolutionStrategy for execution

**Key Functions**:

#### `analyzeGroup(group, force)`
Main analysis function

**Algorithm**:
1. Extract metadata:
   - `hasLocal = !!group.local`
   - `workspaceCandidates = group.workspace`
   - `workspaceCandidateCount = workspaceCandidates.length`

2. Check if root file:
   - Registry path equals `AGENTS.md` or other root patterns
   - OR any candidate has `isRootFile` flag

3. Check for platform candidates:
   - Any candidate has platform field (not undefined, not 'ai')

4. **Early exit**: No workspace candidates
   - Type: `no-action-needed`
   - Strategy: `skip`

5. Deduplicate workspace candidates:
   - Call `deduplicateCandidates(workspaceCandidates)`
   - Keep first occurrence of each unique hash

6. Check local parity:
   - If `hasLocal` and exactly 1 unique workspace candidate
   - Compare: `uniqueWorkspace[0].contentHash === local.contentHash`
   - If match: Type `no-change-needed`, Strategy `skip`

7. **Single or identical** candidates:
   - If `uniqueWorkspace.length === 1`
   - Type: `auto-write`
   - Strategy: `write-single`

8. **Multiple differing** candidates:
   - Type: `needs-resolution`
   - Strategy: `force ? 'force-newest' : 'interactive'`

**Return**: ConflictAnalysis object with all fields populated

#### `deduplicateCandidates(candidates)`
Remove duplicate candidates by content hash

**Algorithm**:
1. Create Set to track seen hashes
2. Create result array
3. For each candidate:
   - If hash already seen: Skip
   - Otherwise: Add hash to set, add candidate to result
4. Return deduplicated array

**Preserves**: First occurrence of each unique hash (order matters)

#### `hasContentDifference(local, workspace)`
Check if any workspace differs from local

**Algorithm**:
- If no local: Return true (creation is a difference)
- If no workspace: Return false (no change)
- Check if any workspace candidate hash differs from local hash
- Return boolean

#### `getNewestCandidate(candidates)`
Find candidate with most recent mtime

**Algorithm**:
1. If empty array: Throw error
2. If single candidate: Return it
3. Find candidate with max mtime
4. **Tie-breaking**: If multiple with same max mtime, use alphabetical order by displayPath
5. Return newest candidate

**Use Case**: Auto-select in force mode or when all candidates identical

#### `sortCandidatesByMtime(candidates)`
Sort candidates newest-first with tie-breaking

**Algorithm**:
1. Clone array (don't mutate input)
2. Sort by:
   - Primary: mtime descending (newest first)
   - Tie-breaker: displayPath ascending (alphabetical)
3. Return sorted array

**Use Case**: Establish consistent ordering for user prompts

---

## Decision Logic

### Flow Chart
```
analyzeGroup(group, force)
│
├─ workspaceCount === 0
│  └─→ no-action-needed (skip)
│
├─ uniqueCount === 1 && matches local
│  └─→ no-change-needed (skip)
│
├─ uniqueCount === 1
│  └─→ auto-write (write-single)
│
└─ uniqueCount > 1
   ├─ force === true
   │  └─→ needs-resolution (force-newest)
   └─ force === false
      └─→ needs-resolution (interactive)
```

### Resolution Strategy Mapping

| Scenario | Type | Strategy | User Prompt? |
|----------|------|----------|--------------|
| No workspace files | no-action-needed | skip | No |
| Workspace matches source | no-change-needed | skip | No |
| Single workspace file | auto-write | write-single | No |
| Multiple identical files | auto-write | write-newest | No |
| Multiple differing + force | needs-resolution | force-newest | No |
| Multiple differing + no force | needs-resolution | interactive | Yes |

---

## Platform Pruning Examples

### Example 1: Existing platform file
```
Before pruning:
Group {
  registryPath: "tools/calc.md",
  local: { contentHash: "aaa" },
  workspace: [
    { platform: "cursor", contentHash: "bbb" },
    { platform: "claude", contentHash: "ccc" }
  ]
}

Package source structure:
  tools/calc.md (universal)
  .cursor/tools/calc.md (exists!)

After pruning:
Group {
  registryPath: "tools/calc.md",
  local: { contentHash: "aaa" },
  workspace: [
    { platform: "claude", contentHash: "ccc" }
  ]
}

Reason: .cursor candidate removed because platform file exists in source
```

### Example 2: No existing platform files
```
Before pruning:
Group {
  registryPath: "tools/search.md",
  local: { contentHash: "xxx" },
  workspace: [
    { platform: "cursor", contentHash: "yyy" },
    { platform: "windsurf", contentHash: "zzz" }
  ]
}

Package source structure:
  tools/search.md (universal only)

After pruning:
Group {
  registryPath: "tools/search.md",
  local: { contentHash: "xxx" },
  workspace: [
    { platform: "cursor", contentHash: "yyy" },
    { platform: "windsurf", contentHash: "zzz" }
  ]
}

Reason: No platform files exist, so all candidates retained
```

---

## Conflict Analysis Examples

### Example 1: Single workspace file
```
Input:
Group {
  registryPath: "README.md",
  local: { contentHash: "abc" },
  workspace: [
    { contentHash: "def" }
  ]
}

Analysis:
{
  type: 'auto-write',
  workspaceCandidateCount: 1,
  uniqueWorkspaceCandidates: [{ contentHash: "def" }],
  hasLocalCandidate: true,
  localMatchesWorkspace: false,
  recommendedStrategy: 'write-single'
}
```

### Example 2: Multiple identical files
```
Input:
Group {
  registryPath: "tools/calc.md",
  local: { contentHash: "aaa" },
  workspace: [
    { platform: "cursor", contentHash: "bbb", mtime: 1000 },
    { platform: "windsurf", contentHash: "bbb", mtime: 2000 }
  ]
}

After deduplication:
uniqueWorkspaceCandidates: [
  { platform: "windsurf", contentHash: "bbb", mtime: 2000 }
]

Analysis:
{
  type: 'auto-write',
  workspaceCandidateCount: 2,
  uniqueWorkspaceCandidates: [{ contentHash: "bbb" }],
  hasLocalCandidate: true,
  localMatchesWorkspace: false,
  hasPlatformCandidates: true,
  recommendedStrategy: 'write-single'
}
```

### Example 3: Multiple differing files (force)
```
Input:
Group {
  registryPath: "AGENTS.md",
  workspace: [
    { contentHash: "aaa", mtime: 1000 },
    { contentHash: "bbb", mtime: 2000 },
    { contentHash: "ccc", mtime: 1500 }
  ]
}
force: true

Analysis:
{
  type: 'needs-resolution',
  workspaceCandidateCount: 3,
  uniqueWorkspaceCandidates: [all three],
  hasLocalCandidate: false,
  localMatchesWorkspace: false,
  isRootFile: true,
  recommendedStrategy: 'force-newest'
}

Resolution: Auto-select candidate with mtime: 2000 (newest)
```

### Example 4: Multiple differing files (interactive)
```
Input:
Group {
  registryPath: "tools/search.md",
  local: { contentHash: "xxx" },
  workspace: [
    { platform: "cursor", contentHash: "aaa", mtime: 1000 },
    { platform: "claude", contentHash: "bbb", mtime: 2000 }
  ]
}
force: false

Analysis:
{
  type: 'needs-resolution',
  workspaceCandidateCount: 2,
  uniqueWorkspaceCandidates: [both],
  hasLocalCandidate: true,
  localMatchesWorkspace: false,
  hasPlatformCandidates: true,
  recommendedStrategy: 'interactive'
}

Resolution: Prompt user to choose
```

---

## Integration Points

### Required Utilities (Existing)
- `platform-specific-paths.ts`: `createPlatformSpecificRegistryPath()`
- `fs.ts`: `exists()`
- `logger.ts`: Debug logging
- `constants/index.ts`: `FILE_PATTERNS` (for root file detection)

### Inputs from Phase 1
- SaveCandidateGroup array (after initial grouping)

### Outputs to Phase 3
- ConflictAnalysis array (one per group)
- Pruned candidate groups (mutated in-place)

---

## Testing Requirements

### Unit Tests

#### save-platform-handler.ts
- Prunes candidates with existing platform files
- Keeps candidates without existing platform files
- Handles missing local candidate
- Handles non-platform candidates (keeps them)
- Handles 'ai' platform (keeps them)

#### save-conflict-analyzer.ts
- `analyzeGroup()`: All conflict types
- `analyzeGroup()`: Force mode changes strategy
- `analyzeGroup()`: Root file detection
- `analyzeGroup()`: Platform candidate detection
- `deduplicateCandidates()`: Removes duplicates, preserves order
- `hasContentDifference()`: Detects differences correctly
- `getNewestCandidate()`: Finds max mtime, handles ties
- `sortCandidatesByMtime()`: Sorts correctly with tie-breaking

### Integration Tests

#### Scenario 1: No conflicts (single file)
- Single workspace candidate
- Different from source
- Analysis: auto-write, write-single

#### Scenario 2: No conflicts (identical files)
- Multiple workspace candidates
- Same content hash
- Analysis: auto-write, write-single (after dedup)

#### Scenario 3: Platform pruning
- Multiple platform candidates
- One has existing platform file in source
- After pruning: Candidate removed
- Analysis: Based on remaining candidates

#### Scenario 4: Force mode
- Multiple differing candidates
- Force flag enabled
- Analysis: needs-resolution, force-newest

#### Scenario 5: Interactive mode
- Multiple differing candidates
- Force flag disabled
- Analysis: needs-resolution, interactive

---

## Success Criteria

- ✅ Platform pruning prevents overwriting existing files
- ✅ Conflict analyzer correctly classifies all scenarios
- ✅ Deduplication removes duplicate content
- ✅ Newest candidate selection works with tie-breaking
- ✅ Force mode bypasses interactive prompts
- ✅ Root file detection works
- ✅ Test coverage >80%

---

## Next Phase Dependencies

Phase 3 (Resolution & User Interaction) depends on:
- `ConflictAnalysis` type with recommended strategy
- `ResolutionStrategy` enum
- Sorted and deduplicated unique candidates
- `getNewestCandidate()` function for force mode
