## Push scoping behavior

### Overview

The `opkg push` command may need to **scope** an unscoped package before pushing it.
Scoping ensures that packages in the remote registry are properly namespaced, e.g. `@user/package`.

This document describes how `push` handles scoping for upload. Scoping is applied **only to the upload payload**; the local registry and workspace stay unchanged.

---

## Scope handling (upload-only)

1. The command looks up `<package-name>` in the local registry using the **input name** (unscoped is allowed).
2. If the name is **unscoped** (e.g. `test`):
   - Authentication is validated using the provided profile/API key.
   - The current username (or profile’s default scope) is resolved.
   - A scoped upload name is computed (e.g. `@user/test`) via the existing prompt/default-scope flow.
   - No local rename occurs; the local registry and workspace remain on the unscoped name.
3. Before tarball creation:
   - The package is cloned in-memory and its `openpackage.yml` `name` field is rewritten to the scoped upload name.
   - The upload payload (full or partial) uses this in-memory manifest, so the remote receives the scoped identity.
4. Version selection and path validation still operate on the local name and local files.

---

## Invariants

- The local registry and workspace are **not** renamed by `push`; the unscoped layout remains intact.
- The upload payload always carries a scoped name (manifest rewritten in-memory) when pushing an unscoped package.
- Version selection and missing-path validation use the local name and files; only the upload name changes for remote interaction.

---

## Relationship to version selection

- Scoping for upload is determined before version selection, but local lookups use the **input name**.
- Version selection (`listPackageVersions`, `packageManager.loadPackage`) is driven by the local name; only the upload payload uses the scoped name.


