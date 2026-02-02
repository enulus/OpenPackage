# Issue 1: Marketplace Detection Gap

## Problem Statement

When running `opkg i gh@wshobson/agents` (no subpath), the marketplace is correctly detected by the source loader but not caught by `installResourceCommand`, causing the pipeline to fail with:

```
Marketplace detected but not handled. This should be handled at command level before calling the pipeline.
```

## Technical Analysis

### Current Flow

```
1. parseResourceArg("gh@wshobson/agents")
   → Returns: { type: 'github-shorthand', path: undefined }

2. buildResourceInstallContext()
   → Creates source with: resourcePath: undefined, gitPath: undefined

3. GitSourceLoader.load() [git-source.ts:55]
   → Condition: if (source.resourcePath || source.gitPath)
   → FALSE when no subpath → detectedBaseInfo stays NULL

4. loadPackageFromGit() [git-package-loader.ts:32]
   → detectPluginType() finds .claude-plugin/marketplace.json
   → Returns: { isMarketplace: true }

5. GitSourceLoader.load() [git-source.ts:85]
   → if (result.isMarketplace || detectedBaseInfo?.matchType === 'marketplace')
   → TRUE (result.isMarketplace is true)
   → Returns LoadedPackage with pluginMetadata.pluginType === 'marketplace'

6. installResourceCommand() [install.ts:155]
   → if (loaded.sourceMetadata?.baseDetection)
   → FALSE (baseDetection is undefined because no subpath)
   → Marketplace handling block is SKIPPED

7. Pipeline runs [pipeline.ts:42]
   → if (ctx.source.pluginMetadata?.pluginType === 'marketplace')
   → TRUE
   → Returns error: "Marketplace detected but not handled"
```

### The Gap

The issue is in `installResourceCommand` at lines 155-178:

```typescript
// Current code - only checks baseDetection
if (loaded.sourceMetadata?.baseDetection) {
  const baseDetection = loaded.sourceMetadata.baseDetection;
  // ...
  if (baseDetection.matchType === 'marketplace') {
    return await handleMarketplaceInstallation(context, options, cwd);
  }
}
```

This misses the case where:
- `baseDetection` is undefined (no subpath given)
- But `pluginMetadata.pluginType === 'marketplace'` is correctly set

## Solution

### Option A: Add Direct pluginMetadata Check (Recommended)

Add an explicit check for `pluginMetadata.pluginType === 'marketplace'` after the baseDetection check:

```typescript
// After line 178, before convenience filters
// Handle marketplace detected via pluginMetadata (when no subpath specified)
if (loaded.pluginMetadata?.pluginType === 'marketplace') {
  return await handleMarketplaceInstallation(context, options, cwd);
}
```

### Option B: Ensure baseDetection Always Runs

Modify `GitSourceLoader.load()` to always run base detection for repo root:

```typescript
// In git-source.ts, change line 55
if (source.resourcePath || source.gitPath || true) {
  // Always detect, even at repo root
  const pathToDetect = source.resourcePath || source.gitPath || '.';
  // ...
}
```

This is less clean because it forces detection even when not needed.

### Recommended: Option A

Option A is cleaner and more explicit about handling the two different detection paths.

## Implementation

### File: `src/commands/install.ts`

#### Location: After line 178, before line 180

```typescript
// NEW: Handle marketplace detected via pluginMetadata (when no subpath specified)
// This catches the case where repo root is a marketplace but no resourcePath was given
if (loaded.pluginMetadata?.pluginType === 'marketplace') {
  // Ensure manifestPath is available
  if (!context.source.pluginMetadata?.manifestPath && loaded.pluginMetadata.manifestPath) {
    context.source.pluginMetadata = loaded.pluginMetadata;
  }
  return await handleMarketplaceInstallation(context, options, cwd);
}
```

### Full Context

```typescript
// Around line 155-185 in install.ts

// Base detection is already done in the source loader (Phase 2)
// Check if we have base detection results in sourceMetadata
if (loaded.sourceMetadata?.baseDetection) {
  const baseDetection = loaded.sourceMetadata.baseDetection;
  context.detectedBase = baseDetection.base;
  context.matchedPattern = baseDetection.matchedPattern;
  context.baseSource = baseDetection.matchType as any;
  
  // Handle marketplace detection
  if (baseDetection.matchType === 'marketplace') {
    return await handleMarketplaceInstallation(context, options, cwd);
  }
  
  // Handle ambiguous base detection (before pipeline)
  if (baseDetection.matchType === 'ambiguous' && baseDetection.ambiguousMatches) {
    context = await handleAmbiguousBase(context, baseDetection.ambiguousMatches, cwd, options);
  }
  
  // Calculate base relative to repo root for manifest storage
  if (context.detectedBase && loaded.contentRoot) {
    context.baseRelative = relative(loaded.contentRoot, context.detectedBase);
    if (!context.baseRelative) {
      context.baseRelative = '.'; // Base is repo root
    }
  }
}

// NEW: Handle marketplace detected via pluginMetadata (when no subpath specified)
// This catches the case where repo root is a marketplace but no resourcePath was given
if (loaded.pluginMetadata?.pluginType === 'marketplace') {
  // Ensure manifestPath is available in context
  if (!context.source.pluginMetadata?.manifestPath && loaded.pluginMetadata.manifestPath) {
    context.source.pluginMetadata = loaded.pluginMetadata;
  }
  return await handleMarketplaceInstallation(context, options, cwd);
}

// Apply convenience filters if specified (--agents, --skills)
// ... rest of code
```

## Testing

After implementing this fix:

```bash
# Should now trigger interactive plugin selection
opkg i gh@wshobson/agents

# Should now work with --plugins flag
opkg i gh@wshobson/agents --plugins javascript-typescript
```

## Edge Cases

1. **Marketplace with subpath to specific plugin**
   - `opkg i gh@wshobson/agents/plugins/javascript-typescript`
   - Should work via existing baseDetection path

2. **Non-marketplace repo root**
   - `opkg i gh@user/regular-package`
   - `pluginMetadata.pluginType` will not be 'marketplace'
   - Falls through to normal installation

3. **Marketplace inside a subdirectory**
   - `opkg i gh@user/repo/subdir` where subdir has marketplace.json
   - Should work via existing baseDetection path

## Dependencies

None - this is a standalone fix.

## Follow-up

This fix enables marketplace handling but doesn't resolve Issue 2 (convenience filters with marketplace). See [02-CONVENIENCE_FILTERS_MARKETPLACE.md](./02-CONVENIENCE_FILTERS_MARKETPLACE.md) for that fix.
