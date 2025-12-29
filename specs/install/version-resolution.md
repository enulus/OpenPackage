### Install Version Resolution – Local + Remote

This document specifies how `install` chooses **which concrete version** of a package to install, given:

- A **package name**.
- An **effective version constraint** (from `openpackage.yml` and/or CLI).
- Access to **local registry versions** and optionally **remote registry metadata**.

The goal is to implement **“latest in range from local+remote”** deterministically, with clear pre-release vs stable semantics.

---

## 1. Inputs and terminology

- **Name**: package name, e.g. `formula-main`.
- **Constraint**:
  - A string understood by `version-ranges` (exact, caret, tilde, wildcard, comparison).
  - Examples: `1.2.3`, `^1.2.0`, `~2.0.1`, `>=3.0.0 <4.0.0`, `*`, `latest`.
- When a dependency entry in `openpackage.yml` omits `version`, the effective constraint is treated as `*` (wildcard).
- **Local versions**:
  - Semver versions discoverable via `listPackageVersions(name)` from the **local registry**.
  - May include a `0.0.0` entry when the package has no `version` in `openpackage.yml`.
  - Includes both **stable** and **pre-release** semver versions, e.g. `1.2.3`, `1.2.3-beta.1`.
- **Remote versions**:
  - Semver versions discoverable via remote metadata APIs (e.g. via `fetchRemotePackageMetadata` / registry metadata).
  - May include a `0.0.0` entry when the remote package has no versioned releases yet.
  - Only includes **stable** semver versions.

---

## 2. Effective available versions

- **Base rule**:
  - The **effective `available` set** depends on the resolution mode and scenario, and this rule is applied **uniformly** to:
    - The **root package** being installed.
    - **All recursive dependencies** discovered from `openpackage.yml` files.
    - Any **pre-flight checks or validations** that need to answer “what version would be chosen?” for a given name + constraint.
    - **Local-only / explicit `--local`**:
      - **`available = local`**.
      - Remote metadata is **never** consulted; if no satisfying local version exists, resolution fails (see error behavior).
    - **Fresh dependency installs in default mode** (e.g. `opkg install <name>` or `opkg install <name>@<spec>` where `<name>` is **not yet declared** in `openpackage.yml`):
      - Version selection is **local-first with remote fallback**, regardless of whether the effective constraint is a wildcard or an explicit range:
        - Step 1 – **Local-only attempt**:
          - Start with **`available_local = local`**.
          - Attempt selection using only `available_local` (see §4–§6).
        - Step 2 – **Fallback to remote when local cannot satisfy**:
          - If **no local versions exist at all**, or
          - No local versions satisfy the effective constraint:
            - When remote metadata is available:
              - Fetch remote versions and compute **`available = dedup(local ∪ remote)`**.
              - Re-run selection against this expanded `available` set.
            - When remote metadata is not available (network error, misconfiguration, unauthenticated, etc.):
              - Resolution fails with a clear error that:
                - Explains that no satisfying local version exists, and
                - Mentions that remote lookup also failed (or was disabled).
    - **Existing dependencies in default mode** (e.g. entries already in `openpackage.yml`, or dependencies declared in nested `openpackage.yml` files during recursive resolution):
      - Resolution also follows a **local-first with remote fallback** policy:
        - Step 1 – **Local-only attempt**:
          - Use **only local registry versions** that match the declared range to build `available_local`.
        - Step 2 – **Fallback to remote when local cannot satisfy**:
          - If **no local versions exist at all**, or
          - No local versions satisfy the effective constraint:
            - When remote metadata is available:
              - Fetch remote versions and compute **`available = dedup(local ∪ remote)`**.
              - Re-run selection against this expanded `available` set.
            - When remote metadata is not available:
              - Resolution fails with a clear error explaining that no satisfying local version exists and remote lookup failed or was disabled.

- **Deduping**:
  - Versions are deduped by their **full semver string** (`1.2.3-000fz8.a3k` vs `1.2.3` are distinct).

- **Ordering**:
  - Use standard semver descending order for selection (`semver.compare(b, a)` semantics).
  - `0.0.0` participates as a normal semver version (it will naturally sort below any higher version).

---

## 3. Constraint parsing

- **Parsing**:
  - All constraints are parsed via `parseVersionRange` or equivalent.
  - Supported types:
    - **exact** (`1.2.3`)
    - **caret** (`^1.2.3`)
    - **tilde** (`~1.2.3`)
    - **wildcard** (`*`, `latest`)
    - **comparison** (`>=1.0.0 <2.0.0`, `>=2.0.0-0`, etc.)

- **Invalid constraints**:
  - If the constraint string cannot be parsed:
    - The install operation **fails early** with a clear error.
    - The user is instructed to fix the version in `openpackage.yml` for canonical cases, or in the CLI for fresh installs.

---

## 4. Selection algorithm (high level)

Given `available: string[]` and a parsed constraint:

- **If constraint is `exact`**:
  - **Pick that exact version** if it exists in `available`.
  - Otherwise:
    - Fail with **"version not found"** and list the nearest available versions (see error UX section).

- **If constraint is `wildcard` / `latest`** (default behavior):
  - Use `semver.maxSatisfying(available, '*', { includePrerelease: true })` to find the **highest semver version**.
  - **Select the single highest semver version**, stable or pre-release (if only `0.0.0` exists, it is selected).
  - If the selected version is a pre-release, the CLI should make that explicit in its output.

- **If constraint is `caret`, `tilde`, or `comparison`** (default behavior):
  - Use `semver.maxSatisfying(available, range, { includePrerelease: true })` to find the **highest satisfying version**.
  - **Select that version** (stable or pre-release). `0.0.0` satisfies ranges according to standard semver rules.
  - No additional "downgrade pre-release to stable" heuristic is applied; pre-release versions are first-class semver versions for resolution purposes.

- **With `--stable` flag**:
  - The selection follows the **stable-preferred policy** described in §5.2.
  - For wildcard/ranges: if any satisfying stable version exists, pick the **latest satisfying stable**.
  - Only pick a pre-release when **no satisfying stable exists at all**.

If no version satisfies the constraint:

- The operation **fails** with:
  - A clear description of:
    - The requested range.
    - The set of available stable and pre-release versions.
  - Suggestions for:
    - Editing `openpackage.yml` to broaden the range.
    - Using `pack` (or pulling from remote) to create a compatible version.

---

## 5. Pre-release vs stable selection policy

### 5.1 Definitions

- Let **`S`** be a stable version string, e.g. `1.2.3`.
- Let **`P(S)`** be the set of pre-release versions derived from `S`, e.g.:
  - `1.2.3-beta.1`.

### 5.2 Default policy: Latest wins (stable and pre-release treated uniformly)

- **Latest-in-range selection**:
  - Among all versions that satisfy the constraint, **choose the highest semver version** according to normal semver ordering (with pre-releases ordered per semver).
  - Pre-release versions are first-class semver versions; there is no special demotion to their base stable.
  - This ensures that `opkg install <name>` naturally selects the newest available version, including pre-releases, which can be useful for development workflows.

- **Pre-release transparency**:
  - When the chosen version is a pre-release, the CLI **surfaces that fact** in messages and summaries, but does not alter the chosen version.
  - This helps users understand when they're working with pre-release code.

### 5.3 Stable-preferred policy (used with `--stable` flag)

- **Stable dominates pre-release for the same base line**:
  - If both:
    - A stable `S`, and
    - One or more pre-releases in `P(S)`
    **satisfy the constraint**, then:
    - **Select `S`**, even if some pre-releases have a higher pre-release ordering.
  - Rationale:
    - Matches the mental model that **packed stable** is the canonical release.
    - Useful for CI/production scenarios where stability is preferred.

- **Pre-release only when stable is not an option**:
  - If:
    - No stable versions exist in `available` that satisfy the constraint, but
    - One or more pre-release versions do:
    - The resolver picks the **latest pre-release** that satisfies the constraint.
  - For implicit "latest" / wildcard constraints:
    - If **any stable versions** exist at all for that package (even if outside the requested range), prefer telling the user to **widen the range** rather than silently pulling a pre-release.

---

## 6. Behavior per constraint type

### 6.1 Exact versions (incl. exact pre-release)

- **Example**: `install foo@1.2.3-beta.1`.
- Behavior:
  - Use **exact match**:
    - If that exact version is in `available`, select it.
    - Otherwise, fail with **“exact version not found”**, show nearby versions.
  - No additional pre-release/stable heuristics are applied.

### 6.2 Wildcard / latest (`*`, `latest`)

- **Fresh dependency default (wildcard)**:
  - For `opkg install <name>` where `<name>` is not yet in `openpackage.yml` and the effective constraint is wildcard/latest:
    - Resolution follows the **local-first with remote fallback** policy (see §2 and §7):
      - First, attempt selection using **only local versions** as `available`.
      - If no local versions exist, or none satisfy the wildcard constraint:
        - When remote metadata is available, expand `available` to **`dedup(local ∪ remote)`** and retry selection.
        - Only if **no satisfying version exists in either local or remote**, or remote lookup fails, does the operation error.

- **Default behavior (given an `available` set)**:
  - Use `semver.maxSatisfying(available, '*', { includePrerelease: true })` to find the **highest semver version**.
  - Select that version (stable or pre-release).
  - If the selected version is a pre-release, the CLI output should make that explicit.

- **With `--stable` flag**:
  - If **stable versions exist** in `available`, select the **latest stable**.
  - If **no stable versions exist**:
    - Select the **latest pre-release**.
    - The summary should make it explicit that a **pre-release** was chosen.

### 6.3 Caret / tilde (`^`, `~`)

- **Default behavior**:
  - Use `maxSatisfying` with `{ includePrerelease: true }` to find the **highest satisfying version**.
  - Select that version directly (stable or pre-release), using the `available` pool determined by the mode and scenario in §2–§3 (including local-first-with-fallback for fresh dependencies).

- **With `--stable` flag**:
  - Use `maxSatisfying` with `{ includePrerelease: true }` to find the **highest satisfying version**.
  - Then:
    - If that best version is **stable**, use it.
    - If it is a **pre-release**:
      - Check whether the **base stable line** of that pre-release (`S`) also has a stable version in `available` satisfying the range.
      - If yes, **pick `S` instead**.
      - If no, accept the pre-release version.

### 6.4 Comparison ranges

- **Default behavior**:
  - Use `semver.maxSatisfying(available, range, { includePrerelease: true })` to find the **highest satisfying version**.
  - Select that version directly (stable or pre-release), using the `available` pool determined by the mode and scenario in §2–§3 (including local-first-with-fallback for fresh dependencies).

- **With `--stable` flag**:
  - Same as caret/tilde with `--stable`, but using the exact comparison string.
  - The stable-preferred rules from §5.3 apply.

---

## 7. Local vs remote precedence

- **Default mode**:
  - For **all dependency resolutions in default mode** (root package and recursive dependencies, whether or not they are already declared in some `openpackage.yml`):
    - The resolver behaves as **local-first with automatic fallback to remote** as described in §2:
      - It first attempts to satisfy the effective constraint using **local versions only**.
      - If no satisfying local version exists, it **includes remote versions** (when available) and retries selection over the combined set.
      - Only when **neither local nor remote** can satisfy the constraint does it fail with a “no matching versions found” style error.
  - For **fresh dependencies** (`opkg install <name>` or `opkg install <name>@<spec>` where `<name>` is not yet in `openpackage.yml`, and `--local` is **not** set):
    - This is just a special case of the general rule above, where the dependency is being introduced for the first time into the workspace.

- **`--remote` mode**:
  - Remote metadata is treated as **authoritative** for which versions exist.
  - Local-only versions **not present in remote metadata** are ignored for selection.
  - This guarantees that installed versions are **publishable/known remotely**.

---

## 8. Examples (informal)

These examples assume remote is reachable.

- **Example 1 – Simple caret range**:
  - `openpackage.yml`: `foo: ^1.2.0`
  - Local: `1.2.3`, `1.3.0`
  - Remote: `1.3.1`
  - Selected: **`1.3.1`**.

- **Example 2 – Pre-release and stable (default behavior)**:
  - `openpackage.yml`: `foo: ^1.2.0`
  - Local: `1.2.3-beta.1`, `1.2.3`, `1.3.0-beta.2`
  - Remote: `1.3.0`
  - Satisfying: `1.2.3`, `1.3.0-beta.2`, `1.3.0`
  - Selected: **`1.3.0`** (highest semver version).
  - With `--stable`: **`1.3.0`** (same result, stable preferred).

- **Example 2b – Pre-release and stable (pre-release is newer)**:
  - `openpackage.yml`: `foo: ^1.2.0`
  - Local: `1.2.3`, `1.3.0-beta.2`
  - Remote: `1.3.0`
  - Satisfying: `1.2.3`, `1.3.0-beta.2`, `1.3.0`
  - Selected (default): **`1.3.0-beta.2`** (highest semver, even though pre-release).
  - With `--stable`: **`1.3.0`** (stable preferred over pre-release).

- **Example 3 – No stable exists**:
  - `openpackage.yml`: `foo: ^1.0.0-0` (or explicit pre-release).
  - Local: none.
  - Remote: `1.0.0-beta.1`, `1.0.1-beta.1`
  - Selected: **`1.0.1-beta.1`**.

- **Example 4 – Wildcard with only pre-releases**:
  - CLI: `install foo` (fresh dep, default wildcard internally).
  - Local: none.
  - Remote: `0.1.0-beta.1`
  - Selected: **`0.1.0-beta.1`**, but:
    - The CLI should make it clear the installed version is a **pre-release**.
    - The stored range in `openpackage.yml` may be **exact** or chosen policy-driven (e.g. exact pre-release string).

---

## 9. Content resolution for pre-release versions

Version resolution chooses **which version string** to install; this section summarizes how content for **local pre-release versions** is sourced, and defers full behavior to `install-behavior.md`.

- **Local pre-release versions as full copies**:
  - When the selected version is a pre-release that exists locally, it is represented as a **full copied package** in the registry:
    - Path: `~/.openpackage/registry/<pkg>/<version>/...`.
    - The loader must:
      - Load package files directly from that directory.
      - Read the `openpackage.yml` from that directory for metadata.
  - The resolved version string still participates in semver ordering and dependency resolution as specified above.

- **Remote pre-releases**:
  - Remote registries may expose copied artifacts for pre-release versions.
  - Pre-release versions from remote are treated the same as stable versions for content loading (normal registry copies).

- **Error behavior**:
  - If a pre-release version is selected but its registry directory is missing or malformed:
    - The install operation should fail with a clear error instead of silently falling back to another version.
    - The error should point to:
      - The problematic version string.
      - The expected registry path.
      - Suggested remediation (re-pack / re-pull, or choose a different version).


