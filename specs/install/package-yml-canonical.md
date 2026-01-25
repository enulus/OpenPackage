### `openpackage.yml` as Canonical for Install

This document defines how `openpackage.yml` interacts with the `install` command, and what it means for `openpackage.yml` to be the **canonical** declaration of dependency intent.

The aim is to make behavior predictable and avoid “CLI overrides” that silently diverge from `openpackage.yml`.

---

## 1. Canonical responsibility

- **Canonical source of truth**:
  - For the **current workspace**, `openpackage.yml` is the **only authoritative declaration** of:
    - Which **direct dependencies** exist.
    - Which **source** and **version intent** apply to those dependencies.
  - This applies to both:
    - `dependencies` (regular dependencies).
    - `dev-dependencies` (development dependencies).

- **Install’s role**:
  - `install` **never changes intent by itself**:
    - It does **not mutate existing ranges** in `openpackage.yml` unless explicitly asked by a future higher-level command (e.g. an `upgrade`).
    - It **materializes or refreshes** dependencies so the workspace matches the declared intent.

---

## 2. Direct vs transitive dependencies

- **Direct dependencies**:
  - Declared in the workspace `openpackage.yml`.
  - Fully controlled by the user.
  - Canonical range comes from `openpackage.yml`.

- **Transitive dependencies**:
  - Declared in other packages’ `openpackage.yml` files (inside registry packages).
  - Resolved entirely by the dependency resolver according to version constraints; they do not appear in the root `openpackage.yml`.
  - `install` may upgrade them within the declared ranges, but they are **not canonical at the root level**.

---

## 3. Mapping CLI input to canonical ranges

### 3.0 Dependency entry schema (source fields)

Each dependency entry MUST specify **exactly one** source field:

- `version`: a registry range or exact version (`^1.2.0`, `1.2.3`, `*`, etc.)
- `path`: a filesystem path to a package directory or tarball
- `git`: a git URL (https/ssh/etc.) with optional `ref`

Additional rules:

- `ref` is only valid when `git` is present.
- A dependency entry MUST NOT specify multiple sources (e.g. `version` + `path`).

This keeps dependency intent unambiguous and aligns with modern package managers that treat source types as mutually exclusive.

### 3.1 Fresh packages (not yet in `openpackage.yml`)

- **Case A – `opkg install <name>`**:
  - No explicit range is provided.
  - The CLI:
    - Resolves **latest suitable version** from local+remote (see `version-resolution.md`).
    - Adds `<name>` to `openpackage.yml` with a **default range derived from that version**, e.g.:
      - `^S` where `S` is the selected stable version.
      - If only a pre-release exists, the policy may:
        - Use an **exact pre-release version** in `openpackage.yml`, or
        - Use a range that explicitly includes that pre-release.
      - If the selected version is **unversioned** (manifest omits `version`, represented as `0.0.0` internally), persist the dependency entry **without a `version` field** (bare name), rather than writing `0.0.0`.

- **Case B – `opkg install <name>@<spec>`**:
  - `<spec>` is treated as the **initial canonical range** for `<name>`.
  - The resolver:
    - Uses `<spec>` as the range for selecting a concrete version.
    - On success:
      - Installs the selected version.
      - **Persists `<spec>` as-is** in `openpackage.yml` (except for any normalization strictly required by the version-range parser).

### 3.2 Existing packages (already in `openpackage.yml`)

- Let **`R_pkg`** be the range string stored in `openpackage.yml` for `<name>`.

- **Case C – `opkg install <name>`**:
  - The canonical range is **`R_pkg`**.
  - Any pre-existing installed version is considered **derived from `R_pkg`**.
  - Behavior:
    - Resolve the **latest-in-range** version from local+remote using `R_pkg`.
    - If a newer satisfying version exists, **upgrade** the installed version.
    - `R_pkg` itself is **not changed**.

- **Case D – `opkg install <name>@<spec>`**:
  - CLI `<spec>` is treated as a **constraint hint**, **not** a new canonical source.
  - The system:
    - Parses both `<spec>` and `R_pkg`.
    - Checks for **compatibility**:
      - Informally: `<spec>` must not *contradict* `R_pkg`.
      - Implementation may use:
        - A simple rule (e.g. they must be **semver-equivalent** or one must semantically be a subset of the other).
    - Outcomes:
      - If `<spec>` is **compatible** with `R_pkg`:
        - Proceed using **`R_pkg` as the effective range** for resolution.
        - Optionally log a message: “Using version range from openpackage.yml (`R_pkg`); CLI spec `<spec>` is compatible.”
      - If `<spec>` is **incompatible** with `R_pkg`:
        - **Fail with a clear error**, for example:
          - “Version spec `<spec>` conflicts with `openpackage.yml` range `R_pkg` for `<name>`. Edit `openpackage.yml` if you intend to change the dependency line.”
        - No installs or upgrades are performed.

### 3.3 Path and git dependencies (non-registry sources)

When a dependency uses `path` or `git`, it is treated as a **source-pinned** dependency rather than a semver-ranged registry dependency:

- The installed content is loaded from that source.
- The installed package version comes from the dependency’s own `openpackage.yml`.
- `install` MUST NOT write a registry `version` range for `path`/`git` dependencies.

For git dependencies:

- `git` stores the repository URL.
- `ref` optionally stores the branch/tag/commit provided by the user.

---

## 4. When and how `openpackage.yml` is mutated

### 4.1 Allowed mutations by `install`

- **Adding new dependencies**:
  - `install` may **append** new entries to:
    - `dependencies` (by default), or
    - `dev-dependencies` (when `--dev` is provided).
  - It **must not**:
    - Remove existing entries.
    - Rewrite existing version ranges.

- **Adding source-pinned dependencies**:
  - When installing from `path` or `git`, `install` persists the dependency using the corresponding source fields.
  - It must not add a `version` field in these cases (source-pinned dependencies are not semver-ranged).

- **Rewriting malformed entries (edge case)**:
  - If `openpackage.yml` contains a **syntactically invalid** version range for a dependency that the user is trying to install:
    - The primary expectation is to **fail with a clear error** and ask the user to fix the YAML.
    - Auto-rewriting malformed entries should **not** happen silently.

### 4.2 Mutations by other commands

- `install` assumes that:
  - `pack` and any future `upgrade`-like commands are responsible for:
    - Intentionally changing version lines.
    - Bumping base versions for stable lines.
  - Therefore, `install` **never auto-bumps** the declared ranges in `openpackage.yml`.

- **Auto-tracking of workspace-owned packages (`pack`)**:
  - When a package developed in the current workspace is first added as a dependency:
    - `pack` persists a **default caret range** derived from the new stable, e.g. `^1.2.3`.
  - On subsequent `pack` operations for that same package:
    - Let `R_pkg` be the existing range in `openpackage.yml` and `S_new` the new stable base version (e.g. `2.0.0`).
    - **Special case: Prerelease-to-stable transition during `pack`**:
      - If `R_pkg` includes explicit prerelease intent (e.g. `^1.0.0-0`) and `S_new` is a stable version on the same base line (e.g. `1.0.0`):
        - Then `pack` **updates** `R_pkg` to a stable range (e.g. `^1.0.0`) to reflect the transition from prerelease to stable.
      - This exception **only applies** when transitioning from a prerelease-intent constraint to a stable target; subsequent stable version changes within the stable range do not update `R_pkg`.
    - If `S_new` **already satisfies** `R_pkg` (e.g. `R_pkg = ^1.0.0`, `S_new = 1.0.1`):
      - **The constraint is left unchanged**; `pack` does not rewrite `R_pkg`.
    - If `S_new` is **outside** `R_pkg` (e.g. `R_pkg = ^1.0.0`, `S_new = 2.0.0`):
      - `pack` may **auto-update** the dependency line in `openpackage.yml` to a new caret range `^S_new` to keep the workspace tracking the new stable line.
  - This auto-tracking behavior:
    - Applies only to dependencies managed via `pack` for workspace-owned packages.
    - Never changes constraints that already include the new stable version (except for the prerelease-to-stable transition exception above).

---

## 5. Conflict scenarios & UX

### 5.1 CLI vs `openpackage.yml` disagreement

- **Scenario**:
  - `openpackage.yml`: `foo: ^1.2.0`
  - User runs: `opkg install foo@2.0.0`

- **Behavior**:
  - Detect that `<spec> = 2.0.0` is **outside** `^1.2.0`.
  - Fail with a message similar to:
    - “Requested `foo@2.0.0`, but `openpackage.yml` declares `foo` with range `^1.2.0`. Edit `openpackage.yml` to change the dependency line, then re-run `opkg install`.”

### 5.2 Existing install but changed `openpackage.yml`

- **Scenario**:
  - Previously: `foo` declared as `^1.2.0`, installed `1.3.0`.
  - User edits `openpackage.yml` to `foo: ^2.0.0`.
  - Then runs `opkg install` or `opkg install foo`.

- **Behavior**:
  - Treat the new `^2.0.0` as **canonical**.
  - Compute latest-in-range from local+remote under `^2.0.0`.
  - Install or upgrade to that version, even if it requires pulling from remote.
  - Optionally log a message noting that the base line changed, similar to the pack reset messages (but this is informational only).

### 5.3 Dependency removed from `openpackage.yml`

- **Scenario**:
  - `foo` used to be in `openpackage.yml`.
  - User removes `foo` from both `dependencies` and `dev-dependencies`.
  - `foo` may still be installed under `.openpackage` from a previous state.

- **Behavior on `opkg install`**:
  - `foo` is no longer considered a **direct dependency** of the workspace.
  - **No new installs/upgrades** of `foo` are performed as part of the root install.
  - Cleanup of now-unused packages is handled by `uninstall` / pruning flows, not by `install`.

---

## 6. Partial installs via `files`

- **Meaning**:
  - `files` is an optional array of **registry-relative paths** on a dependency entry (`dependencies` or `dev-dependencies`).
  - When present, the dependency is treated as a **partial install**: only the listed registry paths are installed (root files are included only if explicitly listed).

- **Canonical behavior**:
  - Fresh installs invoked with registry-path syntax (`opkg install <name>/<registry-path>`) **persist** a deduped, normalized `files` list for that dependency.
  - Re-installs with an existing `files` list **reuse** that list as canonical; a TTY prompt may offer to clear it to switch back to a full install.
  - Supplying a new path via CLI for a dependency that already has `files` **adds** the path (deduped) before install.
  - Removing the `files` field (or setting it to `null`/empty) returns the dependency to **full-install semantics**.
  - If a dependency is currently full (no `files`), a path-based install attempt is **rejected**; convert to partial by editing `openpackage.yml` or reinstalling after removal.

- **Matching rules**:
  - Paths in `files` are **exact registry paths** (no globs) and are normalized when persisted.
  - These paths apply to the **root dependency only**; transitive dependencies remain governed by their own manifests.

---

## 7. Summary invariants

- **I1 – Canonical intent**:
  - For direct dependencies, **`openpackage.yml` is always the source of truth**.
  - CLI specs cannot silently override it; at most they can:
    - Seed new entries (fresh installs).
    - Act as compatibility hints for existing entries.

- **I2 – Install does not rewrite intent**:
  - `install`:
    - Does **not mutate existing version ranges**.
    - Only **adds new entries** when installing fresh dependencies.

- **I3 – Explicit edits for semantic changes**:
  - To change which major version line a dependency tracks, the user **edits `openpackage.yml`**, not `install` flags.
  - This mirrors the mental model from the pack specs:
    - “`openpackage.yml` version is what I’m working toward; commands operate relative to that declaration.”


