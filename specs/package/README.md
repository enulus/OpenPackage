### Canonical Universal Package Structure

This directory contains the canonical on-disk structure spec for OpenPackage packages, split into focused documents:

- **Root layout**: `package-root-layout.md` – Package directory structure and content types
- **Universal content**: `universal-content.md` – Platform-normalized content at package root
- **Package index**: `package-index-yml.md` – File mapping and `openpackage.index.yml` structure
- **Registry payload and 1:1 copy rules**: `registry-payload-and-copy.md` – What gets included in packages
- **Nested packages and parent packages**: `nested-packages-and-parent-packages.md` – Multi-package workspaces

---

#### Core Concept: Package Root

A **package root** is any directory containing `openpackage.yml` at its root. This applies to:

- **Workspace root package**: `cwd/` is the package root
- **Nested packages**: `cwd/.openpackage/packages/<name>/` is the package root
- **Registry copies**: `~/.openpackage/registry/<name>/<version>/` is the package root

All package roots have **identical internal structure**:

```text
<package-root>/
  openpackage.yml            # package manifest (marks this as a package)
  <universal-subdirs>/       # universal content (standard: commands/, rules/, agents/, skills/; custom from platforms.jsonc)
  AGENTS.md                  # root files
  <platform-root-files>      # optional platform root file overrides (e.g. CLAUDE.md)
  root/                      # OPTIONAL – copied 1:1 to workspace root (strip `root/` prefix)
  <root-dir>/                # other root-level content (not installed by default)
  README.md                  # docs (not installed by default)
  LICENSE.md                 # docs (not installed by default)
```

---

#### Two Types of Content

| Type | Location | Example |
|------|----------|---------|
| **Universal content** | `<package-root>/<subdir>/` | `commands/test.md` |
| **Root-level content** | `<package-root>/<path>` | `AGENTS.md`, `root/tools/helper.sh`, `README.md` (not installed by default) |

**Universal content** is mapped to platform-specific paths during install.  
**Root-level content** is only installed when it is a root file (e.g., `AGENTS.md`) or under `root/**` (strip-prefix copy).

> **Workspace-local metadata** (like `.openpackage/openpackage.yml` and `openpackage.index.yml`) lives under `.openpackage/`
> in the workspace and is **not part of the package payload**.

---

#### Design Goal

A package directory can be **moved or copied 1:1** between:

- Workspace root packages (effective `cwd/` via shell or `--cwd`; see [../../cli-options.md])
- Nested workspace packages (effective `cwd/.openpackage/packages/<name>/`)
- Local registry copies (`~/.openpackage/registry/<name>/<version>/`)

…while preserving the same internal layout and invariants.

