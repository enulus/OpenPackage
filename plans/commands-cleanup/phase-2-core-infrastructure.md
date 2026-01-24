# Phase 2: Core Infrastructure Cleanup

## Overview

Clean up core infrastructure files that are no longer needed after command removal. This includes the RegistryManager class, directory wrapper functions, and ensuring remote-pull infrastructure is preserved.

## Goals

1. Remove RegistryManager class entirely from `src/core/registry.ts`
2. Remove directory wrapper functions only used by deleted commands
3. Preserve remote-pull infrastructure (critical for install command)
4. Update remaining code to remove imports of deleted infrastructure

## Registry Manager Removal

### Location: `src/core/registry.ts`

### Complete Class Removal

The entire **RegistryManager class** and its singleton export can be removed:

#### Methods Being Removed
- `listPackages()` - Used only by list command
- `getPackageMetadata()` - Used only by delete and show commands
- `listPackageVersions()` - Used only by delete command (wrapper call)
- `getPackageVersion()` - Used only by show and delete commands
- `hasPackage()` - Used only by delete and show commands
- `hasPackageVersion()` - Used only by delete command (wrapper call)
- `getRegistryStats()` - Unused helper method
- `validateRegistry()` - Unused helper method
- `matchesFilter()` (private) - Used only by listPackages

#### Singleton Export Being Removed
```typescript
export const registryManager = new RegistryManager();
```

### Imports to Check

After removing RegistryManager, search for any remaining imports:
```typescript
import { registryManager } from '../core/registry.js';
import { RegistryManager } from '../core/registry.js';
```

**Expected imports**: Should only appear in deleted test files (handled in Phase 4)

### File Decision

After removing the RegistryManager class:
- If the file has other exports or utilities, keep the file
- If the file only contains RegistryManager, delete the entire file

**Analysis**: The file `src/core/registry.ts` primarily contains RegistryManager. Review for any other exports before deletion.

## Directory Wrapper Functions

### Location: `src/core/directory.ts`

### Functions to Remove

These wrapper functions are ONLY used by the delete command:

1. **listPackageVersions(packageName: string): Promise<string[]>**
   - Wraps `packageManager.listPackageVersions()`
   - Only caller: delete command
   - The underlying packageManager method is used elsewhere, keep that

2. **hasPackageVersion(packageName: string, version: string): Promise<boolean>**
   - Wraps `packageManager.hasPackageVersion()`
   - Only caller: delete command
   - The underlying packageManager method may be used elsewhere, keep that

### Functions to KEEP

All other functions in `src/core/directory.ts` must be preserved:
- `ensureRegistryDirectories()` - Used by all commands
- `ensureOpenPackageDirectories()` - Used by CLI initialization
- `getRegistryDirectories()` - Used by various commands
- `getPackageVersionPath()` - Used by install, save, apply
- `getLatestPackageVersion()` - Used by install, save
- `findPackageByName()` - Used by install, save, add
- `listAllPackages()` - Used by install (dependency resolution), save

### Validation

After removing the two wrapper functions:
- Search codebase for `listPackageVersions(` calls
- Search codebase for `hasPackageVersion(` calls
- Ensure only deleted command/test files reference them

## Remote Pull Infrastructure

### Location: `src/core/remote-pull.ts`

### CRITICAL: Must Be Preserved

**DO NOT REMOVE** any files or functions from remote-pull infrastructure:

1. **src/core/remote-pull.ts**
   - Core remote operations
   - Used extensively by install command
   - Contains types, functions for fetching/downloading packages

2. **src/core/install/remote-flow.ts**
   - Remote package metadata fetching
   - Batch download operations
   - Used by install command for remote registry access

3. **src/core/install/remote-reporting.ts**
   - Remote operation reporting
   - Used by install command

4. **src/core/install/download-keys.ts**
   - Download key computation
   - Used by install command for partial installs

5. **src/core/install/version-selection.ts**
   - Version selection from remote
   - Used by install command

### Verification

The pull command used remote-pull infrastructure, but so does install:
- `install` command imports from `remote-flow.ts`
- `remote-flow.ts` imports from `remote-pull.ts`
- This chain must remain intact

Search for imports of remote-pull infrastructure:
```typescript
import { ... } from '../core/remote-pull.js';
import { ... } from './remote-flow.js';
import { ... } from './remote-reporting.js';
import { ... } from './download-keys.js';
```

**Expected**: Should appear in install command files and install core modules

## Package Manager Methods

### Location: `src/core/package.ts`

### Decision: Keep All Methods

Although some methods are only used by deleted commands, they are core capabilities that should be retained:

#### Methods Used Only by Deleted Commands
- `deletePackage(packageName: string)` - Used only by delete command
- `deletePackageVersion(packageName: string, version: string)` - Used only by delete command

#### Rationale for Keeping
1. These are fundamental package management operations
2. May be needed for programmatic use or future cleanup operations
3. May be used in background cleanup tasks or maintenance scripts
4. Removing them would make packageManager API incomplete

### No Changes Required

**DO NOT REMOVE** any methods from packageManager in this phase.

## Import Cleanup

### Search and Remove Imports

After removing RegistryManager, search entire codebase for:

1. **Registry Manager Imports**
   ```typescript
   import { registryManager } from '../core/registry.js';
   import { registryManager } from '../../core/registry.js';
   import { RegistryManager } from '../core/registry.js';
   ```

2. **Directory Wrapper Imports**
   ```typescript
   import { listPackageVersions } from '../core/directory.js';
   import { hasPackageVersion } from '../core/directory.js';
   ```

### Expected Locations

These imports should only appear in:
- Deleted command files (already removed in Phase 1)
- Test files (will be removed in Phase 4)
- Potentially in specs/documentation (will be removed in Phase 4)

If found in active code, investigate and update accordingly.

## Validation Steps

After completing this phase:

1. **Build Check**
   - Run `npm run build`
   - Should show fewer errors than Phase 1
   - Remaining errors should be from types/utilities (handled in Phase 3)

2. **Import Search**
   - Search for `registryManager` in codebase
   - Should only appear in test files and deleted command references

3. **Directory Functions Check**
   - Search for `listPackageVersions(` in codebase
   - Search for `hasPackageVersion(` in codebase
   - Should only appear in test files

4. **Remote Pull Verification**
   - Search for imports from `remote-pull.ts`
   - Verify install command still imports correctly
   - Verify remote-flow.ts still imports correctly

5. **Package Manager Check**
   - Verify `src/core/package.ts` still exports all methods
   - Verify deletePackage methods are still present

## Dependencies for Next Phase

This phase exposes the following cleanup needs for Phase 3:

1. **Type Definitions** - Remove option types for deleted commands
2. **Utility Files** - Remove registry-paths.ts (only used by push/pull)
3. **Prompt Functions** - Remove delete-specific prompts
4. **Formatter Functions** - Remove displayPackageTable (only used by list)

## Estimated Time

2-3 hours

## Completion Criteria

- [x] RegistryManager class removed from `src/core/registry.ts`
- [x] File `src/core/registry.ts` deleted or cleaned up
- [x] Directory wrapper functions removed: `listPackageVersions()`, `hasPackageVersion()` (Note: These functions are actually used by many other modules, so they were kept in directory.ts. Only the RegistryManager wrapper methods were removed.)
- [x] Remote-pull infrastructure verified intact
- [x] Package manager methods verified intact
- [x] Import search completed (no active code references deleted infrastructure)
- [x] Build check completed (documented remaining errors: none - build succeeds)

## Rollback Plan

If issues are discovered:
1. The RegistryManager class is well-isolated - can be restored from git
2. Directory wrapper functions are simple - can be recreated easily
3. Remote-pull infrastructure should not be touched, so no rollback needed

## Next Phase

Proceed to [Phase 3: Utility and Type Cleanup](./phase-3-utilities-types.md) to remove unused types, utilities, and helper functions.
