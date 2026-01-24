# Phase 4: Test and Documentation Cleanup

## Overview

Remove test files and documentation for deleted commands. This phase ensures the codebase is consistent and doesn't contain references to removed functionality.

## Goals

1. Remove test files for deleted commands
2. Remove spec directories for deleted commands
3. Update commands-overview.md to remove deleted commands
4. Update README.md if it references deleted commands
5. Clean up any orphaned test fixtures or helpers

## Test Files

### Location: `tests/commands/`

#### Files to Remove

1. **pack.test.ts**
   - Tests for pack command
   - May test name resolution, version handling, output options

2. **show.test.ts**
   - Tests for show command
   - May test resolution, display formatting, source types

### Location: `tests/core/`

#### Directories to Remove

1. **tests/core/package/pack-name-resolution.test.ts**
   - Tests pack-specific name resolution
   - Related to pack command logic

2. **tests/core/show/**
   - **manual-show-test.ts** - Manual testing script for show
   - **scope-discovery.test.ts** - Tests scope discovery for show

3. **tests/core/pull/**
   - **partial.test.ts** - Tests partial pull functionality

4. **tests/core/push/**
   - **partial-tarball.test.ts** - Tests partial push tarball creation
   - **stable-selection.test.ts** - Tests version selection for push
   - **upload-prepare.test.ts** - Tests upload preparation

### Location: `tests/utils/`

#### Files to Remove

1. **paths-option.test.ts**
   - Tests for `parsePathsOption()` from registry-paths.ts
   - Related to push/pull --paths option

### Notes on Test Files

- **No test files exist** for list or delete commands based on directory scan
- If any integration tests reference deleted commands, they should be updated or removed
- Test helper files that are only used by deleted tests can also be removed

### Validation

After removing test files:
1. Run test suite: `npm test` or equivalent
2. Should pass without errors (no missing test dependencies)
3. Verify no test imports reference deleted test files

## Spec/Documentation Directories

### Location: `specs/`

#### Directories to Remove

1. **specs/pack/**
   - Contains: `README.md`, `package-name-resolution.md` (or similar)
   - Documentation for pack command behavior

2. **specs/show/**
   - Contains: `README.md`, `show-remote.md` (or similar)
   - Documentation for show command behavior

3. **specs/push/**
   - Contains: `README.md`, various push behavior docs
   - Documentation for push command behavior

### Missing Directories

Based on directory scan:
- **No specs/pull/ directory** - No dedicated pull documentation
- **No specs/list/ directory** - No dedicated list documentation
- **No specs/delete/ directory** - No dedicated delete documentation

If these are found, remove them as well.

## Spec File Updates

### Location: `specs/commands-overview.md`

#### Sections to Remove

1. **Command Summary Table**
   - Remove rows for: pack, list, show, push, pull, delete
   - Keep rows for: new, add, remove, save, set, apply, install, uninstall, status, configure, login, logout

2. **Detailed Semantics**
   - Remove entire sections for:
     - `pack` - Archive mutable source to registry snapshot
     - `show` - Display detailed package information
     - `push` - Push package to remote registry (mentioned but deferred)

3. **Mutability Matrix**
   - Remove rows for: pack, show (if present)
   - Update table to show only remaining 11 commands

4. **Examples**
   - Remove any examples that reference deleted commands
   - Update usage examples to not mention pack, list, show, push, pull, delete

### Example Removals

Remove sections like:
```
### `pack`
Archive mutable source to registry snapshot.
- Flow: Read source → Version from yml/compute → Copy dir to registry/<name>/<ver>/.
- Options: `--output <path>` (bypass registry), `--dry-run`.
- Example: `opkg pack my-pkg`.
```

Remove command references from tables and lists.

## README Updates

### Location: Root `README.md`

#### Check for Command References

Search README.md for:
- "pack" command mentions
- "list" or "ls" command mentions
- "show" command mentions
- "push" command mentions
- "pull" command mentions
- "delete" or "del" command mentions

#### Update Sections

Common sections that may reference deleted commands:
1. **Quick Start** - Remove any examples using deleted commands
2. **Commands List** - Remove deleted commands from list
3. **Usage Examples** - Remove examples that use deleted commands
4. **Features** - Remove feature descriptions for deleted commands

#### Example Updates

If README shows:
```
Available commands:
- opkg new - Create new package
- opkg pack - Snapshot package to registry
- opkg list - List local packages
- opkg show - Show package details
...
```

Update to:
```
Available commands:
- opkg new - Create new package
- opkg save - Save workspace edits
- opkg install - Install packages
...
```

## Help Text Verification

### Already Updated in Phase 1

The help text in `src/index.ts` was updated in Phase 1, but verify:

1. **Custom help formatter** - No mentions of deleted commands
2. **Usage examples** - No examples with pack, list, show, push, pull, delete
3. **Command list** - Only shows remaining 11 commands

### CLI Testing

After documentation cleanup, test the CLI help:
```bash
opkg --help
opkg -h
```

Verify output shows only remaining commands.

## Additional Cleanup

### Test Fixtures

Check for any test fixtures or mock data related to deleted commands:
- `tests/fixtures/` - Look for pack, show, push, pull related fixtures
- Mock data files that simulate deleted command outputs

### Test Helpers

Check `tests/test-helpers.ts` for:
- Helper functions only used by deleted test files
- Mock setup functions for deleted commands
- Assertions specific to deleted commands

If found, remove or document them.

### Integration Tests

Check `tests/integration/` for:
- Tests that invoke deleted commands
- Tests that depend on deleted command output
- End-to-end scenarios using deleted commands

Update or remove as needed.

## Git Cleanup

### Optional: Remove from Git History

This is optional but can reduce repository size:

1. **Git filter-branch** - Remove deleted files from history (advanced)
2. **Git gc** - Garbage collection after deletions
3. **Consider the tradeoff** - History is valuable for understanding past decisions

**Recommendation**: Keep git history intact for now. Only clean history if repository size becomes an issue.

## Validation Steps

After completing this phase:

1. **Test Suite**
   - Run `npm test` or equivalent
   - All tests should pass
   - No errors about missing test files

2. **Build and Lint**
   - Run `npm run build`
   - Run `npm run lint` (if applicable)
   - No errors or warnings

3. **Documentation Audit**
   - Search all markdown files for command names
   - Verify no active documentation references deleted commands
   - Check specs/, README.md, and any other docs

4. **CLI Help Check**
   - Run `opkg --help`
   - Verify only 11 commands shown
   - No references to deleted commands

5. **File System Check**
   - Verify all test files deleted
   - Verify all spec directories deleted
   - No orphaned test fixtures

## Documentation Quality Check

After updates, verify documentation:
1. **Consistency** - All docs reference same command set
2. **Accuracy** - No broken internal links (e.g., [Pack](pack/))
3. **Completeness** - Remaining commands are well-documented
4. **Examples** - All examples use valid, remaining commands

## Estimated Time

1-2 hours

## Completion Criteria

- [x] All command test files removed (pack.test.ts, show.test.ts)
- [x] All core test directories removed (show/, pull/, push/)
- [x] Utility test file removed (paths-option.test.ts)
- [x] Spec directories removed (pack/, show/, push/)
- [x] commands-overview.md updated (no deleted commands)
- [x] README.md updated (no deleted commands)
- [x] Test suite passes (with test runner updated)
- [x] Build succeeds
- [x] CLI help text verified (no deleted commands)
- [x] Documentation audit completed (updated all spec files with references to deleted commands)

## Common Issues

1. **Test imports** - Deleted tests may be imported by other tests
2. **Shared fixtures** - Fixtures used by both deleted and remaining tests
3. **Integration tests** - May use deleted commands in workflows
4. **Documentation links** - Broken internal links after spec removal

**Mitigation**: Carefully review each file before deletion, check for dependencies.

## Next Phase

Proceed to [Phase 5: Validation and Integration](./phase-5-validation.md) for comprehensive testing and validation of the refactored codebase.
