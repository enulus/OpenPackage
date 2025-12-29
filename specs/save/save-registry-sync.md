### Save – Sync to Source (mapping-driven)

#### 1. Overview

This document covers the key rules for `opkg save`: syncing workspace edits back to a package **source of truth** based on `.openpackage/openpackage.index.yml`.

---

#### 2. Preconditions

- The workspace must have `.openpackage/openpackage.index.yml`.
- The target package must exist in the index under `packages[<name>]`.
- The package entry must have a non-empty `files:` mapping.

If these conditions are not met, `save` should fail with an actionable message instructing the user to run `opkg apply <name>` or `opkg install ...` first.

---

#### 3. Mutability enforcement

`save` must only write to **mutable** sources:

- If the resolved source path is under `~/.openpackage/registry/` (including git clones cached there), the source is **immutable** and `save` must fail.
- If the resolved source path is a mutable packages directory (e.g. `./.openpackage/packages/...` or `~/.openpackage/packages/...`) or another user path, `save` may proceed.

---

#### 4. What is written

For each mapping entry in `packages[<name>].files`:

- **Directory key** (`rules/`, `commands/`, etc.): enumerate files under each mapped workspace directory and write them back into `<source>/<key>/<relative-file>`.
- **File key** (`AGENTS.md`, `root/docs/guide.md`, etc.): write the mapped workspace file back into `<source>/<key>`.

When multiple workspace candidates map to the same destination, conflict resolution is applied (see `save-conflict-resolution.md`).

