### Save Pipeline – Modes and Inputs

#### 1. Overview

The **save pipeline** is the shared engine behind:

- `opkg save` – creates a **WIP prerelease** snapshot for the current workspace.
- `opkg pack` – promotes the current workspace state to a **stable** snapshot.

Both commands:

- Detect which package to operate on.
- Resolve the effective package name (including scoping and optional rename).
- Compute a target version (WIP vs stable) following `save-pack-versioning.md`.
- Select the set of files that belong to the package.
- Copy those files into the local registry.
- Clean up outdated WIP copies for the current workspace.
- Optionally apply/sync files to platform‑specific layouts (see `opkg apply`, or `opkg save --apply`).

Versioning details are defined in `../save-pack-versioning.md`.

---

#### 2. Modes

The pipeline runs in one of two **modes**:

##### WIP mode (`save`)

- Always produces a **WIP prerelease** version derived from the stable line in `openpackage.yml`.
- May optionally auto‑bump `openpackage.yml.version` to the next patch after a stable cycle, per `../save-pack-versioning.md`.

##### Stable mode (`pack`)

- Produces a **stable** version exactly equal to the current `openpackage.yml.version`.
- Never mutates `openpackage.yml.version`.

---

#### 3. Inputs

- **Working directory (`effective cwd` via shell dir or global `--cwd <dir>` flag)** – establishes the workspace root for file discovery, package detection, and saving (see [../cli-options.md]).
- **Package name argument (optional)** – may be omitted (context detection) or provided explicitly.
- **Optional path argument (when package is provided)** – `opkg save <package> <path>` first runs the add pipeline for that path (including conflict handling and optional platform-specific transforms) and then saves the package snapshot.

---

#### 4. Flags

- **`force`**
  - In WIP mode: can suppress prompts and allow overwriting existing WIP versions.
  - In stable mode: allows overwriting existing stable registry entries.
- **`rename <newName>`** – optional new package name to apply during this pipeline run.
- **`platform-specific` (save only, when path is provided)** – forwarded to the add stage to generate platform-scoped variants for platform subdirectories.
- **`apply` (save only)** – when set, runs the platform apply/sync step after the registry write completes.

