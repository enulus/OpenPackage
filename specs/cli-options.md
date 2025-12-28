# CLI Global Options

This document specifies behavior for global CLI flags available across all `opkg` / `openpackage` commands.

## `--cwd <dir>`

### Overview
The `--cwd` global option overrides the effective working directory for the entire command execution. It simulates running the CLI from `<dir>` instead of the shell's current directory, affecting:
- Path resolutions (relative files, globs).
- Package/workspace detection (e.g., `openpackage.yml` lookup at effective cwd).
- File operations (install/save/push/pull target the specified dir's context).
- Any code using `process.cwd()` (captured post-`--cwd` processing).

This enables monorepo workflows without `cd` (e.g., `opkg install --cwd ./packages/web some-dep` installs into `./packages/web` from root).

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
   - Globals: Applies (harmless for login/list; may affect utils like prompts for rel paths).
   - Subprocesses: Inherit new cwd (if spawned).
7. **Limitations**: Doesn't re-parse other args vs new cwd (resolved early). User scripts via exec may need own handling.

### Usage Patterns
- Monorepos: Target sub-packages without cd.
- Scripts: `opkg save --cwd $PROJ_DIR`.
- Validation fails prevent ops (safety).

Cross-refs: [install-behavior.md] (installs to effective cwd), [save-modes-inputs.md] (saves from effective cwd), [package-root-layout.md] (root = effective cwd).

---

## Command Notes (selected)

This document primarily defines global flags, but some global-option-sensitive behavior is worth calling out:

- **`opkg save` / `opkg pack`**: write a snapshot to the local registry from the effective cwd. Platform apply/sync is **opt-in** via `opkg save --apply` or `opkg apply`.
- **`opkg apply`**: applies/syncs the current/root package to detected platforms from the effective cwd. Supports `--dry-run` and `--force`.