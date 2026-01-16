# Pi-Mono Platform Usage Guide

Pi-Mono is a lightweight AI coding assistant framework. OpenPackage provides seamless integration with Pi-Mono, allowing you to install and manage commands and skills from universal packages.

## Quick Start

### Install to Pi-Mono

```bash
# Install package to Pi-Mono platform
opkg install my-package --platforms pimono

# Auto-detect (if .pi/ directory exists)
opkg install my-package
```

### What Gets Installed

When you install a package to Pi-Mono, files are mapped to the following structure:

| Universal Format | Pi-Mono Location |
|------------------|------------------|
| `AGENTS.md` | `AGENTS.md` (root) |
| `commands/**/*.md` | `.pi/agent/prompts/**/*.md` |
| `skills/**/*` | `.pi/agent/skills/**/*` |

**Example:**
```
Package:                      Workspace:
├── AGENTS.md          →     AGENTS.md
├── commands/          →     .pi/agent/prompts/
│   ├── commit.md            ├── commit.md
│   └── deploy.md            └── deploy.md
└── skills/            →     .pi/agent/skills/
    └── testing/                 └── testing/
        └── SKILL.md                 └── SKILL.md
```

## Directory Structure

Pi-Mono uses a nested structure under `.pi/agent/`:

```
.pi/
└── agent/
    ├── prompts/              # Commands (slash commands)
    │   ├── *.md              # Command definitions
    │   └── category/         # Optional categorization
    │       └── *.md
    └── skills/               # Skills (reusable capabilities)
        └── category/
            └── skill-name/
                ├── SKILL.md
                └── scripts/
```

### User-Level vs Project-Level

Pi-Mono supports two installation scopes:

- **Project-level:** `./.pi/` (current directory)
- **User-level:** `~/.pi/` (home directory)

**Note:** OpenPackage currently installs to project-level only. User-level support is planned (see [Issue #7](https://github.com/enulus/OpenPackage/issues/7)).

## Installation Examples

### Basic Installation

```bash
# Install commands and skills
opkg install devtools-essentials --platforms pimono
```

**Result:**
```
✓ Installed devtools-essentials@1.0.0
✓ Added files: 5
   ├── .pi/agent/prompts/commit.md
   ├── .pi/agent/prompts/deploy.md
   ├── .pi/agent/skills/testing/SKILL.md
   ├── .pi/agent/skills/debugging/SKILL.md
   ├── AGENTS.md
```

### Multi-Platform Installation

Install to both Pi-Mono and Claude Code:

```bash
opkg install my-package --platforms pimono claude
```

**Result:**
```
.pi/agent/prompts/...     # Pi-Mono format
.claude/commands/...       # Claude format
```

Both platforms use the same universal package but different directory structures.

### Auto-Detection

If `.pi/` directory exists, OpenPackage auto-detects Pi-Mono:

```bash
mkdir -p .pi/agent/{prompts,skills}
opkg install my-package  # Automatically uses pimono platform
```

## Modifying Installed Files

### Edit Commands

Commands are stored as markdown files in `.pi/agent/prompts/`:

```bash
# Edit existing command
vim .pi/agent/prompts/commit.md

# Add new command
echo "# My Command" > .pi/agent/prompts/my-command.md
```

### Save Changes Back to Package

For packages installed from local paths:

```bash
# Modify files in .pi/agent/
echo "## Updated section" >> .pi/agent/prompts/commit.md

# Save changes back to package
opkg save my-package

# Verify changes
✓ Saved my-package
  1 updated
  ↻ Updated: commands/commit.md
```

**Workflow:**
1. Modify files in `.pi/agent/`
2. Run `opkg save <package-name>`
3. Changes are synced back to universal format
4. Other platforms can `opkg apply` to receive updates

## Use Cases

### Use Case 1: Personal Command Library

Create a personal library of commands:

```bash
# Create package
opkg new my-commands

# Add commands to package
cd my-commands
mkdir -p commands
echo "# Git Commit Helper" > commands/commit.md
echo "# Deploy Helper" > commands/deploy.md

# Install to Pi-Mono
opkg install . --platforms pimono

# Use in Pi-Mono
# Commands available at .pi/agent/prompts/
```

### Use Case 2: Team Skill Sharing

Share skills across team members:

```bash
# Team lead creates skills package
opkg new team-skills

# Add skills
mkdir -p skills/devtools/testing
echo "# Testing Skill" > skills/devtools/testing/SKILL.md

# Team members install
opkg install github:myorg/team-skills --platforms pimono

# Everyone gets same skills in .pi/agent/skills/
```

### Use Case 3: Multi-Platform Development

Work with multiple AI coding tools:

```bash
# Install to both Pi-Mono and Cursor
opkg install my-workflow --platforms pimono cursor

# Edit in Pi-Mono
vim .pi/agent/prompts/deploy.md

# Save changes
opkg save my-workflow

# Sync to Cursor
opkg apply my-workflow

# Both platforms now have updated content
```

## Supported File Types

Pi-Mono through OpenPackage supports:

| Type | Extension | Location |
|------|-----------|----------|
| Commands | `.md` | `.pi/agent/prompts/` |
| Skills | `.md`, `.sh`, `.py`, etc. | `.pi/agent/skills/` |
| Agent Config | `.md` | `AGENTS.md` (root) |

**Note:** Rules and Agents are not supported by Pi-Mono platform.

## Advanced Usage

### Nested Commands

Organize commands in subdirectories:

```
commands/
├── git/
│   ├── commit.md
│   └── rebase.md
└── deploy/
    └── production.md
```

**Installs to:**
```
.pi/agent/prompts/
├── git/
│   ├── commit.md
│   └── rebase.md
└── deploy/
    └── production.md
```

Directory structure is preserved.

### Complex Skills

Skills can include multiple files:

```
skills/
└── devtools/
    └── testing/
        ├── SKILL.md
        ├── scripts/
        │   ├── test.sh
        │   └── coverage.sh
        └── config/
            └── jest.config.js
```

**All files install to:**
```
.pi/agent/skills/devtools/testing/
```

### Aliases

Pi-Mono can be referenced by multiple names:

```bash
opkg install my-package --platforms pimono
opkg install my-package --platforms pi-mono
opkg install my-package --platforms pi
```

All three work identically.

## Comparison with Other Platforms

### Pi-Mono vs Codex CLI

Pi-Mono is very similar to Codex CLI:

| Feature | Pi-Mono | Codex CLI |
|---------|---------|-----------|
| Root Dir | `.pi/` | `.codex/` |
| Root File | `AGENTS.md` | `AGENTS.md` |
| Commands | `agent/prompts/` | `prompts/` |
| Skills | `agent/skills/` | `skills/` |
| Rules | ❌ | ❌ |
| Agents | ❌ | ❌ |

### Pi-Mono vs Claude Code

| Feature | Pi-Mono | Claude Code |
|---------|---------|-------------|
| Root Dir | `.pi/` | `.claude/` |
| Root File | `AGENTS.md` | `CLAUDE.md` |
| Commands | `agent/prompts/` | `commands/` |
| Skills | `agent/skills/` | `skills/` |
| Rules | ❌ | ✅ `rules/` |
| Agents | ❌ | ✅ `agents/` |

## Troubleshooting

### Platform Not Detected

**Problem:** `opkg install` doesn't recognize Pi-Mono

**Solution:**
```bash
# Use explicit platform flag
opkg install my-package --platforms pimono

# Or create .pi/ directory first
mkdir -p .pi/agent/{prompts,skills}
opkg install my-package  # Now auto-detects
```

### Files Not Installed

**Problem:** Package claims to support pimono but files not installed

**Solution:** Check package structure uses universal format:
- Commands should be in `commands/` (not `.pi/agent/prompts/`)
- Skills should be in `skills/` (not `.pi/agent/skills/`)
- OpenPackage handles the transformation

### Save Not Working

**Problem:** `opkg save` doesn't detect changes

**Solution:** 
- Only tracked files are saved
- New files need to be added to package source first
- For local packages: copy new files to package, reinstall, then save works

## Migration from Manual Setup

If you have existing `.pi/agent/` files:

```bash
# Create package from workspace
opkg save my-pi-setup --platform pimono

# This creates a universal package at:
# .openpackage/packages/my-pi-setup/
# with content:
#   commands/  (from .pi/agent/prompts/)
#   skills/    (from .pi/agent/skills/)
#   AGENTS.md  (from root)

# Share package
cp -r .openpackage/packages/my-pi-setup ~/my-packages/

# Install elsewhere
cd other-project
opkg install ~/my-packages/my-pi-setup --platforms pimono
```

## Links

- **Pi-Mono GitHub:** https://github.com/badlogic/pi-mono
- **OpenPackage Docs:** https://openpackage.dev
- **Platform System:** See `specs/platforms/` for technical details
- **Issue Tracker:** Report Pi-Mono issues at https://github.com/enulus/OpenPackage/issues

## Contributing

Have feedback on Pi-Mono support? Open an issue or PR at the OpenPackage repository.

Pi-Mono support added in OpenPackage v0.7.4 ([#13](https://github.com/enulus/OpenPackage/issues/13)).
