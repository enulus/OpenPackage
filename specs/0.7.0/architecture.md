# Architecture Overview

## Core Philosophy

OpenPackage CLI v0.7.0 adopts a **path-based source of truth** model, inspired by how Git, Docker, and npm separate development sources from distribution artifacts.

## Layered Model

```
┌─────────────────────────────────────────────────────────────┐
│                     WORKSPACE                               │
│  Platform directories: .cursor/, .opencode/, docs/, etc.   │
│  (Where users actually edit files)                          │
└────────────────────────────┬────────────────────────────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 │
       save (sync)       add (new)             │
           │                 │                 │
           └─────────────────┼─────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────┐
│               SOURCE OF TRUTH (mutable)                     │
│  • ./.openpackage/packages/<name>/                          │
│  • ~/.openpackage/packages/<name>/                          │
│  • Any path declared in openpackage.yml                     │
│                                                             │
│  ✅ save/add work here                                      │
│  ❌ Fails if source is registry (immutable)                 │
└────────────────────────────┬────────────────────────────────┘
                             │
                          pack
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  REGISTRY (immutable)                       │
│  ~/.openpackage/registry/<name>/<version>/                  │
│                                                             │
│  ⛔ save/add cannot write here                              │
│  📦 Created only by pack                                    │
└────────────────────────────┬────────────────────────────────┘
                             │
                    push / pull
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   REMOTE REGISTRY                           │
└─────────────────────────────────────────────────────────────┘
```

## Key Distinctions

| Concept | Analogy | Characteristics |
|---------|---------|-----------------|
| **Package Codebase** | Git working directory | Mutable, editable, development focused |
| **Versioned Snapshot** | Docker image / npm tarball | Immutable, archived, distribution focused |

## Data Flow

### Workspace → Source (save/add)

User edits files in platform directories (`.cursor/rules/`, `docs/`). These changes flow back to the package source via `save` or `add`.

Notes:
- `save` writes back based on the unified workspace index mappings (`.openpackage/openpackage.index.yml`) and resolves multi-platform conflicts using mtime + platform override rules.
- `add` maps non-platform workspace paths into `root/<workspace-relpath>` in the package source (copy-to-root payload; prefix stripped when installed/applied).

### Source → Registry (pack)

Package source is archived into an immutable directory snapshot for distribution or offline caching.

### Registry → Workspace (install)

Registry version is applied to workspace platform directories.

### Source → Workspace (apply)

Direct sync from a mutable package source to workspace platforms.

## Simplified Metadata

### Removed Complexity

- **WIP versioning**: Users can manually use prerelease versions if needed
- **Workspace hashes**: No longer tracking workspace as a working copy
- **Per-package metadata directories**: Replaced with unified index
- **Tarball storage**: Registry uses directories for simplicity

### Retained Metadata

- `openpackage.yml`: Package manifest with dependencies
- `openpackage.index.yml`: Single unified index tracking all installed packages

## Breaking Changes

This version introduces breaking changes with no migration path:

- Re-initialize workspaces with `opkg init`
- Re-install packages with `opkg install`
