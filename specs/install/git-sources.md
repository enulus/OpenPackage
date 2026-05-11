### `opkg install` – Git Sources

This document specifies how `install` supports installing packages from **git repositories**, including **subdirectory support for Claude Code plugins and monorepos**.

---

## 1. Supported inputs

### 1.1 CLI inputs (New Syntax)

**Modern syntax (recommended):**

- **`opkg install gh@<owner>/<repo>[/path]`**
  - GitHub shorthand for installing from GitHub repositories.
  - Always uses the default branch.
  - `path` is optional and specifies a subdirectory within the repository.

- **`opkg install <github-url>`**
  - Direct GitHub URLs from browser (copy-paste friendly).
  - Supports repository URLs: `https://github.com/owner/repo`
  - Supports tree URLs with branch/tag: `https://github.com/owner/repo/tree/main`
  - Supports tree URLs with subdirectory: `https://github.com/owner/repo/tree/main/path`

- **`opkg install <git-url>[#ref][&path=<path>]`**
  - Generic git URLs with hash fragments for ref and path.
  - Supports any git host (GitLab, Bitbucket, self-hosted, etc.)
  - `ref` is optional and may be a branch, tag, or commit SHA.
  - `path` is optional and specifies a subdirectory within the repository.

**Legacy syntax (deprecated, still works with warnings):**

- **`opkg install github:<owner>/<repo>[#ref][&subdirectory=path]`** ⚠️ DEPRECATED
  - Shows warning: `The 'github:' prefix is deprecated. Use 'gh@user/repo' instead.`
  - Legacy GitHub shorthand, use `gh@` instead.

- **`opkg install git:<url>[#ref][&subdirectory=path]`** ⚠️ DEPRECATED
  - Shows warning: `The 'git:' prefix is deprecated. Use the URL directly.`
  - Legacy git prefix, use URL directly instead.

**Examples (Modern Syntax):**
```bash
# GitHub shorthand (uses default branch)
opkg install gh@anthropics/claude-code

# GitHub shorthand with subdirectory
opkg install gh@anthropics/claude-code/plugins/commit-commands

# GitHub web URL (copy from browser)
opkg install https://github.com/anthropics/claude-code

# GitHub web URL with branch
opkg install https://github.com/anthropics/claude-code/tree/main

# GitHub web URL with branch and subdirectory
opkg install https://github.com/anthropics/claude-code/tree/v1.0.0/plugins/commit-commands

# Generic git URL with ref
opkg install https://gitlab.com/user/repo.git#main

# SSH git URL (with optional ref and path)
opkg install ssh://git@gitlab.com/user/repo.git#main

# Generic git URL with ref and subdirectory
opkg install https://gitlab.com/user/repo.git#main&path=packages/plugin-a

# Generic git URL with subdirectory only
opkg install https://example.com/repo.git#path=src/plugin
```

**Examples (Legacy Syntax - Still Works):**
```bash
# Legacy GitHub shorthand (deprecated)
opkg install github:anthropics/claude-code
⚠️  The 'github:' prefix is deprecated. Use 'gh@user/repo' instead.

# Legacy git prefix (deprecated)
opkg install git:https://gitlab.com/user/repo.git
⚠️  The 'git:' prefix is deprecated. Use the URL directly.

# Legacy with subdirectory (both path= and subdirectory= work)
opkg install github:user/repo#main&subdirectory=plugins/x  # Still works
opkg install gh@user/repo                                   # Recommended
```

### 1.2 Path/subdirectory syntax

**Modern syntax** uses `path=` in hash fragments for generic git URLs:
- **With ref**: `#ref&path=<path>` (ref + path)
- **Without ref**: `#path=<path>` (path only)

**GitHub shorthand** embeds path directly in the syntax:
- Format: `gh@owner/repo/path/to/subdir`

**GitHub web URLs** extract path from the URL structure:
- Format: `https://github.com/owner/repo/tree/ref/path/to/subdir`

**Legacy syntax** uses `subdirectory=` (still supported, no warning):
- **With ref**: `#ref&subdirectory=path`
- **Without ref**: `#subdirectory=path`

**Note:** Both `path=` and `subdirectory=` work in hash fragments for backward compatibility. The system automatically normalizes to `path` internally.

---

## 2. openpackage.yml schema

Dependencies in `openpackage.yml` support git sources via:

**Current schema (as of Phase 2):**
```yaml
dependencies:
  # Basic git source (default branch)
  - name: somepkg
    url: https://example.com/org/repo.git

  # With specific ref (branch/tag/commit)
  - name: somepkg-versioned
    url: https://example.com/org/repo.git#v1.0.0

  # With subdirectory
  - name: plugin-package
    url: https://example.com/org/repo.git#main
    path: plugins/my-plugin
```

**Legacy schema (auto-migrated on read, never written):**
```yaml
dependencies:
  # Old format - automatically migrated
  - name: somepkg
    git: https://example.com/org/repo.git
    ref: main
    subdirectory: plugins/my-plugin  # Also migrated to 'path'
```

Rules:
- Each dependency entry MUST specify **exactly one** source field: `version`, `path`, or `url`.
- `path` specifies a subdirectory path within the repository when `url` is present.
- Git dependencies MUST NOT specify `version` (git dependencies are source-pinned, not semver-ranged).
- Legacy `git`, `ref`, and `subdirectory` fields are automatically migrated when reading old manifests.
- New manifests always use the `url` field format with optional embedded `#ref`.

---

## 3. Resolution and installation behavior

### 3.1 Basic git install

- `install` clones the repository to a **structured cache** at `~/.openpackage/cache/git/` using the system `git` executable.
- **Cache structure**: `~/.openpackage/cache/git/<url-hash-12>/<commit-sha-7>/`
  - `<url-hash-12>`: 12-character hash of normalized Git URL
  - `<commit-sha-7>`: First 7 characters of resolved commit SHA
- **Clone behavior**:
  - Uses shallow clones (`--depth 1`) for space efficiency.
  - Reuses existing cache if same commit is already cached.
  - Writes metadata files (`.opkg-repo.json`, `.opkg-commit.json`) for tracking.
- If `ref` is provided:
  - For branch/tag: clone the specified ref and resolve to commit SHA.
  - For commit SHA: clone and checkout that SHA (best-effort shallow fetch).
- Without subdirectory: The cloned repository root MUST contain `openpackage.yml`.
- The installed package version is read from the repo's `openpackage.yml`.
- The rest of the install flow matches path installs:
  - Dependencies are resolved recursively.
  - Content is installed to the workspace platforms.

### 3.2 Subdirectory installs

When `subdirectory` is specified:
- Repository is cloned to the structured cache (same as §3.1).
- The specified subdirectory path is resolved relative to the repository root.
- The subdirectory MUST contain either:
  - `openpackage.yml` (standard OpenPackage package), OR
  - `.claude-plugin/plugin.json` (Claude Code plugin), OR
  - `.claude-plugin/marketplace.json` (Claude Code plugin marketplace)
- For OpenPackage packages: `openpackage.yml` is read from the subdirectory.
- For Claude Code plugins: See §4 for special handling including scoped naming.

### 3.3 Cache persistence and management

The Git cache persists across sessions:
- **Location**: `~/.openpackage/cache/git/`
- **Benefits**: Faster reinstalls, survives reboots, debuggable with metadata
- **Structure**:
  ```
  ~/.openpackage/cache/git/
  ├── a1b2c3d4e5f6/              # URL hash
  │   ├── .opkg-repo.json        # Repo metadata (URL, last fetched)
  │   ├── abc1234/               # Commit SHA
  │   │   ├── .git/              # Shallow clone
  │   │   ├── .opkg-commit.json  # Commit metadata (ref, timestamp)
  │   │   └── <repo contents>
  │   └── def5678/               # Different commit
  └── x9y8z7w6v5u4/              # Different repo
  ```
- **Metadata tracking**:
  - `.opkg-repo.json`: Stores URL, normalized URL, last fetch timestamp
  - `.opkg-commit.json`: Stores full commit SHA, ref name, clone/access timestamps

---

## 4. Claude Code plugin support

**See also:** [Install Behavior §9](./install-behavior.md#9-claude-code-plugin-support) for complete plugin install flow with Universal Converter integration.

### 4.1 Plugin detection

When installing from a git source (with or without subdirectory), the system detects:

1. **Claude Code plugin manifests:**
   - **Individual plugins**: `.claude-plugin/plugin.json`
   - **Plugin marketplaces**: `.claude-plugin/marketplace.json`

2. **Package format** (via Universal Converter):
   - **Platform-specific**: Files in platform directories (`.claude/`, `.cursor/`, etc.)
   - **Universal**: Files in universal subdirectories (`commands/`, `agents/`, etc.)

Detection happens automatically after cloning, before attempting to load as an OpenPackage.

### 4.2 Individual plugin install

When an individual plugin is detected:
1. Plugin manifest (`.claude-plugin/plugin.json`) is read and validated.
2. **Plugin name is generated with scoping**:
   - **GitHub plugins (standalone)**: Use scoped format `gh@<username>/<repo>`
   - **GitHub plugins from subdirectory**: Use `gh@<username>/<repo>/<plugin-name>`
   - **Non-GitHub sources**: Use original plugin name (no scoping)
   - **Fallback behavior**: If `plugin.json` has no `name` field:
     - Use subdirectory basename if installing from subdirectory
     - Use repository name if installing full repo
     - Use "unnamed-plugin" as last resort
3. Plugin metadata is transformed to OpenPackage format in-memory:
   - Scoped `name` becomes package metadata
   - `version` from `plugin.json` becomes package version
   - `description`, `author`, `repository`, etc. are preserved
4. All plugin files are collected (commands/, agents/, skills/, hooks/, .mcp.json, .lsp.json, etc.)
5. **Package format is detected** and appropriate installation strategy selected:
   - **Direct AS-IS**: Source platform = target platform (fastest)
   - **Cross-platform conversion**: Source ≠ target (via Universal Converter)
   - **Standard flows**: Universal format packages
6. Files are installed to platform-specific directories:
   - `commands/` → `.claude/commands/`, `.cursor/commands/`, etc.
   - `agents/` → `.claude/agents/`, `.cursor/agents/`, etc.
   - Root files (`.mcp.json`, `.lsp.json`) → platform roots
7. The dependency is tracked in `openpackage.yml` with its **scoped name** and git source (not as a registry version).
8. No registry copy is created (git repository remains source of truth).

**See:** [Universal Platform Converter](../platforms/universal-converter.md) for cross-platform conversion details.

**Example:**
```bash
opkg install github:anthropics/claude-code#path=plugins/commit-commands
```

Result in `openpackage.yml`:
```yaml
packages:
  - name: "gh@anthropics/claude-code/plugins/commit-commands"  # Scoped name with full path
    git: https://github.com/anthropics/claude-code.git
    path: plugins/commit-commands
```

Installed to cache:
```
~/.openpackage/cache/git/a1b2c3d4e5f6/abc1234/plugins/commit-commands/
```

### 4.3 Marketplace install

When a plugin marketplace is detected:
1. Marketplace manifest (`.claude-plugin/marketplace.json`) is parsed.
   - **Fallback behavior**: If `marketplace.json` has no `name` field, uses repository name
2. An interactive multiselect prompt is displayed listing all available plugins.
3. User selects which plugin(s) to install (space to select, enter to confirm).
4. Each selected plugin is installed individually:
   - **Scoped name is generated**: `gh@<username>/<repo>/<plugin-path>`
   - Plugin path is resolved within the cloned repository.
   - Plugin is validated (must have `.claude-plugin/plugin.json`).
   - Plugin is installed following the individual plugin flow (§4.2).
5. Each plugin gets its own entry in `openpackage.yml` with its **scoped name** and specific path.

**Example:**
```bash
opkg install github:anthropics/claude-code

📦 Marketplace: claude-code-plugins
   Example plugins demonstrating Claude Code plugin capabilities

3 plugins available:

❯ ◯ commit-commands
  ◯ pr-review-toolkit
  ◯ explanatory-output-style

Select plugins to install (space to select, enter to confirm):
```

Result in `openpackage.yml` (if user selected commit-commands and pr-review-toolkit):
```yaml
packages:
  - name: "gh@anthropics/claude-code/plugins/commit-commands"  # Scoped name with full path
    git: https://github.com/anthropics/claude-code.git
    path: plugins/commit-commands
  - name: "gh@anthropics/claude-code/plugins/pr-review-toolkit"  # Scoped name with full path
    git: https://github.com/anthropics/claude-code.git
    path: plugins/pr-review-toolkit
```

Installed to cache:
```
~/.openpackage/cache/git/a1b2c3d4e5f6/abc1234/plugins/commit-commands/
~/.openpackage/cache/git/a1b2c3d4e5f6/abc1234/plugins/pr-review-toolkit/
```

### 4.4 Plugin naming convention

**Scoped naming for GitHub plugins**: Plugins installed from GitHub repositories use scoped names to provide clear provenance and prevent naming conflicts.

**Naming formats**:
- **Marketplace plugin**: `gh@<username>/<repo>/<plugin-path>`
- **Standalone plugin**: `gh@<username>/<repo>`
- **Non-GitHub source**: `<plugin-name>` (no scoping)

**Examples**:
| Source | Plugin Name | Scoped Name |
|--------|-------------|-------------|
| `github:anthropics/claude-code#path=plugins/commit-commands` | `commit-commands` | `gh@anthropics/claude-code/plugins/commit-commands` |
| `github:anthropics/my-plugin` | `my-plugin` | `gh@anthropics/my-plugin` |
| `git:https://gitlab.com/user/plugin.git` | `cool-plugin` | `cool-plugin` (no scoping) |
| `./local-plugin/` | `local-plugin` | `local-plugin` (no scoping) |

**Fallback behavior**:
1. **Plugin name missing**: Uses path basename → repo name → "unnamed-plugin"
2. **Repository name is always used for GitHub plugins** (marketplace name in `marketplace.json` is display-only)

**Automatic migration**: 
- **Marketplace name migration**: If an existing installation uses the old naming format (e.g., `@username/marketplace-name/plugin` where marketplace name differs from repo name), the system will automatically migrate to use the repo name when the manifest is read and written.
- **GitHub prefix migration**: If an existing installation uses the old format without the `gh` prefix (e.g., `@username/repo` or `@username/repo/path`), the system will automatically migrate to the new format (`gh@username/repo` or `gh@username/repo/path`) when the manifest is read and written.

**Benefits**:
- Clear GitHub provenance at a glance
- Repository name directly corresponds to scoped name (no ambiguity)
- Full path inclusion provides maximum clarity
- No name conflicts between authors
- Easy to identify plugin source
- Deterministic structure: segment 1 = username, segment 2 = repo, rest = plugin path

**Backward compatibility**:
- **Lookup**: Commands like `uninstall` accept old `@username/repo` format and normalize for workspace lookup
- **Migration**: Old format names are automatically converted when reading/writing manifests

### 4.5 Plugin transformation details

**In-memory transformation** (no registry copy):
- Plugin manifest fields map to OpenPackage metadata:
  - `name` → `metadata.name`
  - `version` → `metadata.version`
  - `description` → `metadata.description`
  - `author.name` → `metadata.author`
  - `repository.url` → `metadata.repository.url`
  - `license` → `metadata.license`
  - `keywords` → `metadata.keywords`

**File collection**:
- All files except `.claude-plugin/` are collected.
- Original directory structure is preserved.
- Platform mapping applies automatically during install.

**Skipped files**:
- `.claude-plugin/` directory (plugin metadata, not needed in workspace)
- `.git/` directory and git metadata
- Junk files (`.DS_Store`, `Thumbs.db`, etc.)

---

## 5. Limitations and future work

### 5.1 Current limitations

- **No lockfile pinning**: Commit SHAs are resolved but not persisted to `openpackage.yml` (no `resolvedSha` field).
- **Branch tracking**: Installing from a branch will use the latest commit at install time, not track updates.
- Authentication behavior is delegated to `git` (credentials configured in the user's environment).

### 5.2 Subdirectory support notes

- Subdirectory paths are relative to repository root.
- Subdirectory must contain a valid package or plugin manifest.
- For OpenPackage packages in subdirectories, their dependencies are resolved relative to the subdirectory location.

### 5.3 Cache features

**Implemented**:
- ✅ Structured cache at `~/.openpackage/cache/git/`
- ✅ Deterministic paths based on URL hash + commit SHA
- ✅ Automatic cache reuse when same commit exists
- ✅ Metadata tracking (`.opkg-repo.json`, `.opkg-commit.json`)
- ✅ Shallow clones for space efficiency
- ✅ Persistent across reboots

**Future considerations**:
- Cache management commands (`opkg cache list`, `opkg cache clean`)
- Cache update detection (detect when branch has new commits)
- Git worktrees for further space optimization
- Automatic cache cleanup based on age/size
- Commit SHA lockfile support for reproducible installs
