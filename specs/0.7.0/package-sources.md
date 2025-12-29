# Package Sources

## Path-Based Model

All packages resolve to a path. The dependency declaration in `openpackage.yml` determines the source type.

## Source Types

### 1. Workspace Path (Mutable)

```yaml
packages:
  - name: project-tools
    path: ./.openpackage/packages/project-tools/
```

- Path relative to workspace `openpackage.yml`
- Editable development codebase
- `save`, `add`, `pack`, `apply` all work

### 2. Global Path (Mutable)

```yaml
packages:
  - name: shared-rules
    path: ~/.openpackage/packages/shared-rules/
```

- Tilde path to global packages directory
- Shared across multiple workspaces
- `save`, `add`, `pack`, `apply` all work

### 3. Registry Version (Immutable)

```yaml
packages:
  - name: community-pkg
    version: 1.2.3
    path: ~/.openpackage/registry/community-pkg/1.2.3/
```

- `version:` indicates origin from registry
- `path:` points to immutable registry location
- `apply`, `install` work; `save`, `add` fail with error

### 4. Git Source

```yaml
packages:
  - name: git-pkg
    git: https://github.com/user/repo.git
    ref: main
```

- Git dependencies are resolved by cloning/fetching the repository locally.
- **Mutability is determined by the resolved filesystem path** (not by the fact that the source is git):
  - If the resolved path is under `~/.openpackage/registry/`, it is treated as an **immutable registry snapshot**.
  - If the resolved path is under a mutable packages directory (e.g. `~/.openpackage/packages/` or `./.openpackage/packages/`), it is treated as **mutable**.
  - 0.7.0 does not standardize a "git working copy" location; it standardizes that **registry locations are immutable**.

#### Git clone location (this repo’s 0.7.0 behavior)

In this codebase, git sources are cloned under the local registry (for caching/offline use), so they are **immutable**:

```
~/.openpackage/registry/...
```

## Source Resolution Flow

```
1. Read dependency from workspace openpackage.yml
2. Determine source type:
   - Has `path:` → Use path directly (resolve ~ and relative paths)
   - Has only `version:` → Resolve from registry, populate path
   - Has `git:` → Clone/fetch from repository to a local directory, then use that path
3. Validate source exists
4. Proceed with operation
```

## Mutability Rules

| Source Type | `save` | `add` | `pack` | `apply` | `install` |
|-------------|--------|-------|--------|---------|-----------|
| `./.openpackage/packages/...` | ✅ | ✅ | ✅ | ✅ | N/A |
| `~/.openpackage/packages/...` | ✅ | ✅ | ✅ | ✅ | N/A |
| `~/.openpackage/registry/...` | ❌ | ❌ | N/A | ✅ | ✅ |
| `git: ...` (resolved to `~/.openpackage/registry/...`) | ❌ | ❌ | ✅ | ✅ | ✅ |
| `git: ...` (resolved to a mutable packages dir) | ✅ | ✅ | ✅ | ✅ | ✅ |

## Error Handling

### Attempting to Modify Immutable Source

```
Error: Cannot save to 'community-pkg' - installed from registry (version 1.2.3).

To make changes:
  1. Copy to a local package directory
  2. Update path in openpackage.yml
  3. Edit the local copy
  4. Pack your own version: opkg pack community-pkg
```

### Source Path Not Found

```
Error: Package source not found: ~/.openpackage/packages/my-rules/

The path declared in openpackage.yml does not exist.
Run 'opkg status' to check package states.
```

## Path Resolution

### Tilde Expansion

`~/.openpackage/...` expands to user's home directory at runtime.

Stored in YAML with tilde for portability across machines.

### Relative Paths

Relative paths (e.g., `./.openpackage/packages/...`) resolve relative to the `openpackage.yml` file location.

### Portability

| Path Type | Example | Portability |
|-----------|---------|-------------|
| Tilde | `~/.openpackage/packages/...` | ✅ Portable (same home structure) |
| Relative | `./.openpackage/packages/...` | ✅ Portable (committed with project) |
| Absolute | `/opt/packages/...` | ❌ Machine-specific |

## Registry Path After Install

When installing from registry, the path is populated:

```yaml
# Before install (in openpackage.yml)
packages:
  - name: community-pkg
    version: ^1.2.0

# After `opkg install` resolves and installs
packages:
  - name: community-pkg
    version: 1.2.3
    path: ~/.openpackage/registry/community-pkg/1.2.3/
```

The `version` field is retained to indicate the package originated from the registry.
