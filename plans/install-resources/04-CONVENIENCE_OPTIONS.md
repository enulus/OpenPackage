# Convenience Options

This document specifies the `--plugins`, `--agents`, and `--skills` convenience options for filtering resource installations.

---

## Overview

Convenience options allow users to selectively install specific resources from a larger collection (repo, package, or marketplace). They filter the installation scope based on resource metadata (frontmatter, file names, directory names).

---

## Option Definitions

### `--plugins <names...>`

**Purpose:** Filter plugins from a marketplace source.

**Behavior:**
1. Requires `.claude-plugin/marketplace.json` at resource root
2. Matches plugin names defined in the marketplace manifest
3. If no `--agents` or `--skills` specified, installs all matched plugins completely
4. If `--agents` and/or `--skills` specified, further filters within matched plugins

**Example:**
```bash
opkg i gh@wshobson/agents --plugins javascript-typescript python
```

### `--agents <names...>`

**Purpose:** Filter agent files matching `agents/**/*.md` pattern.

**Behavior:**
1. Matches against frontmatter `name` field first
2. Falls back to filename (without `.md` extension)
3. Uses deepest match resolution if multiple matches

**Example:**
```bash
opkg i gh@hyericlee/essentials --agents designer architect
```

### `--skills <names...>`

**Purpose:** Filter skill directories matching `skills/**/*` pattern.

**Behavior:**
1. Requires `SKILL.md` file in the skill directory (case-sensitive)
2. Matches against frontmatter `name` field in `SKILL.md` first
3. Falls back to directory name
4. Installs entire skill directory (not just `SKILL.md`)
5. Uses deepest match resolution if multiple matches

**Example:**
```bash
opkg i gh@vercel-labs/skills --skills ios-design android-design
```

---

## Matching Algorithm

### Agent Matching

```
function matchAgents(
  resourceRoot: string,
  base: string,
  requestedNames: string[]
): MatchResult[] {
  const results: MatchResult[] = [];
  const agentPattern = 'agents/**/*.md';
  
  // Find all agent files relative to base
  const agentFiles = glob(join(base, agentPattern));
  
  for (const name of requestedNames) {
    const match = findAgentByName(agentFiles, name);
    
    if (match) {
      results.push({
        name,
        found: true,
        path: match.path,
        matchedBy: match.matchedBy  // 'frontmatter' or 'filename'
      });
    } else {
      results.push({
        name,
        found: false,
        error: `Agent '${name}' not found`
      });
    }
  }
  
  return results;
}

function findAgentByName(files: string[], name: string): AgentMatch | null {
  // Priority 1: Frontmatter name match
  for (const file of files) {
    const frontmatter = parseFrontmatter(file);
    if (frontmatter?.name === name) {
      return { path: file, matchedBy: 'frontmatter' };
    }
  }
  
  // Priority 2: Filename match (deepest if multiple)
  const byFilename = files.filter(f => basename(f, '.md') === name);
  
  if (byFilename.length === 1) {
    return { path: byFilename[0], matchedBy: 'filename' };
  }
  
  if (byFilename.length > 1) {
    // Deepest match - most segments in path
    const deepest = byFilename.sort((a, b) => 
      b.split('/').length - a.split('/').length
    )[0];
    return { path: deepest, matchedBy: 'filename' };
  }
  
  return null;
}
```

### Skill Matching

```
function matchSkills(
  resourceRoot: string,
  base: string,
  requestedNames: string[]
): MatchResult[] {
  const results: MatchResult[] = [];
  const skillPattern = 'skills/**/*';
  
  // Find all SKILL.md files relative to base
  const skillFiles = glob(join(base, 'skills/**/SKILL.md'));
  
  for (const name of requestedNames) {
    const match = findSkillByName(skillFiles, name);
    
    if (match) {
      results.push({
        name,
        found: true,
        path: match.path,
        installDir: dirname(match.path),  // Install entire parent directory
        matchedBy: match.matchedBy
      });
    } else {
      results.push({
        name,
        found: false,
        error: `Skill '${name}' not found (requires SKILL.md)`
      });
    }
  }
  
  return results;
}

function findSkillByName(skillFiles: string[], name: string): SkillMatch | null {
  // Priority 1: Frontmatter name match
  for (const file of skillFiles) {
    const frontmatter = parseFrontmatter(file);
    if (frontmatter?.name === name) {
      return { path: file, matchedBy: 'frontmatter' };
    }
  }
  
  // Priority 2: Directory name match
  for (const file of skillFiles) {
    const dirName = basename(dirname(file));
    if (dirName === name) {
      return { path: file, matchedBy: 'dirname' };
    }
  }
  
  // Priority 3: Nested directory name match (deepest)
  const byDirname = skillFiles.filter(f => {
    const segments = dirname(f).split('/');
    return segments.includes(name);
  });
  
  if (byDirname.length > 0) {
    // Deepest match
    const deepest = byDirname.sort((a, b) =>
      b.split('/').length - a.split('/').length
    )[0];
    return { path: deepest, matchedBy: 'dirname' };
  }
  
  return null;
}
```

### Plugin Matching (Enhanced)

```
function matchPlugins(
  resourceRoot: string,
  marketplace: MarketplaceManifest,
  requestedNames: string[]
): MatchResult[] {
  const results: MatchResult[] = [];
  
  for (const name of requestedNames) {
    const plugin = marketplace.plugins.find(p => p.name === name);
    
    if (plugin) {
      results.push({
        name,
        found: true,
        source: plugin.source,
        metadata: plugin
      });
    } else {
      results.push({
        name,
        found: false,
        error: `Plugin '${name}' not found in marketplace '${marketplace.name}'`,
        available: marketplace.plugins.map(p => p.name)
      });
    }
  }
  
  return results;
}
```

---

## Option Combinations

### `--plugins` Only
Install complete plugins (all content in each plugin directory).

### `--agents` Only
Match and install only agent files from the resource (using detected base).

### `--skills` Only
Match and install only skill directories from the resource (using detected base).

### `--plugins` + `--agents`
Scope agent search within the specified plugins only.

```bash
opkg i gh@wshobson/agents --plugins javascript-typescript --agents typescript-pro
```

1. Find `javascript-typescript` plugin in marketplace
2. Within that plugin's directory, match `agents/**/*.md` for `typescript-pro`
3. Install only that agent

### `--plugins` + `--skills`
Scope skill search within the specified plugins only.

### `--agents` + `--skills`
Install both matched agents and matched skills (independent searches).

### All Three
Scope both agent and skill searches within specified plugins.

---

## Error Handling

### Name Not Found
```
Error: The following agents were not found:
  - nonexistent-agent
  - another-missing

Available agents:
  - designer
  - architect
  - reviewer
```

### SKILL.md Missing
```
Error: Skill 'my-skill' not found.

Directory 'skills/my-skill/' exists but does not contain SKILL.md.
Skills must have a SKILL.md file (case-sensitive).
```

### Conflicting Options
```
Error: Cannot use --agents 'outside-agent' with --plugins 'plugin-a'

Agent 'outside-agent' exists at /agents/outside-agent.md
but is outside the specified plugin scope.

Either:
  - Remove --plugins to search the entire resource
  - Or use an agent name that exists within the plugin
```

### No Marketplace for --plugins
```
Error: --plugins requires a marketplace source.

The resource at 'gh@user/repo' does not contain a marketplace manifest.
Expected: .claude-plugin/marketplace.json
```

---

## Frontmatter Parsing

### Agent Frontmatter
```yaml
---
name: typescript-pro
description: Expert TypeScript developer
model: anthropic/claude-sonnet-4
---
```

### Skill Frontmatter (SKILL.md)
```yaml
---
name: ios-design
description: iOS design patterns and guidelines
---
```

### Parsing Logic
```
function parseFrontmatter(filePath: string): Record<string, any> | null {
  const content = readFile(filePath);
  
  // Check for YAML frontmatter
  if (!content.startsWith('---')) {
    return null;
  }
  
  const endMarker = content.indexOf('---', 3);
  if (endMarker === -1) {
    return null;
  }
  
  const yamlContent = content.slice(3, endMarker).trim();
  return yaml.parse(yamlContent);
}
```

---

## Deepest Match Examples

### Multiple Agents with Same Filename
```
Repository structure:
  /agents/designer.md (name: basic-designer)
  /plugins/ui/agents/designer.md (name: ui-designer)
  /plugins/ux/agents/designer.md (name: ux-designer)

Command: opkg i gh@user/repo --agents designer

Deepest match: /plugins/ux/agents/designer.md (3 segments deep)
```

### Multiple Skills with Same Directory Name
```
Repository structure:
  /skills/git/SKILL.md (name: git-basics)
  /advanced/skills/git/SKILL.md (name: git-advanced)

Command: opkg i gh@user/repo --skills git

Deepest match: /advanced/skills/git/ (3 segments deep)
```

---

## Future Extensibility

The convenience options system is designed to be extensible for future patterns:

| Option | Pattern | Match Field |
|--------|---------|-------------|
| `--agents` | `agents/**/*.md` | frontmatter `name` or filename |
| `--skills` | `skills/**/*` | frontmatter `name` or dirname (via `SKILL.md`) |
| `--commands` (future) | `commands/**/*.md` | frontmatter `name` or filename |
| `--rules` (future) | `rules/**/*.md` | frontmatter `name` or filename |
| `--mcp` (future) | `mcp.jsonc` | server names in config |

Each new option follows the same structure:
1. Define the pattern to match
2. Define the name extraction strategy
3. Support deepest match for ambiguity
4. Integrate with the filtering pipeline
