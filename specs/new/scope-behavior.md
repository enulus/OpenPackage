# Scope Behavior

This document details the behavior of each scope in the `opkg new` command, including path resolution, workspace integration, and use case patterns.

## Scope Selection

When running `opkg new` **interactively without the `--scope` or `--path` flag**, you'll be prompted to choose:

```bash
$ opkg new my-package
? Where should this package be created? › 
❯ Root (current directory) - Create openpackage.yml here - for standalone/distributable packages
  Local (workspace-scoped) - Create in .openpackage/packages/ - for project-specific packages
  Global (cross-workspace) - Create in ~/.openpackage/packages/ - shared across all workspaces on this machine
  Custom (specify path) - Create at a custom location you specify
```

- **Interactive mode**: Prompts for scope/path selection
- **Non-interactive mode**: Requires `--scope` or `--path` flag (error if neither provided)
- **Explicit `--scope` flag**: Skips prompt, uses specified scope
- **Explicit `--path` flag**: Skips prompt, uses custom path (takes precedence over `--scope`)

This ensures you make an explicit choice about where your package lives, without relying on an implicit default.

## Scope Types and Custom Paths

OpenPackage supports three predefined scopes plus custom paths:

| Type | Location | Shared? | Workspace Integration | Use Case |
|------|----------|---------|----------------------|----------|
| `root` | `./openpackage.yml` | No | Optional | Dedicated package repos |
| `local` | `./.openpackage/packages/<name>/` | No | Automatic | Project-specific packages |
| `global` | `~/.openpackage/packages/<name>/` | Yes | Manual | Cross-workspace utilities |
| `custom` | User-specified path | Varies | Manual | Flexible organization |

## Root Scope

### Path Resolution

```
Current Directory (cwd)
├── openpackage.yml          # Created here
├── .cursor/                 # Platform content
├── root/                    # Root files
└── [other package content]
```

**Package Directory:** `cwd/`
**Manifest Path:** `cwd/openpackage.yml`
**Package Root:** `cwd/`

### Creation Behavior

```bash
# In /Users/alice/my-package/
$ opkg new --scope root
```

**Steps:**
1. Validates cwd is writable
2. Checks for existing `openpackage.yml`
3. If exists and no `--force`: displays existing, exits
4. If exists and `--force`: overwrites
5. Prompts for package details (interactive mode)
6. Creates `openpackage.yml` at cwd
7. Does NOT create workspace structure
8. Does NOT add to any workspace manifest

**Result:**
```
/Users/alice/my-package/
└── openpackage.yml
```

### Use Case Patterns

#### Dedicated Package Repository

**Scenario:** Creating a standalone package to distribute

```bash
# Create package repo
mkdir my-awesome-package
cd my-awesome-package
opkg new --scope root

# Develop package
mkdir -p .cursor/rules
echo "# Rule 1" > .cursor/rules/rule1.md

# Package and publish
opkg pack
opkg push my-awesome-package
```

#### Monorepo Package

**Scenario:** Package within a larger repository

```bash
# In monorepo
cd packages/shared-components/
opkg new --scope root

# Package exists alongside other code
packages/
├── shared-components/
│   ├── openpackage.yml    # Root package
│   ├── src/               # Other code
│   └── .cursor/
└── other-package/
```

### Workspace Integration

Root packages do NOT auto-integrate with workspaces. To use in a workspace:

```yaml
# Manually add to .openpackage/openpackage.yml
dependencies:
  - name: my-package
    path: /absolute/path/to/my-package/
    # or relative to workspace
    path: ../../packages/my-package/
```

### Advantages
- ✅ Clean package root (no nested directories)
- ✅ Similar to npm/cargo/pypi patterns
- ✅ Easy to distribute
- ✅ Minimal metadata overhead

### Disadvantages
- ❌ No automatic workspace integration
- ❌ Requires manual path management
- ❌ Not isolated from other cwd content

## Local Scope

### Path Resolution

```
Project Root
├── .openpackage/
│   ├── openpackage.yml           # Workspace manifest (auto-created)
│   └── packages/
│       └── my-package/           # Package directory
│           ├── openpackage.yml   # Package manifest
│           ├── .cursor/
│           └── root/
└── src/                          # Project code
```

**Package Directory:** `cwd/.openpackage/packages/<name>/`
**Manifest Path:** `cwd/.openpackage/packages/<name>/openpackage.yml`
**Package Root:** `cwd/.openpackage/packages/<name>/`

### Creation Behavior

```bash
# In /Users/alice/my-project/
$ opkg new my-package
```

**Steps:**
1. Validates package name provided
2. Normalizes package name (lowercase)
3. Resolves path: `cwd/.openpackage/packages/<name>/`
4. Checks for existing package
5. If exists and no `--force`: displays existing, exits
6. If exists and `--force`: overwrites
7. Ensures `.openpackage/packages/` directory exists
8. Prompts for package details (interactive mode)
9. Creates `openpackage.yml` in package directory
10. **Auto-creates workspace manifest** if not exists
11. **Adds package to workspace manifest** with path reference

**Result:**
```
/Users/alice/my-project/
├── .openpackage/
│   ├── openpackage.yml
│   └── packages/
│       └── my-package/
│           └── openpackage.yml
└── src/
```

**Workspace Manifest Entry:**
```yaml
name: my-project
dependencies:
  - name: my-package
    path: ./.openpackage/packages/my-package/
dev-dependencies: []
```

### Use Case Patterns

#### Project-Specific Rules

**Scenario:** Custom rules for a specific project

```bash
cd my-project/
opkg new project-rules

# Develop rules
cd .openpackage/packages/project-rules/
mkdir -p rules
echo "# Project-specific rule" > rules/style-guide.md

# Install to workspace
opkg install project-rules
```

#### Temporary Development Package

**Scenario:** Testing package before publishing

```bash
# Create local package for development
opkg new experimental-feature

# Develop and test locally
cd .openpackage/packages/experimental-feature/
# Add content

# Install to test in workspace
opkg install experimental-feature

# When ready, pack and publish
opkg pack experimental-feature
opkg push experimental-feature
```

#### Multiple Related Packages

**Scenario:** Multiple packages in one project

```bash
opkg new frontend-rules
opkg new backend-rules
opkg new shared-prompts

# All packages available in project
.openpackage/
└── packages/
    ├── frontend-rules/
    ├── backend-rules/
    └── shared-prompts/
```

### Workspace Integration

Local packages are **automatically integrated**:
- Workspace manifest auto-created if needed
- Package added with relative path
- Available for `opkg install`, etc.

### Advantages
- ✅ Automatic workspace integration
- ✅ Relative paths (portable)
- ✅ Clear separation from project code
- ✅ Easy to manage multiple packages
- ✅ Isolated in `.openpackage/` directory

### Disadvantages
- ❌ Not shared across workspaces
- ❌ Nested directory structure
- ❌ Requires workspace context

## Global Scope

### Path Resolution

```
~/.openpackage/
└── packages/
    └── shared-utils/             # Package directory
        ├── openpackage.yml       # Package manifest
        ├── .cursor/
        └── root/
```

**Package Directory:** `~/.openpackage/packages/<name>/`
**Manifest Path:** `~/.openpackage/packages/<name>/openpackage.yml`
**Package Root:** `~/.openpackage/packages/<name>/`

### Creation Behavior

```bash
# In any directory
$ opkg new shared-utils --scope global
```

**Steps:**
1. Validates package name provided
2. Normalizes package name
3. Resolves path: `~/.openpackage/packages/<name>/`
4. Expands tilde to user home directory
5. Checks for existing package
6. If exists and no `--force`: displays existing, exits
7. If exists and `--force`: overwrites
8. Ensures `~/.openpackage/packages/` directory exists
9. Prompts for package details (interactive mode)
10. Creates `openpackage.yml` in global package directory
11. Does NOT add to any workspace manifest

**Result:**
```
~/.openpackage/
└── packages/
    └── shared-utils/
        └── openpackage.yml
```

### Use Case Patterns

#### Personal Utility Library

**Scenario:** Rules/prompts used across all projects

```bash
# Create global utilities
opkg new personal-rules --scope global

# Add content
cd ~/.openpackage/packages/personal-rules/
mkdir -p .cursor/rules
echo "# My coding standards" > .cursor/rules/standards.md

# Pack to registry
opkg pack personal-rules

# Use in any project
cd ~/projects/any-project/
# Add to .openpackage/openpackage.yml:
# dependencies:
#   - name: personal-rules
#     path: ~/.openpackage/packages/personal-rules/
opkg install
```

#### Team Shared Packages

**Scenario:** Packages shared within team (via git)

```bash
# Team member creates package
opkg new team-conventions --scope global

# Add to version control
cd ~/.openpackage/packages/team-conventions/
git init
git add .
git commit -m "Initial conventions"
git remote add origin git@github.com:team/conventions.git
git push

# Other team members clone
cd ~/.openpackage/packages/
git clone git@github.com:team/conventions.git team-conventions

# Use in projects
cd ~/projects/any-project/
# Add to .openpackage/openpackage.yml:
# dependencies:
#   - name: team-conventions
#     path: ~/.openpackage/packages/team-conventions/
```

#### Development Templates

**Scenario:** Reusable templates for new projects

```bash
# Create template package
opkg new project-template --scope global
cd ~/.openpackage/packages/project-template/

# Add template content
mkdir -p root/
echo "# Template README" > root/README.md
mkdir -p .cursor/rules
echo "# Template rule" > .cursor/rules/setup.md

opkg pack project-template

# Use in new projects
cd ~/new-project/
# Add template to manifest
opkg install project-template
```

### Workspace Integration

Global packages require **manual integration**:

```yaml
# Add to any workspace's .openpackage/openpackage.yml
dependencies:
  - name: shared-utils
    path: ~/.openpackage/packages/shared-utils/
```

Then install:
```bash
opkg install
# or
opkg install shared-utils
```

### Advantages
- ✅ Shared across all workspaces
- ✅ Single source of truth
- ✅ Easy to maintain in one place
- ✅ Persists across projects
- ✅ Tilde expansion (portable home path)

### Disadvantages
- ❌ Requires manual workspace integration
- ❌ User-specific (not in project repo)
- ❌ Needs documentation for team use
- ❌ Potential path conflicts between users

## Custom Path

### Path Resolution

```
/any/user/specified/path/
└── my-package/
    ├── openpackage.yml       # Package manifest
    ├── .cursor/
    └── root/
```

**Package Directory:** User-specified (can be relative, absolute, or tilde)
**Manifest Path:** `<specified-path>/openpackage.yml`
**Package Root:** `<specified-path>/`

**Path Types Supported:**
- Relative: `./my-package`, `../shared/package`
- Absolute: `/opt/packages/my-package`
- Tilde: `~/projects/my-package`

### Creation Behavior

```bash
# Various path types
$ opkg new my-package --path ./custom-location
$ opkg new my-package --path /opt/packages/my-package
$ opkg new my-package --path ~/projects/my-package
```

**Steps:**
1. Validates package name provided
2. Normalizes package name
3. Resolves custom path (expands tilde, converts to absolute)
4. Validates parent directory exists
5. Checks path is not in dangerous system directory
6. Checks for existing package
7. If exists and no `--force`: displays error, exits
8. If exists and `--force`: overwrites
9. Prompts for package details (interactive mode)
10. Creates directory if needed
11. Creates `openpackage.yml` at specified path
12. Does NOT add to any workspace manifest

**Result (for relative path `./custom-location`):**
```
current-directory/
└── custom-location/
    └── openpackage.yml
```

### Use Case Patterns

#### Monorepo Structure

**Scenario:** Integrate with existing monorepo organization

```bash
# Project structure:
# project-root/
# ├── apps/
# ├── packages/
# └── shared/

# Create package in shared/
cd project-root/apps/app-1/
opkg new app-configs --path ../../shared/app-configs

# Resulting structure:
# project-root/
# ├── apps/
# │   └── app-1/           (current directory)
# ├── packages/
# └── shared/
#     └── app-configs/
#         └── openpackage.yml
```

#### Team Shared Directory

**Scenario:** Shared network or team directory

```bash
# Create package in team shared location
opkg new team-standards --path /mnt/team-share/packages/team-standards

# Team members can reference same location
# In any workspace:
opkg install --path /mnt/team-share/packages/team-standards
```

#### Custom Project Layout

**Scenario:** Match existing project conventions

```bash
# Project with custom structure:
# project/
# ├── src/
# ├── docs/
# └── ai-configs/

# Create package in ai-configs/
cd project/src/
opkg new project-rules --path ../ai-configs/project-rules

# Resulting structure:
# project/
# ├── src/
# ├── docs/
# └── ai-configs/
#     └── project-rules/
#         └── openpackage.yml
```

#### Parent Directory Reference

**Scenario:** Package in parent directory for multi-workspace use

```bash
# Structure:
# project-root/
# ├── workspace-a/         (current directory)
# ├── workspace-b/
# └── shared-packages/

cd project-root/workspace-a/
opkg new shared-utils --path ../shared-packages/shared-utils

# Both workspaces can reference:
opkg install --path ../shared-packages/shared-utils
```

### Workspace Integration

Custom path packages require **manual integration** via path reference:

```bash
# Install by explicit path
opkg install --path /custom/location/my-package

# Or add to manifest manually
```

```yaml
# .openpackage/openpackage.yml
packages:
  - name: my-package
    path: ../custom-location/my-package  # Relative to workspace
  - name: other-package
    path: /opt/packages/other-package    # Absolute path
```

### Advantages
- ✅ Complete flexibility in package location
- ✅ Can match existing project structures
- ✅ Support for monorepo patterns
- ✅ Can use team shared directories
- ✅ Relative paths portable within repo
- ✅ Tilde paths portable across users' home dirs

### Disadvantages
- ❌ Requires manual workspace integration
- ❌ Path management responsibility on user
- ❌ Absolute paths not portable across systems
- ❌ Needs clear documentation for team members
- ❌ No automatic discovery

### Safety Features

Custom paths include safety validations:

**Parent Directory Check:**
```bash
$ opkg new test --path ./non-existent/package
Error: Parent directory does not exist: /path/to/non-existent
Please create it first or choose a different path.
```

**System Directory Protection:**
```bash
$ opkg new test --path /usr/my-package
Error: Cannot create package in system directory: /usr/my-package
```

Protected directories include: `/bin`, `/sbin`, `/usr`, `/etc`, `/sys`, `/proc`, `/dev`, etc.

**Exceptions:** Temp directories like `/tmp` and macOS `/var/folders/` are allowed for testing purposes.

## Scope Comparison

### Path Portability

| Type | Path Example | Portable? | Notes |
|------|--------------|-----------|-------|
| Root | `./openpackage.yml` | ✅ In repo | Relative to repo root |
| Local | `./.openpackage/packages/pkg/` | ✅ In repo | Relative to workspace |
| Global | `~/.openpackage/packages/pkg/` | ⚠️ Per-user | Tilde expands to home |
| Custom (relative) | `./custom/pkg/` | ✅ In repo | Relative to workspace |
| Custom (absolute) | `/opt/packages/pkg/` | ❌ No | System-specific path |
| Custom (tilde) | `~/projects/pkg/` | ⚠️ Per-user | User home specific |

### Version Control

| Type | In Git? | Shared? | Notes |
|------|---------|---------|-------|
| Root | ✅ Yes | Team | Part of repo |
| Local | ✅ Yes | Team | In `.openpackage/` |
| Global | ❌ No* | No* | User-specific, can be git repo itself |
| Custom | ⚠️ Varies | Varies | Depends on path location |

*Global packages can be separate git repos

### Workspace Integration

| Type | Auto-Added? | Manual Steps | Install Command |
|------|-------------|--------------|-----------------|
| Root | ❌ No | Add path to manifest | `opkg install` |
| Local | ✅ Yes | None | Auto-available |
| Global | ❌ No | Add path to manifest | `opkg install` |
| Custom | ❌ No | Add path to manifest | `opkg install --path <path>` |

## Scope Selection Decision Tree

```
Do you need to match an existing directory structure?
├─ Yes → Use CUSTOM PATH
│        opkg new my-package --path ./your/structure/here
│
└─ No → Is this package for one project only?
        ├─ Yes → Use LOCAL scope
        │        opkg new my-package
        │
        └─ No → Is this package shareable?
                ├─ Yes → Is it personal or team-wide?
                │        ├─ Personal → Use GLOBAL scope
                │        │              opkg new utils --scope global
                │        │
                │        ├─ Team (shared location) → Use CUSTOM PATH
                │        │              opkg new team-utils --path /mnt/team-share/packages/team-utils
                │        │
                │        └─ Team (separate repo) → Use ROOT scope
                │                   mkdir shared-package
                │                   cd shared-package
                │                   opkg new --scope root
                │
                └─ No → Are you distributing this package?
                        ├─ Yes → Use ROOT scope
                        │        opkg new my-package --scope root
                        │
                        └─ No → Use LOCAL scope (default)
                                opkg new my-package
```

**When to use each:**
- **LOCAL**: Default choice for project-specific packages
- **ROOT**: Standalone package repositories for distribution
- **GLOBAL**: Personal utilities used across your projects
- **CUSTOM**: When you need to integrate with existing structures or team conventions

## Scope Migration

### Local → Global

When a local package becomes useful across projects:

```bash
# Copy to global location
cp -r .openpackage/packages/my-package ~/.openpackage/packages/

# Update workspace manifest
# Change:
#   path: ./.openpackage/packages/my-package/
# To:
#   path: ~/.openpackage/packages/my-package/

# Remove local copy (optional)
rm -rf .openpackage/packages/my-package/

# Reinstall from global
opkg install my-package
```

### Global → Root (for distribution)

When a global package should be distributed:

```bash
# Create new repo
mkdir my-package-repo
cd my-package-repo

# Copy content from global
cp -r ~/.openpackage/packages/my-package/* .

# Already has openpackage.yml at root
# Just add git
git init
git add .
git commit -m "Initial commit"

# Pack and publish
opkg pack
opkg push my-package
```

### Local → Root (for monorepo)

When restructuring to monorepo:

```bash
# Move package to monorepo location
mv .openpackage/packages/my-package ../monorepo/packages/my-package/

# Update workspace manifest to point to new location
# packages:
#   - name: my-package
#     path: ../monorepo/packages/my-package/
```

## Scope and Path Best Practices

### Choose Local When:
- Package is specific to one project
- Team collaboration through git
- Need automatic workspace integration
- Just starting development
- Standard OpenPackage workflow

### Choose Global When:
- Package used across multiple projects
- Personal development utilities
- Want to maintain once, use everywhere
- Independent of any single project
- Personal, not team-shared

### Choose Root When:
- Creating standalone package for distribution
- Package has its own repository
- Monorepo structure with packages/ directory
- Following npm/cargo patterns
- Planning to publish to registry

### Choose Custom Path When:
- Need to match existing project structure
- Working with monorepo conventions
- Integrating with team's directory standards
- Using shared network/team directories
- Have specific organizational requirements
- Want packages outside `.openpackage/` structure

### Custom Path Best Practices:
1. **Use Relative Paths When Possible**: More portable within repo
2. **Document Path Conventions**: Ensure team knows where packages live
3. **Validate Parent Exists**: Create parent directories before running `opkg new`
4. **Consider Portability**: Absolute paths won't work across different systems
5. **Use Tilde for User Dirs**: `~/` works across user home directories
6. **Add to .gitignore if Needed**: Decide if custom location should be in version control

## See Also

- [New Command README](./README.md) - Full command specification
- [Scope Management](../scope-management.md) - Scope transitions and management
- [Directory Layout](../directory-layout.md) - Directory structure details
- [Package Sources](../package-sources.md) - Source resolution and paths
