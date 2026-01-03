### Install Command Specs

This directory contains specifications for the `install` command, with a focus on:

- **Latest-in-range resolution from local + remote registries**
- **Workspace context**: Installs target effective cwd (shell or global --cwd; see [../../cli-options.md])
- **`openpackage.yml` as the canonical source of dependency intent**
- **Consistent, minimal, npm-inspired UX**
- **Git sources with subdirectory support** for monorepos and Claude Code plugins

The documents are intended to be implementation-guiding but not tied to specific modules.

### Files

- **`install-behavior.md`**: Top-level `opkg install` UX and scenarios (CLI shapes, fresh vs existing deps, dev vs prod). Includes Claude Code plugin support (§8).
- **`git-sources.md`**: Installing packages from git repositories (`git:` and `github:` inputs), including subdirectory support for monorepos and Claude Code plugins.
- **`version-resolution.md`**: Formal rules for "latest in range from local+remote", including pre-release vs stable semantics.
- **`package-yml-canonical.md`**: Rules for treating `openpackage.yml` as the canonical declaration for install.


