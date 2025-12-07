## Push version selection (stable + unversioned)

### Terminology

- **Stable version**: A semver-valid version with no prerelease segment, e.g. `1.2.3`.
- **Prerelease version**: A semver-valid version with a prerelease segment, e.g. `1.2.3-dev.abc123`.
- **Unversioned package**: A package whose `package.yml` omits `version`; stored under `.../unversioned/` locally. Only one may exist per package and it can be pushed only if the remote has **no versioned releases**.
- **Local registry**: The on-disk package store used by `opkg` (managed via `packageManager`).

This document defines the rules `opkg push` uses to decide **which local version** is eligible to be pushed to the remote registry.

---

## Explicit version: `opkg push <pkg>@<version>`

Given `<pkg>@<version>`:

1. **Prerelease rejection**
   - If `<version>` is a prerelease:
     - The version is **never** considered eligible for push.
     - The user is told that only stable versions of the form `x.y.z` are allowed.
     - The CLI suggests using `opkg pack <package>` to create a stable version.

2. **Existence check**
   - If `<version>` is not a prerelease:
     - The CLI attempts to load `pkg@version` from the local registry via `packageManager.loadPackage`.
     - If this fails with `PackageNotFoundError`:
       - The version is treated as **non-existent**.
       - The user sees a “version not found” message plus a hint to use `opkg pack`.

3. **Safety check**
   - After loading, the resulting `pkg.metadata.version` must still be stable.
   - If it is not (pathological), the push is rejected as a prerelease.

**Result**

- Exactly the requested `<version>` is used as `versionToPush` when it:
  - Exists in the local registry, and
  - Is a stable version.

---

## Implicit version: `opkg push <pkg>`

When no version is explicitly supplied, `opkg push`:

- Considers **all local versions** of `<pkg>`.
- Prefers the **latest stable** version.
- If no stable exists but an **unversioned** entry exists, uses the unversioned entry (still subject to the remote “no versioned releases exist” rule).
- Treats absence of both stable and unversioned as a **non-error** (informational) outcome.

### Algorithm

Let `versions = listPackageVersions(pkg)` (all local versions, as directory names).

1. Compute `latestStable = getLatestStableVersion(versions)` using helpers in `src/utils/package-versioning.ts`:
   - `filterStableVersions(versions)`:
     - Returns only semver-valid, non-prerelease versions.
   - `getLatestStableVersion(versions)`:
     - Applies `filterStableVersions`.
     - If no stable versions remain, returns `null`.
     - Otherwise, returns the highest stable version using `semver.rsort`.

2. If `latestStable === null`:
   - If an **unversioned** entry exists locally:
     - Use the unversioned package as the candidate.
     - Before upload, the CLI rejects if the remote already has any versioned releases.
   - Otherwise:
     - Print the “no stable versions” message and exit with success.

3. If `latestStable` is present:
   - That version becomes the candidate `versionToPush`.
   - The user is asked to confirm before pushing (see behavior spec).

**Notes**

- Prerelease-only packages (e.g. `1.0.0-dev.abc`, `1.0.0-dev.def`) result in `latestStable === null`; if an unversioned entry exists, it is chosen, otherwise informational exit.
- Mixed stable and prerelease sets (e.g. `1.0.0`, `1.1.0-dev.abc`, `1.2.0`) always choose the numerically highest stable (`1.2.0`).

---

## Stable/unversioned guarantees (versioning view)

From the version-selection point of view:

- `push` **never** picks a prerelease version.
- Explicit prerelease inputs are rejected up front.
- Implicit selection:
  - Prefers latest stable.
  - Uses unversioned only when no stable exists and the remote has **no versioned releases**.
  - Ignores prereleases for candidacy.


