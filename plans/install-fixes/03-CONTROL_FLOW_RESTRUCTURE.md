# Issue 3: Control Flow Restructure

## Problem Statement

The control flow in `installResourceCommand` has the wrong order of operations, causing convenience filters to run before marketplace handling is complete, and warnings to fire incorrectly.

## Technical Analysis

### Current Flow (Problematic)

```typescript
async function installResourceCommand(...) {
  // 1. Parse and load source
  const resourceSpec = await parseResourceArg(packageInput, cwd);
  let context = await buildResourceInstallContext(cwd, resourceSpec, options);
  const loader = getLoaderForSource(context.source);
  const loaded = await loader.load(context.source, options, cwd);
  
  // 2. Update context with loaded info
  context.source.packageName = loaded.packageName;
  context.source.version = loaded.version;
  context.source.contentRoot = loaded.contentRoot;
  context.source.pluginMetadata = loaded.pluginMetadata;
  
  // 3. Check baseDetection for marketplace ← Only catches subpath case
  if (loaded.sourceMetadata?.baseDetection) {
    if (baseDetection.matchType === 'marketplace') {
      return await handleMarketplaceInstallation(...);  // ← Exits here
    }
    // Handle ambiguous...
  }
  
  // 4. Apply convenience filters ← Runs BEFORE marketplace check!
  if ((options as any).agents || (options as any).skills) {
    const basePath = context.detectedBase || loaded.contentRoot || cwd;
    const filterResult = await applyConvenienceFilters(basePath, {...});
    // ... stores results
  }
  
  // 5. Warn about --plugins on non-marketplace ← Too late, wrong check
  if (options.plugins && options.plugins.length > 0 && 
      !(options as any).agents && !(options as any).skills) {
    console.log('Warning: --plugins flag is only used with marketplace sources. Ignoring.');
  }
  
  // 6. Run pipeline
  return await runUnifiedInstallPipeline(context);
}
```

### Problems

1. **Step 3 misses marketplace** when no subpath (Issue 1)
2. **Step 4 runs before marketplace handling** - uses wrong base path for marketplace
3. **Step 5 warning is incorrect** - fires even when it IS a marketplace (because check at step 3 failed)
4. **No integration** between `--plugins` and convenience options

### Correct Flow (Desired)

```
1. Parse and load source
2. Detect if marketplace (from BOTH baseDetection AND pluginMetadata)
3. Branch based on marketplace status:
   
   IF MARKETPLACE:
     a. If --plugins + (--agents or --skills):
        → Resolve plugin paths from marketplace.json
        → Apply convenience filters to plugin directories
        → Install filtered resources
     b. If --plugins only (no convenience options):
        → Install specified plugins entirely
     c. If (--agents or --skills) without --plugins:
        → Error: "Please specify --plugins to scope the search"
        → (OR: search all plugins - TBD on UX preference)
     d. If no flags:
        → Trigger interactive plugin selection
   
   IF NOT MARKETPLACE:
     a. If --plugins specified:
        → Warning: "--plugins is only for marketplaces"
     b. If (--agents or --skills):
        → Apply convenience filters to detected base
     c. Run pipeline normally

4. Run pipeline (for non-marketplace or after marketplace handling)
```

## Solution

### Restructured installResourceCommand

```typescript
async function installResourceCommand(
  packageInput: string,
  options: InstallOptions,
  cwd: string
): Promise<CommandResult> {
  // ============================================
  // PHASE 1: Parse and Load
  // ============================================
  
  const resourceSpec = await parseResourceArg(packageInput, cwd);
  logger.debug('Parsed resource spec', { resourceSpec });
  
  let context = await buildResourceInstallContext(cwd, resourceSpec, options);
  
  const loader = getLoaderForSource(context.source);
  const loaded = await loader.load(context.source, options, cwd);
  
  // Update context with loaded info
  context.source.packageName = loaded.packageName;
  context.source.version = loaded.version;
  context.source.contentRoot = loaded.contentRoot;
  context.source.pluginMetadata = loaded.pluginMetadata;
  
  // Store commitSha for marketplace handling
  if (loaded.sourceMetadata?.commitSha) {
    (context.source as any)._commitSha = loaded.sourceMetadata.commitSha;
  }
  
  // ============================================
  // PHASE 2: Detect Source Type
  // ============================================
  
  // Determine if this is a marketplace
  // Check BOTH baseDetection and pluginMetadata
  const isMarketplace = 
    loaded.sourceMetadata?.baseDetection?.matchType === 'marketplace' ||
    loaded.pluginMetadata?.pluginType === 'marketplace';
  
  // Extract convenience option flags
  const hasAgents = !!(options as any).agents?.length;
  const hasSkills = !!(options as any).skills?.length;
  const hasConvenienceOptions = hasAgents || hasSkills;
  const hasPluginsOption = !!(options.plugins?.length);
  
  // ============================================
  // PHASE 3: Route Based on Source Type
  // ============================================
  
  if (isMarketplace) {
    return await handleMarketplaceBranch(context, loaded, options, cwd, {
      hasAgents,
      hasSkills,
      hasConvenienceOptions,
      hasPluginsOption
    });
  }
  
  // Not a marketplace
  return await handleNonMarketplaceBranch(context, loaded, options, cwd, {
    hasAgents,
    hasSkills,
    hasConvenienceOptions,
    hasPluginsOption
  });
}

/**
 * Handle marketplace source installation
 */
async function handleMarketplaceBranch(
  context: InstallationContext,
  loaded: LoadedPackage,
  options: InstallOptions,
  cwd: string,
  flags: {
    hasAgents: boolean;
    hasSkills: boolean;
    hasConvenienceOptions: boolean;
    hasPluginsOption: boolean;
  }
): Promise<CommandResult> {
  const { hasConvenienceOptions, hasPluginsOption } = flags;
  
  // Ensure manifestPath is set
  if (!context.source.pluginMetadata?.manifestPath && loaded.pluginMetadata?.manifestPath) {
    context.source.pluginMetadata = loaded.pluginMetadata;
  }
  
  if (hasConvenienceOptions && hasPluginsOption) {
    // Case A: --plugins + (--agents or --skills)
    // Apply convenience filters scoped to specified plugins
    return await handleMarketplaceWithConvenience(context, options as any, cwd);
  }
  
  if (hasConvenienceOptions && !hasPluginsOption) {
    // Case B: (--agents or --skills) without --plugins
    // Option 1: Error - require --plugins
    // Option 2: Search all plugins (more user-friendly but slower)
    
    // For now, error with helpful message
    const repoName = context.source.packageName || 'the marketplace';
    console.error(`\nError: When using --agents or --skills with a marketplace,`);
    console.error(`       you must specify --plugins to indicate which plugins to search.`);
    console.error(`\nExample:`);
    console.error(`  opkg i ${repoName} --plugins <plugin-name> --agents <agent-name>`);
    console.error(`\nTo see available plugins, run:`);
    console.error(`  opkg i ${repoName}`);
    
    return {
      success: false,
      error: 'Missing --plugins option for marketplace with convenience options'
    };
  }
  
  // Case C & D: No convenience options (with or without --plugins)
  // Use standard marketplace installation flow
  return await handleMarketplaceInstallation(context, options, cwd);
}

/**
 * Handle non-marketplace source installation
 */
async function handleNonMarketplaceBranch(
  context: InstallationContext,
  loaded: LoadedPackage,
  options: InstallOptions,
  cwd: string,
  flags: {
    hasAgents: boolean;
    hasSkills: boolean;
    hasConvenienceOptions: boolean;
    hasPluginsOption: boolean;
  }
): Promise<CommandResult> {
  const { hasConvenienceOptions, hasPluginsOption } = flags;
  
  // Warn if --plugins was specified for non-marketplace
  if (hasPluginsOption) {
    console.log('Warning: --plugins flag is only used with marketplace sources. Ignoring.');
  }
  
  // Handle base detection results (ambiguity, pattern matching)
  if (loaded.sourceMetadata?.baseDetection) {
    const baseDetection = loaded.sourceMetadata.baseDetection;
    context.detectedBase = baseDetection.base;
    context.matchedPattern = baseDetection.matchedPattern;
    context.baseSource = baseDetection.matchType as any;
    
    // Handle ambiguous base detection
    if (baseDetection.matchType === 'ambiguous' && baseDetection.ambiguousMatches) {
      context = await handleAmbiguousBase(context, baseDetection.ambiguousMatches, cwd, options);
    }
    
    // Calculate base relative to repo root for manifest storage
    if (context.detectedBase && loaded.contentRoot) {
      context.baseRelative = relative(loaded.contentRoot, context.detectedBase);
      if (!context.baseRelative) {
        context.baseRelative = '.';
      }
    }
  }
  
  // Apply convenience filters if specified
  if (hasConvenienceOptions) {
    const basePath = context.detectedBase || loaded.contentRoot || cwd;
    
    const filterResult = await applyConvenienceFilters(basePath, {
      agents: (options as any).agents,
      skills: (options as any).skills
    });
    
    context.filteredResources = filterResult.resources;
    context.filterErrors = filterResult.errors;
    
    if (filterResult.errors.length > 0) {
      displayFilterErrors(filterResult.errors, filterResult.available);
      
      if (filterResult.resources.length === 0) {
        return {
          success: false,
          error: 'None of the requested resources were found'
        };
      }
      
      console.log(`\n⚠️  Continuing with ${filterResult.resources.length} resource(s)\n`);
    }
  }
  
  // Create resolved package for pipeline
  const resolvedSource: 'local' | 'remote' | 'path' | 'git' = 
    context.source.type === 'registry' ? 'local' :
    context.source.type === 'workspace' ? 'local' :
    context.source.type;
  
  context.resolvedPackages = [{
    name: loaded.packageName,
    version: loaded.version,
    pkg: { metadata: loaded.metadata, files: [], _format: undefined },
    isRoot: true,
    source: resolvedSource,
    contentRoot: context.detectedBase || loaded.contentRoot
  }];
  
  // Run pipeline
  return await runUnifiedInstallPipeline(context);
}
```

## Key Changes

### 1. Unified Marketplace Detection

```typescript
const isMarketplace = 
  loaded.sourceMetadata?.baseDetection?.matchType === 'marketplace' ||
  loaded.pluginMetadata?.pluginType === 'marketplace';
```

This catches marketplace in BOTH cases:
- With subpath: `baseDetection.matchType === 'marketplace'`
- Without subpath: `pluginMetadata.pluginType === 'marketplace'`

### 2. Clear Branching

Two separate handler functions:
- `handleMarketplaceBranch()` - All marketplace logic in one place
- `handleNonMarketplaceBranch()` - All non-marketplace logic in one place

### 3. Correct Warning Placement

```typescript
// In handleNonMarketplaceBranch():
if (hasPluginsOption) {
  console.log('Warning: --plugins flag is only used with marketplace sources. Ignoring.');
}
```

Now only warns when it's actually NOT a marketplace.

### 4. Explicit Case Handling

Each combination of flags is explicitly handled:

| Marketplace | --plugins | --agents/--skills | Handler |
|-------------|-----------|-------------------|---------|
| Yes | Yes | Yes | `handleMarketplaceWithConvenience()` |
| Yes | Yes | No | `handleMarketplaceInstallation()` |
| Yes | No | Yes | Error (or search all plugins) |
| Yes | No | No | `handleMarketplaceInstallation()` |
| No | Yes | Any | Warning + normal flow |
| No | No | Yes | `applyConvenienceFilters()` |
| No | No | No | Normal flow |

## Implementation Steps

1. **Create helper functions:**
   - `handleMarketplaceBranch()`
   - `handleNonMarketplaceBranch()`
   - (Optionally move from inline to separate module)

2. **Refactor `installResourceCommand()`:**
   - Single detection point for marketplace
   - Single branching point based on source type
   - Clear separation of concerns

3. **Update imports:**
   - May need to import additional types

## Testing

After restructure, verify all these paths work:

```bash
# Marketplace paths
opkg i gh@wshobson/agents                                           # Interactive selection
opkg i gh@wshobson/agents --plugins javascript-typescript           # Install plugin
opkg i gh@wshobson/agents --plugins x --agents y                    # Filtered install
opkg i gh@wshobson/agents --agents y                                # Error (no plugins)

# Non-marketplace paths
opkg i gh@user/package                                              # Normal install
opkg i gh@user/package --agents foo                                 # Convenience filter
opkg i gh@user/package --plugins bar                                # Warning + ignore
```

## Dependencies

- **Issue 1 should be fixed as part of this** - The unified marketplace detection incorporates Issue 1's fix
- **Issue 2 depends on this** - The restructured flow provides clean integration points

## Files Modified

| File | Changes |
|------|---------|
| `src/commands/install.ts` | Major restructure of `installResourceCommand()` |

## Benefits

1. **Clearer logic** - Each path is explicit and isolated
2. **Easier testing** - Each branch can be tested independently
3. **Better errors** - Context-appropriate error messages
4. **Extensibility** - Easy to add new cases (e.g., `--rules`, `--commands`)
