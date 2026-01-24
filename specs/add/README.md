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

3. **Map files using IMPORT flows** (workspace → package):
   - Uses **import flows** from `platforms.jsonc` to map workspace files to universal package structure.
   - Platform-specific files (e.g., `.cursor/commands/*.md`) → universal subdirs (`commands/*.md`).
   - Handles glob patterns (`**/*.md`), extension transformations (`.mdc` → `.md`), nested directories.
   - Platform root files (e.g., `AGENTS.md`, `CLAUDE.md`) → package root.
   - Non-platform files → `root/<relpath>` (stored under package root).
   - See [Flow-Based Mapping](#flow-based-mapping) for details.

4. **Copy with conflict resolution**:
   - Copy files to package source with prompts for conflicts.
   - Preserves directory structure and content.

5. **Index updates**:
   - `add` does **not** update `openpackage.index.yml`.
   - Index updates happen via `install` or `apply`.

6. **Optional --apply**:
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

## Flow-Based Mapping

The `add` command uses **IMPORT flows** from `platforms.jsonc` to correctly map workspace files to their universal package structure. This is the reverse of install/apply, which use **EXPORT flows**.

### Flow Directions
- **EXPORT flows**: Package → Workspace (used by `install`, `apply`)
- **IMPORT flows**: Workspace → Package (used by `add`, `save`)

### Mapping Process

1. **Detect platform**: Check if file path matches platform directory patterns (e.g., `.cursor/`, `.claude/`).

2. **Match import flow**: Find matching `import` flow from platform definition:
   ```jsonc
   {
     "cursor": {
       "import": [
         {
           "from": ".cursor/commands/**/*.md",
           "to": "commands/**/*.md"
         },
         {
           "from": ".cursor/rules/**/*.mdc",
           "to": "rules/**/*.md"  // Extension transformation
         }
       ]
     }
   }
   ```

3. **Apply pattern mapping**:
   - Glob patterns (`**`, `*`) preserve directory structure
   - Extension transformations are applied (`.mdc` → `.md`)
   - Nested paths are preserved (`utils/helper.md` → `commands/utils/helper.md`)

4. **Fallback behavior**:
   - Platform root files (AGENTS.md, CLAUDE.md, etc.) → package root
   - Unmatched files → `root/<relpath>` for non-platform content

### Examples

#### Cursor Commands
```bash
opkg add .cursor/commands/deploy.md
# Maps via: .cursor/commands/**/*.md → commands/**/*.md
# Result: .openpackage/commands/deploy.md ✓
```

#### Cursor Rules with Extension Transformation
```bash
opkg add .cursor/rules/typescript.mdc
# Maps via: .cursor/rules/**/*.mdc → rules/**/*.md
# Result: .openpackage/rules/typescript.md ✓
# (Extension changed from .mdc to .md)
```

#### Nested Directory Preservation
```bash
opkg add .cursor/commands/utils/helper.md
# Maps via: .cursor/commands/**/*.md → commands/**/*.md
# Result: .openpackage/commands/utils/helper.md ✓
```

#### Platform Root Files
```bash
opkg add AGENTS.md
# Platform root file detection
# Result: .openpackage/AGENTS.md ✓
```

#### Non-Platform Files
```bash
opkg add config.json
# No platform pattern match
# Result: .openpackage/root/config.json ✓
```

### Technical Details

**Symlink Resolution**: Paths are resolved using `realpathSync()` to handle platform symlinks (e.g., macOS `/var` → `/private/var`).

**Pattern Matching**: Uses regex conversion of glob patterns for efficient matching:
- `**` → matches zero or more directory segments
- `*` → matches single filename segment
- Patterns are anchored to workspace root

**Implementation**:
- Mapping function: `mapWorkspaceFileToUniversal()` in `src/utils/platform-mapper.ts`
- Entry derivation: `deriveSourceEntry()` in `src/core/add/source-collector.ts`
- Test coverage: `tests/core/add/add-flow-based-mapping.test.ts`

## Behavior Changes (v2)

### Previous behavior (v1)
- Required package to be installed in current workspace (checked workspace index).
- Automatically updated `openpackage.index.yml` after copying files.
- Tightly coupled to workspace state.
- Used hardcoded subdirectory mappings (legacy behavior).

### Current behavior (v2)
- Works with any mutable package (workspace or global).
- Does **not** update workspace index (separation of concerns).
- Users explicitly control workspace sync via `install` + `apply` or `--apply` flag.
- Clearer mental model: `add` = modify source, `apply`/`install` = sync to workspace.
- **Uses flow-based mapping** from `platforms.jsonc` for accurate file placement.

## Errors

### Package not found
```
Package 'my-pkg' not found in workspace or global packages.
Available locations:
  - Workspace packages: ./.openpackage/packages/
  - Global packages: ~/.openpackage/packages/

Registry packages are immutable and cannot be modified directly.
To edit a registry package:
  1. Install it with a mutable source: opkg install git:<repo-url> or opkg install path:<local-path>
  2. Or use workspace packages to create an editable version
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