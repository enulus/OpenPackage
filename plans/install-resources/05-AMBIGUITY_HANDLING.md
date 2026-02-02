# Ambiguity Handling

This document specifies how the system handles ambiguous cases during base detection and resource matching, including user prompts and manifest storage.

---

## Types of Ambiguity

### 1. Pattern Ambiguity

Multiple `platforms.jsonc` patterns match at the same depth.

**Example:**
```
Path: /custom-agents/manager.md

Matching patterns:
  - agents/**/*.md → would match if "custom-agents" → "agents"
  - **/*.md → matches anything

Same depth, different semantic meanings.
```

### 2. Base Ambiguity

Multiple patterns match at different depths, but the user's intent is unclear.

**Example:**
```
Path: /skills/git/agents/manager.md

Pattern matches:
  - skills/**/* → starts at index 0, base = /
  - agents/**/*.md → starts at index 2, base = /skills/git/

Both are valid interpretations.
```

### 3. Name Ambiguity

Multiple resources have the same name at different locations.

**Example:**
```
Command: opkg i gh@user/repo --agents designer

Multiple matches:
  - /agents/designer.md (frontmatter name: "designer")
  - /plugins/ui/agents/designer.md (filename: designer.md)
```

---

## Resolution Strategies

### Default Behavior: Deepest Match

When not in interactive mode or when `--force` is specified:
- Select the pattern/match with the deepest starting index
- This results in the most specific base
- Provides predictable, reproducible behavior

### Interactive Mode: User Prompt

When multiple matches exist and the terminal is interactive:
- Display options to the user
- Allow selection of preferred base
- Store selection in workspace manifest for future installs

---

## User Prompts

### Base Selection Prompt

```
? Multiple installation bases detected for '/skills/git/agents/manager.md':

  1. Base: / (entire repo)
     Pattern: skills/**/*
     Would install: skills/git/agents/manager.md → .cursor/skills/git/agents/manager.md

  2. Base: /skills/git/
     Pattern: agents/**/*.md  
     Would install: agents/manager.md → .cursor/agents/manager.md

  Select base (1-2) or 'a' for auto (deepest match): 
```

### Agent Selection Prompt (Multiple Matches)

```
? Multiple agents match 'designer':

  1. /agents/designer.md
     Name: basic-designer (from frontmatter)

  2. /plugins/ui/agents/designer.md
     Name: ui-designer (from frontmatter)

  3. /plugins/ux/agents/designer.md
     Name: designer (filename match)

  Select agent (1-3) or 'a' for auto (deepest match):
```

### Skill Selection Prompt (Multiple Matches)

```
? Multiple skills match 'git':

  1. /skills/git/
     Name: git-basics (from SKILL.md)

  2. /advanced/skills/git/
     Name: git-advanced (from SKILL.md)

  Select skill (1-2) or 'a' for auto (deepest match):
```

---

## Manifest Storage

### Recording Base Selection

When a user selects a base (or the system uses deepest match), record it in the workspace manifest:

**In `.openpackage/openpackage.yml`:**

```yaml
name: my-workspace
version: "1.0.0"

dependencies:
  - name: "gh@wshobson/agents/skills/git/agents/manager"
    url: https://github.com/wshobson/agents.git
    path: skills/git/agents/manager.md
    base: skills/git  # User-selected or auto-resolved base
```

### Base Field Semantics

The `base` field:
- Is optional (omitted when base = repo root or unambiguous)
- Is relative to the repository root
- Takes precedence during bulk install (`opkg install` without args)
- Can be overridden with explicit path in resource spec

### Reading Base from Manifest

During bulk install:

```
function loadDependencyContext(dep: PackageDependency): InstallContext {
  // If base is recorded, use it
  if (dep.base) {
    return {
      ...context,
      detectedBase: join(repoRoot, dep.base),
      baseSource: 'manifest'
    };
  }
  
  // Otherwise, run base detection algorithm
  const detected = detectBase(dep.path, repoRoot);
  return {
    ...context,
    detectedBase: detected.base,
    baseSource: 'detected'
  };
}
```

---

## Non-Interactive Mode

### With `--force`

Skip all prompts, use deepest match:

```bash
opkg i gh@user/repo/ambiguous/path --force
```

- No prompts displayed
- Deepest match selected automatically
- Base recorded in manifest for reproducibility

### In CI/CD Environments

When `process.stdin.isTTY` is false:
- Treat as non-interactive
- Use deepest match or respect manifest `base` field
- Log selected base to stdout for debugging

### Error on Unresolvable Ambiguity

Some ambiguities cannot be auto-resolved:

```
Error: Cannot auto-resolve ambiguous base in non-interactive mode.

Path '/mixed/resources/file.md' matches multiple patterns at the same depth:
  - custom-agents/**/*.md
  - hybrid-files/**/*.md

Options:
  - Specify base explicitly: opkg i gh@user/repo/mixed/resources --base=mixed
  - Run interactively to select base
  - Add 'base' field to openpackage.yml dependency
```

---

## Prompt Implementation

### Using Existing Prompt System

The codebase uses `prompts` library (wrapped in `safePrompts`):

```typescript
import { safePrompts } from '../../utils/prompts.js';

async function promptBaseSelection(
  resourcePath: string,
  matches: BaseMatch[]
): Promise<BaseMatch> {
  console.log(`? Multiple installation bases detected for '${resourcePath}':\n`);
  
  const choices = matches.map((match, i) => ({
    title: `${i + 1}. Base: ${match.base || '/ (repo root)'}`,
    description: `Pattern: ${match.pattern}\n     Would install to: ${match.exampleTarget}`,
    value: match
  }));
  
  // Add auto option
  choices.push({
    title: 'a. Auto (deepest match)',
    description: 'Select the most specific base automatically',
    value: null  // Signals auto-select
  });
  
  try {
    const response = await safePrompts({
      type: 'select',
      name: 'selection',
      message: 'Select base:',
      choices
    });
    
    if (response.selection === null) {
      // Auto-select deepest
      return selectDeepestMatch(matches);
    }
    
    return response.selection;
  } catch (error) {
    if (error instanceof UserCancellationError) {
      throw error;
    }
    // Fallback to deepest on error
    return selectDeepestMatch(matches);
  }
}
```

---

## Integration with Pipeline

### Where Prompts Occur

Prompts are handled **before** entering the unified pipeline:

```
install command
  │
  ├─> parseResourceArg()
  │
  ├─> loadAndDetectBase()
  │     │
  │     └─> If ambiguous && interactive → promptBaseSelection()
  │
  ├─> applyConvenienceFilters()  (--agents, --skills)
  │     │
  │     └─> If multiple matches && interactive → promptResourceSelection()
  │
  └─> runUnifiedInstallPipeline()  ← No prompts inside pipeline
```

### Returning Selected Base

After prompts, the selected base is passed into the pipeline context:

```typescript
interface InstallationContext {
  // ... existing fields
  
  /** Detected or user-selected base path */
  detectedBase?: string;
  
  /** How base was determined */
  baseSource?: 'openpackage' | 'plugin' | 'marketplace' | 'pattern' | 'user-selection' | 'manifest';
  
  /** For recording in manifest (relative to repo root) */
  baseRelative?: string;
}
```

---

## Examples

### Example 1: First-Time Install with Ambiguity

```bash
$ opkg i gh@user/repo/skills/git/agents/manager.md

? Multiple installation bases detected for '/skills/git/agents/manager.md':

  1. Base: / (entire repo)
     Pattern: skills/**/*
     Would install: skills/git/agents/manager.md → .cursor/skills/git/agents/manager.md

  2. Base: /skills/git/
     Pattern: agents/**/*.md
     Would install: agents/manager.md → .cursor/agents/manager.md

  Select base (1-2) or 'a' for auto (deepest match): 2

✓ Installing gh@user/repo with base: /skills/git/
✓ Installed: .cursor/agents/manager.md

# Recorded in openpackage.yml:
dependencies:
  - name: "gh@user/repo/skills/git/agents/manager"
    url: https://github.com/user/repo.git
    path: skills/git/agents/manager.md
    base: skills/git
```

### Example 2: Subsequent Install (Base from Manifest)

```bash
$ opkg i  # Bulk install

✓ Loading dependencies from openpackage.yml
✓ gh@user/repo/skills/git/agents/manager (using saved base: skills/git)
  Installed: .cursor/agents/manager.md
```

### Example 3: CI/CD with --force

```bash
$ opkg i gh@user/repo/skills/git/agents/manager.md --force

Using deepest match: base=/skills/git/, pattern=agents/**/*.md
✓ Installed: .cursor/agents/manager.md
```

### Example 4: Explicit Base Override

```bash
$ opkg i gh@user/repo/skills/git/agents/manager.md --base=/

# Forces base to be repo root, ignoring deeper matches
✓ Installed: .cursor/skills/git/agents/manager.md
```

---

## Future Considerations

### `--base` CLI Option

A future `--base` option could allow explicit base specification:

```bash
opkg i gh@user/repo/path/to/resource --base=path/to
```

This would:
- Skip base detection entirely
- Use the specified base directly
- Useful for scripting and edge cases

### Remembering Preferences

Could store user preferences for common repos:

```yaml
# ~/.openpackage/preferences.yml
repositories:
  github.com/user/repo:
    defaultBase: skills/git
    preferDeepest: true
```
