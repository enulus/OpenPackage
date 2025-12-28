### Save Pipeline – Registry Writes and WIP Cleanup

#### 1. Overview

This document covers the final stages of the save pipeline: version/index handling, registry writes, and WIP cleanup.

---

#### 2. Version and Index Handling

The pipeline follows these principles (see `../save-pack-versioning.md` for full details):

- The version declared in **`openpackage.yml`** is the **canonical "next stable"** version.
- The **WIP or last stable version** recorded for this workspace lives in `openpackage.index.yml` under `workspace.version`.
- WIP versions are always **pre‑releases derived from the stable line**, including:
  - A time component, and
  - A workspace hash component.

##### On WIP saves

- A new WIP version is computed from the current stable line.
- `openpackage.index.yml` is updated with:
  - `workspace.version` (the exact WIP version).
  - `workspace.hash` (derived from `cwd`).

##### On stable packs

- The stable version is always exactly the value in `openpackage.yml.version`.
- `openpackage.index.yml.workspace.version` is updated to that stable version.

##### Version conflicts

- When `openpackage.yml.version` and the last workspace version disagree, the **`openpackage.yml` version wins**, and the WIP stream restarts from that version.

---

#### 3. Registry Writes

For both modes, once a target version is chosen and content files are resolved:

- The pipeline creates a **full copy** of the package in the local registry under:

  ```
  ~/.openpackage/registry/<finalName>/<targetVersion>/...
  ```

- If a directory already exists for that version:
  - It is fully cleared before writing new contents (unless stable mode is disallowed by a non‑`force` duplicate check).

---

#### 4. WIP Cleanup

##### On WIP saves

After a successful copy:

- The pipeline scans the local registry for WIP versions of the same package that are associated with the current workspace hash.
- All such WIP versions are removed, except the newly created one.

##### On stable packs

After a successful copy:

- The pipeline may also remove WIP versions for this workspace to keep only the stable copy, as described in `../save-pack.md` and `../save-pack-versioning.md`.

---

#### 5. Storage Guarantees

These steps ensure that:

- Stable and WIP versions are both stored as **full, independent copies**.
- Registry storage does not accumulate unbounded, per‑workspace WIP state.

---

#### 6. Platform Apply/Sync (optional)

Save may optionally run apply/sync after writing to the registry via `opkg save --apply`.

The apply/sync specification (behavior, conflicts, index updates) lives under:

- `../apply/README.md`

