### Apply – `openpackage.index.yml` Effects

#### 1. Overview

Apply/sync updates `openpackage.index.yml` to reflect the **actual installed paths** created by apply. This is the mechanism by which the index "expands" from a single source path (recorded by add) to multiple platform paths (after apply).

For the index file format and general semantics, see `../package/package-index-yml.md`.

---

#### 2. Index update behavior by operation

| Operation | Behavior |
|-----------|----------|
| **Add** | Records only the source path used to add the file (e.g., `.cursor/...`). |
| **Apply** | Updates the index to include all platform paths where files were actually created/updated during apply. |
| **Save** | Does not expand mappings; it uses the existing mappings to sync workspace edits back to the package source. |
| **Install** | Populates/updates the index with installed paths as part of install. |

---

#### 3. Before/After examples

**After `opkg add .cursor/commands/test.md`** (only source path recorded):

```yaml
packages:
  my-pkg:
    path: ./.openpackage/packages/my-pkg/
    files:
      commands/test.md:
        - .cursor/commands/test.md    # Only the source path that exists
```

**After `opkg apply`** (all synced paths recorded):

```yaml
packages:
  my-pkg:
    path: ./.openpackage/packages/my-pkg/
    version: 1.0.0
    files:
      commands/test.md:
        - .cursor/commands/test.md    # Original source
        - .opencode/commands/test.md  # Synced by apply
      rules/:
        - .cursor/rules/
      # Note: openpackage.yml is NOT included (it's the manifest, not synced content)
```

---

#### 4. Notes

- The index expands to include other platform paths only **after apply/sync runs** (e.g., `opkg apply`).

