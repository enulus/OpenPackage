# Skills Feature Implementation Plan

## Overview

This directory contains the implementation plan for the skills feature, which enables installation of individual skills from skills collections (Claude Plugins, OpenPackage packages, or GitHub repositories).

## What is a Skill?

A **skill** is a specialized sub-package within a skills collection, identified by a `SKILL.md` file. Skills contain focused functionality (e.g., git workflows, docker operations) that can be installed independently from the parent collection.

## What is a Skills Collection?

A **skills collection** is any of the following that contains a root `skills/` directory with at least one `SKILL.md` file:

1. **Claude Plugin** - Has `.claude-plugin/plugin.json` + `skills/` directory
2. **OpenPackage Package** - Has `openpackage.yml` + `skills/` directory  
3. **GitHub Repository** - Has root `skills/` directory with SKILL.md files

### Required Structure

- The `skills/` directory MUST be at the root of the plugin, package, or repository
- At least one `SKILL.md` file must exist at any nesting level under `skills/`
- Pattern: `skills/**/SKILL.md` (any depth of nesting)

## Core Concept

Skills work as a **filtering/selection mechanism** on top of existing installation infrastructure:

- The `--skills` flag acts as a selector to install only specific skill content
- Skills use existing platform mapping flows defined in `platforms.jsonc`
- Each skill is treated as an independent sub-package with its own manifest entry
- Installation follows standard OpenPackage flows with skill-specific scoping

## Key Features

### For Marketplaces
- `--plugins` + `--skills` together: Install specific skills from specific plugins
- Interactive mode: Select plugins, then select skills from those plugins
- Non-interactive mode: Specify both plugins and skills on command line

### For Standalone Sources
- `--skills` alone: Install only specified skills from a plugin/package/repo
- Interactive mode: Discover and prompt for skill selection
- Non-interactive mode: Specify skills on command line

## Architecture Principles

1. **Code Reuse**: Leverage existing plugin/package installation infrastructure
2. **Modular Design**: Skills detection, transformation, and installation in separate modules
3. **Platform Agnostic**: Skills use standard platform flows (no special-casing)
4. **Path Preservation**: Full directory structure from `skills/` is preserved during installation
5. **Consistent Naming**: Skills use GitHub-scoped naming like plugins (e.g., `gh@user/repo/skills/skill-name`)

## Implementation Phases

### [Phase 1: Foundation](./phase-1-foundation.md)
Core types, constants, and skills detection module. Establishes the fundamental building blocks.

### [Phase 2: Marketplace Integration](./phase-2-marketplace.md)
Marketplace-specific skills handling, including parsing, selection, and installation logic.

### [Phase 3: Command Integration](./phase-3-command.md)
CLI command updates, option handling, validation, and routing between marketplace and standalone flows.

### [Phase 4: Loader Integration](./phase-4-loaders.md)
Updates to package loaders to detect and handle skills collections during source loading.

### [Phase 5: Testing](./phase-5-testing.md)
Comprehensive test coverage for all skills functionality, including unit and integration tests.

### [Phase 6: Documentation](./phase-6-documentation.md)
User-facing documentation, examples, and troubleshooting guides.

## Command Line Interface

### Options

```
--skills <names...>      Install specific skills from skills collection
                         For marketplaces: must be paired with --plugins
                         For standalone: filters to install only specified skills
```

### Usage Examples

```bash
# Marketplace: Interactive plugin and skill selection
opkg install https://github.com/user/marketplace

# Marketplace: Specific plugins, interactive skill selection
opkg install https://github.com/user/marketplace --plugins essentials utils

# Marketplace: Specific plugins and skills (non-interactive)
opkg install https://github.com/user/marketplace --plugins essentials --skills git docker

# Standalone: Interactive skill selection from plugin
opkg install https://github.com/user/my-plugin --skills

# Standalone: Specific skills from plugin
opkg install https://github.com/user/my-plugin --skills git docker

# Repository: Specific skills
opkg install https://github.com/user/skills-repo --skills coding review
```

## Skill Identification

Skills are identified using a two-tier naming system:

1. **Primary**: `name` field in SKILL.md frontmatter
2. **Fallback**: Parent directory name of SKILL.md file

When matching requested skill names, frontmatter name takes precedence, but directory name matching is also supported.

## Version Resolution

Skills versions are resolved with the following precedence:

1. `version` field in SKILL.md frontmatter
2. `metadata.version` field in SKILL.md frontmatter  
3. `undefined` (or default to `0.0.0`)

## Installation Behavior

### Path Preservation

When a skill is selected, **all content** in the parent directory of `SKILL.md` is installed, preserving the full directory structure.

Example:
```
Source: plugins/essentials/skills/git/commit/SKILL.md
Skill path: plugins/essentials/skills/git/commit
Installed to (cursor): .cursor/skills/git/commit/
```

### Platform Mapping

Skills use the existing `skills/**/*` export flows defined in `platforms.jsonc`:

```jsonc
"export": [
  {
    "from": "skills/**/*",
    "to": ".cursor/skills/**/*"
  }
]
```

The flow preserves the nested structure from `skills/` onward.

## Error Handling

The implementation includes comprehensive error handling for:

- Missing `--plugins` flag when using `--skills` on marketplace
- Requested skills not found in collection
- No skills found in selected plugins
- Invalid SKILL.md frontmatter parsing
- Source without `skills/` directory when using `--skills` flag

See individual phase documents for detailed error cases and messages.

## Technical Dependencies

### Existing Infrastructure Reused

- **Plugin Detection**: `plugin-detector.ts` patterns for collection detection
- **Plugin Transformation**: `plugin-transformer.ts` patterns for skill transformation
- **Marketplace Handling**: `marketplace-handler.ts` patterns for marketplace skills
- **Package Naming**: `plugin-naming.ts` for GitHub-scoped skill names
- **Format Detection**: `format-detector.ts` for skill content analysis
- **Platform Flows**: `platforms.jsonc` for installation target mapping
- **Frontmatter Parsing**: `markdown-frontmatter.ts` for SKILL.md parsing

### New Modules

- `skills-detector.ts`: Core skills detection and validation
- `skills-transformer.ts`: Transform skills to OpenPackage packages
- `skills-marketplace-handler.ts`: Marketplace-specific skills logic

## File Locations

```
src/
  commands/
    install.ts                          # Updated: CLI command integration
  core/
    install/
      skills-detector.ts                # NEW: Skills detection
      skills-transformer.ts             # NEW: Skills transformation
      skills-marketplace-handler.ts     # NEW: Marketplace skills handling
      plugin-detector.ts                # Updated: Add skills collection detection
      format-detector.ts                # Updated: Add skills format detection
      git-package-loader.ts             # Updated: Include skills detection
  types/
    index.ts                            # Updated: Add skills option
  constants/
    index.ts                            # Updated: Add SKILL_MD constant

tests/
  core/
    install/
      skills-detector.test.ts           # NEW
      skills-marketplace.test.ts        # NEW
      skills-transformer.test.ts        # NEW
  commands/
    install-skills-integration.test.ts  # NEW
```

## Next Steps

1. Review each phase document in order
2. Implement phases sequentially for incremental progress
3. Run tests after each phase to ensure stability
4. Update documentation as implementation progresses

## Questions or Clarifications

For implementation questions or architectural decisions, refer to:
- Individual phase documents for detailed technical specifications
- Existing plugin implementation patterns for consistency
- `platforms.jsonc` for platform-specific mapping rules
