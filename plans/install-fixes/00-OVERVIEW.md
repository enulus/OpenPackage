# Install Command Fixes Overview

## Summary

Three major implementation gaps were identified in the resource installation system that prevent marketplace-based installations from working correctly.

## Issues

| # | Issue | Severity | Impact |
|---|-------|----------|--------|
| 1 | [Marketplace Detection Gap](./01-MARKETPLACE_DETECTION_GAP.md) | Critical | `opkg i gh@user/repo` fails when repo root is a marketplace |
| 2 | [Convenience Filters Don't Work with Marketplace](./02-CONVENIENCE_FILTERS_MARKETPLACE.md) | Critical | `--agents`/`--skills` with `--plugins` can't find resources |
| 3 | [Control Flow Restructure](./03-CONTROL_FLOW_RESTRUCTURE.md) | High | Wrong order of operations causes cascading failures |

## Failing Commands

```bash
# Issue 1: Marketplace not handled
opkg i gh@wshobson/agents
# Error: "Marketplace detected but not handled"

# Issue 2: Resources not found (wrong base path)
opkg i gh@wshobson/agents --agents typescript-pro
# Error: "Agent 'typescript-pro' not found"

# Issue 1 + 2: Combination failure
opkg i gh@wshobson/agents --plugins javascript-typescript --agents typescript-pro
# Error: "Agent 'typescript-pro' not found"

# Issue 1: Warning + failure
opkg i gh@wshobson/agents --plugins javascript-typescript
# Warning: "--plugins flag is only used with marketplace sources. Ignoring."
# Error: "Marketplace detected but not handled"
```

## Root Cause

The `installResourceCommand` function in `src/commands/install.ts` has three problems:

1. **Detection gap**: Only checks `baseDetection.matchType === 'marketplace'` but `baseDetection` is null when no subpath is specified (even though `pluginMetadata.pluginType === 'marketplace'` is correctly set)

2. **Missing integration**: Convenience filters (`--agents`, `--skills`) don't integrate with marketplace plugin resolution (`--plugins`) - they operate independently

3. **Wrong order**: Convenience filters run before marketplace handling is properly completed

## Implementation Order

Fixes should be implemented in this order:

1. **Issue 1** (Marketplace Detection Gap) - Foundation fix
2. **Issue 3** (Control Flow Restructure) - Structural fix
3. **Issue 2** (Convenience Filters Marketplace) - Feature completion

Issue 1 is a prerequisite for Issue 2 and 3. Issue 3 provides the structure for Issue 2.

## Files to Modify

| File | Changes |
|------|---------|
| `src/commands/install.ts` | All three issues - main fix location |
| `src/core/install/convenience-matchers.ts` | Issue 2 - add marketplace-aware filtering |
| `src/core/install/marketplace-handler.ts` | Issue 2 - export plugin path resolution |

## Testing Scenarios

After fixes, these commands should work:

```bash
# Marketplace installation (interactive plugin selection)
opkg i gh@wshobson/agents

# Marketplace with specific plugins
opkg i gh@wshobson/agents --plugins javascript-typescript

# Marketplace with convenience options
opkg i gh@wshobson/agents --agents typescript-pro
opkg i gh@wshobson/agents --plugins javascript-typescript --agents typescript-pro

# Multiple plugins + multiple agents
opkg i gh@wshobson/agents --plugins javascript-typescript ui-design --agents typescript-pro ios-design
```

## References

- [INTENDED_BEHAVIOR.md](../install-resources/INTENDED_BEHAVIOR.md) - Expected behavior specification
- [IMPLEMENTATION_PROGRESS.md](../install-resources/IMPLEMENTATION_PROGRESS.md) - Current implementation status
