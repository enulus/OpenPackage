### Apply – Conflicts

#### 1. Overview

Apply may need to overwrite or reconcile existing files in platform-specific directories. Conflict handling is controlled via install/apply options (notably `conflictStrategy`, `conflictDecisions`, and `--force`).

---

#### 2. Strategies

Supported strategies:

- `ask` (default): prompt when interactive; choose overwrite/skip per path.
- `overwrite`: replace conflicting files.
- `skip`: do not write conflicting files.
- `keep-both`: preserve both versions where supported by the target layout.

CLI mapping:

- `opkg apply` defaults to `ask`.
- `opkg apply --force` uses `overwrite`.
- `opkg save --apply` behaves the same as apply (after the registry write).

---

#### 3. Interactive vs non-interactive

- When stdin/stdout are TTY, apply may prompt for conflict decisions under `ask`.
- In non-interactive contexts, apply must not hang; conflict behavior should resolve deterministically using the provided strategy/decisions.

---

#### 4. Ownership and safety

Apply uses workspace-local indexes (`openpackage.index.yml`) to understand which paths are "owned" by which packages, so it can:

- avoid clobbering other packages’ files where possible, and
- compute deletions for stale paths that were previously installed by this package.

See `index-effects.md` for how apply updates the index after operations complete.

