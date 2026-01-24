# Phase 3: Utility and Type Cleanup

## Overview

Remove utility files, type definitions, and helper functions that are only used by deleted commands. This phase focuses on supporting infrastructure that has no remaining dependencies.

## Goals

1. Remove utility files only used by deleted commands
2. Remove type definitions for deleted command options
3. Remove prompt functions only used by delete command
4. Remove formatter functions only used by list command
5. Ensure no orphaned imports or exports

## Utility Files

### Complete File Removal

#### Location: `src/utils/registry-paths.ts`

**Reason for Removal**: Only used by push and pull commands for `--paths` option parsing.

##### Functions Being Removed
- `parsePathsOption(value?: string): string[]` - Commander option parser
- `normalizeRegistryPaths(rawPaths: string[]): string[]` - Path normalization
- `buildRequestedPaths(optionPaths: string[] | undefined, specPath: string | undefined): string[]` - Path combining
- `formatRegistryPathForDisplay(registryPath: string, cwd?: string): string` - Display formatting

##### Import Check
Search for imports:
```typescript
import { parsePathsOption } from '../utils/registry-paths.js';
import { normalizeRegistryPaths } from '../utils/registry-paths.js';
import { buildRequestedPaths } from '../utils/registry-paths.js';
import { formatRegistryPathForDisplay } from '../utils/registry-paths.js';
```

**Expected locations**: 
- `src/commands/push.ts` (deleted in Phase 1)
- `src/commands/pull.ts` (deleted in Phase 1)
- `src/core/pull/pull-options.ts` (deleted in Phase 1)
- Test files (will be deleted in Phase 4)

##### Dependencies
This file imports from:
- `./registry-entry-filter.js` - Used by other commands, keep this import target
- `../constants/index.js` - Shared constants
- `../core/platforms.js` - Used by other commands

**No reverse dependencies** - safe to delete entire file.

### Utility Files to KEEP

#### `src/utils/registry-entry-filter.ts`
**KEEP** - Used by multiple remaining commands:
- Save command (flow-based-saver, save-candidate-loader, save-conflict-resolution)
- Add command (package-index-updater)
- Install command (index-based-installer, remote-pull)

#### `src/utils/package-copy.ts`
**KEEP** - Used by save and add commands:
- `readPackageFilesForRegistry()`
- `writePackageFilesToDirectory()`

#### `src/utils/package-name-resolution.ts`
**KEEP** - Used by save, add, install for resolving package names across scopes

#### `src/utils/package-name.ts`
**KEEP** - Functions like `parsePackageInput()` used by various remaining commands

#### `src/utils/package-input.ts`
**KEEP** - `classifyPackageInput()` used by install and save

## Type Definitions

### Location: `src/types/index.ts`

### Interfaces to Remove

1. **ListOptions**
   ```typescript
   export interface ListOptions {
     format: 'table' | 'json';
     filter?: string;
     all?: boolean;
     packageName?: string;
   }
   ```
   - Used only by list command

2. **PackOptions**
   ```typescript
   export interface PackOptions {
     force?: boolean;
     rename?: string; // legacy flag (ignored)
     output?: string;
     dryRun?: boolean;
   }
   ```
   - Used only by pack command

3. **PushOptions**
   ```typescript
   export interface PushOptions {
     profile?: string;
     apiKey?: string;
     paths?: string[];
   }
   ```
   - Used only by push command

4. **PullOptions**
   ```typescript
   export interface PullOptions {
     profile?: string;
     apiKey?: string;
     recursive?: boolean;
     paths?: string[];
   }
   ```
   - Used only by pull command

5. **DeleteOptions**
   ```typescript
   export interface DeleteOptions {
     force?: boolean;
     interactive?: boolean;
   }
   ```
   - Used only by delete command

### Types to KEEP

All other types in `src/types/index.ts` must be preserved:
- `OpenPackageDirectories`, `OpenPackageConfig`, `ProfileConfig`, etc. - Used by config system
- `Package`, `PackageFile`, `PackageYml`, `PackageDependency` - Core package types
- `InstallOptions`, `UninstallOptions`, `SaveOptions` - Options for remaining commands
- `RegistryEntry` - Used by remaining infrastructure (if any)
- `PackageStatus`, `CommandResult` - Generic result types
- `OpenPackageError`, `ErrorCodes` - Error handling
- `LogLevel`, `Logger` - Logging infrastructure
- `SaveDiscoveredFile`, `UninstallDiscoveredFile`, `ContentAnalysisResult`, `FileIdInfo` - Discovery types

### Validation

After removing the 5 option interfaces:
- Search for each interface name in codebase
- Should only appear in deleted command/test files
- No active imports should reference these types

## Prompt Functions

### Location: `src/utils/prompts.ts`

### Functions to Remove

These four functions are ONLY used by delete command:

1. **promptVersionSelection(packageName: string, versions: string[], action: string): Promise<string>**
   - Prompts user to select version interactively
   - Used by delete command for interactive mode

2. **promptVersionDelete(packageName: string, version: string): Promise<boolean>**
   - Confirmation prompt for deleting specific version
   - Used by delete command

3. **promptAllVersionsDelete(packageName: string, versionCount: number): Promise<boolean>**
   - Confirmation prompt for deleting all versions
   - Used by delete command

4. **promptPrereleaseVersionsDelete(packageName: string, baseVersion: string, versions: string[]): Promise<boolean>**
   - Confirmation prompt for deleting prerelease versions
   - Used by delete command

### Functions to KEEP

All other prompt functions must be preserved:
- `promptOverwriteConfirmation()` - Used by install, save, add
- `promptPackOverwrite()` - Used by pack (wait, pack is deleted - check this)
- `promptConflictResolution()` - Used by install, save
- Various other prompts used by remaining commands

### Validation

After removing the four delete-specific prompts:
- Search for function names in codebase
- Should only appear in `src/commands/delete.ts` (already deleted)
- Should only appear in test files (handled in Phase 4)

### Special Check: promptPackOverwrite

The function `promptPackOverwrite()` is used by pack command:
- If pack command is deleted, this prompt should also be removed
- Search codebase to verify no other usage
- Location: likely in `src/utils/prompts.ts`

**Action**: Remove `promptPackOverwrite()` if it's only used by pack command.

## Formatter Functions

### Location: `src/utils/formatters.ts`

### Functions to Remove

1. **displayPackageTable(packages: PackageTableEntry[], title?: string, showAllVersions: boolean = false): void**
   - Displays package list in table format
   - Used only by list command
   - Custom table formatting with column widths

2. **PackageTableEntry** (interface)
   ```typescript
   export interface PackageTableEntry {
     name: string;
     version: string;
     description?: string;
     status?: string;
     type?: string;
     available?: string;
   }
   ```
   - Used only by list command
   - Note: Also used by `displayExtendedPackageTable()` which is for status command

### Important: PackageTableEntry is Shared

The `PackageTableEntry` interface is used by:
- `displayPackageTable()` - Only used by list command (can be removed)
- `displayExtendedPackageTable()` - Used by status command (must keep)

**Decision**: Keep `PackageTableEntry` interface because status command needs it.

Only remove the `displayPackageTable()` function.

### Functions to KEEP

All other formatter functions must be preserved:
- `formatPathForDisplay()` - Used throughout codebase
- `displayExtendedPackageTable()` - Used by status command
- `displayCustomTable()` - Generic utility
- `formatProjectSummary()`, `getTreeConnector()`, `getTreePrefix()` - Tree display utils
- `formatStatus()`, `formatFileCount()`, `formatFileSize()` - Formatting utils
- `formatDependencyList()` - Dependency display
- `displayPackageConfig()` - Used by new/configure commands

### Validation

After removing `displayPackageTable()`:
- Search for function name in codebase
- Should only appear in `src/commands/list.ts` (already deleted)
- Should only appear in test files

## Import Cleanup

### Search for Orphaned Imports

After removing utilities and types:

1. **Search for registry-paths imports**
   ```typescript
   import { ... } from '../utils/registry-paths.js';
   import { ... } from '../../utils/registry-paths.js';
   ```

2. **Search for deleted type imports**
   ```typescript
   import { ListOptions, PackOptions, PushOptions, PullOptions, DeleteOptions } from '../types/index.js';
   ```

3. **Search for deleted prompt imports**
   ```typescript
   import { promptVersionSelection, promptVersionDelete, promptAllVersionsDelete, promptPrereleaseVersionsDelete } from '../utils/prompts.js';
   ```

4. **Search for deleted formatter imports**
   ```typescript
   import { displayPackageTable } from '../utils/formatters.js';
   ```

### Expected Locations

These imports should only appear in:
- Deleted command files (already removed in Phase 1)
- Deleted core pipeline files (already removed in Phase 1)
- Test files (will be removed in Phase 4)

If found in active code, investigate why and update accordingly.

## Validation Steps

After completing this phase:

1. **Build Check**
   - Run `npm run build`
   - Should compile successfully or show only test-related errors
   - No errors from active source code

2. **Type Check**
   - Verify no imports of deleted types in active code
   - Search for each deleted interface name

3. **Utility Check**
   - Verify `registry-paths.ts` file deleted
   - Verify deleted prompt functions removed from `prompts.ts`
   - Verify `displayPackageTable()` removed from `formatters.ts`

4. **Import Audit**
   - Run searches for all deleted utilities/types
   - Document any unexpected references

5. **Dependency Graph Check**
   - Verify no circular dependencies introduced
   - Verify all remaining commands still have valid imports

## Edge Cases to Consider

1. **Shared Interfaces**: `PackageTableEntry` is used by multiple formatters - keep it
2. **Prompt Functions**: Verify `promptPackOverwrite()` is only used by pack
3. **Registry Filter**: Keep `registry-entry-filter.ts` even though `registry-paths.ts` imports from it

## Estimated Time

1-2 hours

## Completion Criteria

- [x] File `src/utils/registry-paths.ts` refactored (kept `formatRegistryPathForDisplay`, removed 3 unused functions)
- [x] 5 option interfaces removed from `src/types/index.ts`
- [x] 4 delete-specific prompts removed from `src/utils/prompts.ts` (kept `promptVersionSelection` - used by install)
- [x] Function `displayPackageTable()` removed from `src/utils/formatters.ts`
- [x] Function `promptPackOverwrite()` removed (was pack-only)
- [x] Interface `PackageTableEntry` kept (used by status)
- [x] Import audit completed (no active code references deleted items)
- [x] Build check passed

## Next Phase

Proceed to [Phase 4: Test and Documentation Cleanup](./phase-4-tests-docs.md) to remove test files and documentation for deleted commands.
