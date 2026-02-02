# Issue 2: Convenience Filters Don't Work with Marketplace + `--plugins`

## Problem Statement

When running `opkg i gh@wshobson/agents --plugins javascript-typescript --agents typescript-pro`, the agent is not found because convenience filters search the wrong location:

```
❌ The following resources were not found:
  • Agent 'typescript-pro' not found
None of the requested resources were found
```

## Technical Analysis

### Expected Behavior (from INTENDED_BEHAVIOR.md)

> The `--plugins` option check existence of root `.claude-plugin/marketplace.json` at path specified in resource-spec, the plugin location will be defined in `.claude-plugin/marketplace.json`. If no agents or skills options specified while plugins is specified, then install all specified plugins. **If agents and/or skills specified and plugins is specified, then filter in those plugins (only install agents/skills that are inside the specified plugins).**

### Current Flow

```
1. installResourceCommand() loads the source
   → loaded.contentRoot = "/path/to/cached/wshobson/agents"

2. Convenience filters apply [install.ts:182]
   → basePath = context.detectedBase || loaded.contentRoot || cwd
   → basePath = "/path/to/cached/wshobson/agents" (repo root)

3. applyConvenienceFilters(basePath, { agents: ['typescript-pro'] })
   → matchAgents() searches: basePath + "/agents/"
   → Searches: "/path/to/cached/wshobson/agents/agents/"
   → Directory doesn't exist or agent not there
   → Returns: { found: false, error: "Agent 'typescript-pro' not found" }
```

### The Problem

In a marketplace like `wshobson/agents`:
- Agents are inside plugin directories: `/plugins/javascript-typescript/agents/typescript-pro.md`
- The code searches repo root: `/agents/` (doesn't exist)

The convenience filters don't integrate with `--plugins` to resolve plugin paths from `marketplace.json`.

### Marketplace Structure Example

```
wshobson/agents/
├── .claude-plugin/
│   └── marketplace.json    # Defines plugins and their paths
├── plugins/
│   ├── javascript-typescript/
│   │   ├── .claude-plugin/
│   │   │   └── plugin.json
│   │   └── agents/
│   │       └── typescript-pro.md   # <-- Agent is HERE
│   └── ui-design/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       └── agents/
│           └── ios-design.md
```

### marketplace.json Example

```json
{
  "name": "wshobson/agents",
  "plugins": [
    { "name": "javascript-typescript", "path": "plugins/javascript-typescript" },
    { "name": "ui-design", "path": "plugins/ui-design" }
  ]
}
```

## Solution

### Overview

When `--plugins` is specified with a marketplace:
1. Parse `marketplace.json` to get plugin definitions
2. Resolve specified plugin names to their paths
3. Use those plugin paths as bases for convenience filtering
4. Run convenience filters against each plugin directory

### Implementation Steps

#### Step 1: Export Plugin Path Resolution from marketplace-handler.ts

Add a utility function to resolve plugin paths:

```typescript
// In src/core/install/marketplace-handler.ts

/**
 * Resolve plugin names to their directory paths from a parsed marketplace
 */
export function resolvePluginPaths(
  marketplace: ParsedMarketplace,
  pluginNames: string[],
  repoPath: string
): { resolved: Array<{ name: string; path: string }>; notFound: string[] } {
  const resolved: Array<{ name: string; path: string }> = [];
  const notFound: string[] = [];
  
  for (const name of pluginNames) {
    const plugin = marketplace.plugins.find(p => p.name === name);
    if (plugin) {
      resolved.push({
        name: plugin.name,
        path: join(repoPath, plugin.path)
      });
    } else {
      notFound.push(name);
    }
  }
  
  return { resolved, notFound };
}
```

#### Step 2: Update convenience-matchers.ts

Add a new function for marketplace-aware filtering:

```typescript
// In src/core/install/convenience-matchers.ts

/**
 * Apply convenience filters across multiple plugin directories (for marketplace)
 */
export async function applyMarketplaceConvenienceFilters(
  pluginPaths: Array<{ name: string; path: string }>,
  options: ConvenienceFilterOptions
): Promise<ConvenienceFilterResult> {
  const allResources: ConvenienceFilterResult['resources'] = [];
  const allErrors: string[] = [];
  const allAvailable: { agents?: string[]; skills?: string[] } = {};
  
  for (const plugin of pluginPaths) {
    const result = await applyConvenienceFilters(plugin.path, {
      agents: options.agents,
      skills: options.skills
    });
    
    // Collect resources with plugin context
    for (const resource of result.resources) {
      allResources.push({
        ...resource,
        pluginName: plugin.name  // Track which plugin this came from
      });
    }
    
    // Collect available resources for error messages
    if (result.available?.agents) {
      allAvailable.agents = [...(allAvailable.agents || []), ...result.available.agents];
    }
    if (result.available?.skills) {
      allAvailable.skills = [...(allAvailable.skills || []), ...result.available.skills];
    }
  }
  
  // Generate errors for resources not found in ANY plugin
  const foundAgents = new Set(allResources.filter(r => r.matchedBy !== 'dirname').map(r => r.name));
  const foundSkills = new Set(allResources.filter(r => r.matchedBy === 'dirname').map(r => r.name));
  
  for (const agent of options.agents || []) {
    if (!foundAgents.has(agent)) {
      allErrors.push(`Agent '${agent}' not found in specified plugins`);
    }
  }
  
  for (const skill of options.skills || []) {
    if (!foundSkills.has(skill)) {
      allErrors.push(`Skill '${skill}' not found in specified plugins`);
    }
  }
  
  return {
    resources: allResources,
    errors: allErrors,
    available: Object.keys(allAvailable).length > 0 ? allAvailable : undefined
  };
}
```

#### Step 3: Update install.ts - Add Marketplace + Convenience Flow

Add a new handler function:

```typescript
// In src/commands/install.ts

/**
 * Handle marketplace installation with convenience filtering
 * Called when both --plugins and (--agents or --skills) are specified
 */
async function handleMarketplaceWithConvenience(
  context: InstallationContext,
  options: InstallOptions & { agents?: string[]; skills?: string[] },
  cwd: string
): Promise<CommandResult> {
  const {
    parseMarketplace,
    resolvePluginPaths,
    installMarketplacePlugins,
    validatePluginNames
  } = await import('../core/install/marketplace-handler.js');
  const { applyMarketplaceConvenienceFilters, displayFilterErrors } = 
    await import('../core/install/convenience-matchers.js');
  const { Spinner } = await import('../utils/spinner.js');
  
  // Validate we have marketplace info
  if (!context.source.pluginMetadata?.manifestPath) {
    throw new Error('Marketplace manifest not found');
  }
  
  const spinner = new Spinner('Loading marketplace');
  spinner.start();
  
  // Parse marketplace manifest
  const marketplace = await parseMarketplace(context.source.pluginMetadata.manifestPath, {
    repoPath: context.source.contentRoot
  });
  
  spinner.stop();
  
  // Resolve plugin names to paths
  const { resolved: pluginPaths, notFound } = resolvePluginPaths(
    marketplace,
    options.plugins!,
    context.source.contentRoot!
  );
  
  // Error if any plugins not found
  if (notFound.length > 0) {
    console.error(`Error: The following plugins were not found in marketplace '${marketplace.name}':`);
    for (const name of notFound) {
      console.error(`  - ${name}`);
    }
    console.error(`\nAvailable plugins: ${marketplace.plugins.map(p => p.name).join(', ')}`);
    return {
      success: false,
      error: `Plugins not found: ${notFound.join(', ')}`
    };
  }
  
  console.log(`✓ Marketplace: ${marketplace.name}`);
  console.log(`Searching in plugins: ${pluginPaths.map(p => p.name).join(', ')}`);
  
  // Apply convenience filters across all specified plugins
  const filterResult = await applyMarketplaceConvenienceFilters(pluginPaths, {
    agents: options.agents,
    skills: options.skills
  });
  
  // Display errors if any
  if (filterResult.errors.length > 0) {
    displayFilterErrors(filterResult.errors, filterResult.available);
    
    if (filterResult.resources.length === 0) {
      return {
        success: false,
        error: 'None of the requested resources were found in specified plugins'
      };
    }
    
    console.log(`\n⚠️  Continuing with ${filterResult.resources.length} resource(s)\n`);
  }
  
  // Store filtered resources in context
  context.filteredResources = filterResult.resources;
  
  // Group resources by plugin for installation
  const resourcesByPlugin = new Map<string, typeof filterResult.resources>();
  for (const resource of filterResult.resources) {
    const pluginName = (resource as any).pluginName || 'unknown';
    if (!resourcesByPlugin.has(pluginName)) {
      resourcesByPlugin.set(pluginName, []);
    }
    resourcesByPlugin.get(pluginName)!.push(resource);
  }
  
  // Install resources from each plugin
  // ... (integrate with existing installation flow)
  
  // For now, delegate to marketplace installer with the resolved plugins
  const commitSha = (context.source as any)._commitSha || '';
  if (!commitSha) {
    throw new Error('Marketplace commit SHA not available');
  }
  
  return await installMarketplacePlugins(
    context.source.contentRoot!,
    marketplace,
    pluginPaths.map(p => p.name),
    context.source.gitUrl!,
    context.source.gitRef,
    commitSha,
    { ...options, filteredResources: filterResult.resources },
    cwd
  );
}
```

#### Step 4: Update install.ts - Modify Control Flow

Update `installResourceCommand` to route correctly:

```typescript
// In installResourceCommand(), around line 180

// Check if this is a marketplace with convenience options
const hasConvenienceOptions = !!(options as any).agents || !!(options as any).skills;
const hasPluginsOption = !!(options.plugins && options.plugins.length > 0);
const isMarketplace = loaded.pluginMetadata?.pluginType === 'marketplace';

if (isMarketplace) {
  if (hasConvenienceOptions && hasPluginsOption) {
    // Case: Marketplace + --plugins + (--agents or --skills)
    // Apply convenience filters scoped to specified plugins
    return await handleMarketplaceWithConvenience(context, options as any, cwd);
  }
  
  if (hasConvenienceOptions && !hasPluginsOption) {
    // Case: Marketplace + (--agents or --skills) without --plugins
    // Error: Need to specify which plugins to search
    console.error('Error: When installing from a marketplace with --agents or --skills,');
    console.error('       you must also specify --plugins to indicate which plugins to search.');
    console.error('\nExample:');
    console.error(`  opkg i ${context.source.packageName || 'gh@user/repo'} --plugins <plugin-name> --agents <agent-name>`);
    return {
      success: false,
      error: 'Missing --plugins option for marketplace convenience filtering'
    };
  }
  
  // Case: Marketplace without convenience options (or only --plugins)
  // Trigger normal marketplace installation flow
  return await handleMarketplaceInstallation(context, options, cwd);
}

// Non-marketplace: apply convenience filters normally
if (hasConvenienceOptions) {
  // ... existing convenience filter logic
}
```

## Alternative: Search All Plugins When No --plugins Specified

If you want `opkg i gh@wshobson/agents --agents typescript-pro` to search ALL plugins:

```typescript
if (isMarketplace && hasConvenienceOptions && !hasPluginsOption) {
  // Search all plugins in the marketplace
  const marketplace = await parseMarketplace(context.source.pluginMetadata!.manifestPath!, {
    repoPath: context.source.contentRoot
  });
  
  const allPluginPaths = marketplace.plugins.map(p => ({
    name: p.name,
    path: join(context.source.contentRoot!, p.path)
  }));
  
  return await handleMarketplaceWithConvenience(
    context,
    { ...options, plugins: marketplace.plugins.map(p => p.name) } as any,
    cwd
  );
}
```

This is more user-friendly but may be slower for large marketplaces.

## Testing

After implementing this fix:

```bash
# Should find agent in specified plugin
opkg i gh@wshobson/agents --plugins javascript-typescript --agents typescript-pro

# Should find multiple agents across multiple plugins
opkg i gh@wshobson/agents --plugins javascript-typescript ui-design --agents typescript-pro ios-design

# Should work with skills too
opkg i gh@wshobson/agents --plugins some-plugin --skills my-skill
```

## Dependencies

- **Issue 1 must be fixed first** - Otherwise marketplace is never detected
- **Issue 3 recommended** - Restructured control flow makes this cleaner

## Files Modified

| File | Changes |
|------|---------|
| `src/core/install/marketplace-handler.ts` | Add `resolvePluginPaths()` export |
| `src/core/install/convenience-matchers.ts` | Add `applyMarketplaceConvenienceFilters()` |
| `src/commands/install.ts` | Add `handleMarketplaceWithConvenience()`, update routing logic |

## Edge Cases

1. **Plugin name not found in marketplace**
   - Error with list of available plugins

2. **Agent/skill not found in specified plugins**
   - Error with list of available resources in those plugins

3. **Partial matches (some found, some not)**
   - Warning + continue with found resources

4. **Same agent name in multiple plugins**
   - Install all matches (let user disambiguate if needed)
