# Architecture Overview

OpenPackage CLI adopts a **path-based source of truth** model, inspired by Git (working directories vs. commits), Docker (images), and npm (development vs. distribution). This promotes reliability by clearly separating mutable development sources from immutable distribution artifacts.

## Core Philosophy

- **Path-Centric**: All packages resolve to a concrete filesystem path. Dependencies declare `path:` or infer from `version:` (registry) / `git:` (cloned to path). Git sources support subdirectory navigation for monorepos and Claude Code plugin marketplaces.
- **Mutable vs. Immutable Distinction**: Guards against accidental mutation of published artifacts.
  - Mutable: Editable sources (e.g., `./.openpackage/packages/` or `~/.openpackage/packages/`) support `save`, `add`, `pack`, `apply`.
  - Immutable: Registry snapshots (e.g., `~/.openpackage/registry/<name>/<version>/`) support only `apply`, `install`; `save`/`add` fail with errors.
- **Unified Workspace Index**: Single ` .openpackage/openpackage.index.yml` tracks all installed packages, sources, and file mappings—no per-package metadata.
- **Directory-Based Registry**: Simple, inspectable storage without tarball extraction complexity.

See [Package Sources](package-sources.md) for resolution details and [Registry](registry.md) for storage.

## Layered Model

```
┌─────────────────────────────────────────────────────────────┐
│                     WORKSPACE                               │
│  Platform directories: .cursor/, .opencode/, docs/, etc.    │
│  (User edits here)                                          │
└────────────────────────────┬────────────────────────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 │
       save (sync)       add (new files)       │
           │                 │                 │
           └─────────────────┼─────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│               SOURCE OF TRUTH (MUTABLE)                     │
│  • ./.openpackage/packages/<name>/                          │
│  • ~/.openpackage/packages/<name>/                          │
│  • Declared paths in openpackage.yml                        │
│                                                             │
│  ✅ save/add/pack/apply                                      │
│  ❌ save/add fail if resolved to registry                    │
└────────────────────────────┬────────────────────────────────┘
                             │
                          pack
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  REGISTRY (IMMUTABLE)                       │
│  ~/.openpackage/registry/<name>/<version>/                  │
│                                                             │
│  ⛔ save/add forbidden                                       │
│  📦 From pack only                                          │
└────────────────────────────┬────────────────────────────────┘
                             │
                       install/apply
                             │
                             └──────────────────────┐
                                                    │ push/pull
                                                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   REMOTE REGISTRY (FUTURE)                  │
└─────────────────────────────────────────────────────────────┘
```

## Key Distinctions

| Concept | Analogy | Characteristics |
|---------|---------|-----------------|
| **Package Source** | Git repo / working dir | Mutable, editable; supports dev ops (save, add, pack) |
| **Registry Snapshot** | Git tag / Docker image | Immutable, versioned; distribution-focused (install, apply) |

## Data Flows

### Workspace → Source (save, add)
- User edits platform dirs or adds new files.
- `save`: Syncs via index mappings; resolves conflicts (mtime, overrides); writes to mutable source. Requires package to be installed (reads from workspace index).
- `add`: Copies files from filesystem to mutable package source (workspace or global). Does **not** update workspace index. Works independently of installation status. To sync to workspace, use `install` + `apply` or `--apply` flag.
- See [Save](save/) and [Add](add/) for details.

### Source → Registry (pack)
- Creates immutable directory copy in registry/<name>/<version>/.
- Version from `openpackage.yml` or computed (stable promotion).
- See [Pack](pack/) and [Save Versioning](save/save-versioning.md).

### Registry/Source → Workspace (install, apply)
- `install`: Resolves version, copies to platforms/root, updates yml/index.
- `apply`: Direct sync from source path (mutable or inferred immutable).
- See [Install](install/) and [Apply](apply/).

## Simplified Metadata Changes
### Removed
- WIP versioning complexity (now handled via prereleases in registry).
- Workspace hash tracking.
- Per-package metadata dirs (unified index replaces).
- Tarball registry storage (directories for simplicity).

### Retained
- `openpackage.yml`: Manifest with deps, version.
- `openpackage.index.yml`: Unified tracking of sources/mappings.

## Breaking Changes
The architecture introduces breaks with no auto-migration:
- Workspace manifests are now auto-created (no manual init needed).
- Create packages: `opkg new <package>` with scope support (replaces `opkg init`).
- Re-install packages: `opkg install`.
- Path-based deps replace prior models; mutable guards enforce new flows.
- Unified index requires manual recreation.

For prior version details, consult git history. Cross-links: [Directory Layout](directory-layout.md), [CLI Options](cli-options.md).