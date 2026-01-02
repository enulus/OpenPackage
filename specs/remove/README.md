# Remove Command

`opkg remove` (alias: `rm`) deletes files and directories from a mutable package source. Unlike `uninstall` (which removes packages from workspace), `remove` operates on package source content independently of installation state.

## Purpose & Direction
- **Package Source → Deletion**: Remove files from mutable package sources.
- **Independence**: Works with any mutable package (workspace or global), regardless of installation status.
- **Source-only operation**: Modifies package source only; workspace sync requires explicit `apply` or `--apply` flag.
- Opposite of `add` (which copies files into package sources).

## Preconditions
- Target package must exist as a mutable source:
  - Workspace packages: `./.openpackage/packages/<name>/`
  - Global packages: `~/.openpackage/packages/<name>/`
- Registry packages are **immutable** and cannot be modified via `remove`.

## Flow
1. **Resolve mutable source**:
   - Search workspace packages, then global packages.
   - Error if not found or resolves to immutable registry path.
   - Does **not** require package to be in workspace index.

2. **Collect files** from input path pattern:
   - Single file: `commands/test.md`
   - Directory: `commands/` (all files recursively)
   - Resolves paths relative to package root.

3. **Confirm removal**:
   - Display list of files to be removed (up to 20, then summarize).
   - Prompt user for confirmation (unless `--force` or `--dry-run`).
   - Allow cancellation.

4. **Remove files**:
   - Delete matched files from package source.
   - Clean up empty parent directories.
   - Track removed files for reporting.

5. **Index updates**:
   - `remove` does **not** update `openpackage.index.yml`.
   - Index updates happen via `apply` (if package is installed).

6. **Optional --apply**:
   - Triggers `apply` pipeline immediately after removal.
   - Requires package to be installed in current workspace.
   - Updates workspace index via `apply`.

## Options
- `--apply`: Apply changes to workspace immediately (requires package installation in current workspace).
- `--force`: Skip confirmation prompts.
- `--dry-run`: Preview what would be removed without actually deleting.
- Input: `opkg remove <pkg> <path>`.
- Global flags: [CLI Options](../cli-options.md).

## Examples

### Basic remove (source-only)
```bash
# Remove single file from workspace package (no workspace sync)
opkg remove my-pkg commands/deprecated.md
# Or use the alias
opkg rm my-pkg commands/deprecated.md

# Remove directory from global package
opkg remove shared-utils rules/old/

# Remove from any directory (works with global packages)
cd ~/projects/other-repo
opkg remove global-pkg agents/legacy.md
```

### Remove with immediate apply
```bash
# Remove and sync to workspace in one step
# (requires my-pkg to be installed in current workspace)
opkg remove my-pkg commands/old.md --apply
```

### Preview before removing
```bash
# See what would be removed without actually deleting
opkg remove my-pkg commands/ --dry-run

# Force removal without confirmation
opkg remove my-pkg agents/deprecated.md --force
```

### Workflow: Remove → Apply
```bash
# 1. Remove files from package source
opkg remove my-pkg commands/deprecated/

# 2. If package is installed, apply to sync deletions
opkg apply my-pkg
```

## Behavior Details

### Path Resolution
- Paths are relative to package root
- Supports both files and directories
- Directory paths can include trailing slash (optional)
- Examples:
  - `commands/test.md` - single file
  - `commands/` or `commands` - entire directory
  - `root/tools/helper.sh` - copy-to-root content

### Empty Directory Cleanup
After removing files, `remove` automatically cleans up empty parent directories:
```
Before: pkg/deep/nested/dir/file.md
After:  (entire deep/ directory removed if it becomes empty)
```

This prevents leaving behind empty directory structures in the package source.

### Confirmation Prompt
Unless `--force` or `--dry-run` is specified, users are prompted:
```
The following 3 files will be removed from 'my-pkg':

  - commands/test1.md
  - commands/test2.md
  - rules/auth.md

Do you want to proceed with the removal? (y/N)
```

For large removals (>20 files), the display is summarized:
```
The following 45 files will be removed from 'my-pkg':

  - commands/test1.md
  - commands/test2.md
  ... (first 20 shown)
  ... and 25 more files

Do you want to proceed with the removal? (y/N)
```

### Dry-Run Mode
With `--dry-run`:
- No files are actually deleted
- Shows preview of what would be removed
- Useful for verifying before executing
- No confirmation prompt needed

## Errors

### Package not found
```
Package 'my-pkg' not found in workspace or global packages.
Available locations:
  - Workspace packages: ./.openpackage/packages/
  - Global packages: ~/.openpackage/packages/

Registry packages are immutable and cannot be modified directly.
```

### Immutable source (registry)
```
Package 'my-pkg' resolves to a registry path, which is immutable.
Registry packages cannot be modified via remove command.
Path: ~/.openpackage/registry/my-pkg/1.0.0/
```

### Path not found in package
```
Path 'commands/nonexistent.md' not found in package.
Package source: ~/.openpackage/packages/my-pkg/
```

### Empty directory
```
Directory 'commands/' is empty.
No files to remove.
```

### --apply flag with uninstalled package
```
Files removed from package source at: ~/.openpackage/packages/my-pkg/

However, --apply failed because package 'my-pkg' is not installed in this workspace.

To sync deletions to your workspace:
  1. Ensure package is installed: opkg install my-pkg
  2. Apply the changes: opkg apply my-pkg

Or run 'opkg remove' without --apply flag to skip workspace sync.
```

### User cancellation
```
Operation cancelled by user.
```

## Integration

### Relationship to other commands
- **`add`**: Opposite operation; add copies TO source, remove deletes FROM source.
- **`save`**: Syncs workspace → source based on index mappings (requires installation).
- **`apply`**: Syncs source → workspace platforms + updates index (including deletions).
- **`install`**: Materializes package to workspace + updates index.
- **`uninstall`**: Removes package from workspace + index (different from remove).
- **`pack`**: Creates registry snapshot from source (deletions reflected in new versions).

### Comparison with Uninstall

| Aspect | `remove` | `uninstall` |
|--------|----------|-------------|
| **Target** | Package source files | Workspace files + index |
| **Mutability** | Requires mutable source | Works with any source |
| **Installation** | Not required | Required (reads index) |
| **Index** | No update (unless --apply) | Removes from index |
| **Source** | Modifies source | Preserves source |
| **Scope** | Source-only by default | Workspace cleanup |
| **Purpose** | Content management | Package removal |

### Workflows

1. **Removing deprecated content**:
   ```bash
   opkg remove pkg commands/deprecated/  # Remove from source
   # Or use alias: opkg rm pkg commands/deprecated/
   opkg apply pkg                        # Sync to workspace (if installed)
   ```

2. **Quick remove + sync**:
   ```bash
   opkg remove pkg rules/old.md --apply  # Remove and sync (requires installation)
   ```

3. **Cleaning up after uninstall**:
   ```bash
   opkg uninstall pkg    # Remove from workspace
   opkg remove pkg root/ # Clean up source files
   ```

4. **Preview before removing**:
   ```bash
   opkg remove pkg commands/ --dry-run   # Preview
   opkg remove pkg commands/ --force     # Execute without prompt
   ```

## Implementation
- Pipeline: `src/core/remove/remove-from-source-pipeline.ts`
- Collector: `src/core/remove/removal-collector.ts`
- Confirmation: `src/core/remove/removal-confirmation.ts`
- Source resolution: `src/core/source-resolution/resolve-mutable-source.ts`
- Command: `src/commands/remove.ts`

## See Also
- [Add](../add/) – Copy files into package sources (opposite operation)
- [Apply](../apply/) – Source → workspace platform sync
- [Uninstall](../uninstall/) – Remove package from workspace
- [Save](../save/) – Workspace → source sync for installed packages
- [Package Index](../package/package-index-yml.md) – Workspace installation state
- [Commands Overview](../commands-overview.md) – All command relationships
