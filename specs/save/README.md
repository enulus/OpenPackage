### Save Pipeline Specs

This directory contains specifications for the **`save` behavior** in the v0.7.0 model:

- `opkg save`: **Workspace → Source** (sync workspace edits back to a mutable package source)

These docs are **behavioral**: they describe features and logic, not specific modules or functions.

Key integration: Save ops use effective cwd (shell or --cwd; see [../../cli-options.md]) for workspace/package detection.

---

#### Pipeline Flow

`save` executes in this order:

1. **Read workspace index** → Load `.openpackage/openpackage.index.yml` and find mappings for the package
2. **Resolve package source** → Determine the source-of-truth path (`path:`/`git:`/registry) for the package
3. **Enforce mutability** → `save` must fail for immutable sources (registry paths)
4. **Build candidates from mappings** → Collect workspace candidates for the mapped file/dir keys
5. **Conflict resolution** → Choose which workspace candidate wins when multiple map to the same destination
6. **Write back to source** → Update the package source tree

---

#### Files

| File | Topic |
|------|-------|
| `save-modes-inputs.md` | Overview, inputs, and flags |
| `save-conflict-resolution.md` | Conflict resolution rules and platform-specific selection |
| `save-frontmatter-overrides.md` | Markdown frontmatter extraction and YAML overrides (when applicable) |
| `save-registry-sync.md` | Save-to-source specifics: mutability, mapping-driven writes, and error cases |

---

#### Related Documents

- `../save-pack.md` – High‑level split between `save` and `pack` commands (v0.7.0 behavior).
- `../package/package-index-yml.md` – Unified workspace index schema used by `save`.
