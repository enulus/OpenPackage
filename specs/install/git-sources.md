### `opkg install` – Git Sources

This document specifies how `install` supports installing packages from **git repositories**, including **subdirectory support for Claude Code plugins and monorepos**.

---

## 1. Supported inputs

### 1.1 CLI inputs

- **`opkg install git:<url>[#ref][&subdirectory=path]`**
  - Installs a package from a git repository URL.
  - `ref` is optional and may be a branch, tag, or commit SHA.
  - `subdirectory` is optional and specifies a subdirectory within the repository to install.

- **`opkg install github:<owner>/<repo>[#ref][&subdirectory=path]`**
  - Convenience shorthand for GitHub.
  - Equivalent to:
    - `opkg install git:https://github.com/<owner>/<repo>.git[#ref][&subdirectory=path]`

**Examples:**
```bash
# Install from main branch
opkg install github:anthropics/claude-code

# Install from specific branch
opkg install github:anthropics/claude-code#main

# Install from subdirectory (Claude Code plugin)
opkg install github:anthropics/claude-code#subdirectory=plugins/commit-commands

# Install from specific tag and subdirectory
opkg install github:anthropics/claude-code#v1.0.0&subdirectory=plugins/commit-commands

# Install from any git URL with subdirectory
opkg install git:https://gitlab.com/user/repo.git#main&subdirectory=packages/plugin-a
```

### 1.2 Subdirectory syntax

The subdirectory option supports two formats:
- **After ref**: `#ref&subdirectory=path` (ref + subdirectory)
- **Without ref**: `#subdirectory=path` (subdirectory only)

Order matters: `ref` must come before `subdirectory` when both are present.

---

## 2. openpackage.yml schema

Dependencies in `openpackage.yml` support git sources via:

```yaml
packages:
  - name: somepkg
    git: https://example.com/org/repo.git
    ref: main
    subdirectory: plugins/my-plugin  # Optional
```

Rules:
- Each dependency entry MUST specify **exactly one** source field: `version`, `path`, or `git`.
- `ref` and `subdirectory` are only valid when `git` is present.
- Git dependencies MUST NOT specify `version` (git dependencies are source-pinned, not semver-ranged).
- `subdirectory` specifies a subdirectory path within the repository to use as the package root.

---

## 3. Resolution and installation behavior

### 3.1 Basic git install

- `install` clones the repository to a temporary directory using the system `git` executable.
- If `ref` is provided:
  - For branch/tag: clone the specified ref.
  - For commit SHA: clone and checkout that SHA (best-effort shallow fetch).
- Without subdirectory: The cloned repository root MUST contain `openpackage.yml`.
- The installed package version is read from the repo's `openpackage.yml`.
- The rest of the install flow matches path installs:
  - Dependencies are resolved recursively.
  - Content is installed to the workspace platforms.

### 3.2 Subdirectory installs

When `subdirectory` is specified:
- Repository is cloned to a temporary directory.
- The specified subdirectory path is resolved relative to the repository root.
- The subdirectory MUST contain either:
  - `openpackage.yml` (standard OpenPackage package), OR
  - `.claude-plugin/plugin.json` (Claude Code plugin), OR
  - `.claude-plugin/marketplace.json` (Claude Code plugin marketplace)
- For OpenPackage packages: `openpackage.yml` is read from the subdirectory.
- For Claude Code plugins: See §4 for special handling.

---

## 4. Claude Code plugin support

### 4.1 Plugin detection

When installing from a git source (with or without subdirectory), the system detects Claude Code plugins by checking for:
- **Individual plugins**: `.claude-plugin/plugin.json`
- **Plugin marketplaces**: `.claude-plugin/marketplace.json`

Detection happens automatically after cloning, before attempting to load as an OpenPackage.

### 4.2 Individual plugin install

When an individual plugin is detected:
1. Plugin manifest (`.claude-plugin/plugin.json`) is read and validated.
2. Plugin metadata is transformed to OpenPackage format in-memory:
   - `name` and `version` from `plugin.json` become package metadata
   - `description`, `author`, `repository`, etc. are preserved
3. All plugin files are collected (commands/, agents/, skills/, hooks/, .mcp.json, .lsp.json, etc.)
4. Files are installed to platform-specific directories via the platform mapping system:
   - `commands/` → `.claude/commands/`, `.cursor/commands/`, etc.
   - `agents/` → `.claude/agents/`, `.cursor/agents/`, etc.
   - Root files (`.mcp.json`, `.lsp.json`) → platform roots
5. The dependency is tracked in `openpackage.yml` with its git source (not as a registry version).
6. No registry copy is created (git repository remains source of truth).

**Example:**
```bash
opkg install github:anthropics/claude-code#subdirectory=plugins/commit-commands
```

Result in `openpackage.yml`:
```yaml
packages:
  - name: commit-commands
    git: https://github.com/anthropics/claude-code.git
    subdirectory: plugins/commit-commands
```

### 4.3 Marketplace install

When a plugin marketplace is detected:
1. Marketplace manifest (`.claude-plugin/marketplace.json`) is parsed.
2. An interactive multiselect prompt is displayed listing all available plugins.
3. User selects which plugin(s) to install (space to select, enter to confirm).
4. Each selected plugin is installed individually:
   - Plugin subdirectory is resolved within the cloned repository.
   - Plugin is validated (must have `.claude-plugin/plugin.json`).
   - Plugin is installed following the individual plugin flow (§4.2).
5. Each plugin gets its own entry in `openpackage.yml` with its specific subdirectory.

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
  - name: commit-commands
    git: https://github.com/anthropics/claude-code.git
    subdirectory: plugins/commit-commands
  - name: pr-review-toolkit
    git: https://github.com/anthropics/claude-code.git
    subdirectory: plugins/pr-review-toolkit
```

### 4.4 Plugin transformation details

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

- No lockfile or commit pinning is persisted (no `resolvedSha` field).
- No clone caching (each install may re-clone).
- Authentication behavior is delegated to `git` (credentials configured in the user's environment).

### 5.2 Subdirectory support notes

- Subdirectory paths are relative to repository root.
- Subdirectory must contain a valid package or plugin manifest.
- For OpenPackage packages in subdirectories, their dependencies are resolved relative to the subdirectory location.

### 5.3 Future considerations

- Commit SHA resolution and pinning for reproducible installs.
- Clone caching to speed up repeated installs.
- Plugin registry support (converting plugins to first-class OpenPackage packages).
