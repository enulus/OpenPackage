# SKILL.md Format Specification

## Overview

`SKILL.md` is the manifest file that identifies a directory as a skill within a skills collection. It contains metadata about the skill in YAML frontmatter and optional documentation in the Markdown body.

## Purpose

- **Identification**: Marks a directory as an installable skill
- **Metadata**: Provides name, version, description, and other attributes
- **Documentation**: Contains usage instructions and examples for users
- **Discovery**: Enables OpenPackage to find and list available skills

## Location Requirements

- **Filename**: Must be exactly `SKILL.md` (case-sensitive)
- **Directory**: Must be within the `skills/` directory at any nesting level
- **Pattern**: Matches `skills/**/SKILL.md` (any depth allowed)

### Valid Locations

```
✓ skills/git/SKILL.md
✓ skills/docker/ops/SKILL.md
✓ skills/development/workflows/advanced/SKILL.md
✗ git/SKILL.md                    # Not under skills/
✗ skills/skill.md                 # Wrong case
✗ skills/README.md                # Wrong filename
```

## File Format

SKILL.md uses **Markdown with YAML frontmatter**:

```markdown
---
# YAML frontmatter (metadata)
name: skill-name
version: 1.0.0
description: Brief description
---

# Markdown body (documentation)

Usage instructions, examples, etc.
```

## Frontmatter Fields

### Required Fields

**None.** All frontmatter fields are technically optional. If no `name` is provided, the directory name is used as a fallback.

### Recommended Fields

#### `name` (string)

The skill identifier used for installation and reference.

```yaml
---
name: git-workflow
---
```

**Best Practices:**
- Use lowercase with hyphens (kebab-case)
- Be descriptive but concise
- Avoid special characters except hyphens
- Make it unique within the collection

**Fallback:** If omitted, the parent directory name is used.

#### `version` (string)

The skill version, following semantic versioning.

```yaml
---
name: git-workflow
version: 1.0.0
---
```

**Best Practices:**
- Use semantic versioning (MAJOR.MINOR.PATCH)
- Increment appropriately for changes
- Start at 1.0.0 for stable skills
- Use 0.x.x for experimental skills

**Fallback:** If omitted (and no `metadata.version`), defaults to `0.0.0`.

#### `description` (string)

A brief, single-line description of the skill's purpose.

```yaml
---
name: git-workflow
version: 1.0.0
description: Automated git workflow helpers and commit templates
---
```

**Best Practices:**
- Keep it under 100 characters
- Describe what the skill does, not how
- Use clear, user-friendly language

### Optional Fields

#### `metadata.version` (string)

Alternative location for version field (used if `version` is not present).

```yaml
---
name: docker-helper
metadata:
  version: 2.1.0
description: Docker container management utilities
---
```

**Priority:** The root `version` field takes precedence over `metadata.version`.

#### `author` (string or object)

Information about the skill author.

```yaml
---
name: coding-assistant
version: 1.5.0
author: John Doe
---
```

Or with more detail:

```yaml
---
name: coding-assistant
version: 1.5.0
author:
  name: John Doe
  email: john@example.com
  url: https://github.com/johndoe
---
```

#### `keywords` (array of strings)

Keywords for skill discovery and categorization.

```yaml
---
name: git-workflow
version: 1.0.0
keywords:
  - git
  - workflow
  - automation
  - commits
---
```

**Best Practices:**
- Use 3-7 relevant keywords
- Include technology names (git, docker, etc.)
- Include action words (automation, testing, etc.)
- Keep keywords lowercase

#### `license` (string)

License identifier (SPDX format recommended).

```yaml
---
name: git-workflow
version: 1.0.0
license: MIT
---
```

Common values: `MIT`, `Apache-2.0`, `GPL-3.0`, `BSD-3-Clause`, `ISC`

#### `homepage` (string)

URL to the skill's homepage or documentation.

```yaml
---
name: git-workflow
version: 1.0.0
homepage: https://github.com/user/skills#git-workflow
---
```

#### `repository` (string or object)

Source code repository information.

```yaml
---
name: git-workflow
version: 1.0.0
repository: https://github.com/user/skills
---
```

Or with more detail:

```yaml
---
name: git-workflow
version: 1.0.0
repository:
  type: git
  url: https://github.com/user/skills
  directory: skills/git-workflow
---
```

### Custom Fields

You can add custom fields for your own use. OpenPackage preserves but does not process them:

```yaml
---
name: git-workflow
version: 1.0.0
custom:
  category: development
  difficulty: intermediate
  tags: [git, automation]
internal:
  reviewed: true
  reviewer: alice@example.com
---
```

## Frontmatter Examples

### Minimal

The absolute minimum (relies on directory name fallback):

```yaml
---
# Empty frontmatter - uses directory name as skill name
---
```

### Simple

Basic skill with essential information:

```yaml
---
name: git-workflow
version: 1.0.0
description: Git workflow automation and helpers
---
```

### Standard

Recommended fields for public skills:

```yaml
---
name: git-workflow
version: 1.0.0
description: Git workflow automation and helpers
author: John Doe
keywords:
  - git
  - workflow
  - automation
license: MIT
homepage: https://github.com/user/skills#git-workflow
---
```

### Complete

All common fields populated:

```yaml
---
name: git-workflow
version: 1.0.0
description: Git workflow automation and helpers for common git operations
author:
  name: John Doe
  email: john@example.com
  url: https://github.com/johndoe
keywords:
  - git
  - workflow
  - automation
  - commits
  - branching
license: MIT
homepage: https://github.com/user/skills#git-workflow
repository:
  type: git
  url: https://github.com/user/skills
  directory: skills/git-workflow
---
```

### With Metadata Version

Using alternative version field:

```yaml
---
name: docker-helper
metadata:
  version: 2.1.0
  lastUpdated: 2024-01-15
description: Docker container management utilities
author: Jane Smith
license: Apache-2.0
---
```

## Markdown Body

The content after the frontmatter is standard Markdown and is **not processed** by OpenPackage during installation. It serves as documentation for users who explore the skill.

### Typical Body Content

```markdown
---
name: git-workflow
version: 1.0.0
description: Git workflow automation helpers
---

# Git Workflow Helpers

This skill provides automated git workflow helpers and templates.

## Features

- Pre-configured commit message templates
- Branch naming conventions
- Automated changelog generation
- Git hooks for validation

## Usage

### Commit Templates

Use the provided commit templates with:

```bash
git commit --template .git-templates/commit.txt
```

### Branch Naming

Follow the convention: `<type>/<short-description>`

Examples:
- `feature/add-login`
- `fix/header-alignment`
- `docs/update-readme`

## Configuration

Edit `.git/config` to enable hooks:

```ini
[core]
    hooksPath = .git/hooks
```

## Dependencies

- Git 2.20 or higher
- Bash 4.0 or higher (for scripts)

## License

MIT
```

### Body Best Practices

1. **Include Usage Instructions**: Explain how to use the skill's features
2. **Provide Examples**: Show concrete examples of commands or workflows
3. **List Dependencies**: Mention any required tools or versions
4. **Document Configuration**: Explain any configuration options
5. **Add Troubleshooting**: Help users resolve common issues

## Directory Structure

### Skill Content Scope

When a skill is installed, **all files** in the parent directory of `SKILL.md` are included:

```
skills/
  git-workflow/         # Entire directory installed
    SKILL.md           # Skill manifest
    templates/         # Included
      commit.txt
      pr.md
    scripts/           # Included
      validate.sh
      changelog.sh
    docs/              # Included
      guide.md
    .gitignore         # Included
```

### Nested Skills

Skills can be nested at any depth:

```
skills/
  development/
    git/
      basic/
        SKILL.md       # Skill: development/git/basic
        files...
      advanced/
        hooks/
          SKILL.md     # Skill: development/git/advanced/hooks
          files...
```

The path from `skills/` to the parent directory is preserved during installation.

## Validation and Parsing

### YAML Parsing

OpenPackage uses a YAML parser to extract frontmatter. If parsing fails:

1. **Warning Displayed**: "Failed to parse SKILL.md frontmatter"
2. **Fallback Behavior**: Directory name used for skill name
3. **Installation Continues**: The skill can still be installed

### Invalid YAML Examples

```yaml
---
name: git-workflow
version: 1.0.0
description: Missing closing quote
  - This will cause parse error
---
```

### Validation Rules

1. **No Required Fields**: Missing fields use fallbacks or defaults
2. **Type Checking**: Fields should match expected types (string, array, object)
3. **No Strict Schema**: Unknown fields are preserved but not validated

## Best Practices

### Naming

- **Use Descriptive Names**: `git-workflow` not `gw`
- **Be Consistent**: Use same naming pattern across skills
- **Avoid Redundancy**: Don't repeat "skill" in the name
- **Use Namespacing**: For related skills, use prefixes (e.g., `git-commit`, `git-merge`)

### Versioning

- **Start at 1.0.0**: For stable, production-ready skills
- **Use 0.x.x**: For experimental or unstable skills
- **Increment Appropriately**:
  - MAJOR: Breaking changes
  - MINOR: New features (backwards-compatible)
  - PATCH: Bug fixes (backwards-compatible)

### Documentation

- **Keep SKILL.md Updated**: Reflect current functionality
- **Provide Clear Examples**: Show realistic usage scenarios
- **Document Breaking Changes**: Note compatibility issues in changelogs
- **Include Prerequisites**: List required tools, platforms, or dependencies

### Organization

- **Group Related Skills**: Use subdirectories for logical grouping
- **One Skill per Directory**: Don't put multiple SKILL.md files in same directory
- **Minimal Files**: Include only necessary files for the skill
- **No Generated Files**: Exclude build artifacts, logs, etc.

## Migration from Other Formats

### From Plugin Metadata

If converting from a plugin format:

```json
// Old: plugin.json
{
  "name": "git-workflow",
  "version": "1.0.0",
  "description": "Git helpers"
}
```

To SKILL.md:

```yaml
---
name: git-workflow
version: 1.0.0
description: Git helpers
---
```

### From Package.json

If converting from npm-style:

```json
// package.json (subset)
{
  "name": "@user/git-workflow",
  "version": "1.0.0",
  "description": "Git helpers",
  "keywords": ["git", "workflow"],
  "author": "John Doe",
  "license": "MIT"
}
```

To SKILL.md:

```yaml
---
name: git-workflow
version: 1.0.0
description: Git helpers
keywords:
  - git
  - workflow
author: John Doe
license: MIT
---
```

## Troubleshooting

### Skill Not Detected

**Problem**: OpenPackage doesn't find your skill.

**Solutions**:
- Verify filename is exactly `SKILL.md` (case-sensitive)
- Ensure it's within `skills/` directory at root
- Check that `skills/` directory exists at collection root

### Parse Errors

**Problem**: "Failed to parse SKILL.md frontmatter"

**Solutions**:
- Validate YAML syntax (use a YAML validator)
- Ensure frontmatter is between `---` delimiters
- Check for unclosed quotes, invalid indentation

### Version Not Detected

**Problem**: Skill version shows as 0.0.0

**Solutions**:
- Add `version` field to frontmatter
- Or add `metadata.version` field
- Ensure field value is a string (quote numbers: `"1.0.0"`)

### Name Conflicts

**Problem**: Multiple skills with the same name

**Solutions**:
- Use unique names in frontmatter
- Check all SKILL.md files for duplicate names
- Use namespacing (prefixes) to differentiate

## Related Documentation

- [Skills Installation Guide](./skills-installation.md) - How to install and use skills
- [Skills Troubleshooting](./skills-troubleshooting.md) - Common issues and solutions
- [Plugin Installation](./plugin-installation.md) - Plugin-specific details
- [Marketplace Installation](./marketplace-installation.md) - Marketplace workflows
