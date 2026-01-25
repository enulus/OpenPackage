# Test Directory Organization

This directory contains all tests for the OpenPackage CLI, organized by functionality.

## Directory Structure

### `commands/`
Tests for CLI commands (user-facing functionality):
- `pack.test.ts` - Package creation and packing
- `set.test.ts` - Configuration setting
- `show.test.ts` - Package display functionality
- `list.test.ts` - List checking

### `core/`
Tests for core business logic and internal functionality:

#### `core/add/`
- Tests for adding packages to sources

#### `core/apply/`
- Tests for applying package changes

#### `core/flows/`
- Tests for the flow system (platform conversions, transformations)
- `fixtures/` - Shared test fixtures for flow tests
- `integration/` - Integration tests for flow pipelines
- `transforms/` - Tests for flow transformations
- `unit/` - Unit tests for flow components

#### `core/install/`
- Tests for package installation functionality
- Includes tests for Claude plugins, format detection, source resolution, etc.

#### `core/package/`
- Tests for package-level operations

#### `core/platforms/`
- Tests for platform configuration and conversion
- Includes tests for dynamic subdirectories, extension filters, YAML merging

#### `core/pull/`
- Tests for pulling packages from registry

#### `core/push/`
- Tests for pushing packages to registry

#### `core/remove/`
- Tests for removing packages from sources

#### `core/save/`
- Tests for saving packages
- Includes versioning and package index tests

#### `core/show/`
- Tests for package discovery and display logic

#### `core/source-resolution/`
- Tests for resolving package sources and mutability checks

#### `core/uninstall/`
- Tests for uninstalling packages

#### `core/workspace/`
- Tests for workspace management
- Includes workspace index and path tests

### `integration/`
Tests that span multiple components or test end-to-end workflows:
- `apply-mutable-source.test.ts`
- `cwd-global.test.ts`
- `immutable-save-add-errors.test.ts`
- `save-and-add-mutable-source.test.ts`
- `save-apply-flows.test.ts`

### `utils/`
Tests for utility functions:
- `custom-path-creation.test.ts` - Custom path resolution
- `git-spec-and-schema.test.ts` - Git spec parsing
- `path-display-formatter.test.ts` - Path formatting
- `path-resolution.test.ts` - Path resolution utilities
- `paths-option.test.ts` - Registry paths parsing
- `version-selection.test.ts` - Version range selection

### `fixtures/`
Shared test fixtures and data files used across multiple tests.

## Supporting Files

- `run-tests.ts` - Test runner script
- `test-helpers.ts` - Shared test utilities and helper functions
- `README.md` - This file

## Running Tests

```bash
npm test
```

## Test Organization Guidelines

When adding new tests:

1. **Command tests** (`commands/`) - For testing CLI command behavior
2. **Core tests** (`core/`) - For testing internal business logic, organized by feature area
3. **Integration tests** (`integration/`) - For end-to-end or multi-component tests
4. **Utility tests** (`utils/`) - For testing utility/helper functions
5. **Fixtures** (`fixtures/`) - For shared test data

Keep test files close to the functionality they test, mirroring the structure of the `src/` directory.
