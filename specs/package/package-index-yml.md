### Workspace Index File (`.openpackage/openpackage.index.yml`)

The `openpackage.index.yml` file is the **unified workspace index**. It tracks:

- Installed packages (by name)
- Each package’s resolved **source path**
- Optional resolved **version**
- The file/directory mapping from **package-relative paths** to **workspace paths that were actually written**

---

#### Location

- **Workspace-local metadata**: `cwd/.openpackage/openpackage.index.yml`

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

packages:
  <package-name>:
    path: <declared-path>        # string from openpackage.yml (relative or ~) or inferred registry path
    version: <installed-version> # optional semver string
    dependencies:                # optional cached direct deps (names)
      - <dep-name>
    files:
      <registry-key>:
        - <installed-path>
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
| Directory mapping | `<dir>/` (trailing slash) | `rules/` |

---

#### Values (Installed Paths)

Values are **relative to the workspace root (`cwd`)** and represent **paths that actually exist**:

| Content Type | Value Format | Example |
|--------------|--------------|---------|
| Universal content | Platform-specific paths | `.cursor/commands/test.md`, `.opencode/commands/test.md` |
| Root files | Same as key | `AGENTS.md` |
| `root/` directory (direct copy) | Strip `root/` prefix | `tools/helper.sh` |
| Directory mapping | Workspace directory paths (end with `/`) | `.claude/rules/`, `.cursor/rules/` |

> **Important**: The index only records paths where files **actually exist**. If a file is only installed to one platform (e.g., `.cursor/`), only that path appears in the index—not hypothetical paths for other platforms.

---

#### Index Update Behavior

The unified workspace index is updated differently depending on the operation:

| Operation | Behavior |
|-----------|----------|
| **Add** | Does **not** update the index. Add operates on package sources independently of workspace installation state. To sync added files to workspace and update the index, run `install` + `apply` or use `add --apply`. |
| **Apply** | Writes/updates `packages[<name>].files` based on what was actually written during apply. |
| **Install** | Writes/updates `packages[<name>].files` based on what was installed. |
| **Save** | Uses `packages[<name>].files` as the authoritative mapping when syncing workspace edits back to the package source. Requires package to be installed (reads from index). |

This ensures the index reflects the **current state** of the workspace, not hypothetical future states.

**Key principle**: The index is a record of what exists in the workspace, not what exists in package sources. Commands that materialize content to the workspace (`install`, `apply`) update the index. Commands that only modify sources (`add`) do not.

See `../apply/index-effects.md` for concrete before/after examples.

