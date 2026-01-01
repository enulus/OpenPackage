# Add Command

`opkg add` copies new files from anywhere on the filesystem into a mutable package source. Unlike `save` (which syncs workspace edits based on index mappings), `add` operates independently of workspace installation state.

## Purpose & Direction
- **Filesystem → Package Source**: Copy new files from any location to a mutable package.
- **Independence**: Works with any mutable package (workspace or global), regardless of installation status.
- **Source-only operation**: Modifies package source only; workspace sync requires explicit `install` + `apply` or `--apply` flag.
- Complements `save` (edits) for initial/new content addition.

## Preconditions
- Target package must exist as a mutable source:
  - Workspace packages: `./.openpackage/packages/<name>/`
  - Global packages: `~/.openpackage/packages/<name>/`
- Registry packages are **immutable** and cannot be modified via `add`.

## Flow
1. **Resolve mutable source**:
   - Search workspace packages, then global packages.
   - Error if not found or resolves to immutable registry path.
   - Does **not** require package to be in workspace index.

2. **Collect files** from input path(s).

3. **Map & copy**:
   - Platform subdirs (e.g., `.cursor/rules/`) → universal (`rules/`).
   - Platform root files (e.g., `CLAUDE.md`) → package root.
   - Other paths → package `root/<relpath>` (prefix for install stripping).

4. **Index updates**:
   - `add` does **not** update `openpackage.index.yml`.
   - Index updates happen via `install` or `apply`.

5. **Optional --apply**:
   - Triggers `apply` pipeline immediately after add.
   - Requires package to be installed in current workspace.
   - Updates workspace index via `apply`.

## Options
- `--apply`: Apply changes to workspace immediately (requires package installation in current workspace).
- `--platform-specific`: Save platform-specific variants for platform subdir inputs.
- Input: `opkg add <pkg> <path>`.
- Global flags: [CLI Options](../cli-options.md).

## Examples

### Basic add (source-only)
```bash
# Add files to workspace package (no workspace sync)
opkg add my-pkg ./new-helpers/

# Add files to global package from any directory
cd ~/projects/other-repo
opkg add shared-utils ./config.yml
```

### Add with immediate apply
```bash
# Add and sync to workspace in one step
# (requires my-pkg to be installed in current workspace)
opkg add my-pkg .cursor/rules/example.md --apply
```

### Workflow: Add → Install → Apply
```bash
# 1. Add files to package source
opkg add my-pkg ./docs/guide.md

# 2. Install package to current workspace
opkg install my-pkg

# 3. Apply to sync changes to workspace platforms
opkg apply my-pkg
```

## Behavior Changes (v2)

### Previous behavior (v1)
- Required package to be installed in current workspace (checked workspace index).
- Automatically updated `openpackage.index.yml` after copying files.
- Tightly coupled to workspace state.

### Current behavior (v2)
- Works with any mutable package (workspace or global).
- Does **not** update workspace index (separation of concerns).
- Users explicitly control workspace sync via `install` + `apply` or `--apply` flag.
- Clearer mental model: `add` = modify source, `apply`/`install` = sync to workspace.

## Errors

### Package not found
```
Package 'my-pkg' not found in workspace or global packages.
Available locations:
  - Workspace packages: ./.openpackage/packages/
  - Global packages: ~/.openpackage/packages/

Registry packages are immutable and cannot be modified directly.
To edit a registry package:
  1. Install it with a mutable source: opkg install my-pkg --path <local-path>
  2. Or copy it to workspace: opkg pull my-pkg
```

### Immutable source (registry)
```
Package 'my-pkg' resolves to a registry path, which is immutable.
Registry packages cannot be modified via add command.
Path: ~/.openpackage/registry/my-pkg/1.0.0/
```

### --apply flag with uninstalled package
```
Files added to package source at: ~/.openpackage/packages/my-pkg/

However, --apply failed because package 'my-pkg' is not installed in this workspace.

To sync changes to your workspace:
  1. Install the package: opkg install my-pkg
  2. Apply the changes: opkg apply my-pkg

Or run 'opkg add' without --apply flag to skip workspace sync.
```

### Copy conflicts
- Prompts user to resolve (overwrite/skip/rename).
- Use `--force` (if implemented) to auto-overwrite.

## Integration

### Relationship to other commands
- **`save`**: Syncs workspace → source based on index mappings (requires installation).
- **`add`**: Copies filesystem → source independently (no installation required).
- **`apply`**: Syncs source → workspace platforms + updates index.
- **`install`**: Materializes package to workspace + updates index.
- **`pack`**: Creates registry snapshot from source (no workspace interaction).

### Workflows
1. **Adding new content**:
   ```bash
   opkg add pkg ./new-files/   # Add to source
   opkg install pkg             # Ensure installed
   opkg apply pkg               # Sync to workspace
   ```

2. **Quick add + sync**:
   ```bash
   opkg add pkg ./file.md --apply  # Add and sync (requires installation)
   ```

3. **Editing existing content**:
   ```bash
   # Edit files in workspace, then:
   opkg save pkg  # Uses index to sync changes back
   ```

## See Also
- [Save](../save/) – Workspace → source sync for installed packages
- [Apply](../apply/) – Source → workspace platform sync
- [Install](../install/) – Package materialization and dependency resolution
- [Package Index](../package/package-index-yml.md) – Workspace installation state
- [Commands Overview](../commands-overview.md) – All command relationships

## Implementation
- Pipeline: `src/core/add/add-to-source-pipeline.ts`
- Source resolution: `src/core/source-resolution/resolve-mutable-source.ts`
- Command: `src/commands/add.ts`