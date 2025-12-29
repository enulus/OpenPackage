# Commands

## Command Overview

| Command | Direction | Description |
|---------|-----------|-------------|
| `save` | Workspace → Source | Sync edited workspace files back to package source |
| `add` | Workspace → Source | Add new workspace files to package source |
| `pack` | Source → Registry | Create versioned directory snapshot |
| `apply` | Source → Workspace | Sync package source to workspace platforms |
| `install` | Registry → Workspace | Install registry version to workspace |

---

## `save`

**Purpose**: Sync changes from workspace platform directories back to the package source.

**Direction**: Workspace → Source of Truth

**Preconditions**:
- Package must have a mutable source (`path:` pointing to packages/ directory)
- Fails for registry-installed packages

**Flow**:
```
1. Read package entry from unified openpackage.index.yml
2. Validate source is mutable (path is not in registry/)
3. For each mapped file in the index:
   - Read workspace version
   - Write to source path
4. Update source openpackage.yml if needed
```

**Example**:
```bash
opkg save my-pkg

# Syncs:
#   .cursor/rules/auth.md → ~/.openpackage/packages/my-pkg/rules/auth.md
#   docs/guide.md → ~/.openpackage/packages/my-pkg/docs/guide.md
```

---

## `add`

**Purpose**: Add new files from workspace to package source.

**Direction**: Workspace → Source of Truth

**Preconditions**:
- Package must have a mutable source
- Source files must exist

**Flow**:
```
1. Validate source is mutable
2. Collect files from input path
3. Copy files to package source directory
4. Update unified openpackage.index.yml with new mappings
5. Optionally apply to other platforms (--apply)
```

**Example**:
```bash
opkg add my-pkg ./new-helpers/

# Copies:
#   ./new-helpers/utils.md → ~/.openpackage/packages/my-pkg/commands/utils.md
```

---

## `pack`

**Purpose**: Create an immutable versioned snapshot from package source.

**Direction**: Source → Registry

**Flow**:
```
1. Read package source from path
2. Read version from source openpackage.yml
3. Copy to registry: ~/.openpackage/registry/<name>/<version>/
4. Mark as immutable (registry source)
```

**Example**:
```bash
opkg pack my-pkg

# Creates:
#   ~/.openpackage/registry/my-pkg/1.0.0/
#   ├── openpackage.yml
#   ├── commands/
#   └── rules/
```

**Options**:
- `--output <path>`: Copy to specific location instead of registry
- `--dry-run`: Show what would be packed without writing

---

## `apply`

**Purpose**: Sync package content to workspace platform directories.

**Direction**: Source/Registry → Workspace

**Flow**:
```
1. Resolve package source path from openpackage.yml
2. Read package files from source
3. Map to platform directories (.cursor/, .opencode/, etc.)
4. Write/update files
5. Update unified openpackage.index.yml
```

**Example**:
```bash
opkg apply my-pkg

# Syncs from source to:
#   .cursor/rules/
#   .cursor/commands/
#   .opencode/rules/
#   etc.
```

---

## `install`

**Purpose**: Install a package from registry to workspace.

**Direction**: Registry → Workspace

**Flow**:
```
1. Resolve version from registry
2. Locate registry directory: ~/.openpackage/registry/<name>/<version>/
3. Apply files to workspace platforms
4. Update workspace openpackage.yml with dependency:
   - Registry installs: preserve the requested `version` constraint (range or exact) and do not write `path:` (it is inferred)
   - Git/path installs: do not write ranges; persist the source (`git`/`ref` or `path`) and any version written must be exact
5. Update unified openpackage.index.yml with file mappings
```

**Example**:
```bash
opkg install community-pkg@^1.2.0

# Reads from:
#   ~/.openpackage/registry/community-pkg/1.2.3/

# Updates openpackage.yml:
#   packages:
#     - name: community-pkg
#       version: ^1.2.0
```

---

## `status`

**Purpose**: Show status of all installed packages.

**Flow**:
```
1. Read unified openpackage.index.yml
2. For each package:
   - Validate source path exists
   - Check if files are in sync
   - Report version and status
```

**Example**:
```bash
opkg status

# Output:
# my-rules          1.0.0   ✓ synced    ./.openpackage/packages/my-rules/
# shared-tools      2.1.0   ✓ synced    ~/.openpackage/packages/shared-tools/
# community-pkg     1.2.3   ✓ synced    ~/.openpackage/registry/community-pkg/1.2.3/
```

---

## `uninstall`

**Purpose**: Remove a package from workspace.

**Flow**:
```
1. Read package entry from unified openpackage.index.yml
2. Delete all mapped files from workspace
3. Remove package entry from openpackage.index.yml
4. Remove dependency from openpackage.yml
```

---

## Command Matrix

| Command | Mutable Source | Immutable Source | Creates Files In |
|---------|----------------|------------------|------------------|
| `save` | ✅ Syncs to source | ❌ Error | Source path |
| `add` | ✅ Adds to source | ❌ Error | Source path |
| `pack` | ✅ Creates version | N/A | Registry |
| `apply` | ✅ Syncs to workspace | ✅ Syncs to workspace | Workspace |
| `install` | N/A | ✅ Syncs to workspace | Workspace |
| `status` | ✅ Shows status | ✅ Shows status | N/A |
| `uninstall` | ✅ Removes | ✅ Removes | N/A (deletes) |
