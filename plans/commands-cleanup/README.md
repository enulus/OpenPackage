# Commands Cleanup Implementation Plan

## Overview

This plan outlines the removal of 6 commands (pack, list, show, push, pull, delete) from the OpenPackage CLI to simplify the codebase and enhance UX. This is a breaking change with **no backwards compatibility**.

## Goals

1. Remove unused/redundant commands that complicate the user experience
2. Reduce codebase complexity by ~3,000+ lines of code
3. Maintain full functionality for the remaining 11 core workflow commands
4. Ensure no circular dependencies or breaking changes to remaining commands

## Commands Being Removed

1. **pack** - Snapshot package source to local registry
2. **list** - List local packages
3. **show** - Show package details
4. **push** - Push package to remote registry
5. **pull** - Pull package from remote registry
6. **delete** - Delete package from local registry

## Commands Remaining (11 total)

1. **new** - Create new packages
2. **add** - Add files to mutable packages
3. **remove** - Remove files from mutable packages
4. **save** - Save workspace edits back to package
5. **set** - Update manifest metadata
6. **apply** - Apply package to workspace
7. **install** - Install packages (retains remote-pull infrastructure)
8. **uninstall** - Remove packages from workspace
9. **status** - Check package sync status
10. **configure** - Configure settings
11. **login/logout** - Authentication

## Implementation Phases

See the following documents for detailed phase breakdowns:

1. [Phase 1: Command and Pipeline Removal](./phase-1-commands-pipelines.md)
2. [Phase 2: Core Infrastructure Cleanup](./phase-2-core-infrastructure.md)
3. [Phase 3: Utility and Type Cleanup](./phase-3-utilities-types.md)
4. [Phase 4: Test and Documentation Cleanup](./phase-4-tests-docs.md)
5. [Phase 5: Validation and Integration](./phase-5-validation.md)

## Key Preservation Rules

### Critical Infrastructure to Keep

1. **Remote Pull Infrastructure** - Used by install command for remote registry downloads
2. **Package Manager Core** - All methods including delete capabilities (for programmatic use)
3. **Core Directory Functions** - Most wrapper functions used by remaining commands
4. **Registry Entry Filter** - Used by save, add, and install commands
5. **Package Copy Utilities** - Used by save and add commands
6. **Formatters** - Partial (keep status command formatters)

### Safe to Remove

1. **RegistryManager Class** - Entire class unused after removing list/show/delete
2. **Registry Paths Utility** - Only used by push/pull for --paths option
3. **Delete-specific Prompts** - Four version selection/deletion prompts
4. **Pack/Show/Push/Pull Pipelines** - Completely isolated, no dependencies

## Impact Analysis

### Code Reduction
- **Command files:** 6 files
- **Core pipelines:** 4 directories (~20 files)
- **Utility files:** 1 complete file, partial removals from 3 others
- **Type definitions:** 5 interfaces
- **Test files:** ~8 files + 3 spec directories
- **Total:** ~3,000+ lines of code

### Breaking Changes
- All 6 commands will be completely removed
- No migration path or deprecation warnings
- Users must adapt workflows to use remaining commands

### Non-Breaking
- All remaining 11 commands maintain full functionality
- No API changes to remaining commands
- No changes to core workflow patterns

## Risk Assessment

### Low Risk
- Command files are isolated with clear boundaries
- Core pipelines have no reverse dependencies
- Test coverage validates remaining functionality

### Medium Risk
- Registry infrastructure refactoring (RegistryManager removal)
- Ensuring remote-pull infrastructure stays intact for install

### Mitigation
- Phase-by-phase implementation with validation checkpoints
- Comprehensive testing after each phase
- Manual testing of all remaining commands

## Success Criteria

1. All 6 commands removed from CLI
2. All 11 remaining commands pass tests
3. No orphaned code or unused imports
4. Documentation updated to reflect changes
5. Build completes without errors or warnings
6. Manual testing confirms all workflows function correctly

## Timeline Estimate

- Phase 1: 2-3 hours (command and pipeline removal)
- Phase 2: 2-3 hours (core infrastructure cleanup)
- Phase 3: 1-2 hours (utility and type cleanup)
- Phase 4: 1-2 hours (test and documentation cleanup)
- Phase 5: 2-3 hours (validation and integration testing)

**Total:** 8-13 hours

## Next Steps

Begin with Phase 1 by removing command files and their associated pipelines. See [Phase 1 documentation](./phase-1-commands-pipelines.md) for detailed instructions.
