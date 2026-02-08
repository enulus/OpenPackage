# Save Command (MVP)

## Overview

`opkg save` syncs workspace edits back to mutable package sources. It's the reverse operation of `opkg install`.

## Purpose

- **Direction**: Workspace → Source
- **Scope**: Syncs only files tracked in workspace index
- **Detection**: Hash-based change detection
- **Action**: Simple overwrite (no conflict resolution)

## Usage

```bash
# Save changes back to package source
opkg save <package-name>
```

## Flow

1. **Validate preconditions**
   - Package must be installed (exists in workspace index)
   - Package source must be mutable (not registry)
   - Package must have file mappings

2. **Collect changed files**
   - Read workspace index for file mappings
   - For each mapped file:
     - Check if exists in workspace
     - Calculate content hashes (workspace vs source)
     - Include if hash differs or source doesn't exist

3. **Copy files**
   - Copy changed workspace files to package source
   - Create directories as needed
   - Overwrite existing files

4. **Report results**
   - Show number of files saved
   - List saved file paths
   - Suggest running `opkg install` to re-sync

## Examples

### Basic workflow

```bash
# 1. Install package
opkg install my-pkg

# 2. Edit files in workspace
vim .cursor/commands/deploy.md

# 3. Save changes back to source
opkg save my-pkg
# ✓ Updated 1 file(s) in my-pkg
#    Package: /path/to/.openpackage/packages/my-pkg
#    ├── .cursor/commands/deploy.md
# 💡 Changes saved to package source.
#    To sync changes to workspace, run:
#      opkg install my-pkg

# 4. Re-install to sync to other platforms (optional)
opkg install my-pkg
```

### No changes detected

```bash
opkg save my-pkg
# ✓ No changes to save for my-pkg
#    Package: /path/to/.openpackage/packages/my-pkg/
```

## Error Cases

### Package not installed

```bash
opkg save unknown-pkg
# ❌ Package 'unknown-pkg' is not installed in this workspace.
#    Run 'opkg install unknown-pkg' to install it first.
```

### Immutable source (registry)

```bash
opkg save registry-pkg
# ❌ Cannot save to registry package (immutable).
```

### No file mappings

```bash
opkg save empty-pkg
# ❌ Package 'empty-pkg' has no files installed.
#    Nothing to save.
```

## Design Decisions

### Minimal MVP Approach

The save command is intentionally minimal to reduce complexity:

**What it does**:
- ✅ Hash-based change detection
- ✅ Simple overwrite strategy
- ✅ Smart skipping of unchanged files
- ✅ Creates new files in source if needed

**What it doesn't do** (vs previous implementation):
- ❌ No conflict resolution (just overwrites)
- ❌ No platform-specific variant selection
- ❌ No frontmatter parsing
- ❌ No interactive prompts
- ❌ No add-before-save

**Rationale**: These features added 5,000+ LOC of complexity for edge cases that rarely occur in practice.

### Hash-Based Detection

Files are compared using content hashes (xxhash3):
- Fast and reliable
- Ignores timestamps and metadata
- Only copies files that actually changed

### Overwrite Strategy

Always overwrites source files without prompting:
- **Rationale**: Save is intentional - if you run it, you want to sync back
- **Safety**: Only affects mutable sources (registry packages rejected)
- **Predictable**: No magic, no surprises

### Workspace Index as Source of Truth

Only saves files tracked in the workspace index:
- **Rationale**: Index records what was installed
- **Benefit**: Clear scope - only sync tracked files
- **Limitation**: New files need to be added via `opkg add` first

## Integration with Other Commands

- **`opkg install`**: Syncs source → workspace (forward)
- **`opkg save`**: Syncs workspace → source (reverse)
- **`opkg add`**: Adds new files to source (without sync)
- **`opkg pack`**: Creates registry snapshot from source

## Bidirectional Workflow

```
┌─────────────────┐
│  Package Source │
│  (mutable)      │
└────────┬────────┘
         │
         │ opkg install
         ▼
    ┌────────────┐
    │ Workspace  │
    │  (.cursor) │
    └─────┬──────┘
          │
          │ Edit files
          ▼
    ┌────────────┐
    │ Workspace  │
    │  (modified)│
    └─────┬──────┘
          │
          │ opkg save
          ▼
┌─────────────────┐
│  Package Source │
│  (updated)      │
└─────────────────┘
```

## Implementation

- **Pipeline**: `src/core/save/save-pipeline.ts` (~180 lines)
- **Command**: `src/commands/save.ts` (~50 lines)
- **Tests**: `tests/commands/save.test.ts` (6 test cases)
- **Total**: ~230 lines vs 5,000+ lines in previous implementation

## See Also

- [Install](../install/) – Package materialization (source → workspace)
- [Add](../add/) – Add new files to package source
- [Commands Overview](../commands-overview.md) – All command relationships
