### Install Command Specs

This directory contains specifications for the `install` command, with a focus on:

- **Latest-in-range resolution from local + remote registries**
- **Workspace context**: Installs target effective cwd (shell, global --cwd, or home directory with --global; see [../../cli-options.md])
- **Global installation mode**: Install to home directory (`~/`) with `-g, --global` flag
- **`openpackage.yml` as the canonical source of dependency intent**
- **Consistent, minimal, npm-inspired UX**
- **Git sources with subdirectory support** for monorepos and Claude Code plugins
- **Cross-platform conversion** via Universal Platform Converter (automatic format detection and conversion)

The documents are intended to be implementation-guiding but not tied to specific modules.

### Files

#### Core Installation

- **`install-behavior.md`**: Top-level `opkg install` UX and scenarios (CLI shapes, fresh vs existing deps, dev vs prod). Includes Claude Code plugin support (§9) with Universal Converter integration.
- **`git-sources.md`**: Installing packages from git repositories (`git:` and `github:` inputs), including subdirectory support for monorepos and Claude Code plugins. Covers scoped naming for GitHub plugins.
- **`git-cache.md`**: Structured Git cache architecture at `~/.openpackage/cache/git/` with deterministic paths, automatic reuse, and metadata tracking.
- **`version-resolution.md`**: Formal rules for "latest in range from local+remote", including pre-release vs stable semantics.
- **`package-yml-canonical.md`**: Rules for treating `openpackage.yml` as the canonical declaration for install.

#### Claude Code Plugin Installation

- **`plugin-installation.md`**: Complete specification for Claude Code plugin installation including detection, transformation, and source handling. Covers individual plugins and marketplace plugins with all supported source types.
- **`marketplace-installation.md`**: Detailed marketplace installation workflow including manifest parsing, plugin selection, and multi-plugin installation. Covers relative path, GitHub, and Git URL sources.
- **`plugin-source-normalization.md`**: Normalization and validation logic for plugin sources. Specifies conversion rules, validation constraints, and security measures for all source types.

### Related

- **[Universal Platform Converter](../platforms/universal-converter.md)**: Cross-platform package conversion system that enables installing platform-specific packages to any platform


