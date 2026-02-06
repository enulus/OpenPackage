# Status Command

## Overview

The `opkg status` command provides workspace file status information, showing both tracked and untracked files.

## Command Signature

```bash
opkg status [options]
```

## Options

- **(no flags)** - Show summary with counts
- `--tracked` - Show all tracked files from workspace index with existence validation
- `--untracked` - Show files detected by platform patterns but not in index
- `--global` - Apply to home directory instead of workspace

## Default Behavior (Summary)

Shows a quick summary of workspace health:

```bash
$ opkg status

Workspace: /path/to/project
Tracked: 45 | Untracked: 8

Tip: Use --tracked or --untracked to see file lists
```

**Data sources:**
- Tracked count: From `.openpackage/openpackage.index.yml`
- Untracked count: From platform pattern matching

## --tracked Flag

Shows all files tracked in the workspace index, grouped by platform, with existence validation.

```bash
$ opkg status --tracked

Tracked files (45):
  ✓ 44 present | ✗ 1 missing

claude:
  ✓ .claude/rules/base.md                       (typescript-rules@2.0.0)
  ✗ .claude/rules/missing.md                    (typescript-rules@2.0.0) [MISSING]
  ✓ .claude/rules/typescript.md                 (typescript-rules@2.0.0)
```

**Features:**
- Groups files by platform
- Shows package ownership with version
- Validates file existence on disk
- Marks missing files with ✗ and [MISSING] label
- Provides counts of present vs missing files

**Purpose:** See what files are currently managed by installed packages and detect if any tracked files are missing from the workspace.

## --untracked Flag

Shows files that match platform patterns but are not tracked in the workspace index.

```bash
$ opkg status --untracked

Untracked files (8):

claude:
  rules/
    custom-typescript.md
    experimental-patterns.md
  commands/
    deploy-workflow.md
```

**Features:**
- Detects platforms in workspace
- Uses platform export flow patterns for discovery
- Filters out files already in workspace index
- Groups by platform and category

**Purpose:** Discover files in your workspace that could be managed but aren't currently tracked.

## Mutual Exclusivity

`--tracked` and `--untracked` flags are mutually exclusive:

```bash
opkg status --tracked --untracked  # Error: cannot combine
```

**Rationale:** Different data sources and purposes. User should choose one view at a time.

## Validation

**Required:** Workspace index must exist at `.openpackage/openpackage.index.yml`

If missing:
```
Error: No workspace index found at <path>
Initialize a workspace with 'opkg new' or ensure you're in a valid workspace.
```

## Global Scope

Works with `--global` flag to check home directory:

```bash
opkg status --global              # Summary for ~/
opkg status --global --tracked    # Tracked files in ~/
opkg status --global --untracked  # Untracked files in ~/
```

## Use Cases

### Workspace Health Check
```bash
opkg status
```
Quick overview of tracked vs untracked file counts.

### Audit Installed Files
```bash
opkg status --tracked
```
See all files from installed packages, verify they exist.

### Discover Unmanaged Files
```bash
opkg status --untracked
```
Find files that could be packaged but aren't.

### Detect Missing Files
```bash
opkg status --tracked
```
Files marked with ✗ [MISSING] indicate tracked files that were deleted or moved.

## Comparison with `list` Command

| Feature | `list` | `status` |
|---------|--------|----------|
| Focus | Packages | Files |
| Shows package tree | ✓ | ✗ |
| Shows dependencies | ✓ | ✗ |
| Shows tracked files | via --files | via --tracked |
| Shows untracked files | ✗ | ✓ |
| Validates existence | ✗ | ✓ |
| Health check | ✗ | ✓ |

**Mental model:**
- `opkg list` = "What packages are installed?"
- `opkg status` = "What's the state of my workspace files?"

## Implementation

**Core modules:**
- `src/commands/status.ts` - Command handler and display
- `src/core/status/status-pipeline.ts` - Pipeline orchestration
- `src/core/status/tracked-files-collector.ts` - Extract tracked files from index
- `src/core/list/untracked-files-scanner.ts` - Scan for untracked files (reused)

**Code reuse:**
- Workspace index reading from `workspace-index-yml.ts`
- Untracked scanner from list command
- Execution context from existing infrastructure
