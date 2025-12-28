### Apply Specs

This directory defines the behavior of **apply** (a.k.a. platform apply/sync): projecting a package's canonical content into **platform-specific workspace layouts**, and updating `openpackage.index.yml` to reflect what is actually installed.

Apply can be triggered in two ways:

- `opkg apply` – explicit apply/sync.
- `opkg save --apply` – save to the local registry and then apply/sync.

> `opkg save` / `opkg pack` without `--apply` write registry snapshots but do not mutate platform workspaces.

---

#### Documents

| File | Topic |
|------|-------|
| `apply-command.md` | CLI contract: args, flags, and examples |
| `apply-behavior.md` | What apply does (create/update/delete), timing, and root-package considerations |
| `conflicts.md` | Conflict handling (interactive vs non-interactive) and strategies |
| `index-effects.md` | How apply affects `openpackage.index.yml`, including before/after examples |

