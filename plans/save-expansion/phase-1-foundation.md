# Phase 1: Foundation & Types

## Status

**✅ COMPLETED**

- Implementation Date: February 6, 2026
- Files Created:
  - `src/core/save/save-types.ts` (~180 LOC)
  - `src/core/save/save-candidate-builder.ts` (~370 LOC)
  - `src/core/save/save-group-builder.ts` (~95 LOC)
  - `tests/core/save/save-candidate-builder.test.ts` (~440 LOC)
  - `tests/core/save/save-group-builder.test.ts` (~200 LOC)
- Total LOC: ~645 (core) + ~640 (tests) = ~1,285 LOC
- Test Results: ✅ All 25 tests passing

## Overview

Establish the foundational type system and core data transformation modules for the enhanced save command. This phase focuses on creating the building blocks that all subsequent phases depend on.

**Estimated Effort**: 1 day  
**LOC**: ~800 (core) + ~300 (tests)

## Objectives

1. Define comprehensive type system for save operations
2. Implement candidate building (file → SaveCandidate transformation)
3. Implement candidate grouping (organize by registry path)
4. Establish patterns for error handling and validation

## Modules

### 1. `save-types.ts`

**Purpose**: Central type definitions for the entire save subsystem

**Key Types**:

#### SaveCandidate
Represents a single file version with rich metadata:
- `source`: 'local' (package source) or 'workspace'
- `registryPath`: Normalized path in package (e.g., "tools/search.md")
- `fullPath`: Absolute filesystem path
- `content`: File content string
- `contentHash`: SHA-256 hash for comparison
- `mtime`: Modification timestamp (milliseconds)
- `displayPath`: User-friendly relative path
- `platform`: Inferred platform ('cursor', 'claude', 'windsurf', 'ai', or undefined)
- `isRootFile`: Whether this is a root package file (AGENTS.md, etc.)
- `frontmatter`: Parsed YAML frontmatter (for markdown files)
- `rawFrontmatter`: Raw frontmatter text
- `markdownBody`: Body content without frontmatter
- `isMarkdown`: Boolean flag

#### SaveCandidateGroup
Organizes all versions of a single file:
- `registryPath`: The canonical registry path
- `local`: Optional local (source) candidate
- `workspace`: Array of workspace candidates (may be empty, single, or multiple)

#### ResolutionStrategy
Enumeration of resolution approaches:
- `skip`: No action needed
- `write-single`: Auto-write (exactly one candidate)
- `write-newest`: Auto-write (multiple identical candidates, pick newest)
- `force-newest`: Auto-select newest (multiple differing, force mode)
- `interactive`: User prompt required

#### ResolutionResult
Output from resolution execution:
- `selection`: Chosen universal candidate (or null if only platform-specific)
- `platformSpecific`: Array of candidates marked as platform-specific
- `strategy`: Which strategy was used
- `wasInteractive`: Whether user was prompted

#### WriteOperation
Describes a pending file write:
- `registryPath`: Target path in registry
- `targetPath`: Absolute filesystem target
- `content`: Content to write
- `operation`: 'create', 'update', or 'skip'
- `isPlatformSpecific`: Boolean flag
- `platform`: Platform name if applicable

#### WriteResult
Result of write operation:
- `operation`: The WriteOperation that was executed
- `success`: Boolean
- `error`: Optional Error object

#### CandidateBuildError
Error during candidate building:
- `path`: Filesystem path that failed
- `registryPath`: Intended registry path
- `reason`: Human-readable error message

---

### 2. `save-candidate-builder.ts`

**Purpose**: Transform filesystem files into SaveCandidate objects with metadata

**Architecture**:
```
buildCandidates(options) → CandidateBuildResult
├── buildLocalCandidates() → SaveCandidate[]
│   └── For each mapped registry path
│       └── buildCandidate('local', ...)
└── buildWorkspaceCandidates() → { candidates, errors }
    └── For each index mapping
        ├── If directory mapping
        │   └── collectFilesUnderDirectory()
        │       └── For each discovered file
        │           └── buildCandidate('workspace', ...)
        └── If file mapping
            └── buildCandidate('workspace', ...)
```

**Key Functions**:

#### `buildCandidates(options)`
Main entry point - orchestrates candidate discovery

**Input**:
- `packageRoot`: Absolute path to package source
- `workspaceRoot`: Absolute path to workspace
- `filesMapping`: Workspace index files mapping

**Output**:
- `localCandidates`: Array of source candidates
- `workspaceCandidates`: Array of workspace candidates
- `errors`: Array of build errors (non-fatal)

**Algorithm**:
1. Extract registry paths from workspace index
2. Build local candidates (only for mapped paths)
3. Build workspace candidates (from mappings)
4. Aggregate results and errors

#### `buildLocalCandidates(packageRoot, mappedRegistryPaths)`
Discover candidates in package source

**Logic**:
- Only load files that exist in workspace index mappings
- Skip directory keys (end with `/`)
- Skip non-existent files (will be created on save)
- No platform inference for local files
- Parse markdown frontmatter if applicable

#### `buildWorkspaceCandidates(workspaceRoot, packageRoot, filesMapping)`
Discover candidates in workspace

**Logic**:
- Handle both file and directory mappings
- For directories: recursively walk with `collectFilesUnderDirectory()`
- Extract target path from mapping (handle string and object formats)
- Skip non-existent files (no error - just missing)
- **Enable platform inference** for workspace files
- Parse markdown frontmatter if applicable

#### `buildCandidate(source, absPath, registryPath, options)`
Core transformation: file → candidate

**Steps**:
1. Read file content
2. Calculate SHA-256 content hash
3. Get file stats (mtime)
4. Calculate display path (relative to appropriate root)
5. Infer platform (workspace only):
   - Use `inferPlatformFromWorkspaceFile()` utility
   - Pass: absolute path, source directory, registry path, workspace root
6. Parse markdown frontmatter (if `.md` or `.markdown`):
   - Use `splitFrontmatter()` utility
   - Extract: frontmatter object, raw text, body
7. Construct SaveCandidate object

**Error Handling**:
- Log warning on failure
- Return null (skip candidate)
- Caller aggregates errors

#### `collectFilesUnderDirectory(absDir)`
Recursively enumerate files in directory

**Logic**:
- Use `walkFiles()` utility for recursive traversal
- Convert to relative paths from directory root
- Normalize path separators to forward slash
- Return array of relative paths

#### `deriveSourceDir(relPath)`
Extract first path segment for platform inference

**Example**: `.cursor/commands/test.md` → `.cursor`

---

### 3. `save-group-builder.ts`

**Purpose**: Organize candidates by registry path into groups for analysis

**Architecture**:
```
buildCandidateGroups(local, workspace) → SaveCandidateGroup[]
└── For each unique registry path
    ├── Find local candidate (if any)
    └── Find workspace candidates (if any)

filterGroupsWithWorkspace(groups) → SaveCandidateGroup[]
└── Keep only groups with non-empty workspace array
```

**Key Functions**:

#### `buildCandidateGroups(localCandidates, workspaceCandidates)`
Group candidates by registry path

**Algorithm**:
1. Collect all unique registry paths from both local and workspace
2. For each registry path:
   - Find local candidate: `localCandidates.find(c => c.registryPath === path)`
   - Find workspace candidates: `workspaceCandidates.filter(c => c.registryPath === path)`
   - Create SaveCandidateGroup
3. Return array of groups

**Optimization**: Use Set to collect unique paths efficiently

#### `filterGroupsWithWorkspace(allGroups)`
Filter to active groups

**Logic**:
- Keep only groups where `workspace.length > 0`
- These are the groups that require saving action
- Groups with empty workspace have no changes to save

---

## Data Flow

### Example Scenario

**Package Structure**:
```
package-source/
└── tools/
    └── search.md

Workspace Structure:
.cursor/tools/search.md
.claude/tools/search.md
.windsurf/tools/search.md
```

**Workspace Index Mapping**:
```yaml
packages:
  my-package:
    files:
      tools/search.md:
        - .cursor/tools/search.md
        - .claude/tools/search.md
        - .windsurf/tools/search.md
```

**Phase 1 Output**:
```typescript
// After buildCandidates()
{
  localCandidates: [
    {
      source: 'local',
      registryPath: 'tools/search.md',
      fullPath: '/path/to/package-source/tools/search.md',
      contentHash: 'abc123...',
      platform: undefined  // No platform for source files
    }
  ],
  workspaceCandidates: [
    {
      source: 'workspace',
      registryPath: 'tools/search.md',
      fullPath: '/workspace/.cursor/tools/search.md',
      contentHash: 'def456...',
      platform: 'cursor'  // Inferred from path
    },
    {
      source: 'workspace',
      registryPath: 'tools/search.md',
      fullPath: '/workspace/.claude/tools/search.md',
      contentHash: 'ghi789...',
      platform: 'claude'
    },
    {
      source: 'workspace',
      registryPath: 'tools/search.md',
      fullPath: '/workspace/.windsurf/tools/search.md',
      contentHash: 'def456...',  // Same as .cursor (identical)
      platform: 'windsurf'
    }
  ]
}

// After buildCandidateGroups()
[
  {
    registryPath: 'tools/search.md',
    local: { /* local candidate */ },
    workspace: [
      { /* .cursor candidate */ },
      { /* .claude candidate */ },
      { /* .windsurf candidate */ }
    ]
  }
]
```

---

## Integration Points

### Required Utilities (Existing)
- `workspace-index-yml.ts`: Read workspace index
- `workspace-index-helpers.ts`: Extract target path from mappings
- `hash-utils.ts`: Calculate SHA-256 hash
- `path-normalization.ts`: Normalize paths for processing
- `platforms.ts`: `inferPlatformFromWorkspaceFile()`
- `markdown-frontmatter.ts`: `splitFrontmatter()`
- `fs.ts`: `exists()`, `readTextFile()`, `getStats()`, `walkFiles()`
- `logger.ts`: Debug/info logging

### Outputs to Phase 2
- SaveCandidateGroup array (filtered with workspace candidates)
- Error array (non-fatal build errors)

---

## Error Handling Strategy

### Build Errors (Non-Fatal)
- File read failures
- Hash calculation failures
- Directory enumeration failures

**Behavior**: Log warning, aggregate in errors array, continue processing

### Validation Errors (Fatal)
- Missing workspace index
- Invalid index structure
- Null/undefined required parameters

**Behavior**: Throw error, halt pipeline

---

## Testing Requirements

### Unit Tests

#### save-types.ts
- Type definitions compile correctly
- Type guards work as expected (if any)

#### save-candidate-builder.ts
- `buildCandidate()`: Creates candidate with all fields
- Platform inference works for workspace files
- Markdown frontmatter parsing
- Directory enumeration recursion
- Error handling for unreadable files
- Both file and directory mappings

#### save-group-builder.ts
- Groups correctly by registry path
- Handles multiple workspace candidates per group
- Handles missing local candidates
- Filter removes groups without workspace candidates

### Integration Tests

#### Scenario 1: Simple file mapping
- Single workspace file
- Exists in source
- No platform

**Expected**: 1 group with 1 local + 1 workspace candidate

#### Scenario 2: Platform variants
- Three workspace files (.cursor, .claude, .windsurf)
- Same registry path
- Exists in source

**Expected**: 1 group with 1 local + 3 workspace candidates (each with platform)

#### Scenario 3: Directory mapping
- Directory mapping in index
- Multiple files in directory tree
- Recursive discovery

**Expected**: Multiple groups, one per discovered file

#### Scenario 4: New file (no local)
- Workspace file exists
- No source file yet

**Expected**: 1 group with no local, 1 workspace candidate

---

## Success Criteria

- ✅ All type definitions compile
- ✅ Candidate builder handles file and directory mappings
- ✅ Platform inference works correctly for workspace files
- ✅ Markdown frontmatter parsing integrated
- ✅ Group builder organizes by registry path
- ✅ Error handling aggregates non-fatal errors
- ✅ Test coverage >80%

---

## Next Phase Dependencies

Phase 2 (Platform Awareness & Analysis) depends on:
- `SaveCandidateGroup` type
- `SaveCandidate` type with platform field
- Array of groups filtered to have workspace candidates
- Content hash field for comparison
