### Package Index File (`openpackage.index.yml`)

The `openpackage.index.yml` file tracks the mapping between package files and their **actually installed** workspace locations.

---

#### Location

- **Root package (workspace-local metadata)**: `cwd/.openpackage/openpackage.index.yml`
- **Nested package (cached package root)**: `cwd/.openpackage/packages/<name>/openpackage.index.yml`

> **Note**: `openpackage.index.yml` is **never** included in the registry payload. It's workspace-local metadata.

---

#### Excluded Content

The following files are **never** included in the index, even though they may exist in the package:

| File | Reason |
|------|--------|
| `openpackage.yml` | Package manifest; not synced as a regular content file |
| `openpackage.index.yml` | Index file itself; workspace-local metadata |

The index only contains entries for content that is **actually synced** to workspace locations.

---

#### Structure

```yaml
# This file is managed by OpenPackage. Do not edit manually.

workspace:
  hash: <workspace-hash>
  version: <installed-version>
files:
  <registry-key>:
    - <installed-path>
    - <installed-path>
  <registry-key>:
    - <installed-path>
```

---

#### Registry Keys

Registry keys are **relative to the package root**:

| Content Type | Key Format | Example |
|--------------|------------|---------|
| Universal content | `<subdir>/<file>` | `commands/test.md` |
| Root files | `<filename>` | `AGENTS.md` |
| `root/` directory (direct copy) | `root/<path>` | `root/tools/helper.sh` |

---

#### Values (Installed Paths)

Values are **relative to the workspace root (`cwd`)** and represent **paths that actually exist**:

| Content Type | Value Format | Example |
|--------------|--------------|---------|
| Universal content | Platform-specific paths | `.cursor/commands/test.md`, `.opencode/commands/test.md` |
| Root files | Same as key | `AGENTS.md` |
| `root/` directory (direct copy) | Strip `root/` prefix | `tools/helper.sh` |

> **Important**: The index only records paths where files **actually exist**. If a file is only installed to one platform (e.g., `.cursor/`), only that path appears in the index—not hypothetical paths for other platforms.

---

#### Index Update Behavior

The index is updated differently depending on the operation:

| Operation | Behavior |
|-----------|----------|
| **Add** | Records only the source path that was used to add the file. If you add `.cursor/commands/test.md`, only that path is recorded. |
| **Save** | Writes a registry snapshot; index expansion requires apply (via `save --apply` or separate `apply`). |
| **Apply** | Expands the index to include all platform paths where files were actually created during apply. |
| **Install** | Populates the index with all platform paths where files were installed. |

This ensures the index reflects the **current state** of the workspace, not hypothetical future states.

See `../apply/index-effects.md` for concrete before/after examples.

---

#### Add Command Examples

When adding files, the index only records the **source path that exists**:

| Command | Package | Stored At | Registry Key | Values (in index) |
|---------|---------|-----------|--------------|-------------------|
| `opkg add foo helpers/foo.md` | Nested `foo` | `.openpackage/packages/foo/helpers/foo.md` | `helpers/foo.md` | `helpers/foo.md` |
| `opkg add foo .cursor/commands/foo.md` | Nested `foo` | `.openpackage/packages/foo/commands/foo.md` | `commands/foo.md` | `.cursor/commands/foo.md` (source) |
| `opkg add helpers/foo.md` | Root | `helpers/foo.md` | `helpers/foo.md` | `helpers/foo.md` |
| `opkg add .cursor/commands/foo.md` | Root | `commands/foo.md` | `commands/foo.md` | `.cursor/commands/foo.md` (source) |

**Notes**:
- Platform-specific paths (e.g., `.cursor/commands/foo.md`) are normalized to universal registry paths (e.g., `commands/foo.md`) and stored at the package root.
- Universal content lives directly at the package root (not under `.openpackage/<subdir>/`).
- The index expands to include other platform paths (e.g., `.opencode/commands/foo.md`) only after an apply/sync step runs (e.g., `opkg apply` or `opkg save --apply`). See `../apply/index-effects.md`.


