# Registry

## Purpose

The registry stores **immutable versioned snapshots** of packages for distribution and offline caching. It is analogous to Docker's image registry or npm's package registry.

## Structure

Registry uses **directory-based storage** for simplicity:

```
~/.openpackage/registry/
├── <package>/
│   ├── <version>/                    # Immutable version directory
│   │   ├── openpackage.yml          # Package manifest
│   │   ├── commands/
│   │   │   └── *.md
│   │   ├── rules/
│   │   │   └── *.md
│   │   └── AGENTS.md
│   │
│   └── <version>/
│       └── ...
│
└── @<scope>/
    └── <package>/
        └── <version>/
            └── ...
```

## Version Directory Contents

Each version directory contains the complete package:

```
~/.openpackage/registry/my-rules/1.0.0/
├── openpackage.yml            # Package manifest
├── commands/
│   └── *.md
├── rules/
│   └── *.md
├── agents/
│   └── *.md
└── AGENTS.md                  # Root files
```

## Why Directories (Not Tarballs)

| Aspect | Directory-Based | Tarball-Based |
|--------|-----------------|---------------|
| **Simplicity** | ✅ Direct file access | ❌ Requires extraction |
| **Path references** | ✅ Work directly | ❌ Need extraction cache |
| **Debugging** | ✅ Easy inspection | ❌ Must extract to view |
| **Code paths** | ✅ Same as mutable sources | ❌ Different handling |
| **Disk usage** | ⚠️ Uncompressed | ✅ Compressed |

For OpenPackage's use case (relatively small text-based packages), the simplicity benefits outweigh storage overhead.

## Operations

### Creating Registry Entries (pack)

Only `pack` creates registry entries:

```bash
opkg pack my-pkg

# 1. Read from source path
# 2. Copy to registry: ~/.openpackage/registry/my-pkg/1.0.0/
# 3. Directory is now immutable
```

### Reading from Registry (install, apply)

```bash
opkg install my-pkg@1.0.0

# 1. Locate ~/.openpackage/registry/my-pkg/1.0.0/
# 2. Read files directly (no extraction)
# 3. Apply to workspace
# 4. Update openpackage.yml with path to registry location
```

## Immutability Guarantee

Once created, registry entries are never modified:
- Same version = same content
- Re-packing overwrites entire directory (idempotent)
- No partial updates

### Git clones stored in the registry

If git sources are cloned under `~/.openpackage/registry/` (as this repo’s 0.7.0 behavior does), those directories are treated as **immutable** as well. The invariant is simple:

- Anything under `~/.openpackage/registry/` is **read-only** for `save` / `add` (regardless of whether it came from `pack`, `install`, or `git`).

### Enforcement

The `save` and `add` commands detect registry paths and fail:

```
Error: Cannot save to 'my-pkg' - source is in registry (immutable).

Path: ~/.openpackage/registry/my-pkg/1.0.0/

To make changes, copy to a mutable location first.
```

## Version Listing

```bash
opkg list my-pkg

# Lists versions by reading directory names:
# my-pkg
#   1.0.0
#   1.1.0
#   2.0.0
```

## Pruning Old Versions

```bash
opkg prune my-pkg --keep 3

# Removes oldest versions, keeping 3 most recent:
# Removed: 1.0.0
# Kept: 1.1.0, 2.0.0, 2.1.0
```

## Remote Registries

Remote registries may use tarballs for efficient network transfer. When pulled:
1. Download tarball
2. Extract to local registry directory
3. Delete tarball (or cache for re-download efficiency)

See `self-hosted-registries.md` for remote registry design.

## Scoped Packages

Scoped packages use nested directories:

```
~/.openpackage/registry/@myorg/my-pkg/1.0.0/
└── ...
```

Path in `openpackage.yml`:
```yaml
packages:
  - name: "@myorg/my-pkg"
    version: 1.0.0
    path: ~/.openpackage/registry/@myorg/my-pkg/1.0.0/
```
