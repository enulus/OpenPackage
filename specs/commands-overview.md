# Commands Overview

This file provides high-level semantics for core commands in the path-based model. Detailed behaviors in subdirs (e.g., [Install](install/)). Commands enforce mutability (e.g., add/remove require mutable sources).

## Command Summary

| Command | Direction | Purpose | Mutable Source | Immutable Source |
|---------|-----------|---------|----------------|------------------|
| `new` | N/A | Create package manifest | N/A | N/A |
| `add` | Filesystem → Source | Add new files (source-only, path-only for workspace root) | ✅ | ❌ Error |
| `remove` | Source → Deletion | Remove files from source (source-only, path-only for workspace root) | ✅ | ❌ Error |
| `save` | Workspace → Source | Save workspace edits back to source (hash-based sync) | ✅ | ❌ Error |
| `set` | N/A | Update manifest metadata | ✅ | ❌ Error |
| `install` | Registry → Workspace | Install version (git/path too) + update index | N/A | ✅ |
| `list` | N/A | Report sync state | ✅ | ✅ |
| `uninstall` | Workspace | Remove package files/mappings | ✅ | ✅ |
| `publish` | Source → Registry | Publish to local or remote registry | ✅ | N/A |
| `configure` | N/A | Configure settings | N/A | N/A |

Other: `login`/`logout` in subdocs or future.

## Detailed Semantics

### `add`

Add new files from anywhere to mutable source (workspace or global packages).

- Preconditions: Mutable package source (workspace or global); **does not require installation**.
- Flow: Resolve mutable source → Collect input → Map (platform→universal, root→root, other→root/<rel>) → Copy to source.
- **No index updates**: `add` only modifies package source. To sync to workspace, use `install`.
- Example: 
  - `opkg add ./new-files/ --to my-pkg` (source-only)
  - `opkg add ./file.md --to my-pkg` (adds to source)
  - `opkg install my-pkg` (to sync to workspace)
- Works from any directory with any mutable package.
- See [Add](add/).

### `remove`

Remove files from mutable source or workspace root.

- Preconditions: Mutable source or workspace root; fails on registry.
- Flow: Resolve arguments → Resolve source → Collect files → Confirm → Delete → Clean up empty dirs.
- **Argument modes**: 
  - With option: `opkg remove <path> --from <pkg>` (named package)
  - Path only: `opkg remove <path>` (workspace root)
- **No index updates**: `remove` only modifies package source. To sync deletions to workspace, use `install`.
- Options: `--force` (skip confirmation), `--dry-run` (preview).
- Example:
  - `opkg remove commands/deprecated.md` (workspace root, path-only)
  - `opkg remove commands/deprecated.md --from my-pkg` (named package, source-only)
  - `opkg remove rules/old/ --from my-pkg` (removes from source)
  - `opkg remove commands/ --dry-run` (preview workspace root)
  - `opkg install my-pkg` (to sync deletions to workspace)
- Works from any directory with any mutable package.
- Opposite of `add` command.
- See [Remove](remove/).

### `save`

Save workspace edits back to mutable package source.

- Preconditions: Package installed in workspace; mutable source; has file mappings.
- Flow: Read index → Compare hashes → Copy changed files → Report.
- **Hash-based detection**: Only copies files where workspace content differs from source.
- **Simple overwrite**: No conflict resolution - workspace wins.
- **Minimal MVP**: ~230 LOC total (vs 5,000+ in previous implementation).
- Example:
  - `opkg save my-pkg` (save all changed files)
  - Skips files with matching hashes
  - Creates new files in source if needed
  - Suggests running `opkg install my-pkg` to re-sync workspace
- Bidirectional workflow: `install` goes forward, `save` goes backward.
- See [Save](save/).

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

### `list`

Check package states.

- Flow: Read index → Validate paths → Hash compare source vs. workspace → Report (synced/modified/missing).
- Example: `opkg list` (✅/⚠️/❌ output).
- See [List](list/).

### `uninstall`

Remove package from workspace.

- Flow: Read index → Delete mapped files (not source) → Remove sections from root files → Update index/yml.
- **Global mode**: `-g, --global` uninstalls from home directory (`~/`) instead of current workspace.
- Example: 
  - `opkg uninstall my-pkg` (workspace)
  - `opkg uninstall -g shared-rules` (global)
- See [Uninstall](uninstall/).

### `publish`

Publish package to local registry (default) or remote registry (with `--remote` flag).

- Flow: 
  - **Local**: Resolve package source → Validate version → Copy to local registry or custom output → Update workspace index.
  - **Remote**: Resolve package source → Validate version → Authenticate → Collect files → Create tarball → Upload to remote.
- **Package Input**: 
  - No argument: Uses CWD
  - Package name: Resolves from CWD → Workspace → Global
  - Directory path: Uses specified path
- **Local publishing** (default):
  - Destination: `~/.openpackage/registry/<name>/<version>/` or custom path via `--output`
  - No authentication required
  - Allows prerelease versions (with warning)
- **Remote publishing** (`--remote`):
  - Destination: Remote OpenPackage backend
  - Authentication: Required via `--profile` or `--api-key`
  - Scoping: Auto-adds username scope to unscoped packages
  - Version: Must be stable semver (no prereleases)
- Options: `--force`, `--output <path>` (local only), `--remote`, `--profile`, `--api-key`.
- Example:
  - `opkg publish` (publish CWD to local registry)
  - `opkg publish my-pkg` (publish by name)
  - `opkg publish ./path/to/package` (publish by path)
  - `opkg publish --output ./dist` (custom output)
  - `opkg publish --remote` (publish to remote)
  - `opkg publish my-pkg --remote --profile prod` (remote with profile)
- **Replaces**: `pack` command (deprecated and removed)
- See [Publish](publish/).

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
| `add` | ✅ Adds to source | ❌ Error | Source path |
| `remove` | ✅ Removes from source | ❌ Error | N/A (deletes) |
| `set` | ✅ Updates manifest | ❌ Error | Source path |
| `install` | N/A | ✅ Syncs to workspace | Workspace |
| `list` | ✅ Shows status | ✅ Shows status | N/A |
| `uninstall` | ✅ Removes | ✅ Removes | N/A (deletes) |
| `publish` | ✅ Creates snapshot (local) or uploads (remote) | N/A | Local/remote registry |
| `configure` | ✅ Updates config | ✅ Updates config | Config files |

See table above for summary; full ops rules in [Package Sources](package-sources.md).

For CLI options common to commands, see [CLI Options](cli-options.md). Future commands (e.g., elevate) in [Scope Management](scope-management.md).
