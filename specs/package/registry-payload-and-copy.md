### Registry Payload and 1:1 Copy

The **registry payload** for a given version is defined structurally. There is
no manifest-level include/exclude filtering.

---

#### 1. Payload membership

**Never include (always excluded):**
- `.openpackage/**` (workspace-local metadata directory; never part of payload)
- `openpackage.index.yml` (workspace-local index; never part of payload)
- `packages/**` (reserved; never part of payload)

**Always include:**
- `openpackage.yml` (package manifest; marks the package root)

**Included in the payload when present at the package root:**
- Universal subdirs (standard: `commands/`, `rules/`, `agents/`, `skills/`, plus custom from `platforms.jsonc`)
- Root files (e.g., `AGENTS.md`, and platform root files like `CLAUDE.md`)
- `root/**` (direct copy; copied 1:1 to workspace root with `root/` stripped on install)
- Other root-level files/dirs (e.g., `README.md`, `LICENSE.md`, arbitrary folders)

> **Note**: Some root-level content is not installed by default, but it can still be
> part of the payload (e.g., docs or license files).

---

#### Save and Install Operations

**When saving:**

1. The save pipeline reads files from the package root using the rules above
2. Files are written **unchanged** to: `~/.openpackage/registry/<name>/<version>/...`

**When installing:**

1. The install pipeline loads `pkg.files` from the registry
2. Files are written 1:1 to: `cwd/.openpackage/packages/<name>/...` for local cache
3. Universal content is mapped to platform-specific locations in the workspace

---

#### Package Structure in Registry

Registry copies maintain the same structure as workspace packages:

```text
~/.openpackage/registry/<name>/<version>/
  openpackage.yml              # package manifest
  commands/                    # universal content
    test.md
  rules/
    auth.md
  <root-dir>/                  # root-level content (any directory)
    helper.md
  AGENTS.md                    # root files
```

---

#### Guarantees

This system guarantees that:

- The **workspace package**, **local cache**, and **registry version directory** all share the **same tree shape**
- Save and install operations are **pure copies** at the package boundary, without structural rewrites
- Packages can be moved between locations (workspace root ↔ nested ↔ registry) without modification

