# Commands Cleanup - Summary

## Quick Reference

This document provides a high-level summary of the commands cleanup refactor. For detailed phase-by-phase instructions, see the individual phase documents.

## What's Being Removed

### 6 Commands
- **pack** - Snapshot package to local registry
- **list** - List local packages  
- **show** - Show package details
- **push** - Push to remote registry
- **pull** - Pull from remote registry
- **delete** - Delete from local registry

### Core Infrastructure
- **4 pipeline directories** (~20 files)
  - `src/core/pack/`
  - `src/core/show/`
  - `src/core/push/`
  - `src/core/pull/`

- **RegistryManager class** (complete removal)
  - `src/core/registry.ts` - Entire class + singleton

- **Directory wrappers** (2 functions)
  - `listPackageVersions()` from `src/core/directory.ts`
  - `hasPackageVersion()` from `src/core/directory.ts`

### Utilities
- **Complete file removal**
  - `src/utils/registry-paths.ts`

- **Partial removal from files**
  - 5 option interfaces from `src/types/index.ts`
  - 4 prompt functions from `src/utils/prompts.ts`
  - 1 formatter function from `src/utils/formatters.ts`

### Tests & Documentation
- **~8 test files** across commands/, core/, and utils/
- **3 spec directories** (pack/, show/, push/)
- **Updates to**: commands-overview.md, README.md

## What's Being Kept

### 11 Remaining Commands
1. **new** - Create packages
2. **add** - Add files to packages
3. **remove** - Remove files from packages
4. **save** - Save workspace edits
5. **set** - Update manifest metadata
6. **apply** - Apply package to workspace
7. **install** - Install packages (uses remote-pull)
8. **uninstall** - Remove from workspace
9. **status** - Check sync status
10. **configure** - Configure settings
11. **login/logout** - Authentication

### Critical Infrastructure
- **Remote-pull infrastructure** - Used by install command
  - `src/core/remote-pull.ts`
  - `src/core/install/remote-flow.ts`
  - `src/core/install/remote-reporting.ts`
  - `src/core/install/download-keys.ts`
  - `src/core/install/version-selection.ts`

- **Package manager** - All methods retained
  - Including `deletePackage()` and `deletePackageVersion()` for programmatic use

- **Core utilities** - Used by multiple commands
  - `registry-entry-filter.ts` - Used by save, add, install
  - `package-copy.ts` - Used by save, add
  - `package-name-resolution.ts` - Used by save, add, install
  - Most formatter functions (keep status formatters)

## Implementation Phases

| Phase | Focus | Time Est. | Key Activities |
|-------|-------|-----------|----------------|
| **1** | Commands & Pipelines | 2-3 hrs | Remove 6 commands + 4 pipeline dirs |
| **2** | Core Infrastructure | 2-3 hrs | Remove RegistryManager + wrappers |
| **3** | Utilities & Types | 1-2 hrs | Remove utilities + types + prompts |
| **4** | Tests & Docs | 1-2 hrs | Remove tests + specs + update docs |
| **5** | Validation | 2-3 hrs | Test all remaining commands thoroughly |
| **Total** | | **8-13 hrs** | |

## Impact Assessment

### Breaking Changes
- ❌ 6 commands completely removed
- ❌ No backwards compatibility
- ❌ No migration path

### Non-Breaking  
- ✅ All 11 remaining commands unchanged
- ✅ No API changes to remaining commands
- ✅ Workflows with remaining commands unaffected

### Benefits
- 📉 ~3,000+ lines of code removed
- 📉 38% reduction in command count (18→11)
- 📈 Simplified UX and mental model
- 📈 Easier maintenance going forward
- 📈 Faster builds and test runs

## Critical Preservation Rules

### ⚠️ DO NOT REMOVE

1. **Remote-pull infrastructure** - Install depends on it
2. **Registry-entry-filter** - Save/add/install use it
3. **Package manager delete methods** - Keep for programmatic use
4. **PackageTableEntry interface** - Status command needs it
5. **Core directory functions** - Most are used by remaining commands

### ✅ SAFE TO REMOVE

1. **RegistryManager class** - Only used by deleted commands
2. **Registry-paths utility** - Only push/pull used it
3. **Delete-specific prompts** - Only delete command used them
4. **DisplayPackageTable formatter** - Only list used it
5. **Directory wrappers** - Only delete used them

## Validation Checklist

### Must Pass
- [ ] Build completes without errors
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] All 11 commands work manually
- [ ] Remote install/authentication works
- [ ] Documentation updated accurately

### Quality Gates
- [ ] No orphaned imports
- [ ] No dead code
- [ ] No circular dependencies
- [ ] Test coverage maintained
- [ ] Performance acceptable
- [ ] No regressions detected

## Risk Mitigation

### Low Risk Areas
- Command file removal (clear boundaries)
- Pipeline directory removal (no reverse deps)
- Test file removal (isolated)

### Medium Risk Areas
- RegistryManager removal (need to verify no hidden deps)
- Remote-pull preservation (must ensure install works)
- Type definition removal (need to check all imports)

### Mitigation Strategy
1. Phase-by-phase implementation
2. Validation after each phase
3. Comprehensive testing before sign-off
4. Rollback plan ready if needed

## Quick Start

To begin the refactor:

1. **Read the README** - [README.md](./README.md)
2. **Start with Phase 1** - [phase-1-commands-pipelines.md](./phase-1-commands-pipelines.md)
3. **Follow sequentially** - Complete each phase before moving to next
4. **Validate thoroughly** - Don't skip validation steps
5. **Test everything** - Manual testing is critical

## File Reference

| Document | Purpose |
|----------|---------|
| [README.md](./README.md) | Overview and goals |
| [SUMMARY.md](./SUMMARY.md) | This file - quick reference |
| [phase-1-commands-pipelines.md](./phase-1-commands-pipelines.md) | Remove commands and pipelines |
| [phase-2-core-infrastructure.md](./phase-2-core-infrastructure.md) | Remove core infrastructure |
| [phase-3-utilities-types.md](./phase-3-utilities-types.md) | Remove utilities and types |
| [phase-4-tests-docs.md](./phase-4-tests-docs.md) | Remove tests and docs |
| [phase-5-validation.md](./phase-5-validation.md) | Validate everything works |

## Key Takeaways

1. **This is a breaking change** - No backwards compatibility
2. **Remote-pull must stay** - Install command depends on it
3. **Test thoroughly** - All 11 remaining commands must work
4. **Follow phases sequentially** - Don't skip ahead
5. **Validate after each phase** - Catch issues early
6. **Document everything** - Keep notes on decisions made

## Success Criteria

The refactor is complete when:

✅ All 6 commands removed  
✅ All supporting code removed  
✅ All tests pass  
✅ All 11 commands work manually  
✅ Documentation updated  
✅ No orphaned code  
✅ Team sign-off received  

## Questions?

Refer to:
- Individual phase documents for detailed instructions
- README.md for high-level goals and rationale
- Code comments for implementation details

---

**Ready to begin?** Start with [Phase 1: Commands and Pipeline Removal](./phase-1-commands-pipelines.md)
