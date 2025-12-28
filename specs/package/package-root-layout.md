### Package Root Layout

This document describes the **package payload layout** and how it relates to
workspace-local metadata.

```text
<package-root>/
  openpackage.yml              # REQUIRED – package manifest (marks this as a package)

  # Universal content (platform-mapped)
  commands/                    # standard + custom universal subdirs (from platforms.jsonc)
  rules/
  agents/
  skills/
  <custom-subdirs>/

  # Root files (installed/processed)
  AGENTS.md                    # OPTIONAL – universal root file
  <platform-root-files>        # OPTIONAL – platform-specific root files (e.g. CLAUDE.md)

  # Direct copy to workspace root
  root/                        # OPTIONAL – files copied 1:1 into the workspace root
    <any-files-or-dirs>/

  # Other root-level files/dirs (not installed by default)
  README.md                    # OPTIONAL – documentation (not installed)
  LICENSE.md                   # OPTIONAL – license (not installed)
```

---

#### Installation Semantics

1. **Universal subdirs at package root** (`commands/`, `rules/`, `agents/`, `skills/`, plus any platform-defined custom subdirs):
   - Stored in a platform-normalized “universal” format.
   - Mapped to platform-specific locations during install (e.g., `.cursor/commands/`, `.opencode/commands/`).

2. **Root files at package root**:
   - `AGENTS.md` is universal and can be used to populate platform root files during install.
   - Platform-specific root files at package root (e.g., `CLAUDE.md`) act as **overrides** when present.

3. **`root/` directory**:
   - Files under `root/**` are copied **1:1 to the workspace root**, stripping the `root/` prefix.
   - Example: `root/tools/helper.sh` → `<workspace>/tools/helper.sh`.

---

#### Key Invariants

- **`openpackage.yml`** marks a directory as a package root.
- **Universal content** lives at the **package root** under universal subdirs (no `.openpackage/<subdir>/` container in package payloads).
- **Install mapping**:
  - Universal-subdir paths are platform-mapped.
  - `root/` is the only prefix that uses a **strip-prefix** rule (copy-to-root).
  - Other root-level files/dirs are **not installed** by default.
- **Cached packages** (workspace-local installed copies) live under `cwd/.openpackage/packages/<name>/` and mirror the package payload layout.
- **Global registry copies** (under `~/.openpackage/registry/...`) store the package payload layout and **never include** workspace index files.

---

#### Concrete Examples

**Package repo on disk** (payload shape; same shape used in registry copies):

```text
<package-root>/
  openpackage.yml
  commands/
    test.md
  rules/
    auth.md
  AGENTS.md
  root/
    tools/
      helper.sh
  README.md
```

**Workspace metadata + cached package copy** (package root = `cwd/.openpackage/packages/foo/`):

```text
cwd/
  .openpackage/
    openpackage.yml                        # workspace manifest (dependency intent)
    openpackage.index.yml                  # OPTIONAL – workspace-local root index (never in registry payload)
    packages/
      foo/
        openpackage.yml                    # cached payload (mirrors package root)
        openpackage.index.yml              # workspace-local per-package index (never in registry payload)
        commands/
          test.md
        root/
          tools/helper.sh
```

