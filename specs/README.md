### OpenPackage CLI Specs

This directory contains the **canonical** implementation-guiding specifications for the OpenPackage CLI, with the primary architecture being the path-based model. The codebase reflects this (path-based source of truth, mutable vs. immutable sources, unified workspace index, directory-based local registry). Specifications are organized by topic, with top-level overview files providing cohesion.

#### Design Principles

- **Focused**: Each command serves one clear purpose, avoiding overload.
- **Surgical**: Strict separation of mutable development sources from immutable distribution snapshots, with enforcement via errors.
- **Simple**: Paths are the universal source of truth; a single unified index manages all tracking.
- **Reliable**: Built-in guards prevent common errors, like mutating published registry content.

For full philosophy, data flows, and layered model, see [Architecture](architecture.md).

#### Key Concepts

- **Path-Based Source of Truth**: All packages resolve to a filesystem path. Dependencies use explicit `path:` or infer from `version:` (registry) or `git:` (cloned path). Git sources support subdirectory navigation for monorepos and Claude Code plugins.
- **Mutable vs. Immutable Sources**: 
  - Mutable (e.g., local/global packages dirs): Support editing via `save`/`add`.
  - Immutable (e.g., registry dirs): Read-only; `save`/`add` fail.
- **Unified Workspace Index**: `.openpackage/openpackage.index.yml` tracks packages, sources, versions, and file mappings across the workspace—no fragmented per-package files.
- **Directory-Based Local Registry**: `~/.openpackage/registry/<name>/<version>/` for simple, direct access without tarballs.

#### Command Flow Diagram

```
Workspace ←──apply/install── Source/Registry (mutable or immutable)
Workspace ──save/add──────→ Source (mutable only; fails on registry)
Source ────pack───────────→ Registry (immutable snapshot)
CWD ───────publish────────→ Remote Registry
```

Detailed semantics in [Commands Overview](commands-overview.md) and command subdirs (e.g., [Save](save/), [Pack](pack/), [Publish](publish/)).

#### Breaking Changes from Prior Versions

The architecture introduces breaking changes with no automated migration—re-initialize workspaces:
- Removed complex WIP versioning (now prereleases in registry), workspace hash tracking, per-package metadata directories, and tarball-based registry.
- Unified `openpackage.index.yml` replaces scattered index files.
- All registry storage is directory-based for inspectability and path compatibility.
- Path-based dependencies and mutability guards replace prior behaviors; re-run `opkg install` for workspaces. Use `opkg new` to create packages.
- No backward compatibility for removed features like staging mutations or link-only WIP layouts.

Consult git history (e.g., commit 9d23bf2) for prior version details. See [Architecture](architecture.md) for removed/retained metadata.

---

#### Where to look

- **Architecture & Overviews**: 
  - High-level design, flows, philosophy: `architecture.md`
  - Command semantics and matrix: `commands-overview.md`
  - Directory structures (global/workspace): `directory-layout.md`
- **Core Concepts**:
  - Package source types, resolution, mutability: `package-sources.md`
  - Registry storage and operations: `registry.md`
  - Scopes (workspace/global; deferred transitions): `scope-management.md`
- **Package Structure & Payload**: `package/`
  - Copy rules to/from registry: `registry-payload-and-copy.md`
  - Universal/root content mappings: `universal-content.md`
  - Unified index schema: `package-index-yml.md`
  - Package root layout: `package-root-layout.md`
- **Commands**:
  - `new` (create packages): `new/`
    - Scope behavior: `scope-behavior.md`
  - `add` (new files to source): `add/`
  - `apply`/`sync`: `apply/`
  - `install` (from registry/git/plugins): `install/`
    - Behavior/scenarios: `install-behavior.md` (includes Claude Code plugin support in §8)
    - Git sources: `git-sources.md` (includes subdirectory syntax and plugin detection)
  - `pack` (to local registry): `pack/`
  - `publish` (to remote registry): `publish/`
  - `save` (edits to source; WIP versioning): `save/`
    - Versioning details: `save-versioning.md`
  - `set` (update manifest metadata): `set/`
    - Behavior and validation: `set-behavior.md`
  - `push`: `push/`
  - `list`: `list/`
  - `uninstall`: `uninstall/`
- **Other**:
  - Auth: `auth/`
  - Platforms: `platforms/` - Platform-specific transformations and flows
    - Overview: `platforms/overview.md`
    - Flows: `platforms/flows.md`
    - Universal Converter: `platforms/universal-converter.md` - Cross-platform package conversion
    - Map Pipeline: `platforms/map-pipeline.md`
    - Configuration: `platforms/configuration.md`
  - CLI flags/options: `cli-options.md`

---