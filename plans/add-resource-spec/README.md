# Add Command: Resource Spec Support

## Overview

Extend `opkg add` to accept any resource type as its first argument (matching `opkg install`'s input classification), with two execution modes: **dependency mode** (record in `openpackage.yml`) and **copy mode** (copy files into package source). The mode is auto-detected from the input type with a `--copy` override flag.

## Current State

```
opkg add <path> [--to <package>] [--platform-specific]
```

- Accepts only a local filesystem path
- Copies files into a mutable package source or workspace `.openpackage/`
- Does NOT touch `openpackage.yml` dependencies
- Pipeline: `add-to-source-pipeline.ts` (file-copy only)

## Proposed State

```
opkg add <resource-spec> [--to <target>] [--dev] [--copy] [--platform-specific]
```

- Accepts: registry packages, GitHub URLs, GitHub shorthand, git URLs, local paths, tarballs
- Two modes: dependency (record in manifest) or copy (file-copy into package)
- Mode auto-detected from input type, overridable with `--copy`
- `--to` works in both modes (target package for dependency or copy destination)

## Architecture

```
src/commands/add.ts (CLI definition + display)
  │
  ├── classifyAddInput()  [NEW: src/core/add/add-input-classifier.ts]
  │     ├── reuses: parseResourceArg() from utils/resource-arg-parser.ts
  │     ├── reuses: classifyPackageInput() from utils/package-input.ts
  │     ├── reuses: isValidPackageDirectory() from core/package-context.ts
  │     ├── reuses: detectPluginType() from core/install/plugin-detector.ts
  │     └── returns: AddInputClassification { mode, resourceSpec | copyPath }
  │
  ├── DEPENDENCY MODE → addDependencyFlow()  [NEW: src/core/add/add-dependency-flow.ts]
  │     ├── reuses: addPackageToYml() from utils/package-management.ts
  │     ├── reuses: resolveMutableSource() from core/source-resolution/ (for --to)
  │     ├── reuses: ensureLocalOpenPackageStructure() from utils/package-management.ts
  │     ├── reuses: createWorkspacePackageYml() from utils/package-management.ts
  │     └── reuses: getLocalPackageYmlPath() from utils/paths.ts
  │
  └── COPY MODE → runAddToSourcePipeline()  [EXISTING, unchanged]
        └── current file-copy pipeline
```

---

## Phase 1: Input Classification

### File: `src/core/add/add-input-classifier.ts` (NEW)

**Purpose**: Classify the first argument to determine execution mode and resource details.

#### Types

```ts
export type AddMode = 'dependency' | 'copy';

export interface AddInputClassification {
  mode: AddMode;

  // Dependency mode fields
  resourceSpec?: ResourceSpec;         // From parseResourceArg()
  packageName?: string;                // Resolved package name for manifest
  version?: string;                    // Version constraint
  gitUrl?: string;                     // Git source URL
  gitRef?: string;                     // Git ref/branch/tag
  gitPath?: string;                    // Subdirectory within git repo
  localPath?: string;                  // Absolute path for path-based dependency
  base?: string;                       // Base path for resource model

  // Copy mode fields
  copySourcePath?: string;             // Absolute path to copy from
}
```

#### Logic: `classifyAddInput(input, cwd, options)`

Reuses `parseResourceArg()` from `src/utils/resource-arg-parser.ts` as the primary parser, falling back to `classifyPackageInput()` from `src/utils/package-input.ts` for legacy cases.

```
1. If --copy flag is set AND input is a local path → mode: 'copy'
2. If --copy flag is set AND input is NOT a local path → ERROR
3. Parse input with parseResourceArg(input, cwd):
   a. type: 'github-url'      → mode: 'dependency'
   b. type: 'github-shorthand' → mode: 'dependency'
   c. type: 'registry'         → mode: 'dependency'
   d. type: 'filepath':
      i.   isDirectory=false                               → mode: 'copy'
      ii.  isDirectory=true, has openpackage.yml            → mode: 'dependency'
      iii. isDirectory=true, is plugin (detectPluginType)   → mode: 'dependency'
      iv.  isDirectory=true, no manifest, no plugin         → mode: 'copy'
4. Fallback to classifyPackageInput(input, cwd):
   a. type: 'git'       → mode: 'dependency'
   b. type: 'tarball'   → mode: 'dependency'
   c. type: 'directory'  → mode: 'dependency' (classifyPackageInput already validates it's a package)
   d. type: 'registry'  → mode: 'dependency'
```

#### Reused Code
| Function | Source | Purpose |
|---|---|---|
| `parseResourceArg()` | `src/utils/resource-arg-parser.ts` | Primary input parsing (gh@, URLs, paths, registry) |
| `classifyPackageInput()` | `src/utils/package-input.ts` | Legacy fallback (tarball, git:, github:) |
| `isValidPackageDirectory()` | `src/core/package-context.ts` | Check if dir has `openpackage.yml` |
| `detectPluginType()` | `src/core/install/plugin-detector.ts` | Check if dir is a Claude plugin |
| `looksLikePath()` | Inline (same logic as `resource-arg-parser.ts:278-287`) | Path syntax detection |

---

## Phase 2: Dependency Flow

### File: `src/core/add/add-dependency-flow.ts` (NEW)

**Purpose**: Record a dependency in the target `openpackage.yml`. Does NOT install — just records.

#### Function: `runAddDependencyFlow(classification, options)`

```ts
export interface AddDependencyOptions {
  dev?: boolean;           // --dev → dev-dependencies
  to?: string;             // --to → target package (must be mutable)
}

export interface AddDependencyResult {
  packageName: string;     // What was added
  targetManifest: string;  // Which openpackage.yml was updated
  section: 'dependencies' | 'dev-dependencies';
  action: 'added' | 'updated';
  version?: string;
}
```

#### Logic

```
1. Determine target manifest path:
   a. If --to is provided:
      - Resolve with resolveMutableSource({ cwd, packageName: options.to })
      - Use that package's openpackage.yml path
      - assertMutableSourceOrThrow() for safety
   b. If no --to:
      - Default: root openpackage.yml via getLocalPackageYmlPath(cwd)
      - If it doesn't exist: create via ensureLocalOpenPackageStructure() + createWorkspacePackageYml()

2. Build dependency fields from classification:
   - registry:          { name, version }
   - github-url:        { name (owner/repo or owner/repo/path), gitUrl, gitRef, gitPath }
   - github-shorthand:  { name (owner/repo or owner/repo/path), gitUrl, gitRef, gitPath }
   - generic git:       { name (from URL), gitUrl, gitRef, gitPath }
   - local path:        { name (from manifest or dirname), path (relative/tilde) }
   - tarball:           { name (from manifest inside tarball or filename), path }

3. Call addPackageToYml(targetDir, name, version, isDev, ...)
   - This is the SAME function install uses
   - It handles: dedup, version range logic, section placement, write

4. Return result for display
```

#### Reused Code
| Function | Source | Purpose |
|---|---|---|
| `addPackageToYml()` | `src/utils/package-management.ts` | Core manifest update logic (dedup, versioning, write) |
| `resolveMutableSource()` | `src/core/source-resolution/resolve-mutable-source.ts` | Resolve `--to` target package |
| `assertMutableSourceOrThrow()` | `src/utils/source-mutability.ts` | Validate target is mutable |
| `ensureLocalOpenPackageStructure()` | `src/utils/package-management.ts` | Create `.openpackage/` dirs |
| `createWorkspacePackageYml()` | `src/utils/package-management.ts` | Create workspace manifest |
| `getLocalPackageYmlPath()` | `src/utils/paths.ts` | Resolve `.openpackage/openpackage.yml` path |
| `formatPathForYaml()` | `src/utils/path-resolution.ts` | Format local paths for manifest (relative/tilde) |
| `normalizePackageName()` | `src/utils/package-name.ts` | Normalize package name for manifest entry |

#### Deriving Package Name from Input

For dependency mode, we need a `name` to record in the manifest. Rules:

| Input Type | Name Derivation |
|---|---|
| Registry (`@scope/pkg`) | Direct: `@scope/pkg` |
| Registry with path (`@scope/pkg/agents/foo`) | Package: `@scope/pkg`, path recorded separately |
| GitHub URL | `owner/repo` (from URL parsing) |
| GitHub URL with subpath | `owner/repo`, with `gitPath` for subdir |
| GitHub shorthand (`gh@owner/repo`) | `owner/repo` |
| GitHub shorthand with path | `owner/repo`, with `gitPath` for subdir |
| Generic git URL | Derive from URL (last path segment sans `.git`) |
| Local path (package dir) | Read `name` from its `openpackage.yml`, fallback to `basename(path)` |
| Tarball | Read from embedded manifest, fallback to filename sans extension |

This matches what `updateManifestPhase` in install already does — we reuse the same derivation.

---

## Phase 3: Command Definition Update

### File: `src/commands/add.ts` (MODIFY)

#### Changes

1. **Rename argument**: `<path>` → `<resource-spec>`
2. **Add options**: `--dev`, `--copy`
3. **Branch on mode**: after classification, route to dependency flow or existing copy pipeline
4. **Update display**: separate display functions for each mode

```ts
export function setupAddCommand(program: Command): void {
  program
    .command('add')
    .argument('<resource-spec>', 
      'resource to add (package[@version], gh@owner/repo, https://github.com/owner/repo, /path/to/local)')
    .description('Add a dependency to openpackage.yml or copy files to a package')
    .option('--to <package-name>', 'target package (for dependency: which manifest; for copy: which package source)')
    .option('--dev', 'add to dev-dependencies instead of dependencies')
    .option('--copy', 'force copy mode (copy files instead of recording dependency)')
    .option('--platform-specific', 'save platform-specific variants for platform subdir inputs')
    .action(
      withErrorHandling(async (resourceSpec: string, options) => {
        const cwd = process.cwd();

        // Step 1: Classify input
        const classification = await classifyAddInput(resourceSpec, cwd, options);

        // Step 2: Route to appropriate flow
        if (classification.mode === 'dependency') {
          const result = await runAddDependencyFlow(classification, {
            dev: options.dev,
            to: options.to,
          });
          displayDependencyResult(result);
        } else {
          // Copy mode — existing pipeline
          // Validate: --dev is not valid for copy mode
          if (options.dev) {
            throw new Error('--dev can only be used when adding a dependency, not when copying files');
          }
          const packageName = options.to;
          const result = await runAddToSourcePipeline(packageName, classification.copySourcePath!, options);
          if (!result.success) {
            throw new Error(result.error || 'Add operation failed');
          }
          if (result.data) {
            await displayAddResults(result.data);
          }
        }
      })
    );
}
```

#### Display: Dependency Mode

```
✓ Added @hyericlee/essentials@^1.0.0 to dependencies
  in .openpackage/openpackage.yml
```

Or with `--to`:

```
✓ Added @hyericlee/essentials@^1.0.0 to dependencies
  in .openpackage/packages/my-pkg/openpackage.yml
```

#### Display: Copy Mode (local path auto-detected)

```
✓ Added to workspace package
✓ Added files: 3
   ├── agents/foo.md
   ├── skills/bar/SKILL.md
   └── rules/baz.md
```

#### Display: Dependency Mode (local package auto-detected)

```
✓ Added my-pkg to dependencies
  in .openpackage/openpackage.yml
```

---

## Phase 4: Validation & Edge Cases

### Validation Rules (in `add-input-classifier.ts` and `add.ts`)

| Scenario | Behavior |
|---|---|
| `opkg add` (no args) | Error: `resource-spec is required` (commander handles this) |
| `opkg add @pkg --copy` | Error: `--copy can only be used with local paths` |
| `opkg add gh@owner/repo --copy` | Error: `--copy can only be used with local paths` |
| `opkg add ./file.md --dev` | Error: `--dev can only be used when adding a dependency` |
| `opkg add ./nonexistent` | Error: `Path not found: ./nonexistent` (existing behavior) |
| `opkg add @pkg --to immutable-pkg` | Error from `resolveMutableSource`: package is immutable |
| `opkg add @pkg --to nonexistent-pkg` | Error from `resolveMutableSource`: package not found |
| `opkg add @pkg --platform-specific` | Ignored (no-op for dependency mode, only applies to copy mode) |
| `opkg add @pkg@1.0 --dev --to my-pkg` | Valid: add versioned dep to my-pkg's dev-dependencies |

### Self-Reference Guard

When adding a dependency with `--to`, check if the resource being added is the same package as the target. Reuse the guard already in `addPackageToYml()` (lines 184-190 of `package-management.ts`):

```ts
if (workspacePackageName && arePackageNamesEquivalent(packageName, workspacePackageName)) {
  logger.debug(`Skipping manifest update: package is the workspace package itself`);
  return;
}
```

---

## Phase 5: Integration & Testing

### Test Cases

#### Unit: `add-input-classifier.test.ts`
1. Registry package → dependency mode
2. Registry package with version → dependency mode, version preserved
3. Registry package with sub-path → dependency mode, path preserved
4. GitHub URL → dependency mode
5. GitHub URL with tree/ref/path → dependency mode, all fields preserved
6. GitHub shorthand → dependency mode
7. GitHub shorthand with path → dependency mode
8. Generic git URL → dependency mode
9. Local directory with `openpackage.yml` → dependency mode
10. Local directory with `.claude-plugin/plugin.json` → dependency mode
11. Local directory without manifest → copy mode
12. Local file → copy mode
13. `--copy` flag overrides local package → copy mode
14. `--copy` with non-local input → error
15. Tarball → dependency mode

#### Unit: `add-dependency-flow.test.ts`
1. Add registry dependency → writes to `.openpackage/openpackage.yml`
2. Add git dependency → writes url field with ref
3. Add local path dependency → writes relative path
4. `--dev` → writes to dev-dependencies
5. `--to` with mutable package → writes to that package's manifest
6. `--to` with immutable package → error
7. Duplicate add → updates existing entry (via `addPackageToYml` dedup logic)
8. Manifest doesn't exist → creates it first

#### Integration: `add.test.ts`
1. `opkg add @scope/pkg` → dependency recorded, hint shown
2. `opkg add ./local-pkg` (with manifest) → dependency recorded, hint shown
3. `opkg add ./raw-dir` → files copied (existing behavior preserved)
4. `opkg add ./raw-dir --copy` → files copied
5. `opkg add ./local-pkg --copy` → files copied (override)
6. `opkg add gh@owner/repo --dev` → dev-dependency recorded

---

## File Change Summary

| File | Action | Scope |
|---|---|---|
| `src/core/add/add-input-classifier.ts` | **CREATE** | ~80 lines — classify input, determine mode |
| `src/core/add/add-dependency-flow.ts` | **CREATE** | ~100 lines — resolve target, build fields, call `addPackageToYml` |
| `src/commands/add.ts` | **MODIFY** | Update argument, add options, branch on mode, update display |
| `src/core/add/add-to-source-pipeline.ts` | **NO CHANGE** | Existing copy pipeline remains intact |

### Estimated New Code: ~250 lines
### Reused Code (not duplicated): ~400+ lines from existing modules

---

## Implementation Order

1. **Phase 1**: `add-input-classifier.ts` — can be built and unit-tested independently
2. **Phase 2**: `add-dependency-flow.ts` — can be built and unit-tested independently  
3. **Phase 3**: `commands/add.ts` — wires phases 1+2 together, update CLI definition
4. **Phase 4**: Validation edge cases — add guards in classifier and command
5. **Phase 5**: Integration tests
