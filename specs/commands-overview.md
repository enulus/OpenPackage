# Commands Overview

This file provides high-level semantics for core commands in the path-based model. Detailed behaviors in subdirs (e.g., [Save](save/), [Install](install/)). Commands enforce mutability (e.g., save/add require mutable sources).

## Command Summary

| Command | Direction | Purpose | Mutable Source | Immutable Source |
|---------|-----------|---------|----------------|------------------|
| `new` | N/A | Create package manifest | N/A | N/A |
| `add` | Filesystem → Source | Add new files (source-only, path-only for workspace root) | ✅ | ❌ Error |
| `remove` | Source → Deletion | Remove files from source (source-only, path-only for workspace root) | ✅ | ❌ Error |
| `save` | Workspace → Source | Sync edits back (requires install) | ✅ | ❌ Error |
| `set` | N/A | Update manifest metadata | ✅ | ❌ Error |
| `apply` | Source/Registry → Workspace | Sync content to platforms + update index | ✅ | ✅ |
| `install` | Registry → Workspace | Install version (git/path too) + update index | N/A | ✅ |
| `status` | N/A | Report sync state | ✅ | ✅ |
| `uninstall` | Workspace | Remove package files/mappings | ✅ | ✅ |
| `configure` | N/A | Configure settings | N/A | N/A |

Other: `login`/`logout` in subdocs or future.

## Detailed Semantics

### `save`

Sync workspace changes to mutable source via index mappings.

- Preconditions: Mutable source; fails on registry.
- Flow: Read index → Collect/resolve conflicts (mtime, platforms) → Write to source.
- Versioning: Computes WIP prerelease.
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

Remove files from mutable source or workspace root.

- Preconditions: Mutable source or workspace root; fails on registry.
- Flow: Resolve arguments → Resolve source → Collect files → Confirm → Delete → Clean up empty dirs.
- **Argument modes**: 
  - Two-arg: `opkg remove <pkg> <path>` (named package)
  - One-arg: `opkg remove <path>` (workspace root)
- **No index updates**: `remove` only modifies package source. To sync deletions to workspace, use `apply` or `--apply` flag.
- Options: `--apply` (sync to workspace immediately; requires package to be installed in current workspace), `--force` (skip confirmation), `--dry-run` (preview).
- Example:
  - `opkg remove commands/deprecated.md` (workspace root, path-only)
  - `opkg remove my-pkg commands/deprecated.md` (named package, source-only)
  - `opkg remove my-pkg rules/old/ --apply` (source + workspace sync)
  - `opkg remove commands/ --dry-run` (preview workspace root)
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
- **Global mode**: `-g, --global` installs to home directory (`~/`) instead of current workspace.
- Example: 
  - `opkg install community-pkg@^1.0.0` (registry)
  - `opkg install -g shared-rules` (global install)
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
- **Global mode**: `-g, --global` uninstalls from home directory (`~/`) instead of current workspace.
- Example: 
  - `opkg uninstall my-pkg` (workspace)
  - `opkg uninstall -g shared-rules` (global)
- See [Uninstall](uninstall/).

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
| `apply` | ✅ Syncs to workspace | ✅ Syncs to workspace | Workspace |
| `install` | N/A | ✅ Syncs to workspace | Workspace |
| `status` | ✅ Shows status | ✅ Shows status | N/A |
| `uninstall` | ✅ Removes | ✅ Removes | N/A (deletes) |
| `configure` | ✅ Updates config | ✅ Updates config | Config files |

See table above for summary; full ops rules in [Package Sources](package-sources.md).

For CLI options common to commands, see [CLI Options](cli-options.md). Future commands (e.g., elevate) in [Scope Management](scope-management.md).
