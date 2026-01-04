### `opkg install` – Behavior & UX

This document defines the **user-facing behavior** of the `install` command, assuming:

- Versioning semantics from `save` / `pack` specs are already in place.
- `openpackage.yml` is the **canonical declaration of direct dependencies** (see `package-yml-canonical.md`).
- Version selection obeys **“latest in range”**, with **local-first defaults for fresh installs without an explicit version** and **automatic fallback to remote when local cannot satisfy** (see `version-resolution.md`).

---

## 0. Workspace Context
The `install` command operates on the **workspace root** determined by the effective current working directory (`cwd` from shell or overridden by global `--cwd <dir>` flag; see [../../cli-options.md]). This affects:
- Detection of `openpackage.yml` (must exist at effective cwd for root package ops).
- Target location for file installations:
  - **Universal content**: platform-mapped from package subdirs (e.g., `commands/`, `rules/`) to platform-specific locations (e.g., `.cursor/commands/`, `.opencode/commands/`).
  - **Root files**: installed at workspace root (e.g., `AGENTS.md`).
  - **`root/` directory (direct copy)**: copied 1:1 to workspace root with `root/` prefix stripped.
- Dependency resolution from workspace `openpackage.yml`.
- **Package source discovery**: Searches workspace-local and global packages directories before falling back to registry.

If no package detected at effective cwd, errors with "No package project found" (unless dry-run or flags allow).

## 0.1 Package Source Resolution for Name-Based Install

When `opkg install <name>` is invoked (no path, git, or tarball syntax), the system searches for packages in this priority order:

### 1. Check Existing Dependency in openpackage.yml (Highest Priority)

If `<name>` exists in `openpackage.yml`:
- **With `path:`**: Always use the declared path source
- **With `git:`**: Always use the declared git source  
- **With `version:`**: Resolve from registry as normal

This ensures explicit declarations in the manifest are always respected.

### 2. Check Workspace-Local Packages (Override)

If `./.openpackage/packages/<name>/` exists and is a valid package:
- **Always use it** - no version comparison
- This is an explicit local override (you're working on this project's fork)
- Skip all other checks

**User Feedback**:
```
✓ Found <name> in workspace packages
💡 Workspace packages always override global/registry
```

### 3. Compare Global Packages vs Registry (Version-Aware)

If both `~/.openpackage/packages/<name>/` and `~/.openpackage/registry/<name>/<version>/` exist:

**Version Comparison**:
- Read `version` from global packages `openpackage.yml`
- Find latest version in registry
- **Select source with higher semver version**
- **Tie-breaker**: If versions equal, prefer global packages (mutable, development-friendly)

**Rationale**: Global packages are for convenience/sharing. Users expect to get the latest version automatically. Unlike workspace packages (explicit override), global packages should track the latest available version to avoid outdated dependencies.

**User Feedback** (comparison case):
```
Resolving <name>...
  • Global packages: 0.2.0 (mutable)
  • Registry: 0.5.0 (stable)
✓ Using <name>@0.5.0 from registry (newer version)
⚠️  Global packages has older version (0.2.0)
💡 To update global: cd ~/.openpackage/packages/<name> && opkg pack
```

**User Feedback** (tie-breaker):
```
Resolving <name>...
  • Global packages: 0.5.0 (mutable)
  • Registry: 0.5.0 (stable)
✓ Using <name>@0.5.0 from global packages (same version, prefer mutable)
```

### 4. Single Source Fallback

If only global packages OR registry exists (not both):
- Use the available source
- No version comparison needed

**User Feedback**:
```
✓ Found <name> in global packages
```

### 5. Remote Resolution

If no local sources exist:
- Fall back to normal registry resolution (local + remote)
- Follow version-resolution.md semantics

### Forcing Specific Sources

To bypass version comparison and force a specific source:

**Force global packages**:
```bash
opkg install ~/.openpackage/packages/<name>/
```

**Force registry version**:
```bash
opkg install <name>@0.2.0  # Explicit version
```

**Lock in openpackage.yml**:
```yaml
packages:
  - name: <name>
    path: ~/.openpackage/packages/<name>/  # Explicit path = no version check
```

### Summary Table

| Scenario | Behavior | Reason |
|----------|----------|--------|
| In openpackage.yml with path/git | Use declared source | Explicit declaration |
| Workspace pkg exists | Use workspace (no comparison) | Explicit override |
| Global newer than registry | Use global | Higher version |
| Registry newer than global | Use registry | Higher version |
| Same version | Use global | Prefer mutable |
| Only global exists | Use global | Single source |
| Only registry exists | Use registry | Single source |
| Neither exists locally | Remote resolution | Normal flow |

## 1. Command shapes

- **`opkg install`**
  - **Meaning**: Materialize *all* dependencies declared in `openpackage.yml` into the workspace, at the **latest versions that satisfy their declared ranges**, using the **default local-first with remote-fallback policy** over local and remote registries (see §2 and `version-resolution.md`).

- **`opkg install <name>`**
  - **Meaning**:
    - If `<name>` is **already declared** in `openpackage.yml`: ensure it is installed at the **latest version that satisfies the `openpackage.yml` range**, using the same **local-first with remote-fallback** resolver behavior.
    - If `<name>` is **not declared**: perform a **fresh install**, resolve the target version using the **local-first with remote-fallback** policy (see §3 and `version-resolution.md`), then add a new entry to `openpackage.yml` (see §3).

- **`opkg install <name>@<spec>`**
  - **Meaning**:
    - If `<name>` is **already declared** in `openpackage.yml`: `<spec>` is treated as a **constraint hint** that must be **compatible** with the canonical `openpackage.yml` range (see `package-yml-canonical.md` for rules); resolution still uses the same **local-first with remote-fallback** semantics unless `--local` or `--remote` are set.
    - If `<name>` is **not declared**: `<spec>` is treated as the **initial version range** to store in `openpackage.yml`, and resolution uses the **local-first with remote-fallback** policy under that range (or strictly local / remote when the corresponding flags are set).

- **`opkg install <name>/<registry-path>`** and **`opkg install <name>@<spec>/<registry-path>`**
  - **Meaning**: Install only the specified registry-relative path(s) for `<name>` (e.g. `commands/foo.md`, `agents/helper.md`). The path must be an **exact registry path** (no globs) and applies only to the **root dependency** being installed.

- **`opkg install git:<url>[#ref]`**
  - **Meaning**: Install a package directly from a git repository by cloning it and installing from the checked-out working tree.
  - Requirements:
    - The repository root MUST contain `openpackage.yml`.
    - `git` must be available on PATH.
  - Notes:
    - The installed package version is taken from the repo’s `openpackage.yml`.
    - `install` persists this dependency to `openpackage.yml` using `git` + optional `ref` (not a registry `version` range).

- **`opkg install github:<owner>/<repo>[#ref]`**
  - **Meaning**: Shorthand for GitHub git installs. Equivalent to:
    - `opkg install git:https://github.com/<owner>/<repo>.git[#ref]`

Other flags (`--dev`, `--remote`, `--platforms`, `--dry-run`, conflicts) keep their existing semantics unless overridden below.

---

## 2. High-level goals

- **G1 – Single mental model**:
  - **“`openpackage.yml` declares intent, `install` materializes the newest versions that satisfy that intent.”**

- **G2 – Latest in range with local-first defaults**:
  - Whenever a version needs to be chosen for install, the system:
    - For **fresh dependencies** (e.g. `opkg install <name>` or `opkg install <name>@<spec>` where `<name>` is not yet in `openpackage.yml`), first tries to satisfy the effective range from the **local registry only**, then falls back to include **remote versions** when local cannot satisfy.
    - For **existing dependencies** (already declared in `openpackage.yml`, with or without CLI hints), follow the **same local-first with remote fallback policy** described in `version-resolution.md`, choosing the highest satisfying semver version (including pre-releases where allowed by policy).
  - This same resolver policy (or its `--local` / `--remote` variants) is used **uniformly** for:
    - The root install target.
    - All **transitive dependencies** discovered during resolution.
    - Any **dependency checks or validations** that need to resolve a target version.

- **G3 – Minimal UX surface**:
  - `install` doubles as both:
    - “Install what’s declared” (no args).
    - “Upgrade within range” (re-run with no args or with a name).
  - A separate `upgrade` command remains optional and can later be added for **range-bumping workflows** (e.g. changing `^1.2.3` → `^2.0.0`).

---

## 3. Fresh vs existing dependencies

### 3.1 Fresh dependency (`<name>` not in openpackage.yml)

- **Inputs**:
  - CLI: `opkg install <name>` or `opkg install <name>@<spec>`.
  - `--dev` determines whether the dep is added to `packages` or `dev-packages`.

- **Behavior**:
  - **Case A – `opkg install <name>` (no version spec)**:
    - Compute **available versions** from the **local registry only** for the first resolution attempt (no remote metadata is consulted initially).
    - Select the **latest semver version** from this local set that satisfies the internal wildcard range (`*`), including pre-releases when applicable. If the selected version is a pre-release, the CLI should state that explicitly.
    - If **no local versions exist** or **no local version satisfies the implicit range**:
      - In **default mode** (no `--local`), `install` MUST:
        - Attempt resolution again including **remote versions**, following the rules in `version-resolution.md` (local+remote union).
        - Only fail if **neither local nor remote** provide a satisfying version, or remote metadata is unavailable.
      - In **`--local` mode**, this remote fallback is **disabled** and the command fails with a clear “not available locally” style error that may suggest re-running without `--local` or using `save` / `pack`.
    - **Install `<name>@<selectedVersion>`**.
    - **Add to `openpackage.yml`**:
      - Default range is **caret based on the stable base** of the selected version (e.g. `^1.0.1` for `1.0.1-000fz8.a3k`), unless later overridden by a global policy.
      - When the selected version is **unversioned** (manifest omits `version`, represented internally as `0.0.0`), persist the entry **without a `version` field** in `packages` / `dev-packages` (do **not** write `0.0.0`).

  - **Case B – `opkg install <name>@<spec>`**:
    - Treat `<spec>` as the **initial canonical range**:
      - Parse `<spec>` using the same semantics as `version-ranges` (exact, caret, tilde, wildcard, comparison).
    - Resolve using the **local-first with remote fallback** policy for fresh dependencies (per `version-resolution.md`):
      - First, attempt to satisfy `<spec>` using only **local registry versions**.
      - If no satisfying local version exists:
        - In **default mode** (no `--local`), include **remote versions** and retry selection over the combined set, allowing a remote version to be selected when it is the only match.
        - In **`--local` mode**, do **not** fall back to remote; fail with a clear error indicating no local version satisfies `<spec>`.
    - **Install the selected version**.
    - **Persist `<spec>` in `openpackage.yml`** (do not auto-normalize beyond what the version-range parser requires).

### 3.2 Existing dependency (`<name>` already in openpackage.yml)

- **Inputs**:
  - Canonical range from `openpackage.yml` (see `package-yml-canonical.md`).
  - Optional CLI `<spec>` from `install <name>@<spec>`.

- **Behavior**:
  - **Path/Git Source Persistence**:
    - If the dependency entry in `openpackage.yml` has a `path:` or `git:` field, `opkg install <name>` **always uses that declared source**, regardless of whether a registry version exists.
    - This ensures that path-based and git-based dependencies remain consistent with their declared intent, supporting local development workflows and monorepo scenarios.
    - User feedback: `✓ Using path source from openpackage.yml: <path>` or `✓ Using git source from openpackage.yml: <url>#<ref>`
    - To switch from path/git to registry:
      - Edit `openpackage.yml`: remove `path:` or `git:` field, add `version:` field
      - Or: `opkg uninstall <name>` then `opkg install <name>@<version>`
  
  - **Registry-based dependencies** (have `version:` field, no `path:` or `git:`):
    - `opkg install <name>`:
      - Use the **canonical range from `openpackage.yml`**.
      - Resolve versions using the same **local-first with remote-fallback** policy (per `version-resolution.md`):
        - First attempt to satisfy the canonical range using **only local registry versions**.
        - Only when no satisfying local version exists, and remote is enabled and reachable, **include remote versions** and retry selection over the combined set.
      - **Install / upgrade to the latest satisfying version** (if newer than current).
    - `opkg install <name>@<spec>`:
      - Treat `<spec>` as a **sanity check** against the canonical range:
        - If compatible (according to rules in `package-yml-canonical.md`), proceed as above.
        - If incompatible, **fail with a clear error** instructing the user to edit `openpackage.yml` instead of using CLI-only overrides.

### 3.4 Registry-path / single-file installs

- **Inputs**:
  - `opkg install <name>/<registry-path>` (optionally with `@<spec>`).
  - `<registry-path>` is a registry-relative file path (no globs, exact match against registry entries).

- **Behavior – fresh dependency**:
  - Resolve the version using the same policies as §3.1 (respecting `<spec>` if provided).
  - Install only the specified registry path(s), including root files only when they are explicitly listed.
  - Persist a new `files: [<registry-path>, ...]` list for the dependency in `openpackage.yml` alongside the chosen range.
- If the requested path does not exist in the selected version, the install **warns and skips the package** (no files written, counts as `skipped`).

- **Behavior – existing dependency with `files` already in `openpackage.yml`**:
  - `opkg install <name>` (no new path):
    - Re-installs the stored subset.
    - In an interactive TTY and non-`--dry-run`, prompt: **switch to full install?** If accepted, clears the `files` list and performs a full install; otherwise keeps the subset.
    - In non-interactive or `--dry-run`, keep the stored subset automatically (no prompt).
  - `opkg install <name>/<registry-path>`:
    - Adds the new path to the stored `files` list (deduped), then installs that combined subset.

- **Behavior – existing dependency without `files` (full install)**:
  - Path-based install attempts are **rejected** with a clear error. To install a subset, uninstall first (or remove the dependency) and re-install with a path, or edit `openpackage.yml` manually to add `files`.

- **Switching back to full**:
  - Accept the prompt described above, or delete the `files` field for the dependency in `openpackage.yml` (or uninstall/reinstall without a path).

---

### 3.3 Selection summary UX (local vs remote)

- After resolving the root version for any `install` invocation (fresh or existing dependency), the CLI MUST print a one-line summary indicating **where the chosen version came from**:
  - If the selected version is backed by the **local registry**:
    - Print: `✓ Selected local @<name>@<version>`.
  - If the selected version is obtained from **remote metadata/registry**:
    - Print: `✓ Selected remote @<name>@<version>`.
- For **scoped packages** (e.g. `@hyericlee/nextjs`), this formatting naturally yields output like:
  - `✓ Selected local @@hyericlee/nextjs@0.3.1`
  - `✓ Selected remote @@hyericlee/nextjs@0.3.1`
- This summary line complements any additional logging and should appear **once per top-level install invocation**, clearly tying the resolution decision to its source (local vs remote).

---

## 4. `opkg install` (no args) – “refresh workspace to intent”

- **Inputs**:
  - `openpackage.yml`:
    - `packages[]` and `dev-packages[]`, each with `name` and exactly one source:
      - `version` (registry range or exact)
      - `path` (directory or tarball)
      - `git` (git URL) with optional `ref`

- **Behavior**:
  - For each declared dependency:
    - If it is a registry dependency (`version`):
      - Determine its **effective range** (canonical, possibly reconciled with any global overrides).
      - Resolve **latest satisfying version from local+remote**.
    - If it is a path dependency (`path`) or git dependency (`git` + optional `ref`):
      - Load directly from that source (no registry version resolution).
    - If that version is **already installed**, **do nothing** (idempotent).
    - If a **newer satisfying version exists**, **upgrade** the installed version to that one.
  - This makes `opkg install` act as:
    - **“Hydrate my workspace to match `openpackage.yml`”** on first run.
    - **“Upgrade within my declared ranges”** on subsequent runs.

---

## 5. Remote interaction modes

### 5.1 Default mode (no `--remote`)

- When resolving versions (for both the root target and **all recursive dependencies**):
  - Resolution obeys the **local-first with remote fallback** policy from `version-resolution.md`:
    - First, attempt to satisfy the effective constraint using **only local registry versions**.
    - If no satisfying local version exists and remote is **reachable**:
      - Fetch remote metadata, compute the **union of local+remote versions**, and retry selection over this combined set.
      - If the chosen version does not yet exist locally, it will be **pulled from remote** (subject to existing remote-flow prompts and dry-run behavior).
    - If remote is **unreachable or misconfigured**:
      - The resolver remains effectively **local-only** and fails when no satisfying local version exists, emitting a clear warning or error that remote lookup failed.

### 5.2 `--remote` flag

- `opkg install --remote` or `opkg install <name> --remote`:
  - **Forces remote-primary behavior**:
    - Resolution *may* still consider local versions, but:
      - Remote metadata is treated as authoritative for **available versions**.
      - Selected versions are **guaranteed to exist remotely**; local-only versions are ignored for selection.
  - Intended for:
    - Ensuring compatibility with what is actually **published** remotely.
    - CI / reproducibility scenarios where local registry state should not affect choices.

---

## 6. Workspace Index and Key Tracking

### 6.1 Workspace Index Updates

`opkg install` updates the workspace index (`openpackage.index.yml`) to reflect installed files:

- **Simple file mappings**: Direct string paths for files owned by one package
  ```yaml
  files:
    commands/test.md:
      - .cursor/commands/test.md
  ```

- **Complex mappings with key tracking**: Object format for merged files
  ```yaml
  files:
    mcp.jsonc:
      - target: .opencode/opencode.json
        merge: deep
        keys:
          - mcp.server1
          - mcp.server2
  ```

### 6.2 Key Tracking for Flow-Based Merges

When packages use platform flows with merge strategies (`deep` or `shallow`), the install system automatically tracks which keys each package contributes to merged files.

**Purpose:** Enables precise removal during uninstall without affecting other packages' content.

**When keys are tracked:**
- ✅ Flow uses `merge: 'deep'` or `merge: 'shallow'`
- ✅ Target file will be shared by multiple packages

**When keys are NOT tracked:**
- ❌ `merge: 'replace'` - entire file owned by one package
- ❌ `merge: 'composite'` - delimiter-based tracking used
- ❌ Simple file copy - no merge involved

**Example flow with key transformation:**

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".opencode/opencode.json",
  "map": {
    "mcpServers.*": "mcp.*"  // Transform keys
  },
  "merge": "deep"
}
```

**Package source:**
```json
{
  "mcpServers": {
    "server1": { "url": "http://localhost:3000" }
  }
}
```

**Workspace index after install:**
```yaml
packages:
  my-mcp-package:
    files:
      mcp.jsonc:
        - target: .opencode/opencode.json
          merge: deep
          keys:
            - mcp.server1  # Transformed key tracked
```

**Key features:**
- Tracks **output** keys (after transformations), not input keys
- Uses dot notation for nested paths: `mcp.server1` → `{ mcp: { server1: {...} } }`
- Enables clean uninstall without reverse-applying transformations

See [Platforms → Flows](../platforms/flows.md#key-tracking-for-uninstall) for complete details on key tracking behavior.

## 7. Pre-release vs stable on install

High-level rules (details in `version-resolution.md`):

- **Latest-in-range, including pre-releases**:
  - For any non-exact constraint (wildcard or range), the resolver chooses the **highest semver version** that satisfies the range, including pre-releases when allowed by semver range rules.
  - When a pre-release is selected, `opkg install` output should clearly indicate that the installed version is a pre-release.

---

## 8. Pre-release content resolution (unified with stable)

This section ties pre-release version selection to **how content is loaded** when the selected version is a pre-release, assuming both stable and pre-release versions are stored as full copies in the local registry.

- **Registry layout for pre-releases**:
  - The local registry contains a **full copy** of the package for any version (stable or pre-release):
    - Path: `~/.openpackage/registry/<pkg>/<version>/...`.

- **Install behavior when a pre-release is selected**:
  - When the version resolution layer selects a **pre-release version** that exists locally:
    - The package loader (e.g. `packageManager.loadPackage`) MUST:
      - Load files directly from the selected registry directory (`~/.openpackage/registry/<pkg>/<version>/...`).
      - Read the `openpackage.yml` from that directory for metadata.
      - Treat this data exactly as it would for a stable registry copy for the purposes of installation and dependency resolution.
  - If the registry directory is missing or malformed for a selected version:
    - Install MUST **fail clearly**, indicating the broken registry copy and suggesting:
      - Re-running `opkg pack` (or re-pulling from remote) to regenerate the version, or
      - Using a different available version instead.

- **Remote considerations**:
  - Both pre-release and stable versions exposed by remote registries are treated as **normal copied packages**.

---

## 9. Claude Code plugin support

OpenPackage supports installing **Claude Code plugins** directly from git repositories and local paths. Plugin detection and transformation happens automatically during the install flow.

### 9.1 Plugin detection

After cloning a git repository or resolving a local path, the install pipeline checks for Claude Code plugin manifests:

- **Individual plugin**: `.claude-plugin/plugin.json` at the package root
- **Plugin marketplace**: `.claude-plugin/marketplace.json` at the package root

If either manifest is found, special plugin handling is triggered instead of treating the source as a standard OpenPackage.

### 9.2 Individual plugin install flow

When an individual plugin is detected:

1. **Read and validate** `.claude-plugin/plugin.json`
   - Required fields: `name`, `version`
   - Optional fields: `description`, `author`, `repository`, `license`, `keywords`

2. **Transform to OpenPackage format (in-memory only)**
   - Plugin metadata is converted to OpenPackage `PackageYml` structure
   - No registry copy is created (git/path remains source of truth)

3. **Collect plugin files**
   - All files except `.claude-plugin/` directory are collected
   - Original directory structure is preserved (commands/, agents/, skills/, hooks/, etc.)
   - Junk files (`.DS_Store`, `.git/`, etc.) are filtered out

4. **Install via platform mapping**
   - Plugin files are installed using the standard platform mapping system
   - Universal subdirs map to platform-specific directories:
     - `commands/` → `.claude/commands/`, `.cursor/commands/`, etc.
     - `agents/` → `.claude/agents/`, `.cursor/agents/`, etc.
     - `skills/` → `.claude/skills/`, `.cursor/skills/`, etc.
     - `hooks/` → `.claude/hooks/`, `.cursor/hooks/`, etc.
   - Root files (`.mcp.json`, `.lsp.json`) install to platform roots

5. **Track as git dependency**
   - Persisted in `openpackage.yml` with git source:
     ```yaml
     packages:
       - name: commit-commands
         git: https://github.com/anthropics/claude-code.git
         subdirectory: plugins/commit-commands  # If from subdirectory
     ```

**Example:**
```bash
# Install individual plugin from subdirectory
opkg install github:anthropics/claude-code#subdirectory=plugins/commit-commands

# Install plugin from dedicated repo
opkg install github:user/my-claude-plugin
```

### 9.3 Marketplace install flow

When a plugin marketplace is detected:

1. **Parse marketplace manifest** (`.claude-plugin/marketplace.json`)
   - Required fields: `name`, `plugins[]`
   - Each plugin entry must have: `name`, `subdirectory` (or `source`)

2. **Display interactive selection prompt**
   - Lists all available plugins with descriptions
   - User selects plugin(s) via multiselect (space to toggle, enter to confirm)
   - Canceling (no selection) exits without installing

3. **Install each selected plugin**
   - For each selected plugin:
     - Resolve plugin subdirectory within the cloned/resolved marketplace directory
     - Validate subdirectory contains `.claude-plugin/plugin.json`
     - Install following individual plugin flow (§8.2)
     - Each plugin gets its own entry in `openpackage.yml`

4. **Display installation summary**
   - Shows which plugins succeeded/failed
   - Reports errors for any plugins that failed validation or install

**Example:**
```bash
# Install from marketplace (prompts for selection)
opkg install github:anthropics/claude-code

📦 Marketplace: claude-code-plugins
   Example plugins demonstrating Claude Code plugin capabilities

3 plugins available:

❯ ◯ commit-commands
  ◯ pr-review-toolkit
  ◯ explanatory-output-style

Select plugins to install (space to select, enter to confirm):
```

Result in `openpackage.yml`:
```yaml
packages:
  - name: commit-commands
    git: https://github.com/anthropics/claude-code.git
    subdirectory: plugins/commit-commands
  - name: pr-review-toolkit
    git: https://github.com/anthropics/claude-code.git
    subdirectory: plugins/pr-review-toolkit
```

### 9.4 Path-based plugin install

Plugins can also be installed from local paths (useful for development/testing):

```bash
# Install from local plugin directory
opkg install ./my-plugin

# Install from local marketplace (prompts for selection)
opkg install ./my-marketplace
```

Path-based plugin dependencies are tracked in `openpackage.yml` with `path:` source:
```yaml
packages:
  - name: my-plugin
    path: ./my-plugin
```

**Notes:**
- Plugins are **not converted to registry packages** - git/path source remains authoritative
- Plugin manifest is validated but transformation is **in-memory only**
- Standard OpenPackage operations (`save`, `add`, `apply`) work on path-sourced plugins if the source is mutable
- See [Git Sources](git-sources.md) for complete git install behavior including subdirectory syntax

---

## 10. Compatibility and non-goals

- **Non-goal**: Emulate every nuance of npm’s `install` / `update` / `dedupe` behavior.
  - Instead, aim for a **small, orthogonal core**:
    - `openpackage.yml` declares intent.
    - `pack` publishes versioned snapshots; `install` materializes versions into the workspace.
    - `install` materializes **latest-in-range** from local+remote.

- **Compatibility goal**:
  - A user coming from npm should be able to reason as:
    - “`openpackage.yml` is like `package.json` dependencies.”
    - “`opkg install` is like `npm install`: it installs & upgrades within ranges.”
    - “To change which major I target, I edit the version in `openpackage.yml`, not the CLI.”


