# Directory Structure

## Global Directory (`~/.openpackage/`)

```
~/.openpackage/
├── packages/                          # DEVELOPMENT CODEBASES
│   │                                  # (mutable, like git working copies)
│   ├── my-rules/
│   │   ├── openpackage.yml           # Package manifest
│   │   ├── commands/
│   │   │   └── *.md
│   │   └── rules/
│   │       └── *.md
│   │
│   └── @scope/                        # Scoped packages
│       └── shared-tools/
│           └── openpackage.yml
│
├── registry/                          # VERSIONED SNAPSHOTS
│   │                                  # (immutable, directory-based)
│   ├── my-rules/
│   │   ├── 1.0.0/                    # Immutable version directory
│   │   │   ├── openpackage.yml
│   │   │   ├── commands/
│   │   │   └── rules/
│   │   └── 1.1.0/
│   │       └── ...
│   │
│   └── @scope/
│       └── shared-tools/
│           └── 2.0.0/
│               └── ...
│
└── config.yml                         # Global configuration
```

## Workspace Directory

```
<workspace>/
├── .openpackage/
│   ├── openpackage.yml               # Root package manifest
│   ├── openpackage.index.yml         # UNIFIED install tracking (all packages)
│   │
│   └── packages/                      # WORKSPACE-SCOPE PACKAGES
│       └── <name>/                    # (mutable development codebases)
│           ├── openpackage.yml       # Package manifest
│           ├── commands/
│           │   └── *.md
│           └── rules/
│               └── *.md
│           └── root/                  # Copy-to-root payload (installed to workspace root, prefix stripped)
│               └── ...
│
├── .cursor/                           # Platform sync targets
│   ├── rules/
│   └── commands/
│
├── .opencode/                         # Another platform
│   └── ...
│
└── docs/                              # Root-level content
    └── ...
```

## Directory Purposes

| Directory | Purpose | Mutability |
|-----------|---------|------------|
| `~/.openpackage/packages/` | Global shared package development | ✅ Mutable |
| `~/.openpackage/registry/` | Versioned package snapshots | ❌ Immutable |
| `./.openpackage/packages/` | Workspace-local package development | ✅ Mutable |
| `./.openpackage/openpackage.index.yml` | Unified install tracking | Metadata |

## Key Principles

### 1. Unified Index

A single `openpackage.index.yml` at `.openpackage/openpackage.index.yml` tracks:
- All installed packages
- Their source paths
- Their file mappings to workspace platforms

No per-package metadata directories needed.

### 2. Directory-Based Registry

Registry stores versions as expanded directories, not tarballs:
- Simpler to inspect and debug
- Direct path references work
- Same code paths for all sources

### 3. Workspace Packages Inside `.openpackage/`

Workspace-scope packages live at `.openpackage/packages/<name>/`:
- Keeps project root clean
- Clear "managed by opkg" signal
- Consistent with global structure

## Path Conventions

| Path Type | Example | Use Case |
|-----------|---------|----------|
| Workspace relative | `./.openpackage/packages/my-pkg/` | Project-specific packages |
| Global tilde | `~/.openpackage/packages/my-pkg/` | Shared global packages |
| Registry | `~/.openpackage/registry/my-pkg/1.0.0/` | Versioned snapshots |

## Key Changes from Previous Versions

1. **Unified index**: Single `openpackage.index.yml` replaces per-package index files
2. **No per-package metadata directories**: Metadata embedded in unified index
3. **Directory-based registry**: Replaced tarballs with expanded directories
4. **Workspace packages**: Moved from `./packages/` to `./.openpackage/packages/`
