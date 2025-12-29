# OpenPackage CLI v0.7.0 — Implementation Plan (Phased)

This document is an implementation plan for the specs in `specs/0.7.0/`.

It intentionally **does not implement anything yet**; it’s a checklist-oriented plan we’ll use to execute the rollout in controlled phases.

---

## Goals (from spec)

- **Path is source of truth**: every dependency ultimately resolves to a `path:`.
- **Mutable vs immutable**:
  - Mutable sources: `./.openpackage/packages/...`, `~/.openpackage/packages/...`, or any user-provided local path.
  - Immutable sources: `~/.openpackage/registry/<name>/<version>/...` (and remote-derived registry caches).
  - `save` / `add` must **fail** for immutable sources; `apply` / `install` must work for both.
- **Unified workspace index**: a single `.openpackage/openpackage.index.yml` tracks *all installed packages* and their file mappings.
- **Directory-based registry**: `~/.openpackage/registry/<name>/<version>/` contains expanded package directories (not tarballs).
- **Command semantics** (0.7.0): `save`, `add`, `pack`, `apply`, `install`, `status`, `uninstall`.
- **Breaking change**: no migration path; workspaces are re-initialized (per spec).

---

## Non-goals / deferred (explicit in spec)

- **Scope transition commands**: `elevate`, `localize`, `scope` (see `scope-management.md`).
- **Self-hosted registries** (remote): git/http registries, scoped registries, checksums/signatures (see `self-hosted-registries.md`).

Notes:
- The current repo includes additional commands (e.g. `push/pull/login/logout`). We will keep them compiling, but **aligning them to 0.7.0** is out-of-scope unless they block core 0.7.0 flows.

---

## A key gap to address (current repo vs 0.7.0)

The current implementation (as of `package.json` version `0.6.2`) is oriented around:

- `save` / `pack` producing registry snapshots (WIP/stable), including workspace hash tracking
- per-package `openpackage.index.yml` behavior in some paths

0.7.0 requires:

- `save` / `add` to sync **workspace → mutable source path**
- `pack` to snapshot **source → registry**
- a **single unified** `.openpackage/openpackage.index.yml` for the workspace
- removing (or bypassing) WIP versioning + workspace hash tracking in the 0.7.0 path

This means 0.7.0 is best treated as a **behavioral rewrite** of the package lifecycle pipeline, not an incremental tweak.

---

## Phase 0 — Spec-to-code alignment (decisions + acceptance tests)

Deliverable: a short “decisions” section (checked in as part of this plan) that locks behavior where the spec is intentionally high-level.

Todos:
- **Decide**: Do we fully replace 0.6.x behaviors, or ship 0.7.0 behind a compatibility flag?
  - **Locked (per review)**: **replace defaults**; treat as breaking release.
- **Define**: “What files are considered package content?”
  - Spec examples: `rules/`, `commands/`, `agents/`, and root files like `AGENTS.md`.
  - Decide whether to keep/rename any existing conventions in the repo (e.g. `root/` copy behavior).
- **Define**: How `apply/install` decide mappings when no prior index exists.
  - Option A: mapping derived from discovered platform directories + package directories.
  - Option B: mapping derived from existing `.openpackage/openpackage.index.yml` entries only.
  - Recommendation: **derive mapping on apply/install**, then persist into unified index.
- **Define**: conflict strategy for `apply/install` overwrites.
  - **Locked (per review)**: **reuse existing conflict/overwrite logic already in the codebase** (including current prompting/flags like `--force`).
- **Define**: `status` “in sync” detection method.
  - **Locked (per review)**: **hash-based** comparison of mapped files.
- **Define**: file filtering behavior (legacy `include:`).
  - **Locked (per review)**: **remove filtering** for 0.7.0; no `include:` support in manifests. (Everything that matches package content/mapping rules is eligible.)
- **Acceptance**: write a checklist of CLI-level scenarios that must pass (see Phase 8 tests).

Exit criteria:
- All above decisions written into this doc under “Locked decisions”.

---

## Phase 1 — Core data model + path resolution utilities

Deliverable: reusable primitives used by all commands.

Todos:
- **Implement**: path resolution
  - `~` expansion (preserve tilde in YAML; expand at runtime).
  - `./` resolution relative to the referencing `openpackage.yml` location.
- **Define types** (TS) for:
  - Workspace `openpackage.yml` dependency entries:
    - path-based (`name`, `path`)
    - registry-resolved (`name`, `version`, `path`)
    - git-based (`name`, `git`, `ref?`)
    - (No `include:` / filtering support in 0.7.0)
  - Unified `openpackage.index.yml` schema (workspace-local):
    - `packages[packageName].version?`
    - `packages[packageName].path`
    - `packages[packageName].dependencies?`
    - `packages[packageName].files` (mapping of package-relative -> workspace targets)
- **Implement**: `readWorkspaceIndex()` / `writeWorkspaceIndex()` with stable formatting.
- **Implement**: helpers:
  - `isRegistryPath(path)` and `assertMutableSourceOrThrow()`
  - `normalizePackageName()` rules for scoped names (`@scope/name`).

Exit criteria:
- All above utilities covered by unit-ish tests (or thin integration tests) and used by at least one command pipeline in Phase 3+.

---

[NOT IMPLEMENTED]
## Phase 2 — Directory layout enforcement (`init` + safety)

Deliverable: consistent on-disk layout as specified.

Todos:
- **Update `opkg init`** to create/ensure:
  - `<workspace>/.openpackage/openpackage.yml`
  - `<workspace>/.openpackage/openpackage.index.yml` (empty structure)
  - `<workspace>/.openpackage/packages/` (workspace-scope package roots)
- **Ensure global dirs**:
  - `~/.openpackage/packages/`
  - `~/.openpackage/registry/`
- **Validate**: safe behavior if directories already exist (idempotent).
- **Doc**: confirm “breaking” note (no migration) in CLI help or README update (later phase).

Exit criteria:
- `opkg init` can be run repeatedly without changing existing content unexpectedly.

---

## Phase 3 — Source resolution engine (single truth for all commands)

Deliverable: a single module that resolves package “source of truth” and mutability.

Todos:
- **Implement**: `resolvePackageSource(workspaceRoot, packageName)` that returns:
  - resolved absolute filesystem source path
  - original declared `path` (tilde/relative preserved for writing back to YAML)
  - mutability (`mutable | immutable`)
  - version (if known / registry-based)
- **Implement**: `resolveRegistryVersion(name, versionRange)` (semver) for installs.
- **Implement**: dependency graph walk (if needed for `install` / `apply` / `status`).
  - Keep it minimal: 0.7.0’s unified index can cache dependencies, but commands must be correct even if cache is absent.

Exit criteria:
- Any command can ask “where do I read from?” and “am I allowed to write?” without re-implementing logic.

Note:
- **Mutability is determined by resolved path**:
  - Paths under `~/.openpackage/registry/` are treated as **immutable** (including git clones if stored there).
  - Paths under `./.openpackage/packages/` or `~/.openpackage/packages/` are treated as **mutable**.

---

## Phase 4 — `apply` (Source → Workspace) using unified index

Deliverable: `apply` syncs package content into platform targets and records mappings in unified index.

Todos:
- **Implement**: mapping rules
  - Package-relative directories like `rules/` map to platform directories (e.g. `.cursor/rules/`, `.opencode/rules/`).
  - Root files (e.g. `AGENTS.md`) map to the workspace root (or per-platform root where applicable).
- **Implement**: file sync algorithm
  - Create directories as needed
  - Overwrite/update semantics: **reuse existing conflict/overwrite logic** (prompting/flags like `--force`)
- **Write unified index entries**:
  - `packages[name].path` = resolved source path (tilde/relative preserved if sourced from `openpackage.yml`)
  - `packages[name].files` = mapping actually applied

Exit criteria:
- After `opkg apply <name>`, unified index includes `<name>` with correct mappings, and files appear in expected workspace locations.

---

## Phase 5 — `install` (Registry → Workspace) and manifest updates

Deliverable: `install` installs a registry version and updates workspace `openpackage.yml` + unified index.

Todos:
- **Resolve version**:
  - Support `opkg install name@1.2.3` and/or version ranges if already supported.
  - For registry installs requested with a range, preserve the requested constraint in `openpackage.yml` (do not rewrite to an exact version).
- **Read from local registry directory**:
  - `~/.openpackage/registry/<name>/<version>/`
- **Apply files to workspace** (share mapping code with `apply`).
- **Update `.openpackage/openpackage.yml`**:
  - Ensure dependency entry preserves `version: <requested>` (range or exact) and does **not** write `path:` for registry installs (it is inferred)
  - The exact installed version and resolved source path are recorded in `.openpackage/openpackage.index.yml`
- **Update unified index** for installed package.

Exit criteria:
- `install` is idempotent and results in a workspace dependency entry with both `version` and `path`.

---

## Phase 6 — `save` (Workspace → Source) for mutable sources only

Deliverable: `save` syncs mapped workspace files back into the package source-of-truth.

Todos:
- **Enforce mutability**: if `packages[name].path` is registry (immutable), fail with a clear error.
- **Read mapping** from unified index:
  - For each mapping entry, copy workspace content back to source path location.
- **Handle missing mappings**:
  - Decide: error vs hint to run `apply/install` first.
  - Recommendation: error with actionable message (“run `opkg apply <name>` or `opkg install ...` to create mappings”).
- **Don’t mutate registry snapshots** under any circumstances.

Exit criteria:
- Given an applied package from a mutable source, edits in `.cursor/...` are synced back to `./.openpackage/packages/<name>/...` (or other mutable `path:`) via `save`.

---

## Phase 7 — `add` (Workspace → Source) for new files + mapping updates

Deliverable: `add` copies new workspace files into the package source and updates unified index mappings.

Todos:
- **Enforce mutability** (same as `save`).
- **Collect input**:
  - Support adding a file or directory path from the workspace.
- **Copy into source tree**:
  - Decide destination within package (spec examples imply user-provided input maps to a package-relative location; likely preserve relative structure).
- **Update unified index**:
  - Add/extend `packages[name].files` to include newly tracked paths.
- **Optional**: `--apply` behavior (if desired): after adding, immediately apply to platforms.

Exit criteria:
- After `opkg add <name> <path>`, the source package contains the added content and the unified index reflects the new mapping.

---

## Phase 8 — `pack` (Source → Registry), directory-based snapshots

Deliverable: snapshot a package source into `~/.openpackage/registry/<name>/<version>/`.

Todos:
- **Read version from source** `openpackage.yml`.
- **Copy package directory** into registry version directory (expanded directory snapshot).
- **Idempotent overwrite**:
  - If version directory exists, overwrite the entire directory (matches `registry.md`).
- **Support options** (from spec):
  - `--output <path>`: copy to target directory instead of registry
  - `--dry-run`: print what would be written

Exit criteria:
- `opkg pack <name>` produces a readable directory snapshot in the registry and does not depend on WIP/stable workspace-hash logic.

---

## Phase 9 — `status` and `uninstall` (workspace lifecycle)

Deliverable: status reporting and removal based on unified index.

Todos:
- **`status`**:
  - Read unified index, iterate packages
  - Validate source path exists
  - For each mapped file, check workspace exists and is “synced” (per Phase 0 decision)
  - Print name, version (if known), sync state, and path
- **`uninstall`**:
  - Read unified index entry
  - Delete mapped workspace files/directories (careful not to delete user files outside mappings)
  - Remove entry from unified index
  - Remove dependency entry from `.openpackage/openpackage.yml`

Exit criteria:
- `status` gives actionable output; `uninstall` removes only managed files and leaves workspace otherwise intact.

---

## Phase 10 — Test plan (must-pass scenarios)

Deliverable: test coverage aligned to spec behaviors, replacing or updating any tests that encode 0.6.x snapshot/WIP semantics.

Todos (high-value):
- **Init**:
  - creates `.openpackage/openpackage.yml` and `.openpackage/openpackage.index.yml`
- **Apply (mutable)**:
  - applies package content to platform dirs
  - writes unified index mapping
- **Save (mutable)**:
  - after editing workspace file, `save` updates source-of-truth
- **Add (mutable)**:
  - adds new files, updates mapping, then `save` round-trips
- **Install (immutable)**:
  - installs from registry, writes manifest `version + path`, updates unified index
- **Save/Add (immutable)**:
  - fails with clear error
- **Pack**:
  - produces `~/.openpackage/registry/<name>/<version>/` directory snapshot
- **Uninstall**:
  - removes mapped files + manifest/index entries only

Exit criteria:
- CI/local `npm test` passes with 0.7.0 semantics.

---

## Locked decisions (confirmed)

- **Compatibility strategy**: **Replace defaults (breaking)**.
- **Conflict strategy** for `apply/install` overwrites: **Reuse existing conflict/overwrite logic in the codebase** (including prompting/flags like `--force`).
- **Status sync detection**: **Hash-based** comparison.
- **Filtering / `include:`**: **Removed** for 0.7.0 (legacy feature; do not implement).
- **Package content rules**:
  - **Authoritative spec**:
    - Payload membership + 1:1 copy boundary: `specs/package/registry-payload-and-copy.md`
    - Universal content vs root-level content + install mapping: `specs/package/universal-content.md`
  - **Payload (copy boundary)**:
    - Always include `openpackage.yml`.
    - Never include `.openpackage/**`, `openpackage.index.yml`, or `packages/**`.
    - May include universal subdirs, root files, `root/**`, and other root-level content (e.g. docs/license) when present.
  - **Installed-by-default behavior**:
    - Universal subdir content is mapped into platform-specific workspace locations.
    - Root files (e.g. `AGENTS.md`, platform root files) are installed to workspace root.
    - `root/**` is installed via direct-copy with the `root/` prefix stripped.
    - Other root-level content may be present in the payload but is not installed by default.

---

## Suggested execution cadence (how we’ll work together)

- We implement **one phase at a time**.
- After each phase:
  - run/extend tests for that phase
  - you review behavior against spec examples
  - then we proceed to the next phase

