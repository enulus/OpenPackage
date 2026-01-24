# New Command - Summary

## Quick Reference

```bash
# Interactive - prompts for scope selection
opkg new my-package

# Create local package (explicit)
opkg new my-package --scope local

# Create global package
opkg new shared-utils --scope global

# Create root package
opkg new my-package --scope root

# Force overwrite
opkg new my-package --scope local --force

# Non-interactive (requires --scope)
opkg new my-package --scope local --non-interactive
```

## What is `opkg new`?

The `opkg new` command creates new OpenPackage packages with explicit scope support. It replaces the deprecated `opkg init` command with clearer semantics and better UX.

## Key Features

### Three Scopes

1. **Local (Default)** - Workspace-scoped packages
   - Location: `./.openpackage/packages/<name>/`
   - Auto-added to workspace manifest
   - Best for project-specific packages

2. **Global** - Cross-workspace packages
   - Location: `~/.openpackage/packages/<name>/`
   - Shared across all projects
   - Best for personal utilities

3. **Root** - Current directory as package
   - Location: `./openpackage.yml`
   - Standalone package
   - Best for distribution

### Smart Behavior

- **Scope Selection**: Interactive prompt in interactive mode; requires `--scope` flag in non-interactive mode
- **Interactive**: Prompts for scope and metadata by default
- **Workspace Integration**: Automatic for local scope
- **Conflict Detection**: Won't overwrite without `--force`

### Auto-Creation

For local packages:
- Workspace manifest auto-created if missing
- Package auto-added to workspace dependencies
- Ready to use immediately with other commands

## When to Use Each Scope

| Situation | Scope | Command |
|-----------|-------|---------|
| Project-specific rules | `local` | `opkg new my-rules` |
| Personal utilities | `global` | `opkg new utils --scope global` |
| Distributable package | `root` | `opkg new pkg --scope root` |
| Team shared package | `root` | `opkg new team-pkg --scope root` (separate repo) |
| Temporary/experimental | `local` | `opkg new experiment` |

## Common Workflows

### Local Package Development

```bash
# Create package
opkg new my-package

# Add content
cd .openpackage/packages/my-package/
mkdir -p .cursor/rules
echo "# Rule" > .cursor/rules/rule1.md

# Save and apply
opkg save my-package
opkg apply my-package
```

### Global Package Usage

```bash
# Create global package
opkg new shared-prompts --scope global

# Add content
cd ~/.openpackage/packages/shared-prompts/
mkdir -p .cursor/prompts
echo "# Prompt" > .cursor/prompts/prompt1.md

# Use in any workspace
cd ~/projects/any-project/
# Add to .openpackage/openpackage.yml:
# packages:
#   - name: shared-prompts
#     path: ~/.openpackage/packages/shared-prompts/
opkg install
```

### Root Package Distribution

```bash
# Create package repo
mkdir my-package && cd my-package
opkg new --scope root

# Add content
mkdir -p .cursor/rules
echo "# Rule" > .cursor/rules/rule1.md

# Package ready for distribution via git or registry
```

## Comparison with Deprecated `opkg init`

| Feature | `opkg init` (deprecated) | `opkg new` |
|---------|-------------------------|-----------|
| Create root package | `opkg init` | `opkg new --scope root` |
| Create local package | `opkg init <name>` | `opkg new <name>` |
| Create global package | ❌ Not supported | `opkg new <name> --scope global` |
| Workspace init | Manual required | Auto-created |
| Scope clarity | ❌ Implicit | ✅ Explicit |
| Dual purpose | ✅ Yes (confusing) | ❌ No (clear) |

## Integration with Other Commands

### After Creation

```bash
# Create → Add content → Save → Apply
opkg new my-pkg
# ... add files ...
opkg save my-pkg
opkg apply my-pkg
```

### With Install

```bash
# Create local package
opkg new my-pkg

# Workspace manifest updated automatically
opkg install  # Installs all deps including my-pkg
```

### With Status

```bash
opkg new my-pkg
# ... make changes ...
opkg status my-pkg  # Check sync state
```

## Options Reference

### `--scope <scope>`

Specifies package scope:
- `root` - Current directory
- `local` - Workspace packages (default)
- `global` - Global packages

**Example:**
```bash
opkg new my-pkg --scope global
```

### `-f, --force`

Overwrites existing package without confirmation.

**Example:**
```bash
opkg new existing-pkg --force
```

### `--non-interactive`

Skips interactive prompts, uses defaults.

**Example:**
```bash
opkg new my-pkg --non-interactive
```

## Error Handling

### Missing Package Name
```
Error: Package name is required for local scope.
Usage: opkg new <package-name> --scope local
```

### Invalid Scope
```
Error: Invalid scope: 'invalid'
Valid scopes: root, local, global
```

### Invalid Package Name
```
Error: Package name 'Invalid-Name' is invalid.
Package names must be lowercase...
```

### Existing Package (without --force)
```
✓ .openpackage/packages/existing-pkg/openpackage.yml already exists
  - Name: existing-pkg
  - Version: 1.0.0
```

## Best Practices

### Do's

✅ Use local scope for project-specific packages
✅ Use global scope for personal utilities
✅ Use root scope for distributable packages
✅ Run `opkg new` early in development
✅ Use `--non-interactive` in scripts/CI

### Don'ts

❌ Don't use root scope for project-specific packages
❌ Don't commit global packages to project repos
❌ Don't use force flag without understanding impact
❌ Don't create packages with uppercase names

## Migration from `opkg init`

If you previously used `opkg init`:

```bash
# Old way
opkg init              # Workspace + root package
opkg init my-package   # Local package

# New way
opkg new --scope root  # Just root package
opkg new my-package    # Local package (workspace auto-created)
```

See [MIGRATION-INIT-TO-NEW.md](../../MIGRATION-INIT-TO-NEW.md) for complete migration guide.

## File Structure Examples

### Local Package

```
project/
├── .openpackage/
│   ├── openpackage.yml          # Workspace (auto-created)
│   └── packages/
│       └── my-package/
│           └── openpackage.yml  # Package
└── src/
```

### Global Package

```
~/.openpackage/
└── packages/
    └── shared-utils/
        └── openpackage.yml
```

### Root Package

```
my-package/
└── openpackage.yml
```

## Further Reading

- [Full Command Specification](./README.md) - Complete command details
- [Scope Behavior](./scope-behavior.md) - Deep dive into scopes
- [Scope Management](../scope-management.md) - Scope transitions
- [Commands Overview](../commands-overview.md) - All commands
- [Directory Layout](../directory-layout.md) - Directory structure

## Support

For questions or issues:
1. Check this documentation
2. Run `opkg new --help`
3. Check [MIGRATION-INIT-TO-NEW.md](../../MIGRATION-INIT-TO-NEW.md)
4. Open issue on GitHub
