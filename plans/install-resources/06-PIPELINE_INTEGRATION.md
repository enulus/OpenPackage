# Pipeline Integration

This document specifies how the resource-based installation system integrates with the existing unified install pipeline.

---

## Overview

The unified pipeline (`runUnifiedInstallPipeline`) remains the core execution engine. The resource model adds pre-pipeline processing (parsing, base detection, filtering) and modifies some pipeline phases to work with the detected base.

---

## Modified Architecture

### Before: Package-Centric Flow

```
User Input → classifyPackageInput() → buildContext() → Pipeline
                                           │
                                           └─> Package root is implicit base
```

### After: Resource-Centric Flow

```
User Input → parseResourceArg() → loadSource() → detectBase() → filter() → Pipeline
                                                       │              │
                                                       └─> Explicit   └─> Reduced file set
                                                           base
```

---

## Pre-Pipeline Processing

### Step 1: Parse Resource Argument

Location: `src/commands/install.ts` before `buildInstallContext()`

```typescript
async function installCommand(packageInput: string | undefined, options: InstallOptions) {
  if (!packageInput) {
    return buildBulkInstallContexts(cwd, options);
  }
  
  // NEW: Parse resource argument
  const resourceSpec = parseResourceArg(packageInput, cwd);
  
  // Build context based on resource type
  const context = await buildResourceContext(cwd, resourceSpec, options);
  
  // ... continue with pipeline or pre-pipeline handling
}
```

### Step 2: Load Source Content

Location: Enhanced source loaders in `src/core/install/sources/`

For git sources:
1. Clone/fetch repository to cache
2. Resolve `resourceSpec.path` within repo
3. Return content root and available file listing

For path sources:
1. Resolve absolute path
2. Verify existence
3. Return content root

### Step 3: Detect Base

Location: New module `src/core/install/base-detector.ts`

Called after source loading, before context building completes:

```typescript
async function loadPackagePhase(ctx: InstallationContext): Promise<void> {
  // Existing: Load from source
  const loaded = await loader.load(ctx.source, ctx.options, ctx.cwd);
  
  // NEW: Detect base if resource path was specified
  if (ctx.source.resourcePath) {
    const baseResult = await detectBase(
      ctx.source.resourcePath,
      loaded.contentRoot
    );
    
    ctx.detectedBase = baseResult.base;
    ctx.baseMatchType = baseResult.matchType;
    
    // Handle marketplace detection
    if (baseResult.matchType === 'marketplace') {
      ctx.source.pluginMetadata = {
        isPlugin: true,
        pluginType: 'marketplace',
        manifestPath: baseResult.manifestPath
      };
      return; // Let command layer handle marketplace
    }
    
    // Handle ambiguity (if needed)
    if (baseResult.matchType === 'ambiguous' && !ctx.options.force) {
      ctx.ambiguousMatches = baseResult.ambiguousMatches;
      // Caller will prompt user
      return;
    }
  }
  
  // ... continue with existing loading logic
}
```

### Step 4: Handle Ambiguity (Pre-Pipeline)

Location: `src/commands/install.ts` after context building

```typescript
// After building context, before pipeline
if (context.ambiguousMatches) {
  if (canPrompt) {
    const selected = await promptBaseSelection(context.ambiguousMatches);
    context.detectedBase = selected.base;
    context.baseRelative = selected.baseRelative;
  } else {
    // Non-interactive: use deepest match
    context.detectedBase = selectDeepestMatch(context.ambiguousMatches).base;
  }
}
```

### Step 5: Apply Convenience Filters (Pre-Pipeline)

Location: `src/commands/install.ts` after base detection

```typescript
// Apply --agents, --skills, --plugins filters
if (options.agents || options.skills) {
  const filterResult = await applyConvenienceFilters(
    context.detectedBase || context.source.contentRoot,
    {
      agents: options.agents,
      skills: options.skills,
      pluginScope: resolvedPlugins  // If --plugins was also specified
    }
  );
  
  // Store filter results for pipeline
  context.filteredResources = filterResult.resources;
  context.filterErrors = filterResult.errors;
  
  // Report any not-found errors
  if (filterResult.errors.length > 0 && !options.force) {
    displayFilterErrors(filterResult.errors);
    return { success: false, error: 'Some resources not found' };
  }
}
```

---

## Modified Pipeline Phases

### Phase 1: Load Package (Modified)

**Current behavior:**
- Load package metadata
- Detect plugin type
- Create root resolved package

**New behavior:**
- All of the above, plus:
- Use `ctx.detectedBase` as the effective content root
- Filter file discovery to files matching the detected pattern

```typescript
// In load-package.ts
export async function loadPackagePhase(ctx: InstallationContext): Promise<void> {
  const loader = getLoaderForSource(ctx.source);
  const loaded = await loader.load(ctx.source, ctx.options, ctx.cwd);
  
  // NEW: Adjust content root based on detected base
  const effectiveRoot = ctx.detectedBase || loaded.contentRoot;
  
  ctx.source.contentRoot = effectiveRoot;
  
  // Create resolved package with correct root
  const rootPackage = {
    name: loaded.packageName,
    version: loaded.version,
    pkg: { metadata: loaded.metadata, files: [] },
    isRoot: true,
    source: ctx.source.type,
    contentRoot: effectiveRoot  // Use detected base
  };
  
  ctx.resolvedPackages = [rootPackage];
}
```

### Phase 2: Resolve Dependencies (Unchanged)

Dependencies are resolved relative to the package metadata, which may be at the detected base. No changes required unless packages have dependencies declared in their own manifests.

### Phase 3: Process Conflicts (Unchanged)

Conflict detection works on the final file paths. No changes required.

### Phase 4: Execute Installation (Modified)

**Current behavior:**
- Iterate resolved packages
- Call `installPackageByIndexWithFlows` for each

**New behavior:**
- If convenience filters were applied, only install filtered resources
- Pass detected base to flow installer
- Apply pattern-based file filtering

```typescript
// In execute.ts
export async function executeInstallationPhase(ctx: InstallationContext): Promise<ExecutionResult> {
  // NEW: If filtered resources specified, use them
  if (ctx.filteredResources) {
    return executeFilteredInstallation(ctx);
  }
  
  // Existing behavior for full package install
  return performIndexBasedInstallationPhases({
    cwd: ctx.cwd,
    packages: ctx.resolvedPackages,
    platforms: ctx.platforms,
    conflictResult,
    options: ctx.options,
    targetDir: ctx.targetDir
  });
}

async function executeFilteredInstallation(ctx: InstallationContext): Promise<ExecutionResult> {
  const results = [];
  
  for (const resource of ctx.filteredResources) {
    // Create mini-context for each filtered resource
    const resourceResult = await installSingleResource(
      ctx.cwd,
      resource.path,
      ctx.detectedBase,
      ctx.platforms,
      ctx.options
    );
    results.push(resourceResult);
  }
  
  return aggregateResults(results);
}
```

### Phase 5: Update Manifest (Modified)

**New behavior:**
- Record `base` field if it was user-selected or non-default
- Use resource path in dependency name

```typescript
// In manifest.ts
export async function updateManifestPhase(ctx: InstallationContext): Promise<void> {
  const dependency: PackageDependency = {
    name: ctx.source.packageName,
    // ... existing fields
  };
  
  // NEW: Record base if non-default
  if (ctx.baseRelative && ctx.baseSource === 'user-selection') {
    dependency.base = ctx.baseRelative;
  }
  
  // NEW: Record resource path if specified
  if (ctx.source.resourcePath) {
    dependency.path = ctx.source.resourcePath;
  }
  
  await addOrUpdateDependency(cwd, dependency, ctx.options);
}
```

### Phase 6: Report Results (Unchanged)

Result reporting works on the execution outcomes. No changes required.

---

## Flow Installer Integration

### FlowInstallContext Changes

```typescript
interface FlowInstallContext {
  packageName: string;
  packageRoot: string;        // NOW: Detected base path
  workspaceRoot: string;
  platform: Platform;
  packageVersion: string;
  priority: number;
  dryRun: boolean;
  packageFormat?: any;
  conversionContext?: any;
  
  // NEW: Resource filtering
  matchedPattern?: string;    // Pattern that matched for base detection
  resourceFilter?: string[];  // Specific resource paths to install (from convenience options)
}
```

### File Discovery Modification

In `file-discovery.ts`:

```typescript
export async function discoverAndCategorizeFiles(
  packageName: string,
  version: string,
  platforms: Platform[],
  includePaths?: string[],
  contentRoot?: string,
  matchedPattern?: string,     // NEW: Pattern that was matched
  resourceFilter?: string[]    // NEW: Specific resources to install
): Promise<CategorizedInstallFiles> {
  const pkg = await packageManager.loadPackage(packageName, version, {
    packageRootDir: contentRoot
  });
  
  // NEW: If resource filter specified, only include those
  if (resourceFilter && resourceFilter.length > 0) {
    const filtered = pkg.files.filter(f => 
      resourceFilter.some(r => f.path.startsWith(r) || f.path === r)
    );
    return categorizeFiles(filtered, platforms);
  }
  
  // NEW: If matched pattern specified, filter by pattern
  if (matchedPattern) {
    const filtered = pkg.files.filter(f => 
      minimatch(f.path, matchedPattern)
    );
    return categorizeFiles(filtered, platforms);
  }
  
  // Existing behavior
  return categorizeFiles(pkg.files, platforms);
}
```

---

## Context Structure Changes

### Extended InstallationContext

```typescript
interface InstallationContext {
  // Existing fields...
  source: PackageSource;
  mode: 'install' | 'apply';
  options: InstallOptions;
  platforms: Platform[];
  cwd: string;
  targetDir: string;
  resolvedPackages: ResolvedPackage[];
  warnings: string[];
  errors: string[];
  
  // NEW: Resource model fields
  
  /** Detected base path (absolute) */
  detectedBase?: string;
  
  /** Detected base relative to repo root (for manifest) */
  baseRelative?: string;
  
  /** How base was determined */
  baseSource?: 'openpackage' | 'plugin' | 'marketplace' | 'pattern' | 'user-selection' | 'manifest';
  
  /** Pattern that matched (for pattern-based detection) */
  matchedPattern?: string;
  
  /** Ambiguous matches awaiting user resolution */
  ambiguousMatches?: BaseMatch[];
  
  /** Filtered resources from convenience options */
  filteredResources?: FilteredResource[];
  
  /** Errors from convenience option filtering */
  filterErrors?: string[];
}
```

### Extended PackageSource

```typescript
interface PackageSource {
  // Existing fields...
  
  /** Resource path within the source (for git/registry sources) */
  resourcePath?: string;
  
  /** Detected base for this resource */
  detectedBase?: string;
}
```

---

## Error Handling

### No Pattern Match

If base detection fails to find any matching pattern:

```typescript
if (baseResult.matchType === 'none') {
  return {
    success: false,
    error: `Path '${resourcePath}' does not match any installable pattern.

Installable patterns include:
  - agents/**/*.md
  - skills/**/*
  - rules/**/*.md
  - commands/**/*.md

Tip: Ensure your resource contains one of these directory structures.`
  };
}
```

### Empty After Filtering

If convenience options filter out all files:

```typescript
if (filteredResources.length === 0) {
  // Still record in manifest (as specified in INTENDED_BEHAVIOR.md)
  await updateManifestPhase(ctx);
  
  return {
    success: true,
    data: {
      installed: 0,
      message: 'Succeeded with 0 installs (resource directory is empty or no matches found)'
    }
  };
}
```

---

## Backwards Compatibility

### Existing Package Installs

When no resource path is specified (e.g., `opkg i gh@user/repo`):
- Skip base detection (base = repo root)
- Skip convenience filtering
- Use existing full-package installation

### Existing Marketplace Handling

Marketplace detection remains unchanged:
- Detected during source loading
- Returns to command layer for plugin selection
- Selected plugins installed via existing flow

### Existing CLI Options

All existing options continue to work:
- `--platforms` - Target platforms
- `--dry-run` - Preview mode
- `--force` - Skip prompts, overwrite
- `--plugins` - Filter marketplace plugins
