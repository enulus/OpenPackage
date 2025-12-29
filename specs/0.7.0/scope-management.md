# Scope Management

> **Status: Deferred**
>
> Scope transition commands (`elevate`, `localize`) are planned for a future release.
> This document describes the design for when they are implemented.

## Package Scopes

Packages can exist in different scopes:

| Scope | Location | Shared | Typical Use |
|-------|----------|--------|-------------|
| **Workspace** | `./.openpackage/packages/<name>/` | No | Project-specific packages |
| **Global** | `~/.openpackage/packages/<name>/` | Yes | Cross-project shared packages |
| **Registry** | `~/.openpackage/registry/<name>/<ver>/` | N/A | Immutable versioned snapshots |

## Current Workflow (v0.7.0)

### Creating a Workspace Package

```bash
# Initialize a new package
mkdir -p .openpackage/packages/my-rules
# Create openpackage.yml manually or with opkg init

# Add to workspace dependencies
# Edit .openpackage/openpackage.yml:
#   packages:
#     - name: my-rules
#       path: ./.openpackage/packages/my-rules/
```

### Using a Global Package

```bash
# Create in global location
mkdir -p ~/.openpackage/packages/shared-rules
# Create openpackage.yml

# Reference from any workspace:
#   packages:
#     - name: shared-rules
#       path: ~/.openpackage/packages/shared-rules/
```

### Manual Scope Change

To move from workspace to global (manual process):

```bash
# 1. Copy the package
cp -r ./.openpackage/packages/my-rules ~/.openpackage/packages/

# 2. Update openpackage.yml
# Change: path: ./.openpackage/packages/my-rules/
# To:     path: ~/.openpackage/packages/my-rules/

# 3. Optionally remove workspace copy
rm -rf ./.openpackage/packages/my-rules
```

---

## Future: Scope Transition Commands

### `elevate` (Workspace → Global)

Move a workspace package to global scope for shared use across projects.

```bash
opkg elevate my-rules
```

**Proposed Flow**:
```
1. Copy ./.openpackage/packages/my-rules/ → ~/.openpackage/packages/my-rules/
2. Update openpackage.yml:
   path: ./.openpackage/packages/my-rules/  →  path: ~/.openpackage/packages/my-rules/
3. Update openpackage.index.yml with new path
4. Optionally: remove ./.openpackage/packages/my-rules/ (with --clean flag)
```

**Options**:
- `--clean`: Remove original after copy
- `--force`: Overwrite if global package exists

### `localize` (Global → Workspace)

Copy a global package to workspace scope for project-specific modifications.

```bash
opkg localize shared-tools
```

**Proposed Flow**:
```
1. Copy ~/.openpackage/packages/shared-tools/ → ./.openpackage/packages/shared-tools/
2. Update openpackage.yml:
   path: ~/.openpackage/packages/...  →  path: ./.openpackage/packages/shared-tools/
3. Update openpackage.index.yml with new path
4. Original global copy remains intact
```

**Options**:
- `--force`: Overwrite if workspace package exists

### `scope` (Information)

Check current scope of a package:

```bash
opkg scope my-rules

# Output:
# my-rules
#   Scope: workspace
#   Path: ./.openpackage/packages/my-rules/
#   Version: 1.0.0
```

---

## Path Declaration Examples

### Workspace Scope

```yaml
packages:
  - name: project-tools
    path: ./.openpackage/packages/project-tools/
```

### Global Scope

```yaml
packages:
  - name: shared-rules
    path: ~/.openpackage/packages/shared-rules/
```

### Registry (Immutable)

```yaml
packages:
  - name: community-pkg
    version: 1.2.3
```

---

## Best Practices

1. **Start workspace**: Develop packages in `./.openpackage/packages/` first
2. **Elevate when stable**: Move to global when ready to share (manual for now)
3. **Localize to fork**: Copy global to workspace for project-specific changes
4. **Use relative paths**: Prefer `./.openpackage/packages/` for portability
5. **Use tilde paths**: Prefer `~/...` over absolute paths for global packages
