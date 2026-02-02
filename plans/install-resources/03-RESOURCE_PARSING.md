# Resource Argument Parsing

This document specifies the unified resource argument parsing system that replaces the current package input classification.

---

## Overview

The resource argument parser provides a single entry point for interpreting the first positional argument to `opkg install`. It determines the type of resource and extracts relevant metadata for subsequent processing.

---

## Resolution Order

Resources are resolved in this strict order:

1. **URL** (GitHub URLs) → Extract repo + path
2. **Resource Name** (with or without `@`) → Parse prefix and segments
3. **Filepath** (absolute or relative) → Resolve to absolute path

This order ensures:
- Explicit URLs take precedence (user's clear intent)
- Shorthand syntax is convenient but unambiguous
- Paths are the fallback for local resources

---

## Resource Types

### 1. GitHub URL

**Detection:** Input starts with `https://github.com/` or `http://github.com/`

**Supported Formats:**
- `https://github.com/owner/repo`
- `https://github.com/owner/repo.git`
- `https://github.com/owner/repo/tree/ref`
- `https://github.com/owner/repo/tree/ref/path/to/resource`
- `https://github.com/owner/repo/blob/ref/path/to/file.md` (single file)

**Extraction:**
```
URL: https://github.com/enulus/OpenPackage/tree/main/schemas/platforms-v1.json

Repo: enulus/OpenPackage
Ref: main
Path: schemas/platforms-v1.json
```

**Output:**
```typescript
{
  type: 'github-url',
  repo: 'enulus/OpenPackage',
  ref: 'main',
  path: 'schemas/platforms-v1.json',
  gitUrl: 'https://github.com/enulus/OpenPackage.git'
}
```

### 2. GitHub Shorthand

**Detection:** Input starts with `gh@`

**Format:** `gh@owner/repo[/path][@version]`

**Examples:**
- `gh@anthropics/claude-code` → repo only
- `gh@wshobson/agents/plugins/javascript-typescript` → repo + path
- `gh@user/repo@v1.0` → repo + version (ref)

**Extraction:**
```
Input: gh@wshobson/agents/plugins/javascript-typescript/agents/typescript-pro.md

Segments: [wshobson, agents, plugins, javascript-typescript, agents, typescript-pro.md]
Repo: wshobson/agents (first two segments)
Path: plugins/javascript-typescript/agents/typescript-pro.md (remaining)
```

**Output:**
```typescript
{
  type: 'github-shorthand',
  repo: 'wshobson/agents',
  path: 'plugins/javascript-typescript/agents/typescript-pro.md',
  ref: undefined,
  gitUrl: 'https://github.com/wshobson/agents.git'
}
```

### 3. Registry/OpenPackage Resource Name

**Detection:** Input starts with `@` (but not `gh@`) OR is a plain alphanumeric name

**Format:** `[@]scope/name[/path][@version]`

**Examples:**
- `@hyericlee/essentials` → scoped registry package
- `@hyericlee/essentials/agents/designer` → scoped + path
- `my-package@1.0.0` → unscoped with version
- `hyericlee/essentials` → could be local or remote (resolve in order)

**Resolution Logic:**
1. Check local workspace packages
2. Check global packages
3. Query openpackage.dev registry

**Output:**
```typescript
{
  type: 'registry',
  name: '@hyericlee/essentials',
  path: 'agents/designer',
  version: undefined
}
```

### 4. Local Filepath

**Detection:** Input matches path patterns:
- Starts with `/` (absolute)
- Starts with `./` or `../` (relative)
- Starts with `~` (home directory)
- Is exactly `.` (current directory)
- Contains path separators and exists on filesystem

**Examples:**
- `/Users/me/projects/my-agents/agents/typescript-pro.md`
- `./my-local-package`
- `~/packages/my-skill`

**Validation:**
- Path must exist (error if not found)
- Path must match an installable pattern OR contain manifest (error if neither)

**Output:**
```typescript
{
  type: 'filepath',
  absolutePath: '/Users/me/projects/my-agents',
  resourcePath: 'agents/typescript-pro.md',  // If pointing to specific resource
  isDirectory: true
}
```

---

## Version Specification

Versions can only be specified at the repo/package level, not for sub-paths.

**Valid:**
- `gh@user/repo@v1.0/path/to/resource`
- `my-package@1.0.0`
- `https://github.com/user/repo/tree/v1.0.0/path`

**Invalid:**
- `gh@user/repo/path@v1.0` (version on sub-path)

**Parsing Rule:** Version marker `@` is only recognized:
1. After repo identifier in shorthand: `gh@user/repo@version`
2. After package name in registry format: `package@version`
3. As part of URL path component: `/tree/version/`

---

## ResourceSpec Interface

```typescript
interface ResourceSpec {
  /** How the resource was specified */
  type: 'github-url' | 'github-shorthand' | 'registry' | 'filepath';
  
  /** Repository identifier (for git sources) */
  repo?: string;
  
  /** Git URL (for git sources) */
  gitUrl?: string;
  
  /** Git ref/version (branch, tag, commit) */
  ref?: string;
  
  /** Path within repo/package to the resource */
  path?: string;
  
  /** Package name (for registry sources) */
  name?: string;
  
  /** Version constraint (for registry sources) */
  version?: string;
  
  /** Absolute path (for filepath sources) */
  absolutePath?: string;
  
  /** Whether path points to a directory */
  isDirectory?: boolean;
}
```

---

## Parsing Algorithm

```
function parseResourceArg(input: string, cwd: string): ResourceSpec {
  // 1. GitHub URL
  if (input.startsWith('https://github.com/') || input.startsWith('http://github.com/')) {
    return parseGitHubUrl(input);
  }
  
  // 2. GitHub shorthand
  if (input.startsWith('gh@')) {
    return parseGitHubShorthand(input);
  }
  
  // 3. Filepath detection (before registry to avoid false positives)
  if (looksLikePath(input)) {
    const resolved = resolvePath(input, cwd);
    if (exists(resolved)) {
      return {
        type: 'filepath',
        absolutePath: resolved,
        isDirectory: isDirectory(resolved)
      };
    }
    // Path syntax but doesn't exist - could still be registry
    // Only error if it's unambiguously a path
    if (isUnambiguouslyPath(input)) {
      throw new Error(`Path not found: ${input}`);
    }
  }
  
  // 4. Registry resource name
  return parseRegistryName(input);
}

function looksLikePath(input: string): boolean {
  return input.startsWith('/') ||
         input.startsWith('./') ||
         input.startsWith('../') ||
         input.startsWith('~') ||
         input === '.' ||
         (isAbsolute(input) && !input.includes('@'));
}

function isUnambiguouslyPath(input: string): boolean {
  // Starts with explicit path markers
  return input.startsWith('/') ||
         input.startsWith('./') ||
         input.startsWith('../') ||
         input.startsWith('~');
}
```

---

## Integration with Current System

### Relationship to `classifyPackageInput()`

The new parser replaces the current classification with a resource-aware version:

**Current:**
```typescript
classifyPackageInput(raw, cwd) → { type, name?, gitUrl?, ... }
```

**New:**
```typescript
parseResourceArg(raw, cwd) → ResourceSpec
```

### Relationship to `detectGitSource()`

The existing `git-url-detection.ts` utilities can be reused:
- `parseGitHubUrl()` - Adapt for ResourceSpec output
- `parseGitHubShorthand()` - Adapt for ResourceSpec output
- `isGitUrl()` - Keep for detection

---

## Error Handling

### Path Not Found
```
Error: Path '/Users/me/nonexistent' does not exist.
```

### Ambiguous Input
```
Note: 'my-package' could refer to:
  - Local package at ./my-package
  - Registry package 'my-package'
  
Using local package. Specify '@my-package' for registry.
```

### Invalid Version Placement
```
Error: Version cannot be specified on sub-paths.

Got: gh@user/repo/path@v1.0
Use: gh@user/repo@v1.0/path
```

---

## Examples

### GitHub URL to Deep Path
```
Input: https://github.com/wshobson/agents/tree/main/plugins/javascript-typescript

Output:
  type: github-url
  repo: wshobson/agents
  gitUrl: https://github.com/wshobson/agents.git
  ref: main
  path: plugins/javascript-typescript
```

### GitHub Shorthand with Version
```
Input: gh@anthropics/claude-code@v2.0

Output:
  type: github-shorthand
  repo: anthropics/claude-code
  gitUrl: https://github.com/anthropics/claude-code.git
  ref: v2.0
  path: undefined
```

### Scoped Registry Package
```
Input: @hyericlee/essentials

Output:
  type: registry
  name: @hyericlee/essentials
  version: undefined
  path: undefined
```

### Local Directory
```
Input: ~/packages/my-agents
CWD: /Users/me/workspace

Output:
  type: filepath
  absolutePath: /Users/me/packages/my-agents
  isDirectory: true
```

### Relative Path to File
```
Input: ./agents/designer.md
CWD: /Users/me/workspace

Output:
  type: filepath
  absolutePath: /Users/me/workspace/agents/designer.md
  isDirectory: false
```
