# Set Command Specification

## Overview

The `opkg set` command updates manifest fields in `openpackage.yml` for mutable package sources. It provides both interactive and batch modes for modifying package metadata.

## Command Signature

```bash
opkg set [package] [options]
```

## Arguments

- `[package]` (optional) - Package name or path
  - If omitted, operates on the package in the current directory
  - Can be a package name (searches workspace/global) or a path

## Options

### Field Options

- `--ver <version>` - Set package version (must be valid semver)
- `--name <name>` - Set package name
- `--description <desc>` - Set package description
- `--keywords <keywords>` - Set keywords (space-separated)
- `--author <author>` - Set package author
- `--license <license>` - Set license identifier
- `--homepage <url>` - Set homepage URL
- `--private` - Mark package as private

### Behavior Options

- `-f, --force` - Skip confirmation prompts
- `--non-interactive` - Require flags, no prompting (for CI/CD)
- `-h, --help` - Display help for command

## Modes of Operation

### Interactive Mode

Triggered when no field options are provided. Prompts user for each field, showing current values as defaults.

```bash
# Interactive update of CWD package
opkg set

# Interactive update of named package
opkg set my-package
```

**Behavior:**
1. Displays current package information
2. Prompts for each field with current value as default
3. Shows change diff before applying
4. Requires confirmation (unless `--force`)
5. Only updates fields that changed

### Batch Mode

Triggered when one or more field options are provided. Updates only specified fields.

```bash
# Update version
opkg set my-package --ver 1.2.0

# Update multiple fields
opkg set my-package --ver 2.0.0 --description "New description"

# Update CWD package
opkg set --ver 0.5.0
```

**Behavior:**
1. Validates all provided field values
2. Shows change diff
3. Applies changes immediately (no confirmation unless interactive mode)

### Non-Interactive Mode

Used for CI/CD pipelines. Requires at least one field flag.

```bash
opkg set my-package --ver 1.0.0 --non-interactive
```

**Behavior:**
- Errors if no field flags provided
- No prompts or confirmations
- Fails fast on validation errors

## Package Resolution

The command searches for packages in the following order:

1. **Current directory** (if no package argument)
   - Looks for `openpackage.yml` in CWD

2. **Workspace packages** (if package name provided)
   - `.openpackage/packages/<package-name>/`

3. **Global packages** (if package name provided)
   - `~/.openpackage/packages/<package-name>/`

**Registry packages are excluded** - they are immutable and cannot be modified.

## Field Specifications

### Version Field (`--ver`)

**Format:** Valid semantic version

**Validation:**
- Must be valid semver (e.g., `1.0.0`, `2.1.3-beta.1`)
- Validated using semver library

**Examples:**
```bash
opkg set --ver 1.2.3
opkg set --ver 2.0.0-alpha.1
opkg set --ver 0.1.0
```

### Name Field (`--name`)

**Format:** Package name string

**Validation:**
- Must contain only: `a-z`, `0-9`, `.`, `_`, `-`, `/`
- Automatically normalized to lowercase
- No spaces allowed
- Supports scoped names: `@scope/package-name`
- Supports hierarchical names: `@scope/package-name/subpackage`
- No consecutive or trailing slashes

**Examples:**
```bash
opkg set --name my-package
opkg set --name @myorg/my-package
opkg set --name package.name
opkg set --name @anthropics/claude-code/commit-commands
```

### Description Field (`--description`)

**Format:** Plain text string

**Validation:** None (any string allowed)

**Examples:**
```bash
opkg set --description "My awesome package"
opkg set --description ""  # Clear description
```

### Keywords Field (`--keywords`)

**Format:** Space-separated string

**Processing:**
- Split by whitespace
- Empty strings filtered out
- Stored as array in YAML

**Examples:**
```bash
opkg set --keywords "ai coding assistant"
# Results in: keywords: [ai, coding, assistant]

opkg set --keywords "test"
# Results in: keywords: [test]
```

### Author Field (`--author`)

**Format:** Plain text string

**Validation:** None (any string allowed)

**Examples:**
```bash
opkg set --author "John Doe"
opkg set --author "Jane Smith <jane@example.com>"
```

### License Field (`--license`)

**Format:** License identifier string

**Validation:** None (any string allowed, but should be valid SPDX identifier)

**Examples:**
```bash
opkg set --license MIT
opkg set --license "Apache-2.0"
opkg set --license ISC
```

### Homepage Field (`--homepage`)

**Format:** URL string

**Validation:**
- Must be valid URL format
- Typically starts with `http://` or `https://`

**Examples:**
```bash
opkg set --homepage https://example.com
opkg set --homepage https://github.com/user/repo
```

### Private Field (`--private`)

**Format:** Boolean flag

**Behavior:**
- Flag present = `true`
- Flag absent = no change (or `false` in interactive mode)

**Examples:**
```bash
opkg set --private
# Results in: private: true
```

## Output and Feedback

### Change Diff Display

Before applying changes, displays a diff of what will change:

```
📝 Changes to apply:
  version: 1.0.0 → 1.1.0
  description: Old description → New description
  keywords: [test, demo] → [test, demo, updated]
```

### Success Output

After successful update:

```
✓ Updated my-package manifest
  Path: .openpackage/packages/my-package
  Type: workspace package
  Updated: version, description
```

### No Changes Detected

When no fields changed:

```
✓ No changes made to my-package
  Manifest unchanged
```

## Error Handling

### Missing Package

**Error:** No openpackage.yml in CWD and no package specified

```
Error: No openpackage.yml found in current directory.
Either specify a package name or run from a package root:
  opkg set <package-name> [options]
  opkg set [options]  # When in package root
```

### Package Not Found

**Error:** Named package doesn't exist in workspace or global

```
Error: Package 'nonexistent' not found in workspace or global packages.
Available locations:
  - Workspace packages: ./.openpackage/packages/
  - Global packages: ~/.openpackage/packages/
```

### Immutable Package

**Error:** Attempting to modify registry package

```
Error: Package 'my-package' not found in workspace or global packages.

Registry packages are immutable and cannot be modified directly.
To edit a registry package:
  1. Install it with a mutable source: opkg install my-package --path <local-path>
  2. Or copy it to workspace: opkg pull my-package
```

### Invalid Version

**Error:** Version doesn't follow semver

```
Error: Invalid version format: "not-a-version"
Version must be valid semver (e.g., 1.0.0, 2.1.3-beta.1)
```

### Invalid Name

**Error:** Name contains invalid characters

```
Error: Package name 'invalid name' segment 'invalid name' contains invalid characters (use only: a-z, 0-9, ., _, -)
```

### Invalid URL

**Error:** Homepage is not a valid URL

```
Error: Invalid homepage URL: "not-a-url"
Must be a valid URL (e.g., https://example.com)
```

### Non-Interactive Without Flags

**Error:** Non-interactive mode requires field flags

```
Error: Non-interactive mode requires at least one field flag.
Available flags: --ver, --name, --description, --keywords, --author, --license, --homepage, --private
Example: opkg set my-package --ver 1.0.0 --non-interactive
```

## Mutability and Immutability

### Mutable Sources (Allowed)

- ✅ Workspace packages (`.openpackage/packages/`)
- ✅ Global packages (`~/.openpackage/packages/`)
- ✅ Current directory packages (with `openpackage.yml`)

### Immutable Sources (Rejected)

- ❌ Registry packages (`~/.openpackage/registry/`)
  - Packed versions are snapshots and cannot be modified
  - Must be pulled/copied to mutable location first

## Use Cases

### Version Bump for Release

```bash
# Update version before packing
opkg set my-package --ver 1.2.0
opkg pack my-package
```

### Add Metadata to Existing Package

```bash
# Add complete metadata
opkg set my-package \
  --description "My awesome package" \
  --keywords "ai coding assistant" \
  --author "John Doe" \
  --license "MIT" \
  --homepage "https://example.com"
```

### Rename Package

```bash
# Update the name
opkg set old-name --name new-name

# Note: Package directory remains the same
# Consider updating workspace index references if needed
```

### Mark as Private

```bash
# Prevent accidental public push
opkg set my-package --private
```

### Interactive Metadata Update

```bash
# Review and update all fields interactively
opkg set my-package
```

### CI/CD Version Update

```bash
# Automated version bump in pipeline
opkg set my-package --ver $NEW_VERSION --non-interactive
```

## Integration with Other Commands

### With `pack`

```bash
# Set version, then pack to registry
opkg set my-package --ver 1.0.0
opkg pack my-package
```

### With `push`

```bash
# Update metadata before pushing to remote
opkg set my-package --description "Production ready"
opkg pack my-package
opkg push my-package
```

### With `new`

```bash
# Create package, then add metadata later
opkg new my-package --scope local --non-interactive
opkg set my-package --ver 1.0.0 --description "Initial version"
```

## Comparison with Related Commands

| Command | Purpose | Creates Files | Modifies Metadata | Supports Interactive |
|---------|---------|---------------|-------------------|---------------------|
| `opkg new` | Create new package | ✅ Yes | ✅ Initial | ✅ Yes |
| `opkg set` | Update existing package | ❌ No | ✅ Update | ✅ Yes |
| `opkg pack` | Snapshot to registry | ✅ Registry copy | ❌ No | ❌ No |
| `opkg save` | Sync workspace edits | ❌ No | ❌ No | ❌ No |

## Technical Implementation

See [set-behavior.md](./set-behavior.md) for detailed implementation behavior.

## Examples

### Basic Usage

```bash
# Update version of CWD package
cd my-package/
opkg set --ver 1.1.0

# Update named workspace package
opkg set my-package --ver 2.0.0

# Update multiple fields
opkg set my-package --ver 1.5.0 --author "Jane Doe" --license "Apache-2.0"
```

### Interactive Usage

```bash
# Prompt for all fields
opkg set my-package

# Example session:
# Current package: my-package (v1.0.0)
# Leave blank to keep current value
#
# Name [my-package]: 
# Version [1.0.0]: 1.1.0
# Description [My package]: Updated description
# Keywords [test demo]: test demo updated
# Author [John Doe]: 
# License [MIT]: 
# Homepage []: https://example.com
# Private [false]: 
#
# 📝 Changes to apply:
#   version: 1.0.0 → 1.1.0
#   description: My package → Updated description
#   keywords: [test, demo] → [test, demo, updated]
#   homepage: (not set) → https://example.com
#
# Apply these changes? (y/n): y
#
# ✓ Updated my-package manifest
```

### Automated Usage

```bash
#!/bin/bash
# CI/CD script for version bumping

NEW_VERSION=$(node -p "require('./package.json').version")

opkg set my-package \
  --ver "$NEW_VERSION" \
  --non-interactive

opkg pack my-package
```

## Design Rationale

### Option Names

- **`--ver`** instead of `--version`: Avoids conflict with Commander.js's global `--version` flag
- **`--name`**: Not reserved by Commander in subcommands, provides clear intent
- Other options use full descriptive names for clarity

### Mutability Enforcement

Only mutable sources are allowed to prevent accidental modification of registry snapshots, which serve as immutable history.

### Change Detection

Shows diffs before applying to prevent accidental modifications and provide transparency.

### Interactive Mode

Default to interactive when no flags provided to encourage thoughtful metadata updates.

### Validation Before Write

All fields validated before any file modifications to prevent partial updates on error.
