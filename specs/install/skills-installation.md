# Skills Installation Guide

## Overview

Skills are specialized sub-packages within skills collections that can be installed independently from their parent collection. This guide covers how to install, manage, and work with skills using OpenPackage.

## What is a Skill?

A **skill** is a focused piece of functionality (e.g., git workflows, docker operations, code review helpers) that lives within a skills collection. Skills are identified by a `SKILL.md` file in their directory.

### Key Characteristics

- **Independent Installation**: Install specific skills without the entire collection
- **Focused Functionality**: Each skill provides a specific capability
- **Platform Agnostic**: Uses standard platform mapping flows
- **Path Preservation**: Full directory structure is maintained during installation
- **Consistent Naming**: Uses GitHub-scoped naming (e.g., `gh@user/repo/skills/skill-name`)

## What is a Skills Collection?

A **skills collection** is any of the following that contains a root `skills/` directory with at least one `SKILL.md` file:

1. **Claude Plugin** - Has `.claude-plugin/plugin.json` + `skills/` directory
2. **OpenPackage Package** - Has `openpackage.yml` + `skills/` directory  
3. **GitHub Repository** - Has root `skills/` directory with SKILL.md files

### Required Structure

```
my-collection/
  skills/               # Required: Root skills directory
    git/
      SKILL.md         # Required: Skill manifest
      workflow.sh
      helper.md
    docker/
      ops/
        SKILL.md       # Nested skills supported
        utils.sh
```

- The `skills/` directory MUST be at the root of the plugin, package, or repository
- At least one `SKILL.md` file must exist at any nesting level under `skills/`
- Pattern: `skills/**/SKILL.md` (any depth of nesting)

## Installation Modes

### Marketplace Skills

When installing from a marketplace (a collection of plugins), you must specify both plugins and skills.

#### Syntax
```bash
opkg install <marketplace-url> --plugins <plugin-names...> --skills <skill-names...>
```

#### Interactive Mode
```bash
# Select plugins first, then select skills
opkg install https://github.com/user/marketplace
# → Prompts for plugin selection
# → Prompts for skill selection from chosen plugins
```

#### Non-Interactive Mode
```bash
# Specify both plugins and skills on command line
opkg install https://github.com/user/marketplace --plugins essentials utils --skills git docker coding

# Install all skills from specific plugins
opkg install gh@user/marketplace --plugins essentials --skills git docker kubernetes
```

#### Interactive Skill Selection (with specified plugins)
```bash
# Specify plugins, but prompt for skills
opkg install https://github.com/user/marketplace --plugins essentials --skills
# → Prompts for skill selection from "essentials" plugin only
```

### Standalone Skills

When installing from a single plugin, package, or repository, use `--skills` alone.

#### Syntax
```bash
opkg install <source-url> --skills <skill-names...>
```

#### Interactive Mode
```bash
# Discover and select skills
opkg install https://github.com/user/my-plugin --skills
# → Discovers available skills
# → Prompts for skill selection
```

#### Non-Interactive Mode
```bash
# Specify skills directly
opkg install https://github.com/user/my-plugin --skills git docker

# Multiple skills from a repository
opkg install gh@user/skills-repo --skills coding review testing
```

#### All Source Types
```bash
# From GitHub plugin
opkg install gh@user/plugin --skills workflow automation

# From local path
opkg install ../my-plugin --skills git docker

# From OpenPackage registry
opkg install my-package --skills helpers utils
```

## Skill Identification

Skills are identified using a two-tier naming system:

### Primary: Frontmatter Name

The `name` field in SKILL.md frontmatter takes precedence:

```yaml
---
name: git-workflow
version: 1.0.0
---
```

### Fallback: Directory Name

If no frontmatter name exists, the parent directory name is used:

```
skills/
  git-workflow/        # Directory name used as skill name
    SKILL.md           # No name in frontmatter
    files...
```

### Matching Logic

When you specify `--skills git-workflow`, OpenPackage will:

1. First look for skills with `name: git-workflow` in frontmatter
2. If not found, look for directories named `git-workflow` containing SKILL.md
3. Matching is case-insensitive for convenience

## Version Resolution

Skill versions are resolved with the following precedence:

1. `version` field in SKILL.md frontmatter
2. `metadata.version` field in SKILL.md frontmatter  
3. `undefined` (defaults to `0.0.0`)

Example:
```yaml
---
name: docker-helpers
version: 2.1.0        # Primary version field
description: Docker container utilities
---
```

Or with metadata:
```yaml
---
name: docker-helpers
metadata:
  version: 2.1.0      # Alternative version field
description: Docker container utilities
---
```

## Installation Behavior

### Path Preservation

When a skill is selected, **all content** in the parent directory of `SKILL.md` is installed, preserving the full directory structure from `skills/` onward.

#### Example: Simple Skill
```
Source:
  plugins/essentials/skills/git/SKILL.md
  plugins/essentials/skills/git/workflow.sh
  plugins/essentials/skills/git/docs.md

Installed to Cursor:
  .cursor/skills/git/SKILL.md
  .cursor/skills/git/workflow.sh
  .cursor/skills/git/docs.md
```

#### Example: Nested Skill
```
Source:
  plugins/essentials/skills/git/commit/SKILL.md
  plugins/essentials/skills/git/commit/hooks/
  plugins/essentials/skills/git/commit/templates/

Installed to Cursor:
  .cursor/skills/git/commit/SKILL.md
  .cursor/skills/git/commit/hooks/
  .cursor/skills/git/commit/templates/
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

## Platform Support

Skills are installed to platform-specific directories based on `platforms.jsonc` configuration:

| Platform | Skills Directory | Example Path |
|----------|-----------------|--------------|
| Cursor | `.cursor/skills/` | `.cursor/skills/git/workflow.sh` |
| Claude Code | `.claude/skills/` | `.claude/skills/docker/utils.sh` |
| OpenCode | `.opencode/skills/` | `.opencode/skills/coding/helper.md` |
| Factory | `.factory/skills/` | `.factory/skills/review/guide.md` |
| Codex | `.codex/skills/` | `.codex/skills/git/workflow.sh` |

All platforms follow the same pattern: `.<platform>/skills/<preserved-structure>`

## Advanced Usage

### Installing Nested Skills

Deeply nested skills preserve their full path structure:

```bash
# Source: skills/development/git/advanced/hooks/SKILL.md
opkg install gh@user/plugin --skills hooks

# Installed to: .cursor/skills/development/git/advanced/hooks/
```

### Installing Multiple Skills

Install multiple skills at once:

```bash
# From same source
opkg install gh@user/plugin --skills git docker kubernetes coding

# From marketplace with multiple plugins
opkg install gh@user/marketplace --plugins essentials devtools --skills git docker lint test
```

### Skill Updates

Re-installing a skill updates it in place:

```bash
# Initial installation
opkg install gh@user/plugin --skills git

# Later: update the skill
opkg install gh@user/plugin --skills git
# → Overwrites existing files (use --force if needed)
```

### Conflict Handling

Control how conflicts are handled during installation:

```bash
# Keep both versions (rename new)
opkg install gh@user/plugin --skills git --conflicts keep-both

# Overwrite existing
opkg install gh@user/plugin --skills git --conflicts overwrite

# Skip conflicting files
opkg install gh@user/plugin --skills git --conflicts skip

# Ask for each conflict
opkg install gh@user/plugin --skills git --conflicts ask
```

## Workspace Integration

### Manifest Recording

Installed skills are recorded in `.openpackage/index.yml`:

```yaml
packages:
  gh@user/plugin/skills/git:
    version: 1.0.0
    source: 
      type: git
      url: https://github.com/user/plugin
      ref: main
    files:
      - from: skills/git/workflow.sh
        to: .cursor/skills/git/workflow.sh
      - from: skills/git/SKILL.md
        to: .cursor/skills/git/SKILL.md
```

### Listing Installed Skills

Use the `list` command to see installed skills:

```bash
# List all packages (including skills)
opkg list

# List files for a specific skill
opkg list gh@user/plugin/skills/git
```

### Uninstalling Skills

Remove skills using the uninstall command:

```bash
# Uninstall a specific skill
opkg uninstall gh@user/plugin/skills/git

# Removes all files associated with the skill
```

## Examples

### Example 1: Installing Skills from Marketplace

```bash
# Interactive: Select plugins and skills
opkg install https://github.com/anthropics/claude-code
# → Choose "essentials" plugin
# → Choose "git" and "docker" skills

# Non-interactive: Specify everything
opkg install gh@anthropics/claude-code --plugins essentials --skills git docker

# Result:
# ✓ Installed gh@anthropics/claude-code/plugins/essentials/skills/git@1.0.0
# ✓ Installed gh@anthropics/claude-code/plugins/essentials/skills/docker@1.2.0
```

### Example 2: Installing Skills from Plugin

```bash
# Interactive skill selection
opkg install https://github.com/user/dev-skills --skills
# → Discovers: git, docker, kubernetes, coding
# → Prompts for selection

# Non-interactive
opkg install gh@user/dev-skills --skills git coding

# Result:
# ✓ Installed gh@user/dev-skills/skills/git@2.0.0
# ✓ Installed gh@user/dev-skills/skills/coding@1.5.0
```

### Example 3: Installing from Repository

```bash
# Plain repository with skills/ directory
opkg install https://github.com/team/workflows --skills review testing

# Local path
opkg install ../shared-skills --skills git docker

# Result:
# ✓ Installed gh@team/workflows/skills/review@1.0.0
# ✓ Installed gh@team/workflows/skills/testing@1.1.0
```

### Example 4: Installing Nested Skills

```bash
# Source structure:
# skills/
#   development/
#     git/
#       advanced/
#         hooks/
#           SKILL.md
#           pre-commit.sh

opkg install gh@user/advanced-skills --skills hooks

# Result:
# .cursor/skills/development/git/advanced/hooks/SKILL.md
# .cursor/skills/development/git/advanced/hooks/pre-commit.sh
```

### Example 5: Global Skills Installation

```bash
# Install to home directory (~/)
opkg install gh@user/shared-skills --skills git docker -g

# Result:
# ~/.cursor/skills/git/
# ~/.cursor/skills/docker/
```

## Error Handling

### Common Errors

#### Missing --plugins Flag

```bash
$ opkg install gh@user/marketplace --skills git docker
✗ Error: Skills installation from marketplace requires --plugins flag
  Use: opkg install <marketplace> --plugins <names> --skills <names>
```

**Solution**: Add the `--plugins` flag with plugin names.

#### Skills Not Found

```bash
$ opkg install gh@user/plugin --skills nonexistent another
✗ Error: Skills not found: nonexistent, another
  Available skills: git, docker, kubernetes, coding
```

**Solution**: Check the available skills list and use correct names.

#### No Skills in Plugins

```bash
$ opkg install gh@user/marketplace --plugins no-skills-plugin --skills git
✗ Error: Selected plugins do not contain any skills
  Plugin 'no-skills-plugin' has no skills/ directory
```

**Solution**: Choose plugins that contain skills, or install without `--skills` flag.

#### Source Without Skills Directory

```bash
$ opkg install gh@user/regular-plugin --skills something
✗ Error: Source does not contain skills/ directory
  Cannot use --skills flag with sources that lack skills
```

**Solution**: Verify the source has a `skills/` directory at its root.

## Best Practices

### For Users

1. **Explore Before Installing**: Use interactive mode to discover available skills
2. **Specify Versions**: Pin skill versions for reproducibility
3. **Use Descriptive Names**: Choose skill names that clearly indicate functionality
4. **Group Related Skills**: Install related skills together for better organization
5. **Document Dependencies**: Note which skills depend on each other

### For Skill Authors

1. **Clear SKILL.md**: Provide comprehensive documentation in SKILL.md
2. **Semantic Versioning**: Use semver for skill versions
3. **Focused Functionality**: Keep skills focused on specific tasks
4. **Test Independently**: Ensure skills work standalone
5. **Preserve Structure**: Use meaningful directory structures under skills/

## Related Documentation

- [SKILL.md Format Specification](./skill-manifest-format.md) - Complete SKILL.md format reference
- [Skills Troubleshooting](./skills-troubleshooting.md) - Common issues and solutions
- [Install Command Specs](./README.md) - General installation documentation
- [Plugin Installation](./plugin-installation.md) - Plugin-specific installation details
- [Marketplace Installation](./marketplace-installation.md) - Marketplace workflows
