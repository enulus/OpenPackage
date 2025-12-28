### Universal Content

#### Universal Content vs. Root-Level Content

Packages contain two types of content:

| Type | Location | Description | Install Behavior |
|------|----------|-------------|------------------|
| **Universal content** | `<package-root>/<subdir>/` | Platform-normalized files | Mapped to platform-specific paths |
| **Root-level content** | `<package-root>/<path>` | Any files/dirs at package root | Not installed unless under `root/` (copy-to-root) or a root file |

---

#### Universal Content Layout

Universal subdirs (standard: `agents/`, `rules/`, `commands/`, `skills/`; plus any custom defined in `platforms.jsonc`) are canonical at the **package root**. The full set is dynamically discovered from platform configs.

```text
<package-root>/
  openpackage.yml              # package manifest
  <universal-subdir>/          # e.g., agents/, rules/, commands/, skills/, or custom (from platforms.jsonc)
    <name>.md                  # universal markdown
    <name>.<platform>.md       # platform-suffixed markdown (optional)
  ...                           # other standard/custom subdirs
```

**Definitions:**

- **Universal markdown**:
  - Paths like `agents/foo.md`
  - Contains shared body and (after save) shared frontmatter
  
- **Platform-suffixed markdown**:
  - Paths like `agents/foo.<platform>.md`
  - Represents platform-specific variants of a universal file
  
---

#### Root-Level Content

Root-level content lives at the package root, **not** under `.openpackage/`:

```text
<package-root>/
  <root-dir>/                  # any root-level directory (not installed by default)
  AGENTS.md                    # root files
  CLAUDE.md
  README.md
```

Root-level content:
- Is **not installed** unless it is:
  - A root file (`AGENTS.md` or platform root files), or
  - Under `root/**` (copied to workspace root with prefix stripped).

---

#### Registry Paths (Keys in `openpackage.index.yml`)

Registry paths are **relative to the package root**:

| Content Type | Example Registry Path |
|--------------|----------------------|
| Universal content | `commands/test.md` |
| Root files | `AGENTS.md` |
| `root/` directory (direct copy) | `root/tools/helper.sh` |

**Rules:**

- Universal subdir content lives under the universal subdir name at package root
- Root-level content uses its natural path (no prefix) but is not installed by default
- Root files use their filename directly

---

#### Install Mapping Examples

**Universal content** (platform-specific mapping):

| Registry Path | Installed Paths |
|---------------|-----------------|
| `commands/test.md` | `.cursor/commands/test.md`, `.opencode/commands/test.md`, etc. |
| `rules/auth.md` | `.cursor/rules/auth.mdc`, etc. |

**Root-level content**:

| Registry Path | Installed Path |
|---------------|----------------|
| `AGENTS.md` | `AGENTS.md` |
| `root/tools/helper.sh` | `tools/helper.sh` (strip `root/` prefix) |

---

#### Consistent Layout Across Locations

These layouts apply identically whether the package lives at:

- **Workspace root**: `cwd/` (content at `cwd/<subdir>/...`)
- **Nested package**: `cwd/.openpackage/packages/<name>/` (content at `cwd/.openpackage/packages/<name>/<subdir>/...`)
- **Registry**: `~/.openpackage/registry/<name>/<version>/` (content at `.../<subdir>/...`)

---

#### Frontmatter and Overrides

In the canonical structure:

- Each universal markdown file (`<subdir>/<name>.md`) is the **single source of truth** for:
  - Markdown body
  - Shared frontmatter keys/common metadata
  - Platform overrides embedded inline under `openpackage.<platform>` (ids/aliases, only diffs)

- Platform-specific content files (`<name>.<platform>.md`) remain optional body overrides.

The save pipeline:

1. Normalizes workspace markdown and computes:
   - Universal frontmatter to keep in `foo.md`
   - Per-platform differences to store as inline blocks under `openpackage.<platform>` inside `foo.md`
2. Writes only the universal file (plus any platform-specific markdown files)

