# New Command Specification

The `opkg new` command creates new packages with explicit scope support. It replaces the deprecated `opkg init` command with clearer semantics and better UX.

## Overview

```bash
opkg new [package-name] [options]
```

Creates a new package with an `openpackage.yml` manifest in one of three predefined scopes or at a custom path:
- **root**: Current directory as package
- **local**: Workspace-scoped package (default)
- **global**: User-scoped package shared across workspaces
- **custom**: User-specified directory path

## Command Signature

### Arguments
- `[package-name]` (optional for root scope, required for local/global)
  - Package name following OpenPackage naming conventions
  - Supports scoped packages (`@org/package-name`)
  - Supports hierarchical packages (`@org/package-name/subpackage`)
  - Validated against naming rules (lowercase, alphanumeric, dots, underscores, hyphens, slashes)
  - No consecutive or trailing slashes allowed

### Options
- `--scope <scope>` - Package scope: `root`, `local`, or `global` (prompts if not specified in interactive mode)
- `--path <path>` - Custom directory path for package (overrides `--scope`)
- `-f, --force` - Overwrite existing package without prompting
- `--non-interactive` - Skip interactive prompts, use defaults
- `-h, --help` - Display help for command

**Note:** Either `--scope` or `--path` is required in non-interactive mode. If both are provided, `--path` takes precedence and a warning is issued.

### Scope Selection

When running interactively **without** the `--scope` or `--path` flag, you'll be prompted to choose:

```bash
$ opkg new my-package
? Where should this package be created? › 
❯ Root (current directory) - Create openpackage.yml here - for standalone/distributable packages
  Local (workspace-scoped) - Create in .openpackage/packages/ - for project-specific packages
  Global (cross-workspace) - Create in ~/.openpackage/packages/ - shared across all workspaces on this machine
  Custom (specify path) - Create at a custom location you specify
```

If you select **Custom**, you'll be prompted to enter a directory path:

```bash
? Enter the directory path for the package: › ./my-custom-location
```

This ensures you make an explicit choice about where your package lives. For CI/CD and automation, use the `--scope` or `--path` flag to skip the prompt.

## Scopes

### Root Scope

**Location:** Current directory (`./openpackage.yml`)

```bash
opkg new my-package --scope root
opkg new --scope root  # Interactive: prompts for name
```

**Use Cases:**
- Dedicated package repository
- Standalone package development
- Similar to `npm init`, `cargo init`

**Behavior:**
- Creates `openpackage.yml` at cwd
- Does not create workspace structure
- Package content lives at cwd

**Example Structure:**
```
my-package/
├── openpackage.yml          # Package manifest
├── .cursor/                 # Platform-specific content
│   ├── rules/
│   └── commands/
├── root/                    # Root files
│   └── AGENTS.md
└── README.md
```

### Local Scope

**Location:** `.openpackage/packages/<package-name>/`

```bash
opkg new my-package              # Interactive: prompts for scope
opkg new my-package --scope local  # Explicit
```

**Use Cases:**
- Project-specific packages
- Workspace-scoped development
- Packages tied to single project

**Behavior:**
- Creates package in `.openpackage/packages/<name>/`
- Package content lives in nested directory
- Not automatically added to workspace (use `opkg install` to add)

**Example Structure:**
```
project/
├── .openpackage/
│   └── packages/
│       └── my-package/
│           ├── openpackage.yml  # Package manifest
│           ├── .cursor/
│           │   ├── rules/
│           │   └── commands/
│           └── root/
└── src/                     # Project source code
```

**Installation:**
```bash
opkg install my-package  # Adds to workspace manifest and installs files
```

### Global Scope

**Location:** `~/.openpackage/packages/<package-name>/`

```bash
opkg new shared-utils --scope global
```

**Use Cases:**
- Personal utilities shared across projects
- Common rules and prompts
- Cross-workspace shared packages

**Behavior:**
- Creates package in global directory
- Not added to workspace manifest (used via path reference)
- Persists across all workspaces

**Installation:**
- **By name**: `opkg install <package-name>` (automatic discovery with version-aware resolution)
- **By path**: `opkg install ~/.openpackage/packages/<package-name>/` (explicit)

**Priority**: Global packages are checked after workspace-local packages. When both global packages and registry versions exist, the system compares versions and uses the newer one (with tie-breaker preferring global for mutability).

**Example Structure:**
```
~/.openpackage/
└── packages/
    └── shared-utils/
        ├── openpackage.yml
        ├── .cursor/
        │   ├── rules/
        │   └── commands/
        └── root/
```

**Usage in Workspace:**
```bash
# Install by name - automatic discovery
opkg install shared-utils

# Or explicit path
opkg install ~/.openpackage/packages/shared-utils/

# Or add to openpackage.yml manually
```

```yaml
# Any workspace's .openpackage/openpackage.yml
packages:
  - name: shared-utils
    path: ~/.openpackage/packages/shared-utils/
```

### Custom Path

**Location:** User-specified directory path

```bash
opkg new my-package --path ./custom-location
opkg new my-package --path /opt/packages/my-package
opkg new my-package --path ~/projects/my-package
```

**Use Cases:**
- Monorepo structures with custom package organization
- Shared team directories outside standard locations
- Integration with existing project structures
- Special organizational requirements

**Behavior:**
- Creates package at the exact path specified
- Supports relative paths (resolved from cwd)
- Supports absolute paths
- Supports tilde expansion (`~` → home directory)
- Validates parent directory exists before creation
- Blocks dangerous system directories

**Path Types:**

| Type | Example | Description |
|------|---------|-------------|
| Relative | `./my-package` | Relative to current directory |
| Relative Parent | `../shared/my-package` | Up and across directory tree |
| Absolute | `/opt/packages/my-package` | Full path from root |
| Tilde | `~/projects/my-package` | Relative to home directory |

**Example Structure:**
```
/custom/location/
└── my-package/
    ├── openpackage.yml          # Package manifest
    ├── .cursor/                 # Platform-specific content
    │   ├── rules/
    │   └── commands/
    └── root/                    # Root files
```

**Safety Features:**
- **Parent Validation**: Ensures parent directory exists before creating package
- **System Directory Protection**: Blocks creation in `/usr`, `/bin`, `/etc`, etc.
- **Existence Checking**: Detects existing packages and requires `--force` to overwrite
- **Clear Errors**: Provides actionable error messages when validation fails

**Installation:**
Custom path packages can be installed by path:
```bash
opkg install --path ./custom-location/my-package
# or
opkg install /opt/packages/my-package
```

**Priority**: When using custom paths, the package is treated similarly to root-scoped packages. Installation and management are done via explicit path references.

**Interactive Example:**
```bash
$ opkg new
? Where should this package be created? › Custom (specify path)
? Enter the directory path for the package: › ./my-custom-location
? Package name: › my-package
? Description: › My custom package
✓ my-custom-location/openpackage.yml created

📍 Location: Custom path (./my-custom-location)
💡 This package is at a custom location you specified

💡 Next steps:
   1. Add files to your package at: ./my-custom-location
   2. Install to workspace with path: opkg install --path ./my-custom-location
```

**Non-Interactive Example:**
```bash
$ opkg new my-package --path ./custom-location --non-interactive
✓ custom-location/openpackage.yml created
  - Name: my-package

📍 Location: Custom path (./custom-location)
💡 This package is at a custom location you specified
```

**Error Examples:**
```bash
# Parent directory doesn't exist
$ opkg new test --path ./non-existent/package
Error: Parent directory does not exist: /path/to/non-existent
Please create it first or choose a different path.

# System directory blocked
$ opkg new test --path /usr/my-package
Error: Cannot create package in system directory: /usr/my-package

# Both flags provided (warning)
$ opkg new test --scope local --path ./custom
# Uses custom path, logs warning about --scope being ignored
```

## Behavior Details

### Interactive Mode (Default)

When `--non-interactive` is not specified, prompts user for:
- Package name (if not provided and scope allows)
- Description
- Keywords (space-separated)
- Private flag

**Example Session:**
```bash
$ opkg new my-package
? Package name: › my-package
? Description: › My awesome package
? Keywords (space-separated): › tools utils
? Private package? › No
✓ .openpackage/packages/my-package/openpackage.yml created
```

### Non-Interactive Mode

When `--non-interactive` is specified:
- Uses provided package name or cwd basename
- Skips all prompts
- Creates minimal manifest with name only

**Example:**
```bash
$ opkg new my-package --non-interactive
✓ .openpackage/packages/my-package/openpackage.yml created
  - Name: my-package
```

### Conflict Handling

#### Existing Package Without Force

If package already exists and `--force` is not specified:
- Displays existing package information
- Does not overwrite
- Exits successfully

```bash
$ opkg new existing-package
✓ .openpackage/packages/existing-package/openpackage.yml already exists
  - Name: existing-package
  - Version: 1.0.0
  - Description: Existing package
```

#### Existing Package With Force

If package already exists and `--force` is specified:
- Overwrites `openpackage.yml`
- Preserves existing content directories
- Logs overwrite action

```bash
$ opkg new existing-package --force
✓ .openpackage/packages/existing-package/openpackage.yml created
  - Name: existing-package
```

### Workspace Integration

The `opkg new` command **creates** packages but does **not** automatically add them to the workspace manifest.

To use a package after creation, explicitly install it:
```bash
opkg new my-package --scope local
opkg install my-package  # Adds to workspace manifest and installs files
```

This separation keeps package creation (scaffolding) distinct from package usage (dependency management).

### Error Handling

#### Missing Scope or Path (Non-Interactive)
```bash
$ opkg new my-package --non-interactive
Error: Either --scope or --path is required in non-interactive mode.

Usage with scope:
  opkg new [package-name] --scope <root|local|global> --non-interactive

Usage with custom path:
  opkg new [package-name] --path <directory> --non-interactive

Available scopes:
  root   - Create in current directory
  local  - Create in .openpackage/packages/
  global - Create in ~/.openpackage/packages/
```

#### Missing Package Name
```bash
$ opkg new --scope local --non-interactive
Error: Package name is required for local scope in non-interactive mode.
Usage: opkg new <package-name> --scope local --non-interactive
```

#### Invalid Scope
```bash
$ opkg new my-package --scope invalid
Error: Invalid scope: 'invalid'
Valid scopes: root, local, global
```

#### Invalid Package Name
```bash
$ opkg new My-Package
Error: Package name 'My-Package' is invalid.
Package names must be lowercase...
```

#### Custom Path: Non-Existent Parent Directory
```bash
$ opkg new my-package --path ./non-existent/package
Error: Parent directory does not exist: /path/to/non-existent
Please create it first or choose a different path.
```

#### Custom Path: System Directory Blocked
```bash
$ opkg new my-package --path /usr/my-package
Error: Cannot create package in system directory: /usr/my-package
```

#### Custom Path: Already Exists Without Force
```bash
$ opkg new my-package --path ./existing
Error: Package already exists at: /path/to/existing
Use --force to overwrite.
```

#### Custom Path: Empty Path
```bash
$ opkg new my-package --path ""
Error: Path cannot be empty
```

## Output Format

### Success Output

```bash
✓ <path-to-openpackage.yml> created
  - Name: <package-name>
  [- Version: <version>]      # If specified
  [- Description: <desc>]     # If specified

📍 Scope: <scope-description>
💡 <scope-specific-tip>

💡 Next steps:
   1. <step-1>
   2. <step-2>
   3. <step-3>
```

### Error Output

```bash
Error: <error-message>
[Additional context or suggestions]
```

## Examples

### Create Package with Interactive Scope Selection
```bash
$ opkg new my-tools
? Where should this package be created? › 
❯ Root (current directory) - Create openpackage.yml here - for standalone/distributable packages
  Local (workspace-scoped) - Create in .openpackage/packages/ - for project-specific packages
  Global (cross-workspace) - Create in ~/.openpackage/packages/ - shared across all workspaces on this machine

# User selects "Root"
? Package name: › my-tools
? Description: › My project tools
? Keywords (space-separated): › tools utils
? Private package? › No

✓ openpackage.yml created
  - Name: my-tools
  - Description: My project tools
  - Keywords: tools, utils

📍 Scope: Current directory (root package)

💡 Next steps:
   1. Add files to your package in current directory
   2. Use `opkg save` to save changes
   3. Install in other workspaces: opkg install my-tools
```

### Create Local Package (Explicit Scope)
```bash
$ opkg new my-tools --scope local
# Skips scope prompt, goes directly to package details
✓ .openpackage/packages/my-tools/openpackage.yml created
  - Name: my-tools

📍 Scope: Workspace-local (.openpackage/packages/)
💡 This package is local to the current workspace

💡 Next steps:
   1. Add files to your package: cd .openpackage/packages/my-tools/
   2. Install to this workspace: opkg install my-tools
```

### Create Global Package
```bash
$ opkg new shared-prompts --scope global
✓ /Users/user/.openpackage/packages/shared-prompts/openpackage.yml created
  - Name: shared-prompts

📍 Scope: Global shared (~/.openpackage/packages/)
💡 This package can be used across all workspaces

💡 Next steps:
   1. Add files to your package: cd ~/.openpackage/packages/shared-prompts/
   2. Install to any workspace: opkg install shared-prompts
   3. Or use explicit path: opkg install ~/.openpackage/packages/shared-prompts/
```

### Create Root Package
```bash
$ opkg new my-package --scope root
✓ openpackage.yml created
  - Name: my-package

📍 Scope: Current directory (root package)

💡 Next steps:
   1. Add files to your package in current directory
   2. Use `opkg save` to save changes
   3. Install in other workspaces: opkg install my-package
```

### Create with Force Overwrite
```bash
$ opkg new existing-package --scope local --force --non-interactive
✓ .openpackage/packages/existing-package/openpackage.yml created
  - Name: existing-package

📍 Scope: Workspace-local (.openpackage/packages/)
💡 This package is local to the current workspace
```

### Non-Interactive Mode Requires Scope
```bash
$ opkg new my-package --non-interactive
Error: The --scope flag is required in non-interactive mode.
Usage: opkg new [package-name] --scope <root|local|global> --non-interactive

Available scopes:
  root   - Create in current directory
  local  - Create in .openpackage/packages/
  global - Create in ~/.openpackage/packages/

$ opkg new my-package --scope local --non-interactive
✓ .openpackage/packages/my-package/openpackage.yml created
  - Name: my-package
```

### Create Scoped Package
```bash
$ opkg new @myorg/utils
✓ .openpackage/packages/@myorg/utils/openpackage.yml created
  - Name: @myorg/utils

📍 Scope: Workspace-local (.openpackage/packages/)
💡 This package is local to the current workspace
```

### Create Package at Custom Path (Interactive)
```bash
$ opkg new my-package
? Where should this package be created? › Custom (specify path)
? Enter the directory path for the package: › ./custom-location
? Package name: › my-package
? Description: › Custom location package
? Keywords (space-separated): › 
? Private package? › No

✓ custom-location/openpackage.yml created
  - Name: my-package
  - Description: Custom location package

📍 Location: Custom path (./custom-location)
💡 This package is at a custom location you specified

💡 Next steps:
   1. Add files to your package at: ./custom-location
   2. Install to workspace with path: opkg install --path ./custom-location
```

### Create Package at Custom Path (Relative)
```bash
$ opkg new my-package --path ./custom-location --non-interactive
✓ custom-location/openpackage.yml created
  - Name: my-package

📍 Location: Custom path (./custom-location)
💡 This package is at a custom location you specified

💡 Next steps:
   1. Add files to your package at: ./custom-location
   2. Install to workspace with path: opkg install --path ./custom-location
```

### Create Package at Custom Path (Absolute)
```bash
$ opkg new my-package --path /opt/packages/my-package --non-interactive
✓ /opt/packages/my-package/openpackage.yml created
  - Name: my-package

📍 Location: Custom path (/opt/packages/my-package)
💡 This package is at a custom location you specified

💡 Next steps:
   1. Add files to your package at: /opt/packages/my-package
   2. Install to workspace with path: opkg install --path /opt/packages/my-package
```

### Create Package at Custom Path (Tilde)
```bash
$ opkg new my-package --path ~/projects/my-package --non-interactive
✓ /Users/user/projects/my-package/openpackage.yml created
  - Name: my-package

📍 Location: Custom path (~/projects/my-package)
💡 This package is at a custom location you specified

💡 Next steps:
   1. Add files to your package at: ~/projects/my-package
   2. Install to workspace with path: opkg install --path ~/projects/my-package
```

### Custom Path with Monorepo Structure
```bash
# Create package in monorepo packages directory
$ opkg new shared-components --path ../packages/shared-components --non-interactive
✓ ../packages/shared-components/openpackage.yml created
  - Name: shared-components

📍 Location: Custom path (../packages/shared-components)
💡 This package is at a custom location you specified

# Resulting structure:
# project-root/
# ├── workspace-a/        (current directory)
# └── packages/
#     └── shared-components/
#         └── openpackage.yml
```

## Integration with Other Commands

### After `opkg new`

**Local Package Workflow:**
```bash
opkg new my-package               # Create package
cd .openpackage/packages/my-package/
# Add files (rules, commands, etc.)
opkg install my-package           # Install to workspace
opkg save my-package              # Save changes back to package
```

**Global Package Workflow:**
```bash
opkg new shared-utils --scope global  # Create global package
cd ~/.openpackage/packages/shared-utils/
# Add files
# In any workspace:
# Add to .openpackage/openpackage.yml:
# - name: shared-utils
#   path: ~/.openpackage/packages/shared-utils/
opkg install                      # Install all deps including shared-utils
```

**Root Package Workflow:**
```bash
mkdir my-package && cd my-package
opkg new --scope root             # Create root package
# Add files to current directory
# Package ready for distribution via git or registry
```

### Auto-Creation by Other Commands

The `opkg add` command may auto-create a root package if needed:
```bash
$ cd my-package/
$ opkg add ./rules/example.md
# No package detected - prompts to create root package
? Create package for current directory? › Yes
? Package name: › my-package
? Description: › ...
✓ Created root package
✓ Added ./rules/example.md to package
```

## Comparison with Deprecated `opkg init`

| Aspect | Old `opkg init` | New `opkg new` |
|--------|----------------|----------------|
| **Command** | `opkg init` | `opkg new` |
| **Dual Purpose** | ✅ Yes (workspace + package) | ❌ No (package only) |
| **Root Package** | `opkg init` | `opkg new --scope root` |
| **Local Package** | `opkg init <name>` | `opkg new <name>` |
| **Global Package** | ❌ Not supported | `opkg new <name> --scope global` |
| **Custom Path** | ❌ Not supported | `opkg new <name> --path <dir>` |
| **Workspace Init** | Manual required | Auto-created when needed |
| **Scope Clarity** | Implicit | Explicit with `--scope` or `--path` |
| **Overwrite** | `--force` | `--force` (same) |
| **Interactive** | Yes (default) | Yes (default) |

## Implementation Notes

### Core Logic
- Implemented in `src/commands/new.ts` (CLI interface)
- Core logic in `src/core/package-creation.ts` (business logic)
- Scope-based path resolution in `src/utils/scope-resolution.ts` (pure functions)
- Custom path resolution in `src/utils/custom-path-resolution.ts` (pure functions)

### Design Patterns
- **Separation of Concerns**: CLI, business logic, and utilities separated
- **Single Responsibility**: Each module has one clear purpose
- **Reusability**: `createPackage()` used by both `new` command and `add` pipeline
- **Testability**: Pure functions for path resolution, testable business logic
- **Modularity**: Custom path logic isolated in dedicated utility module

### Custom Path Implementation
The custom path feature follows these principles:
1. **Validation First**: Validate path before any file operations
2. **Clear Errors**: Provide actionable error messages with context
3. **Safety Checks**: Block dangerous system directories
4. **Path Types**: Support relative, absolute, and tilde paths
5. **Precedence**: `--path` takes precedence over `--scope` when both provided

**Key Functions** (`src/utils/custom-path-resolution.ts`):
- `resolveCustomPath()` - Resolves any path type to absolute path
- `validateCustomPath()` - Validates path safety and existence
- `formatCustomPathForDisplay()` - Formats paths for user output

### Extensibility

#### Adding a New Predefined Scope (e.g., "team")
1. Add to `PackageScope` type in `scope-resolution.ts`
2. Add path resolution in `getScopePackageDir()`
3. Add description in `getScopeDescription()`
4. Update command help text
5. Add to interactive prompt choices

#### Adding Custom Path Validation Rules
1. Extend `validateCustomPath()` in `custom-path-resolution.ts`
2. Add new validation checks as needed
3. Return structured error messages
4. Update tests to cover new rules

## See Also

- [Scope Management](../scope-management.md) - Details on local/global scopes
- [Directory Layout](../directory-layout.md) - Package directory structure
- [Package Sources](../package-sources.md) - Path-based source resolution
- [Save Command](../save/) - Syncing changes back to packages
- [Pack Command](../pack/) - Creating registry snapshots
