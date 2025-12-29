# Metadata Files

## Overview

OpenPackage uses two metadata files:

1. **`openpackage.yml`**: Package manifest (name, version, dependencies)
2. **`openpackage.index.yml`**: Unified install tracking (single file for entire workspace)

---

## `openpackage.yml` (Manifest)

### Root Package (Workspace)

Located at: `.openpackage/openpackage.yml`

```yaml
name: my-project
version: 1.0.0
description: My project's AI rules and commands

packages:
  # Workspace-scope package (relative path)
  - name: my-rules
    path: ./.openpackage/packages/my-rules/
    
  # Global-scope package (tilde path)
  - name: shared-tools
    path: ~/.openpackage/packages/shared-tools/
    
  # Registry-installed (version constraint only; path inferred from registry)
  - name: community-pkg
    version: ^1.2.0
    
  # Git sources
  - name: git-pkg
    git: https://github.com/user/repo.git
    ref: main

dev-packages:
  - name: test-utils
    path: ./.openpackage/packages/test-utils/
```

### Package Source

Located at: `<package-root>/openpackage.yml`

```yaml
name: my-rules
version: 1.0.0
description: Custom rules package

# Optional: package dependencies
packages:
  - name: base-rules
    version: ^1.0.0
```

---

## `openpackage.index.yml` (Unified Install Tracking)

### Purpose

A single file at `.openpackage/openpackage.index.yml` that tracks:
- All installed packages
- Their versions
- Their source paths
- Their file mappings to workspace platforms
- Cached dependency information

### Location

Only one location: `.openpackage/openpackage.index.yml`

No per-package index files.

### Structure

```yaml
# Unified index tracking all installed packages

packages:
  my-rules:
    version: 1.0.0
    path: ./.openpackage/packages/my-rules/
    dependencies:
      - name: base-lib
        path: ~/.openpackage/packages/base-lib/
    files:
      rules/:
        - .cursor/rules/
        - .opencode/rules/
      commands/:
        - .cursor/commands/
      AGENTS.md:
        - AGENTS.md
        
  shared-tools:
    version: 2.1.0
    path: ~/.openpackage/packages/shared-tools/
    files:
      agents/:
        - .cursor/agents/
      commands/:
        - .cursor/commands/
        
  community-pkg:
    version: 1.2.3
    path: ~/.openpackage/registry/community-pkg/1.2.3/
    dependencies:
      - name: common-utils
        version: 1.0.0
        path: ~/.openpackage/registry/common-utils/1.0.0/
    files:
      rules/:
        - .cursor/rules/
```

### Fields Per Package

| Field | Required | Description |
|-------|----------|-------------|
| `version` | Optional | Installed version (for status/upgrade detection) |
| `path` | Required | Source of truth location |
| `dependencies` | Optional | Cached dependencies for fast resolution |
| `files` | Required | File mapping: registry-path → installed-paths |

### File Mapping Keys

| Key Format | Type | Example |
|------------|------|---------|
| `name/` (trailing slash) | Directory | `rules/`, `commands/` |
| `name` (no slash) | File | `AGENTS.md`, `docs/guide.md` |

### File Mapping Values

Values are arrays of workspace-relative paths where the content is installed:

```yaml
files:
  # Directory mapped to multiple platforms
  rules/:
    - .cursor/rules/
    - .opencode/rules/
  
  # Directory mapped to single platform
  commands/:
    - .cursor/commands/
  
  # Individual file
  AGENTS.md:
    - AGENTS.md
```

---

## Dependency Declaration

### Path-Based (Mutable)

```yaml
packages:
  - name: my-rules
    path: ./.openpackage/packages/my-rules/
```

- `path:` relative to workspace or using `~`
- Enables `save`, `add`, `pack`, `apply`

### Version-Based (From Registry)

```yaml
packages:
  - name: community-pkg
    version: ^1.2.0
```

- The registry directory is inferred at runtime from `version` (constraint) by resolving to an installed version.
- Enables `install`, `apply` (read-only)
- `save`, `add` fail with clear error

### After Registry Install

```yaml
# In openpackage.yml after `opkg install community-pkg@^1.2.0`
packages:
  - name: community-pkg
    version: ^1.2.0
```

The `version` field remains the requested constraint (range).
The exact installed version and resolved source path are recorded in the unified `.openpackage/openpackage.index.yml`.

### Git-Based

```yaml
packages:
  - name: git-pkg
    git: https://github.com/user/repo.git
    ref: v1.0.0
```

- Optional `ref:` for branch/tag/commit.
- The dependency ultimately resolves to a local filesystem path (after cloning/fetching).
- **Mutability is determined by the resolved path**:
  - If the clone lives under `~/.openpackage/registry/`, it is treated as **immutable** (same rules as any registry snapshot: `save`/`add` must fail).
  - If the clone lives under a mutable packages directory (e.g. `~/.openpackage/packages/` or `./.openpackage/packages/`), it is treated as **mutable**.

This repo’s 0.7.0 behavior clones git sources under `~/.openpackage/registry/`, so git sources are **immutable by default**.

### Partial Install

```yaml
packages:
  - name: large-pkg
    version: ^2.0.0
    include:
      - rules/auth.md
      - commands/login.md
```

- `include:` limits which files are installed
- Reduces workspace footprint

---

## Removed Fields (v0.7.0)

### No Longer Used

```yaml
# REMOVED from index
workspace:
  hash: abc123      # ← Removed: workspace hash for WIP versioning
```

### No Per-Package Index Files

Previous versions stored per-package metadata at:
- `.openpackage/packages/<name>/openpackage.yml`
- `.openpackage/packages/<name>/openpackage.index.yml`

These are replaced by the unified `openpackage.index.yml`.

---

## Path Resolution

### Tilde Expansion

`~/.openpackage/...` expands to user's home directory at runtime.

Stored in YAML as-is (with tilde) for portability.

### Relative Paths

Paths starting with `./` resolve relative to the `openpackage.yml` file location.

### Example Resolution

```yaml
# In .openpackage/openpackage.yml
packages:
  - name: my-pkg
    path: ./.openpackage/packages/my-pkg/
    
# Resolves to: <workspace>/.openpackage/packages/my-pkg/
```
