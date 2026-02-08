# Save Command Expansion Plan

## Overview

This plan outlines the restoration of advanced save functionality including conflict resolution and platform-specific file handling, expanding the current MVP implementation from ~300 LOC to ~3,000 LOC.

## Background

Commit `61dafadb301ec85b80efcad468e80e2432eaa970` removed a full-featured save command implementation (~5,000 LOC total) that included:
- Sophisticated conflict resolution for multiple workspace versions
- Platform-specific file variant handling (`.cursor/`, `.claude/`, `.windsurf/`)
- Interactive user prompts for conflict resolution
- Force mode for automatic newest-file selection
- Parity checking to avoid redundant operations
- Platform-aware file writes and directory management

The current MVP is a simple hash-based sync that copies workspace files back to source without handling conflicts or platform variants.

## Goals

1. **Handle Real-World Multi-Platform Workflows**: Support developers working across `.cursor/`, `.claude/`, `.windsurf/` simultaneously
2. **Prevent Data Loss**: Require user choice when multiple differing versions exist
3. **Minimize Friction**: Auto-resolve 90%+ of saves (single file or identical files)
4. **Preserve Platform Variants**: Maintain separate platform-specific files
5. **Enable Automation**: Provide `--force` flag for scripts/CI

## Architecture Overview

### Current MVP Architecture
```
save-pipeline.ts (simple ~300 LOC)
├── validateSavePreconditions()
├── collectChangedFiles()      // Hash comparison only
└── Copy files (direct overwrite)
```

### Proposed Enhanced Architecture
```
save-to-source-pipeline.ts (orchestrator ~500 LOC)
├── Phase 1: Validation
├── Phase 2: Candidate Discovery & Grouping
│   ├── save-candidate-builder.ts (~400 LOC)
│   ├── save-group-builder.ts (~200 LOC)
│   └── save-platform-handler.ts (~150 LOC)
├── Phase 3: Conflict Analysis & Resolution
│   ├── save-conflict-analyzer.ts (~300 LOC)
│   ├── save-resolution-executor.ts (~250 LOC)
│   └── save-interactive-resolver.ts (~400 LOC)
└── Phase 4: Write & Reporting
    ├── save-write-coordinator.ts (~300 LOC)
    └── save-result-reporter.ts (~200 LOC)
```

## Key Concepts

### Save Candidates
Represent file versions from different sources:
- **Local candidates**: Files in package source
- **Workspace candidates**: Files in workspace (potentially multiple per registry path)
- **Metadata**: Content hash, mtime, platform inference, frontmatter

### Candidate Groups
Organize all versions of the same file by registry path:
- Single `local` candidate (source version)
- Array of `workspace` candidates (may have platform variants)

### Conflict Types
1. **no-action-needed**: No workspace candidates
2. **no-change-needed**: Workspace matches source (hash equal)
3. **auto-write**: Single candidate OR all identical
4. **needs-resolution**: Multiple differing candidates

### Resolution Strategies
- `skip`: No action
- `write-single`: Auto-write (1 candidate)
- `write-newest`: Auto-write newest (N identical)
- `force-newest`: Auto-select newest without prompt
- `interactive`: Prompt user for each file

## Implementation Phases

### Phase 1: Foundation & Types (~1 day)
**Goal**: Establish type system and core data structures

**Deliverables**:
- Type definitions for candidates, groups, resolutions
- Candidate builder module (file → candidate transformation)
- Group builder module (organize candidates by registry path)

**Key Modules**:
- `save-types.ts`
- `save-candidate-builder.ts`
- `save-group-builder.ts`

### Phase 2: Platform Awareness & Analysis (~1 day)
**Goal**: Implement platform inference and conflict detection

**Deliverables**:
- Platform pruning logic (avoid overwriting existing platform files)
- Conflict analyzer (classify groups and recommend strategies)
- Candidate deduplication and sorting

**Key Modules**:
- `save-platform-handler.ts`
- `save-conflict-analyzer.ts`

### Phase 3: Resolution & User Interaction (~1-2 days)
**Goal**: Execute resolution strategies with user prompts

**Deliverables**:
- Resolution executor (dispatch to appropriate strategy)
- Interactive resolver (user prompts with parity checking)
- Force mode implementation

**Key Modules**:
- `save-resolution-executor.ts`
- `save-interactive-resolver.ts`

### Phase 4: Write Coordination & Integration (~1 day)
**Goal**: File writes and command integration

**Deliverables**:
- Write coordinator (universal + platform-specific writes)
- Result reporter (format output)
- Orchestrator pipeline (integrate all phases)
- Command interface updates (`--force` flag)

**Key Modules**:
- `save-write-coordinator.ts`
- `save-result-reporter.ts`
- `save-to-source-pipeline.ts`
- Updated `commands/save.ts`

## Testing Strategy

Each phase includes corresponding test coverage:

### Unit Tests
- Candidate creation and platform inference
- Conflict classification and deduplication
- Strategy execution logic
- Platform pruning behavior
- Group building correctness

### Integration Tests
- Single file, no conflicts → Auto-write
- Multiple identical files → Auto-write newest
- Multiple differing files → Interactive resolution
- Force mode → Auto-select newest
- Platform-specific variants → Separate writes
- Parity checking → Skip redundant operations
- Directory mappings → Recursive discovery

## Estimated Effort

- **Total LOC**: ~3,000 (core) + ~1,500 (tests)
- **New Modules**: 9 files
- **Development Time**: 4-5 days
- **Testing Time**: 1-2 days
- **Documentation**: Included in each phase

## Success Criteria

1. ✅ Handles multiple workspace versions without data loss
2. ✅ Auto-resolves 90%+ of common scenarios (single/identical files)
3. ✅ Preserves platform-specific file variants
4. ✅ Interactive prompts with clear UX
5. ✅ `--force` flag for automation
6. ✅ Parity checking prevents redundant prompts
7. ✅ Comprehensive test coverage (>80%)

## Migration Path

The implementation can be done incrementally:
1. New modules added alongside existing `save-pipeline.ts`
2. Command switches to new pipeline when ready
3. Old pipeline can be removed once validated

## Trade-offs

### Benefits
- Complete conflict resolution coverage
- Platform-aware file management
- Excellent UX with progressive disclosure
- Production-grade edge case handling

### Costs
- 10x code complexity vs MVP
- More surface area for bugs
- Interactive prompts slower for large changesets
- Requires platform directory understanding

## References

- Original implementation: Commit `61dafadb301ec85b80efcad468e80e2432eaa970^`
- Removal rationale: `plans/apply-save-removal/README.md`
- Platform specification: `specs/platforms/`
- Save command spec: `specs/save/README.md`
