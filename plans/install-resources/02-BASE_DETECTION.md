# Base Detection Algorithm

This document provides a detailed technical specification for the base detection algorithm, the core innovation of the resource-based installation system.

---

## Concept Overview

The **base** is the parent directory of the installable content. When installing a resource, we need to determine where the "package boundary" is so that:
1. Flow patterns are applied relative to the correct root
2. Directory structure is preserved correctly at the destination
3. The workspace manifest records the correct source reference

**Example:**
```
Resource: gh@wshobson/agents/plugins/javascript-typescript/agents/typescript-pro.md

Detected Base: /plugins/javascript-typescript/
Matched Pattern: agents/**/*.md
Installed As: .cursor/agents/typescript-pro.md
```

---

## Detection Algorithm

### Priority Order

Base detection follows a strict priority order:

1. **`openpackage.yml` at resource root** → That directory is the base
2. **`.claude-plugin/marketplace.json` at resource root** → Trigger plugin selection flow
3. **`.claude-plugin/plugin.json` at resource root** → That directory is the base
4. **Pattern matching against `platforms.jsonc`** → Deepest match resolution

### Algorithm Pseudocode

```
function detectBase(resourcePath: string, repoRoot: string): BaseDetectionResult {
  const absolutePath = resolve(repoRoot, resourcePath);
  
  // Priority 1: openpackage.yml
  if (exists(join(absolutePath, 'openpackage.yml'))) {
    return {
      base: absolutePath,
      matchType: 'openpackage'
    };
  }
  
  // Priority 2: Marketplace
  if (exists(join(absolutePath, '.claude-plugin/marketplace.json'))) {
    return {
      base: absolutePath,
      matchType: 'marketplace',
      // Caller should trigger plugin selection flow
    };
  }
  
  // Priority 3: Individual plugin
  if (exists(join(absolutePath, '.claude-plugin/plugin.json'))) {
    return {
      base: absolutePath,
      matchType: 'plugin'
    };
  }
  
  // Priority 4: Pattern matching
  return detectBaseFromPatterns(resourcePath, repoRoot);
}
```

---

## Deepest Match Resolution

When multiple patterns from `platforms.jsonc` could match, we select the pattern whose match begins at the **deepest segment** (furthest from root).

### Why Deepest Match?

Deepest matching ensures:
1. Maximum specificity—the most precise match wins
2. Minimal destination path structure—avoids unnecessary nesting
3. Predictable behavior—larger context (parent directories) become the base

### Segment Indexing

Given a path, each segment has an index starting from 0 (root):

```
/skills/git/agents/manager.md
  │      │     │       │
  0      1     2       3

Match: skills/**/* → starts at index 0
Match: agents/**/*.md → starts at index 2

Winner: agents/**/*.md (index 2 > index 0)
Base: /skills/git/
```

### Pattern Matching Algorithm

```
function detectBaseFromPatterns(resourcePath: string, repoRoot: string): BaseDetectionResult {
  const patterns = extractAllFromPatterns(platformsConfig);
  const segments = resourcePath.split('/').filter(s => s.length > 0);
  
  interface Match {
    pattern: string;
    startIndex: number;  // Segment index where match begins
    base: string;        // Path up to (but not including) matched portion
  }
  
  const matches: Match[] = [];
  
  for (const pattern of patterns) {
    const patternSegments = pattern.split('/').filter(s => s.length > 0);
    const firstPatternPart = patternSegments[0].replace(/\*+/g, '').replace(/\{[^}]+\}/g, '');
    
    // Find where this pattern could start matching
    for (let i = 0; i < segments.length; i++) {
      const candidatePath = segments.slice(i).join('/');
      
      if (matchesPattern(candidatePath, pattern)) {
        matches.push({
          pattern,
          startIndex: i,
          base: '/' + segments.slice(0, i).join('/')
        });
        break; // First match for this pattern
      }
    }
  }
  
  if (matches.length === 0) {
    return { base: undefined, matchType: 'none' };
  }
  
  if (matches.length === 1) {
    return {
      base: join(repoRoot, matches[0].base),
      matchedPattern: matches[0].pattern,
      matchType: 'pattern'
    };
  }
  
  // Multiple matches - check if ambiguous
  const deepestIndex = Math.max(...matches.map(m => m.startIndex));
  const deepestMatches = matches.filter(m => m.startIndex === deepestIndex);
  
  if (deepestMatches.length === 1) {
    return {
      base: join(repoRoot, deepestMatches[0].base),
      matchedPattern: deepestMatches[0].pattern,
      matchType: 'pattern'
    };
  }
  
  // Truly ambiguous - multiple patterns at same depth
  return {
    base: join(repoRoot, deepestMatches[0].base),
    matchType: 'ambiguous',
    ambiguousMatches: matches.map(m => ({
      pattern: m.pattern,
      base: join(repoRoot, m.base)
    }))
  };
}
```

---

## Pattern Extraction

Patterns are extracted from all platform definitions in `platforms.jsonc`:

```
function extractAllFromPatterns(config: PlatformsConfig): string[] {
  const patterns = new Set<string>();
  
  // Global flows
  for (const flow of config.global?.export ?? []) {
    addFlowPatterns(flow.from, patterns);
  }
  
  // Platform flows
  for (const [platform, definition] of Object.entries(config)) {
    if (platform === 'global' || platform === '$schema') continue;
    
    for (const flow of definition.export ?? []) {
      addFlowPatterns(flow.from, patterns);
    }
  }
  
  return Array.from(patterns);
}

function addFlowPatterns(from: string | string[] | SwitchExpression, patterns: Set<string>) {
  if (typeof from === 'string') {
    patterns.add(from);
  } else if (Array.isArray(from)) {
    for (const p of from) patterns.add(p);
  } else if (typeof from === 'object' && '$switch' in from) {
    // Handle switch expressions - extract patterns from cases
    for (const c of from.$switch.cases) {
      if (typeof c.value === 'string') {
        patterns.add(c.value);
      }
    }
    if (from.$switch.default) {
      patterns.add(from.$switch.default);
    }
  }
}
```

---

## Key Patterns from platforms.jsonc

Based on current configuration, the primary patterns for matching are:

| Pattern | Description | Platforms |
|---------|-------------|-----------|
| `agents/**/*.md` | Agent markdown files | All |
| `skills/**/*` | Skill directories | All |
| `rules/**/*.md` | Rule files | claude, cursor, windsurf, etc. |
| `commands/**/*.md` | Command files | claude, cursor, augment, etc. |
| `AGENTS.md` | Root agent file | Global |
| `mcp.jsonc` / `mcp.json` | MCP configuration | claude, cursor, opencode |
| `.mcp.json` | Claude plugin MCP | claude-plugin |

---

## Match Examples

### Example 1: Simple Agent

**Resource:** `gh@hyericlee/essentials/agents/designer.md`

| Pattern | Match Starts At | Base |
|---------|-----------------|------|
| `agents/**/*.md` | Segment 0 | `/` |

**Result:** Base = `/` (repo root), install `agents/designer.md` → `.cursor/agents/designer.md`

### Example 2: Nested in Plugin Directory

**Resource:** `gh@wshobson/agents/plugins/javascript-typescript/agents/typescript-pro.md`

| Pattern | Match Starts At | Base |
|---------|-----------------|------|
| `agents/**/*.md` | Segment 3 | `/plugins/javascript-typescript/` |

**Result:** Base = `/plugins/javascript-typescript/`, install `agents/typescript-pro.md` → `.cursor/agents/typescript-pro.md`

### Example 3: Skill Directory

**Resource:** `gh@vercel-labs/skills/skills/ios-design/`

| Pattern | Match Starts At | Base |
|---------|-----------------|------|
| `skills/**/*` | Segment 0 | `/` |

**Result:** Base = `/` (repo root), install `skills/ios-design/` → `.cursor/skills/ios-design/`

### Example 4: Ambiguous Match

**Resource:** `gh@user/repo/skills/git/agents/manager.md`

| Pattern | Match Starts At | Base |
|---------|-----------------|------|
| `skills/**/*` | Segment 0 | `/` |
| `agents/**/*.md` | Segment 2 | `/skills/git/` |

**Result:** Deepest match wins → Base = `/skills/git/`, install `agents/manager.md`

If `--force` not specified, could prompt user to confirm (since both are valid).

---

## BaseDetectionResult Interface

```typescript
interface BaseDetectionResult {
  /** Absolute path to detected base (undefined if no match) */
  base: string | undefined;
  
  /** The from pattern that matched (for pattern-based detection) */
  matchedPattern?: string;
  
  /** How the base was determined */
  matchType: 
    | 'openpackage'    // Found openpackage.yml
    | 'marketplace'    // Found marketplace.json (needs selection)
    | 'plugin'         // Found plugin.json
    | 'pattern'        // Matched from pattern
    | 'ambiguous'      // Multiple patterns at same depth
    | 'none';          // No match found
  
  /** For ambiguous cases, all possible matches */
  ambiguousMatches?: Array<{
    pattern: string;
    base: string;
  }>;
}
```

---

## Integration with File/Directory Resources

When the resource path points to:

### A Single File
- Match the file path against patterns
- Base is the path up to where the pattern starts matching
- Only that file is installed

### A Directory
- Match the directory path against patterns
- Base is the path up to where the pattern starts matching
- All files in the directory matching the pattern are installed

### Example: Directory Resource

**Resource:** `gh@wshobson/agents/plugins/ui-design/agents/`

1. Directory contains: `ios-design.md`, `android-design.md`
2. Pattern `agents/**/*.md` matches starting at `agents/`
3. Base = `/plugins/ui-design/`
4. Install both files to `.cursor/agents/ios-design.md`, `.cursor/agents/android-design.md`

---

## Edge Cases

### No Pattern Matches
If no pattern matches and no manifest is found, return an error:
```
Error: Path does not match any installable pattern.

Tip: Installable patterns include:
  - agents/**/*.md
  - skills/**/*
  - rules/**/*.md
  - commands/**/*.md
```

### Empty Directory After Filtering
If the directory exists but contains no files matching the pattern:
- Record in workspace manifest (dependency tracking)
- Show "succeeded with 0 installs"
- User may populate later

### Pattern at Root
If pattern matches starting at segment 0, base is the repo root itself.

---

## Caching Considerations

For performance with large repos:
1. Cache pattern regex compilation
2. Cache file listing results during a single install session
3. Consider lazy loading of pattern matching for rarely-used platforms
