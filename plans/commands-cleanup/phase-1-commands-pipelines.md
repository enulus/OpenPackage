# Phase 1: Command and Pipeline Removal

## Overview

Remove command files and their associated core pipeline directories. This phase focuses on the user-facing entry points and their dedicated business logic layers.

## Goals

1. Remove 6 command files from `src/commands/`
2. Remove 4 core pipeline directories from `src/core/`
3. Update main CLI entry point to remove command registrations
4. Ensure no circular dependencies are broken

## Command Files to Remove

### Location: `src/commands/`

1. **pack.ts**
   - Entry point for pack command
   - Imports from `../core/pack/pack-pipeline.js`
   - Uses `PackOptions` type
   - Has withErrorHandling wrapper

2. **list.ts**
   - Entry point for list command
   - Uses `registryManager.listPackages()`
   - Uses `displayPackageTable()` formatter
   - Uses `ListOptions` type
   - Has alias `ls`

3. **show.ts**
   - Entry point for show command
   - Imports from `../core/show/show-pipeline.js`
   - No options type (uses packageInput string)
   - Has withErrorHandling wrapper

4. **push.ts**
   - Entry point for push command
   - Imports from `../core/push/push-pipeline.js`
   - Uses `PushOptions` type
   - Uses `parsePathsOption()` from registry-paths utility

5. **pull.ts**
   - Entry point for pull command
   - Imports from `../core/pull/pull-pipeline.js`
   - Uses `PullOptions` type
   - Uses `parsePathsOption()` from pull-options

6. **delete.ts**
   - Entry point for delete command
   - Uses `registryManager` methods (hasPackage, deletePackage, etc.)
   - Uses directory wrappers (listPackageVersions, hasPackageVersion)
   - Uses delete-specific prompts (4 functions)
   - Uses `DeleteOptions` type
   - Has alias `del`

## Core Pipeline Directories to Remove

### Location: `src/core/`

### 1. `pack/` Directory
Files to remove:
- **pack-pipeline.ts** - Main pipeline orchestration
  - Functions: `runPackPipeline()`, `resolveSource()`, `handlePackOverwrite()`
  - Dependencies: Uses package-copy utils, package-name-resolution
  - Exports: `PackPipelineResult` type
  
- **pack-output.ts** - Output formatting and display
  - Functions: `createPackResultInfo()`, `displayPackSuccess()`, `displayPackDryRun()`
  - No external command dependencies

### 2. `show/` Directory
Files to remove:
- **show-pipeline.ts** - Main pipeline orchestration
  - Functions: `runShowPipeline()`, `collectPackageInfo()`
  - Dependencies: Uses package-context, package manager
  
- **show-output.ts** - Display formatting
  - Functions: `displayPackageInfo()`, `displayResolutionInfo()`
  - Uses formatters
  
- **show-types.ts** - Type definitions
  - Types: `ShowPackageInfo`, `ShowSourceInfo`, `ScopeHintInfo`, etc.
  
- **package-resolver.ts** - Package resolution logic
  - Functions: `resolvePackageForShow()`
  - Complex resolution across multiple sources
  
- **scope-discovery.ts** - Scope discovery logic
  - Functions: `discoverScopeForPackage()`
  - Used for providing scope hints in output

### 3. `push/` Directory
Files to remove:
- **push-pipeline.ts** - Main pipeline orchestration
  - Functions: `runPushPipeline()`, `findMissingPaths()`
  - Dependencies: Uses auth, package manager, http-client
  
- **push-context.ts** - Context resolution
  - Functions: `resolveUploadNameForPush()`, `resolvePushResolution()`, etc.
  - Handles package name resolution for upload
  
- **push-errors.ts** - Error handling
  - Functions: `handlePushError()`
  - Specific error formatting for push operations
  
- **push-output.ts** - Output formatting
  - Functions: `logPushSummary()`, `printPushSuccess()`
  
- **push-types.ts** - Type definitions
  - Types: `PushCommandResult`, `PushPipelineOptions`, `PushRequestContext`, etc.
  
- **push-upload.ts** - Upload operations
  - Functions: `preparePackageForUpload()`, `buildPushPayload()`, `createPushTarball()`, `uploadPackage()`
  - Handles tarball creation and HTTP upload

### 4. `pull/` Directory
Files to remove:
- **pull-pipeline.ts** - Main pipeline orchestration
  - Functions: `runPullPipeline()`
  - Uses remote-pull infrastructure (which must be kept)
  
- **pull-options.ts** - Option parsing
  - Functions: `parsePathsOption()`
  - Similar to registry-paths but pull-specific
  
- **pull-output.ts** - Output formatting
  - Functions: Various display functions
  
- **pull-strategies.ts** - Strategy pattern implementation
  - Functions: Strategy selection and execution
  - Uses remote-pull infrastructure
  
- **pull-types.ts** - Type definitions
  - Types: Pull-specific types
  
- **pull-errors.ts** - Error handling
  - Functions: Pull-specific error formatting

## Main Entry Point Updates

### Location: `src/index.ts`

### Imports to Remove
```
import { setupPackCommand } from './commands/pack.js';
import { setupListCommand } from './commands/list.js';
import { setupShowCommand } from './commands/show.js';
import { setupPushCommand } from './commands/push.js';
import { setupPullCommand } from './commands/pull.js';
import { setupDeleteCommand } from './commands/delete.js';
```

### Setup Calls to Remove
```
setupPackCommand(program);
setupListCommand(program);
setupShowCommand(program);
setupPushCommand(program);
setupPullCommand(program);
setupDeleteCommand(program);
```

### Help Text Updates
Remove references to removed commands from:
- Custom help formatter (usage section)
- "All commands" section
- Any examples that reference these commands

Update command list from:
```
new, add, remove, save, set, pack, apply, status,
install, uninstall, list, show, delete,
push, pull, configure, login, logout
```

To:
```
new, add, remove, save, set, apply, status,
install, uninstall, configure, login, logout
```

Update usage examples to remove:
```
opkg pack              snapshot package to registry
opkg list              list local packages
opkg show <pkg>        show package details
opkg push <pkg>        push to remote registry
opkg pull <pkg>        pull from remote registry
opkg delete <pkg>      delete from local registry
```

## Validation Steps

After completing this phase:

1. **Build Check**
   - Run `npm run build` or equivalent
   - Should fail with import errors for removed modules (expected)
   - Note all import errors for Phase 2 cleanup

2. **Import Analysis**
   - Search codebase for imports from removed directories:
     - `from '../core/pack/`
     - `from '../core/show/`
     - `from '../core/push/`
     - `from '../core/pull/`
   - Verify only the removed command files imported these (no other dependencies)

3. **Command Registration Check**
   - Verify `src/index.ts` no longer references removed commands
   - Help text should not mention removed commands
   - No broken imports in index.ts

4. **File System Check**
   - Verify all 6 command files deleted from `src/commands/`
   - Verify all 4 core directories deleted from `src/core/`
   - Check for any backup files or .DS_Store artifacts

## Dependencies for Next Phase

This phase exposes the following cleanup needs for Phase 2:

1. **Registry Manager** - Entire class can be removed (used only by list/show/delete)
2. **Directory Wrappers** - `listPackageVersions()` and `hasPackageVersion()` can be removed
3. **Remote Pull** - Must be preserved (used by install command)
4. **Package Manager** - Keep all methods including delete capabilities

## Estimated Time

2-3 hours

## Completion Criteria

- [x] All 6 command files removed from `src/commands/`
- [x] All 4 core pipeline directories removed from `src/core/`
- [x] `src/index.ts` updated to remove command imports and registrations
- [x] Help text updated to remove command references
- [x] Build check completed (import errors documented for next phase)
- [x] No remaining references to removed commands in active code (except tests/specs which are handled in Phase 4)

## Next Phase

Proceed to [Phase 2: Core Infrastructure Cleanup](./phase-2-core-infrastructure.md) to remove unused registry and directory infrastructure.
