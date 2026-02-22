# Installation Module

This directory contains the core installation system for OpenPackage.

## Directory Structure

### `orchestrator/`
Entry point for the install command. Classifies input, selects a strategy, and routes to the pipeline or handlers.

- `orchestrator.ts` - InstallOrchestrator: validates input, runs strategy preprocess, routes by special handling (marketplace, ambiguous, multi-resource, or unified pipeline)
- `types.ts` - NormalizedInstallOptions, InputClassification, PreprocessResult, InstallStrategy
- `strategies/` - Source-type strategies: git, path, registry, bulk (each implements buildContext + preprocess)

### `preprocessing/`
Context preparation before the pipeline.

- `input-classifier.ts` - Classify user input (bulk | git | path | registry)
- `options-normalizer.ts` - Normalize CLI options (plugins, conflict strategy, platforms)
- `base-resolver.ts` - Apply base detection and path scoping
- `convenience-preprocessor.ts` - Resolve --agents / --skills filters

### `unified/`
Unified installation pipeline and context management.

- `context.ts` - Installation context type and types
- `context-builders.ts` - Functions to build contexts for different scenarios
- `context-helpers.ts` - Helper functions for working with contexts
- `pipeline.ts` - Main unified pipeline orchestration
- `phases/` - Individual pipeline phases:
  - `load-package.ts` - Load package from source
  - `resolve-dependencies.ts` - Resolve and pull dependencies
  - `conflicts.ts` - Handle file conflicts
  - `execute.ts` - Execute installation using flows
  - `manifest.ts` - Update openpackage.yml
  - `report.ts` - Report results to user

### `sources/`
Source loaders for different package types.

- `base.ts` - Base interfaces and types
- `registry-source.ts` - Load from registry
- `path-source.ts` - Load from local path (directory or tarball)
- `git-source.ts` - Load from git repository
- `workspace-source.ts` - Load from workspace index (apply mode)
- `loader-factory.ts` - Factory for creating loaders
- `index.ts` - Public exports

### `validators/`
Input validation at orchestrator entry.

- `target-validator.ts` - assertTargetDirOutsideMetadata
- `options-validator.ts` - validateResolutionFlags

### `handlers/`
Special-case handlers (marketplace handler lives in parent directory; ambiguity is handled inline in the orchestrator).

### `operations/`
Core operations used by the pipeline.

- `root-files.ts` - Root file handling (unified)
- `conflict-handler.ts` - Conflict detection and resolution
- `index.ts` - Public exports

### `helpers/`
Helper utilities specific to installation.

- `file-discovery.ts` - Discover and categorize package files
- `index.ts` - Public exports

### Other Files
- `install-flow.ts` - Core install flow used by pipeline phases
- `remote-flow.ts` - Remote package pulling
- `file-updater.ts` - File update utilities
- `marketplace-handler.ts` - Marketplace plugin selection and install
- Various loaders and utilities

## Architecture

The installation system follows a unified pipeline architecture:

```
1. Load Package (via source loaders)
   ├─ Registry Source
   ├─ Path Source
   ├─ Git Source
   └─ Workspace Source (apply)

2. Resolve Dependencies (install mode only)
   └─ Pull missing packages from remote

3. Process Conflicts
   └─ Detect conflicts and prompt user

4. Execute Installation
   └─ Use flow-based installer to write files

5. Update Manifest (install mode only)
   └─ Update openpackage.yml

6. Report Results
   └─ Display success/failure to user
```

### Key Concepts

**Installation Context**: A unified context object that carries all state through the pipeline phases. Contains package source, options, platforms, mode, etc.

**Source Loaders**: Pluggable loaders that abstract away the differences between package sources (registry, path, git, workspace). All loaders implement the `PackageSourceLoader` interface.

**Phases**: Independent pipeline phases that can be composed and executed conditionally based on context mode.

**Modes**: Two modes supported:
- `install` - Full installation with dependencies and manifest updates
- `apply` - Apply changes from workspace index without dependencies/manifest

## Usage

### Command Layer

The install command normalizes options and delegates to the orchestrator:

```typescript
import { createOrchestrator } from './orchestrator/index.js';
import { normalizeInstallOptions } from './preprocessing/index.js';

const normalizedOptions = normalizeInstallOptions(options);
const orchestrator = createOrchestrator();
const result = await orchestrator.execute(packageName, normalizedOptions, cwd);
```

The orchestrator classifies input, selects a strategy (git, path, registry, bulk), runs strategy preprocess, then routes to the marketplace handler, ambiguity handling, multi-context pipeline, or unified pipeline.

### Adding a New Source Type

1. Create a new source loader in `sources/`
2. Implement the `PackageSourceLoader` interface
3. Register in `loader-factory.ts`
4. Add an install strategy in `orchestrator/strategies/` that implements `InstallStrategy` (canHandle, buildContext, preprocess)
5. Register the strategy in `createOrchestrator()` in `orchestrator/orchestrator.ts`

## Testing

Each module has corresponding tests:

- `tests/core/install/` - Integration tests for install flows
- `tests/core/flows/` - Flow system tests
- Unit tests co-located with implementation

Run tests:
```bash
npm test                    # All tests
npm run test:install        # Install tests only
```

## Migration Notes

This module is the result of a major refactoring (Phases 1-11):

- **Phase 1-2**: Type foundation, validators, options normalizer
- **Phase 3-4**: Orchestrator shell, input classification
- **Phase 5-6**: Strategies (git, path, registry, bulk), preprocessing (base resolver, convenience filters)
- **Phase 7-8**: Ambiguity handled inline in orchestrator; marketplace handler receives context from orchestrator
- **Phase 9-11**: Single path through orchestrator; pipeline assertion at entry; dead code removed

See `plans/install-organization/` for the full refactoring plan.

## Related Documentation

- [Install Command Spec](../../specs/install/)
- [Apply Command Spec](../../specs/apply/)
- [Platform Flows](../../specs/platforms/)
- [Install Refactoring Plan](../../plans/install-organization/)
