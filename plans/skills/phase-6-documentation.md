# Phase 6: Documentation

## Overview

This phase creates comprehensive user-facing documentation for the skills feature, including usage guides, examples, API documentation, and troubleshooting resources.

## Objectives

1. Update main README with skills feature overview
2. Create detailed skills usage guide
3. Add skills examples to install command specs
4. Document skills collection format and structure
5. Create troubleshooting guide for common issues
6. Update CLI help text and command documentation

---

## Main README Updates

### Location
`README.md` (root)

### Additions

#### Feature Highlights Section
Add skills to the feature list:
- "Install individual skills from Claude Plugins, OpenPackage packages, or GitHub repositories"
- "Interactive or non-interactive skill selection"
- "Platform-agnostic skill installation with automatic mapping"

#### Quick Start Examples
Add skills installation example:
```bash
# Install specific skills from a marketplace
opkg install https://github.com/user/marketplace --plugins essentials --skills git docker

# Install skills from a standalone plugin
opkg install https://github.com/user/plugin --skills coding review
```

#### Skills Section (New)
Brief overview with link to detailed documentation:
- What are skills collections
- Basic usage patterns
- Link to detailed guide in specs/

---

## Skills Usage Guide

### Location
`specs/install/skills-installation.md` (NEW FILE)

### Content Structure

#### Introduction
- What are skills
- Skills vs plugins vs packages
- Use cases for skills-only installation

#### Skills Collection Format
- Required structure: root `skills/` directory
- SKILL.md manifest format and requirements
- Frontmatter fields (name, version, description, etc.)
- Directory naming and nesting

#### Installation Modes

**Marketplace Skills:**
- Command syntax: `--plugins` + `--skills`
- Interactive mode: Select plugins, then select skills
- Non-interactive mode: Specify both on CLI
- Examples with various marketplaces

**Standalone Skills:**
- Command syntax: `--skills` alone
- Works with plugins, packages, or repos
- Interactive and non-interactive modes
- Examples with different source types

#### Skill Identification
- Name resolution (frontmatter vs directory name)
- Version detection (version vs metadata.version)
- Matching logic (exact match, case-insensitive)

#### Installation Behavior
- Path preservation from skills/ onward
- Platform-specific mapping (platforms.jsonc)
- Content scope (entire skill directory)
- Manifest and index recording

#### Platform Support
- Skills installation on different platforms
- Path examples for each platform:
  - Cursor: `.cursor/skills/...`
  - Claude: `.claude/skills/...`
  - OpenCode: `.opencode/skills/...`
  - etc.

#### Advanced Usage

**Nested Skills:**
- Installing deeply nested skills
- Path preservation examples
- Directory structure best practices

**Multiple Skills:**
- Installing multiple skills at once
- From same or different plugins
- Order and dependencies

**Skill Updates:**
- Re-installing skills
- Version management
- Conflict handling

---

## Command Documentation

### Location
`specs/commands-overview.md` (UPDATE)

### Additions

#### Install Command
Add skills option documentation:

**Options:**
```
--skills <names...>
  Install specific skills from skills collection.
  For marketplaces: must be paired with --plugins.
  For standalone: filters to install only specified skills.
  Values: Space-separated skill names.
```

**Examples:**
```bash
# Marketplace with plugins and skills
opkg install <marketplace-url> --plugins plugin1 plugin2 --skills skill-a skill-b

# Standalone with skills
opkg install <source-url> --skills skill-a skill-b

# Interactive skill selection
opkg install <source-url> --skills
```

---

## Skills Examples

### Location
`specs/install/README.md` (UPDATE)

### Additions

#### Skills Installation Section

**Example 1: Marketplace Skills**
- Full command with marketplace URL
- Plugins and skills selection
- Expected output and manifest entries
- File locations in workspace

**Example 2: Plugin Skills**
- Standalone plugin with skills
- Skills-only installation
- Comparison with full plugin install

**Example 3: Repository Skills**
- Plain repo with skills/ directory
- Discovery and installation
- Use case scenarios

**Example 4: Nested Skills**
- Deeply nested skill structure
- Path preservation demonstration
- Workspace layout after installation

**Example 5: Interactive Selection**
- Prompt screenshots/samples
- Selection process
- Confirmation and installation

---

## SKILL.md Format Specification

### Location
`specs/install/skill-manifest-format.md` (NEW FILE)

### Content Structure

#### Overview
- Purpose of SKILL.md
- Location requirements (parent directory)
- Format (Markdown with YAML frontmatter)

#### Frontmatter Fields

**Required:**
- None technically required (directory fallback)

**Recommended:**
- `name`: Skill identifier (string)
- `version`: Skill version (string, semver)
- `description`: Brief description (string)

**Optional:**
- `metadata.version`: Alternative version field
- `author`: Author name or object
- `keywords`: Array of keywords
- `license`: License identifier
- `homepage`: Homepage URL
- `repository`: Repository URL or object

**Custom Fields:**
- Additional fields preserved but not used by installer

#### Frontmatter Examples

**Minimal:**
```yaml
---
name: git-workflow
version: 1.0.0
description: Git workflow automation
---
```

**Complete:**
```yaml
---
name: git-workflow
version: 1.0.0
description: Git workflow automation and helpers
author:
  name: John Doe
  email: john@example.com
keywords:
  - git
  - workflow
  - automation
license: MIT
homepage: https://github.com/user/skills
repository:
  type: git
  url: https://github.com/user/skills
---
```

**With Metadata Version:**
```yaml
---
name: docker-helper
metadata:
  version: 2.1.0
description: Docker container management
---
```

#### Body Content
- Markdown content after frontmatter
- Documentation, usage instructions
- Not processed by installer
- Displayed to users in workspace

#### Directory Structure
- SKILL.md location relative to skills/
- All files in parent directory included
- Nested directories preserved

#### Best Practices
- Use semantic versioning
- Provide clear descriptions
- Include relevant keywords
- Document usage in body
- Keep focused and modular

---

## Troubleshooting Guide

### Location
`specs/install/skills-troubleshooting.md` (NEW FILE)

### Content Structure

#### Common Issues

**Error: "Skills installation from marketplace requires --plugins flag"**
- Cause: Used --skills with marketplace without --plugins
- Solution: Add --plugins flag with plugin names
- Example: `opkg install <url> --plugins essentials --skills git`

**Error: "Source does not contain skills/ directory"**
- Cause: Source lacks root skills/ directory
- Solution: Verify source has skills/ at root
- Check: Directory structure requirements

**Error: "Skills not found: [names]"**
- Cause: Requested skill names don't exist
- Solution: Check available skills list in error message
- Note: Names are case-insensitive

**Error: "Selected plugins do not contain any skills"**
- Cause: Plugins lack skills/ directories
- Solution: Choose different plugins or install without --skills
- Verify: Plugin structure before installation

**Warning: "Using directory name as skill name"**
- Cause: SKILL.md missing name frontmatter
- Impact: Directory name used instead
- Resolution: Add name field to SKILL.md frontmatter

**Skills not installing to expected location**
- Cause: Platform detection or mapping issue
- Solution: Verify platform detection
- Check: Platform-specific paths in platforms.jsonc
- Override: Use --platforms flag

#### Validation Issues

**SKILL.md parse errors**
- Cause: Invalid YAML frontmatter
- Solution: Validate YAML syntax
- Tools: YAML linters, validators
- Fallback: Directory name used

**Missing version field**
- Cause: No version or metadata.version in frontmatter
- Impact: Version defaults to 0.0.0
- Resolution: Add version field to frontmatter

**Skill name conflicts**
- Cause: Multiple skills with same name
- Resolution: First match used
- Best practice: Use unique skill names

#### Installation Issues

**Partial skill installation**
- Cause: Some skills failed, others succeeded
- Check: Error messages for failed skills
- Resolution: Fix individual issues, re-install

**Permission errors**
- Cause: Insufficient permissions for installation
- Solution: Check workspace permissions
- Fix: Adjust permissions or use different directory

**Path too long errors (Windows)**
- Cause: Deeply nested skill paths
- Solution: Install to shorter workspace path
- Workaround: Flatten skill directory structure

#### Debug Mode

**Enable verbose logging:**
```bash
# Set environment variable
DEBUG=opkg:* opkg install <url> --skills <names>

# Or use internal logger level
# (if implemented)
```

**Check installation logs:**
- Location of log files
- What to look for
- Common error patterns

---

## CLI Help Text

### Location
Command help output (inline in code)

### Updates

#### Install Command Help
Update description and examples:

```
opkg install [package-name] [options]

Install packages, plugins, or skills to workspace

Arguments:
  package-name          Package, plugin, or skills collection to install
                        Supports: registry names, git URLs, local paths
                        Optional: installs from openpackage.yml if omitted

Options:
  --plugins <names...>  Install specific plugins from marketplace
                        Space-separated plugin names
                        Example: --plugins essentials utils

  --skills <names...>   Install specific skills from skills collection
                        For marketplaces: must be paired with --plugins
                        For standalone: filters to install only specified skills
                        Space-separated skill names
                        Example: --skills git docker coding

  --dry-run            Preview changes without applying them
  --force              Overwrite existing files
  --platforms <names>  Target specific platforms
  ... (other options)

Examples:
  # Install skills from marketplace
  opkg install https://github.com/user/marketplace --plugins essentials --skills git docker

  # Install skills from plugin
  opkg install https://github.com/user/plugin --skills coding review

  # Interactive skill selection
  opkg install https://github.com/user/plugin --skills

  # Install full plugin (no skills filter)
  opkg install https://github.com/user/plugin
```

---

## API Documentation

### Location
`docs/api/skills.md` (NEW FILE - if API docs exist)

### Content

#### Skills Detector API
- `detectSkillsInDirectory()`
- `findSkillByName()`
- `validateSkillExists()`
- Parameter descriptions
- Return value specifications
- Usage examples

#### Skills Transformer API
- `transformSkillToPackage()`
- `extractSkillFiles()`
- Context parameters
- Return values
- Integration examples

#### Skills Marketplace API
- `parseSkillsFromMarketplace()`
- `promptSkillSelection()`
- `validateSkillSelections()`
- `installMarketplaceSkills()`
- Parameter details
- Return specifications

---

## Migration Guide

### Location
`specs/install/skills-migration.md` (NEW FILE - if needed)

### Content

#### For Plugin Authors

**Adding Skills to Existing Plugin:**
1. Create `skills/` directory at plugin root
2. Organize skills into subdirectories
3. Add SKILL.md to each skill directory
4. Fill out frontmatter fields
5. Test skill installation independently

**Skills Directory Structure:**
```
my-plugin/
  .claude-plugin/
    plugin.json
  commands/
    ...
  skills/           ← NEW
    git/            ← Skill 1
      SKILL.md
      helper.sh
      docs.md
    docker/         ← Skill 2
      SKILL.md
      utils/
        ...
```

**SKILL.md Template:**
Provide copy-paste template with all fields

#### For Users

**Switching from Full Plugin to Skills:**
- Uninstall full plugin if needed
- Install specific skills instead
- Reduced workspace footprint
- Targeted functionality

**Managing Multiple Skills:**
- Install skills individually or in batch
- Update skills independently
- Track versions per skill

---

## Examples Repository

### Location
`examples/skills/` (NEW DIRECTORY)

### Contents

**Example 1: Minimal Skill**
```
minimal-skill/
  skills/
    hello/
      SKILL.md
      script.sh
```

**Example 2: Nested Skills**
```
nested-skills/
  skills/
    git/
      commit/
        SKILL.md
        ...
      merge/
        SKILL.md
        ...
```

**Example 3: Marketplace with Skills**
```
marketplace-example/
  .claude-plugin/
    marketplace.json
  plugins/
    essentials/
      .claude-plugin/
        plugin.json
      skills/
        git/
          SKILL.md
        docker/
          SKILL.md
```

**README for Examples:**
- How to use each example
- Installation commands
- Expected results
- Customization tips

---

## Video/Visual Tutorials

### Location
`docs/tutorials/` or external (YouTube, etc.)

### Suggested Topics

**Tutorial 1: Skills Installation Basics**
- What are skills
- Installing first skill
- Exploring workspace changes

**Tutorial 2: Creating Skills**
- Structuring skills directory
- Writing SKILL.md
- Testing locally

**Tutorial 3: Marketplace Skills**
- Finding marketplace skills
- Selecting and installing
- Managing multiple skills

---

## Implementation Checklist

### README
- [ ] Update main README with skills feature
- [ ] Add quick start examples
- [ ] Link to detailed documentation

### Guides
- [ ] Create skills usage guide (specs/install/skills-installation.md)
- [ ] Create SKILL.md format spec (specs/install/skill-manifest-format.md)
- [ ] Create troubleshooting guide (specs/install/skills-troubleshooting.md)
- [ ] Update command overview (specs/commands-overview.md)
- [ ] Update install README (specs/install/README.md)

### Examples
- [ ] Create example skills structures
- [ ] Create marketplace example
- [ ] Add READMEs for examples

### CLI Help
- [ ] Update install command help text
- [ ] Add skills option description
- [ ] Add usage examples

### API Docs (if applicable)
- [ ] Document skills detector API
- [ ] Document skills transformer API
- [ ] Document marketplace skills API

### Review
- [ ] Technical review of all documentation
- [ ] User testing with documentation
- [ ] Verify all examples work
- [ ] Check all links functional

---

## Success Criteria

- [ ] All documentation complete and accurate
- [ ] Examples run successfully
- [ ] Help text clear and comprehensive
- [ ] Troubleshooting covers common issues
- [ ] User feedback positive on clarity
- [ ] No broken links or outdated information
- [ ] Examples cover major use cases
- [ ] API documentation matches implementation

---

## Post-Documentation Tasks

### Announcement
- Blog post about skills feature
- Release notes with skills section
- Social media announcements

### Community
- Create discussion thread for skills
- Collect user feedback
- Document community use cases

### Maintenance
- Keep examples updated
- Update docs with new learnings
- Add FAQs based on user questions
- Maintain troubleshooting guide with new issues

---

## Documentation Style Guide

### Formatting
- Use consistent heading levels
- Code blocks with proper syntax highlighting
- Clear examples with explanations
- Bullet points for lists
- Tables for comparisons

### Tone
- Clear and concise
- User-friendly language
- Avoid jargon where possible
- Explain technical terms
- Practical examples

### Structure
- Overview/introduction
- Step-by-step instructions
- Examples and use cases
- Troubleshooting/common issues
- Related resources/links

### Code Examples
- Complete, runnable examples
- Expected output shown
- Common variations included
- Error cases demonstrated
- Comments for clarification

---

## Notes

### Living Documentation
Documentation should be:
- Updated with feature changes
- Refined based on user feedback
- Expanded with new examples
- Maintained alongside code

### Versioning
- Tag documentation with version
- Note version-specific behavior
- Maintain backwards compatibility docs
- Archive old version docs

### Accessibility
- Clear language for non-native speakers
- Visual examples where helpful
- Screen reader compatible formatting
- Alternative text for images
