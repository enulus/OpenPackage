# Commands Overview

This file provides high-level semantics for core commands in the path-based model. Detailed behaviors in subdirs (e.g., [Save](save/), [Pack](pack/)). Commands enforce mutability (e.g., save/add require mutable sources).

## Command Summary

| Command | Direction | Purpose | Mutable Source | Immutable Source |
|---------|-----------|---------|----------------|------------------|
| `new` | N/A | Create package manifest | N/A | N/A |
| `add` | Filesystem → Source | Add new files (source-only) | ✅ | ❌ Error |
| `remove` | Source → Deletion | Remove files from source (source-only) | ✅ | ❌ Error |
| `save` | Workspace → Source | Sync edits back (requires install) | ✅ | ❌ Error |
| `set` | N/A | Update manifest metadata | ✅ | ❌ Error |
| `pack` | Source → Registry | Create immutable snapshot | ✅ | N/A |
| `apply` | Source/Registry → Workspace | Sync content to platforms + update index | ✅ | ✅ |
| `install` | Registry → Workspace | Install version (git/path too) + update index | N/A | ✅ |
| `show` | N/A | Display package details (read-only) | ✅ | ✅ |
| `status` | N/A | Report sync state | ✅ | ✅ |
| `uninstall` | Workspace | Remove package files/mappings | ✅ | ✅ |
| `push` | Local → Remote | Upload (deferred details) | N/A | N/A |

Other: `list`, `login`/`logout` in subdocs or future.

## Detailed Semantics

### `save`

Sync workspace changes to mutable source via index mappings.

- Preconditions: Mutable source; fails on registry.
- Flow: Read index → Collect/resolve conflicts (mtime, platforms) → Write to source.
- Versioning: Computes WIP prerelease; copies full to registry for persistence.
- Example: `opkg save my-pkg` (or `opkg save <path>` for add-like).
- See [Save](save/) and [Save Versioning](save/save-versioning.md).

### `add`

Add new files from anywhere to mutable source (workspace or global packages).

- Preconditions: Mutable package source (workspace or global); **does not require installation**.
- Flow: Resolve mutable source → Collect input → Map (platform→universal, root→root, other→root/<rel>) → Copy to source.
- **No index updates**: `add` only modifies package source. To sync to workspace, use `install` + `apply` or `--apply` flag.
- Options: `--apply` (sync to workspace immediately; requires package to be installed in current workspace).
- Example: 
  - `opkg add my-pkg ./new-files/` (source-only)
  - `opkg add my-pkg ./file.md --apply` (source + workspace sync)
- Works from any directory with any mutable package.
- See [Add](add/).

### `remove`

Remove files from mutable source.

- Preconditions: Mutable source; fails on registry.
- Flow: Resolve source → Collect files → Confirm → Delete → Clean up empty dirs.
- **No index updates**: `remove` only modifies package source. To sync deletions to workspace, use `apply` or `--apply` flag.
- Options: `--apply` (sync to workspace immediately; requires package to be installed in current workspace), `--force` (skip confirmation), `--dry-run` (preview).
- Example:
  - `opkg remove my-pkg commands/deprecated.md` (source-only)
  - `opkg remove my-pkg rules/old/ --apply` (source + workspace sync)
  - `opkg remove my-pkg commands/ --dry-run` (preview)
- Works from any directory with any mutable package.
- Opposite of `add` command.
- See [Remove](remove/).

### `set`

Update manifest metadata fields in openpackage.yml for mutable packages.

- Preconditions: Mutable source; fails on registry.
- Flow: Resolve package → Load manifest → Collect updates (interactive or flags) → Validate → Apply → Write.
- Modes: Interactive (prompts for fields), Batch (via CLI flags), Non-interactive (CI/CD).
- Fields: `--ver` (version), `--name`, `--description`, `--keywords`, `--author`, `--license`, `--homepage`, `--private`.
- Options: `--force` (skip confirmation), `--non-interactive` (require flags).
- Example: 
  - `opkg set my-pkg --ver 1.2.0` (update version)
  - `opkg set my-pkg` (interactive mode)
  - `opkg set --ver 2.0.0 --description "Updated"` (CWD package)
- See [Set](set/).

### `pack`

Archive mutable source to registry snapshot.

- Flow: Read source → Version from yml/compute → Copy dir to registry/<name>/<ver>/.
- Options: `--output <path>` (bypass registry), `--dry-run`.
- Ties to save: Promotes stable from WIP line.
- Example: `opkg pack my-pkg`.
- See [Pack](pack/).

### `apply`

Sync from source/registry to workspace platforms/root.

- Flow: Resolve path → Map files → Write/update → Update index.
- Handles universal/platform variants, conflicts.
- Example: `opkg apply my-pkg`.
- See [Apply](apply/).

### `install`

Resolve/install from registry/git/path to workspace.

- Flow: Resolve ver/source → Apply files → Update yml (constraint) / index (path/ver/mappings).
- Partial via `files:` supported.
- **Claude Code plugin support**: Automatically detects and transforms plugins from git sources (individual plugins or marketplaces with interactive selection).
- Subdirectory support: `git:url#ref&subdirectory=path` for monorepos and plugin marketplaces.
- Example: 
  - `opkg install community-pkg@^1.0.0` (registry)
  - `opkg install github:anthropics/claude-code#subdirectory=plugins/commit-commands` (plugin)
  - `opkg install github:anthropics/claude-code` (marketplace with interactive selection)
- See [Install](install/).

### `status`

Check package states.

- Flow: Read index → Validate paths → Hash compare source vs. workspace → Report (synced/modified/missing).
- Example: `opkg status` (✅/⚠️/❌ output).
- See [Status](status/).

### `uninstall`

Remove package from workspace.

- Flow: Read index → Delete mapped files (not source) → Remove sections from root files → Update index/yml.
- Example: `opkg uninstall my-pkg`.
- See [Uninstall](uninstall/).

### `show`

Display detailed package information (read-only inspection).

- Purpose: Inspect packages from any source without modification.
- Flow: Classify input → Resolve package location → Collect metadata/files → Display formatted output.
- Sources: Package names (unified resolution), paths, git URLs, tarballs.
- Resolution Priority: CWD → Workspace → Global → Registry (same as `pack`).
- Options: None currently (future: `--remote`, `--json`, `--tree`).
- Example: 
  - `opkg show my-pkg` (by name)
  - `opkg show .openpackage/packages/shared-utils` (by path)
  - `opkg show git:https://github.com/user/repo.git#main` (from git)
- Output: Name, version, source, type, description, dependencies, file list.
- See [Show](show/).

### `new`

Create a new package with manifest.

- Flow: Prompt for scope (if interactive) → Validate scope/name → Resolve target path → Create directory → Write openpackage.yml → Optional workspace integration.
- Scopes: `root` (cwd), `local` (workspace), `global` (cross-workspace).
- Scope Selection: Interactive prompt when `--scope` not provided; required in non-interactive mode.
- Options: `--scope`, `--force`, `--non-interactive`.
- Example: `opkg new my-pkg` (prompts for scope), `opkg new utils --scope global` (explicit global).
- See [New](new/).

## Mutability Matrix (Expanded)

| Command | Mutable Source | Immutable Source | Creates Files In |
|---------|----------------|------------------|------------------|
| `new` | N/A | N/A | Package location (scope-dependent) |
| `save` | ✅ Syncs to source | ❌ Error | Source path |
| `add` | ✅ Adds to source | ❌ Error | Source path |
| `remove` | ✅ Removes from source | ❌ Error | N/A (deletes) |
| `set` | ✅ Updates manifest | ❌ Error | Source path |
| `pack` | ✅ Creates version | N/A | Registry |
| `apply` | ✅ Syncs to workspace | ✅ Syncs to workspace | Workspace |
| `install` | N/A | ✅ Syncs to workspace | Workspace |
| `show` | ✅ Displays info | ✅ Displays info | N/A (read-only) |
| `status` | ✅ Shows status | ✅ Shows status | N/A |
| `uninstall` | ✅ Removes | ✅ Removes | N/A (deletes) |

See table above for summary; full ops rules in [Package Sources](package-sources.md).

For CLI options common to commands, see [CLI Options](cli-options.md). Future commands (e.g., elevate) in [Scope Management](scope-management.md).
