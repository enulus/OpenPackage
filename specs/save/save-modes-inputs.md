### Save – Inputs and Flags

#### 1. Overview

`opkg save` syncs workspace edits back to a package **source of truth** using the unified workspace index (`.openpackage/openpackage.index.yml`) as the mapping authority.

It does **not** create registry snapshots (that is `opkg pack`).

---

#### 3. Inputs

- **Working directory (`effective cwd` via shell dir or global `--cwd <dir>` flag)** – establishes the workspace root for file discovery, package detection, and saving (see [../cli-options.md]).
- **Package name argument (required)** – `save` requires a package name because it operates on mappings stored in the unified workspace index.
- **Optional path argument** – `opkg save <package> <path>` first runs the add pipeline for that path (copy-to-root for non-platform paths), then runs `save` for the package.

---

#### 4. Flags

- **`force`**
  - Auto-selects by latest mtime when conflicts occur (non-interactive resolution).
- **`platform-specific` (only when path is provided)** – forwarded to the add stage to generate platform-scoped variants for platform subdirectory inputs.
- **`apply` (only when path is provided)** – forwarded to the add stage to immediately apply after adding (sync platforms).

