# CLI Global Options

This document specifies behavior for global CLI flags available across all `opkg` / `openpackage` commands.

## `--cwd <dir>`

### Overview
The `--cwd` global option overrides the effective working directory for the entire command execution. It simulates running the CLI from `<dir>` instead of the shell's current directory, affecting:
- Path resolutions (relative files, globs).
- Package/workspace detection (e.g., `openpackage.yml` lookup at effective cwd).
- File operations (install/add/uninstall/status target the specified dir's context).
- Any code using `process.cwd()` (captured post-`--cwd` processing).

This enables monorepo workflows without `cd` (e.g., `opkg install --cwd ./packages/web some-dep` installs into `./packages/web` from root).

**Note**: The `--global` / `-g` flag (install and uninstall commands) **trumps** `--cwd`. If both are specified, `--cwd` is ignored and operations proceed in the home directory (`~/`).

### Behavior
1. **Parsing & Timing**: Commander parses it as global (usable before/after subcommand). Processed in `preAction` hook *before* subcommand action runs (after arg validation).
2. **Resolution**: Resolved to absolute via `path.resolve(originalProcessCwd, <dir>)` (relatives vs shell cwd, not target).
3. **Validation** (sync/async checks before chdir):
   - Exists (fs.stat throws ENOENT if not).
   - Is directory (fs.stat.isDirectory()).
   - Readable/writable (fs.access R_OK | W_OK; errors if perms insufficient for cmd).
   - Errors: Custom msg via console.error + log, `process.exit(1)` (e.g., "Invalid --cwd: must exist, be accessible, and writable").
4. **chdir**: Calls `process.chdir(resolved)` if valid; logs "Changed working directory to: <abs>".
5. **Effects**:
   - All relative paths (e.g., getPackageYmlPath, file discovery) resolve vs new cwd.
   - Package root = effective cwd (or --cwd dir).
   - Global state unaffected (e.g., `~/.openpackage/registry` via os.homedir()).
6. **Edge Cases**:
   - Relative: `--cwd ../sibling` → resolves vs original.
   - Invalid: Early exit, no action run.
   - No-op: Omitted → uses shell cwd.
   - Globals: Applies (harmless for login/logout; may affect utils like prompts for rel paths).
   - Subprocesses: Inherit new cwd (if spawned).
7. **Limitations**: Doesn't re-parse other args vs new cwd (resolved early). User scripts via exec may need own handling.

### Usage Patterns
- Monorepos: Target sub-packages without cd.
- Scripts: `opkg install --cwd $PROJ_DIR`.
- Validation fails prevent ops (safety).

Cross-refs: [install-behavior.md] (installs to effective cwd), [package-root-layout.md] (root = effective cwd).

---

## `-g, --global`

### Overview
The `--global` (or `-g`) flag changes the target directory for install and uninstall operations to the user's home directory (`~/`). This enables system-wide package installations that apply across all projects rather than being scoped to a single workspace.

**Available on:** `install`, `uninstall`

### Behavior
1. **Directory Change**: When `--global` is present, the CLI changes the working directory to `os.homedir()` before executing the command.
2. **Priority**: `--global` **trumps** `--cwd`. If both are provided, `--cwd` is ignored and operations proceed in `~/`.
3. **Manifest**: Creates/updates `~/openpackage.yml` for dependency tracking.
4. **Platform Files**: Installs to `~/.cursor/`, `~/.claude/`, `~/.opencode/`, etc.
5. **Root Files**: Copies to `~/` (with `root/` prefix stripped).

### Use Cases
- **System-wide configurations**: AI coding rules/commands that apply to all projects
- **Personal dotfiles**: Manage home directory configurations as packages
- **Shared settings**: Common preferences across multiple workspaces

### Examples

#### Install
```bash
# Install package globally
opkg install -g shared-rules
opkg install --global shared-rules

# With platforms specified
opkg install -g cursor-config --platforms cursor claude

# Global overrides --cwd
opkg install -g my-package --cwd ./some-dir  # Installs to ~/, not ./some-dir
```

#### Uninstall
```bash
# Uninstall global package
opkg uninstall -g shared-rules
opkg uninstall --global shared-rules
```

### Validation
- No special validation beyond standard directory checks (home directory should always exist and be writable)
- If home directory is inaccessible, command fails early with appropriate error

### Edge Cases
- Works with any source type (registry, git, path, tarball)
- Compatible with all other install/uninstall flags (`--platforms`, `--dry-run`, etc.)
- `--cwd` is explicitly ignored when `--global` is present

### Conditional Flows
The `--global` flag enables conditional installation behavior through the `$$targetRoot` context variable in platform flows:

**Platform Flow Example:**
```jsonc
{
  "from": ["mcp.jsonc", "mcp.json"],
  "to": ".mcp.json",
  "when": { "$ne": ["$$targetRoot", "~/"] }  // Install to .mcp.json when NOT global
},
{
  "from": ["mcp.jsonc", "mcp.json"],
  "to": ".claude.json",
  "when": { "$eq": ["$$targetRoot", "~/"] }  // Install to .claude.json when global
}
```

**How it works:**
- Normal install: `$$targetRoot` = workspace directory (e.g., `/Users/john/project`)
- Global install: `$$targetRoot` = home directory (e.g., `/Users/john`)
- Conditions use path-aware comparison with tilde expansion and glob support

**Result:**
- `opkg install plugin` → Files go to `.mcp.json` (workspace)
- `opkg install -g plugin` → Files go to `.claude.json` (global)

See [Flow Reference](./platforms/flow-reference.md) for details on `$$targetRoot` and conditional flows.

---

## Command Notes (selected)

This document primarily defines global flags, but some global-option-sensitive behavior is worth calling out:

- **`opkg install`**: installs packages to the effective working directory (or home directory when using `--global`).
- **`opkg add`**: adds files to mutable package sources. To sync changes to workspace, use `opkg install`.
- **`opkg remove`**: removes files from mutable package sources. To sync deletions to workspace, use `opkg install`.