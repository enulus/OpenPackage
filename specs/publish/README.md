# Publish Command

`opkg publish` publishes packages to either the local registry (default) or remote OpenPackage registry (with `--remote` flag). It supports flexible package input (package names, paths, or current directory) and provides comprehensive output formatting.

## Purpose & Direction
- **Default (Local)**: Publishes package to local registry (`~/.openpackage/registry/`)
- **Remote Mode**: Publishes package to remote OpenPackage registry (requires authentication)
- **Flexible Input**: Accepts package names, directory paths, or defaults to current directory
- **Custom Output**: Supports writing to custom directories (local mode only)

## Publishing Modes

### Local Publishing (Default)
```bash
opkg publish                    # Publish CWD to local registry
opkg publish my-package         # Publish named package to local registry
opkg publish ./path/to/package  # Publish from path to local registry
opkg publish --output ./dist    # Publish to custom directory
```

- **Destination**: Local registry (`~/.openpackage/registry/`) or custom path
- **Authentication**: Not required
- **Network**: Local filesystem only
- **Use Case**: Local development, testing, sharing packages across projects

### Remote Publishing
```bash
opkg publish --remote           # Publish CWD to remote registry
opkg publish my-package --remote  # Publish named package to remote
```

- **Destination**: Remote OpenPackage registry
- **Authentication**: Required (via profile or API key)
- **Network**: HTTPS upload to backend
- **Use Case**: Distribution to community, public sharing

## Package Input Resolution

The publish command accepts flexible package input:

1. **No argument** (default): Publishes from current working directory
   ```bash
   cd ~/my-package
   opkg publish
   ```

2. **Package name**: Resolves package by name from multiple locations
   ```bash
   opkg publish my-package  # Searches: CWD → Workspace → Global
   ```
   - **CWD**: If current directory contains matching package name
   - **Workspace**: `~/.openpackage/packages/<name>/`
   - **Global**: `~/.openpackage/packages/<name>/` (global installs)

3. **Directory path**: Direct path to package directory
   ```bash
   opkg publish ./packages/my-package  # Relative path
   opkg publish /abs/path/to/package   # Absolute path
   ```

4. **Rejected inputs**: Tarball and git URLs are explicitly rejected with helpful error messages

### Resolution Transparency
When resolving by package name, publish shows where the package was found:
```
✓ Found my-package in workspace packages
```

## Flow

### Local Publishing Flow
1. Resolve package source (CWD, name, or path)
2. Load and validate `openpackage.yml` manifest
3. Validate version (stable semver, allows prerelease warnings)
4. Collect package files from resolved source
5. Determine destination (registry or custom output)
6. Handle overwrite confirmation if destination exists
7. Write package files to destination
8. Display success with source/destination details

### Remote Publishing Flow
1. Resolve package source (CWD, name, or path)
2. Load and validate `openpackage.yml` manifest
3. Validate version (stable semver only, no prereleases)
4. Authenticate with remote registry
5. Resolve package name (auto-scope with username if unscoped)
6. Collect package files from resolved source
7. Create tarball from collected files
8. Upload tarball to remote registry via `/packages/push` API endpoint
9. Display success with package details

## Options

### Common Options
- `[package]`: Package name or path (optional, defaults to CWD)
- `--force`: Overwrite existing version without confirmation
- `--remote`: Publish to remote registry instead of local (default: local)

### Local-Only Options
- `--output <path>`: Write to custom directory instead of registry
  - Cannot be used with `--remote`
  - Useful for creating snapshots or custom distributions

### Remote-Only Options
- `--profile <profile>`: Specify authentication profile (default: `default`)
- `--api-key <key>`: Override with direct API key (skips profile lookup)

## Authentication (Remote Only)

Remote publishing requires authentication via one of:
- **Profile**: `--profile <name>` - Uses saved credentials from `opkg login`
- **API Key**: `--api-key <key>` - Direct API key override

See [Auth](../auth/) for authentication details.

## Package Scoping (Remote Only)

If package name in `openpackage.yml` is unscoped (no `@username/` prefix), remote publish automatically adds your username scope:
- Manifest: `name: my-package`
- Published as: `@username/my-package`

If already scoped, uses the exact name from manifest:
- Manifest: `name: @myorg/my-package`
- Published as: `@myorg/my-package`

Local publishing preserves the exact name from manifest (no auto-scoping).

See [Scope Management](../scope-management.md) for details.

## Version Requirements

### Local Publishing
- **Required**: `openpackage.yml` must contain a `version` field
- **Valid semver**: Must be valid semantic version
- **Prereleases allowed**: Warnings shown but publishing proceeds

### Remote Publishing
- **Required**: `openpackage.yml` must contain a `version` field
- **Valid semver**: Must be valid semantic version (e.g., `1.0.0`, `2.1.3`)
- **No prereleases**: Prerelease versions (e.g., `1.0.0-beta.1`) are rejected
- **No bumping**: Uses exact version from manifest (no auto-increment)

## File Collection

Publishes all files in source directory except:
- `.git/` and other VCS directories
- `node_modules/` and dependency directories
- Build artifacts and temporary files
- Files matching universal exclusion patterns

See [Registry Payload](../package/registry-payload-and-copy.md) for exclusion rules.

## Examples

### Local Publishing (Default)

#### Basic Local Publish
```bash
cd ~/projects/my-package
opkg publish                     # Publishes CWD to local registry
```

#### Publish Named Package
```bash
opkg publish my-package          # Resolves and publishes by name
```

#### Publish from Path
```bash
opkg publish ./packages/my-lib   # Publishes from relative path
opkg publish ~/dev/other-package # Publishes from absolute path
```

#### Custom Output Directory
```bash
opkg publish --output ./snapshots/v1.0.0  # Write to custom location
opkg publish my-package --output ./dist   # Named package to custom dir
```

#### Force Overwrite
```bash
opkg publish --force             # Skip confirmation prompts
opkg publish my-package --force  # Force overwrite existing version
```

### Remote Publishing

#### Basic Remote Publish
```bash
cd ~/projects/my-package
opkg publish --remote            # Publishes CWD to remote registry
```

#### Publish Named Package Remotely
```bash
opkg publish my-package --remote # Resolves and publishes to remote
```

#### With Authentication Options
```bash
opkg publish --remote --profile production  # Use specific profile
opkg publish --remote --api-key xyz123      # Use API key directly
```

### Typical Workflows

#### Local Development Workflow
```bash
cd ~/projects/my-package
# Edit package files...
opkg set --ver 1.2.0              # Update version
opkg publish                      # Publish to local registry
opkg install my-package           # Install from local registry in another project
```

#### Public Release Workflow
```bash
cd ~/projects/my-package
# Edit package files...
opkg set --ver 1.2.0              # Update version
opkg publish                      # Test locally first
opkg publish --remote             # Then publish to remote
```

## Output

### Local Publishing Output
Shows:
- Package name and version
- Description (if available in manifest)
- Source path (where package was found)
- Destination (registry path or custom output)
- File count

Example:
```
✓ Found my-package in workspace packages
✓ Published my-package@1.2.0
✓ Description: A helpful utility package
✓ Source: ~/.openpackage/packages/my-package
✓ Registry: ~/.openpackage/registry/my-package/1.2.0
✓ Files: 25
```

### Remote Publishing Output
Shows:
- Package name (with scope)
- Description (if available)
- Source path
- Version published
- Registry URL
- Profile used
- File count
- Tarball size
- Checksum (first 12 chars)
- Optional server message

Example:
```
✓ Found my-package in current directory

Publishing '@username/my-package@1.2.0' to remote registry...
Profile: default
Registry: https://backend.openpackage.dev/v1

✓ Creating tarball...
✓ Created tarball (25 files, 48.3 KB)
Uploading to registry...

✓ Published @username/my-package@1.2.0 to remote registry

✓ Description: A helpful utility package
✓ Source: ~/projects/my-package
✓ Registry: https://backend.openpackage.dev/v1
✓ Profile: default
✓ Files: 25
✓ Size: 48.3 KB
✓ Checksum: a3f5d8e9c1b2...
```

## Errors

### No openpackage.yml
```
❌ No openpackage.yml found in current directory
   Run this command from a package root directory
```
**Solution**: Navigate to package directory or create `openpackage.yml`

### Package Not Found (When Using Name)
```
❌ Package 'my-package' not found.
   Searched: current directory, workspace packages (.openpackage/packages/), and global packages (~/.openpackage/packages/).
   Make sure the package exists in one of these locations.
```
**Solution**: Check package name or provide a path instead

### Tarball Input Rejected
```
❌ Publish command does not support tarball inputs.
   To publish from a tarball, first extract it to a directory.
```
**Solution**: Extract tarball first, then publish from directory

### Git Input Rejected
```
❌ Publish command does not support git inputs.
   To publish from a git repository, first clone it to a directory.
```
**Solution**: Clone repository first, then publish from directory

### Missing Name
```
❌ openpackage.yml must contain a name field
```
**Solution**: Add `name: my-package` to `openpackage.yml`

### Missing Version
```
❌ openpackage.yml must contain a version field to publish
```
**Solution**: Add `version: 1.0.0` to `openpackage.yml`

### Invalid Version
```
❌ Invalid version: abc. Provide a valid semver version.
```
**Solution**: Use valid semver format (e.g., `1.0.0`, `2.1.3`)

### Prerelease Version (Remote Only)
```
❌ Prerelease versions cannot be published: 1.0.0-beta.1
```
**Solution**: Remove prerelease suffix or publish locally first

### Already Exists (Without Force)
```
❌ Package my-package@1.2.0 already exists in registry (~/.openpackage/registry/my-package/1.2.0).
   Use --force to overwrite, or update the version in openpackage.yml.
```
**Solution**: Use `--force` flag or increment version

### Invalid Option Combination
```
❌ --output option is only supported for local publishing (cannot be used with --remote)
```
**Solution**: Remove `--remote` flag when using `--output`

### Authentication Failed (Remote Only)
```
❌ Authentication failed. Run "opkg login" to configure credentials.
```
**Solution**: Run `opkg login` to authenticate or use `--api-key`

### Network Error (Remote Only)
```
❌ Network error: Unable to connect to registry
```
**Solution**: Check internet connection and registry availability

## Comparison: Local vs Remote

| Aspect | Local Publishing | Remote Publishing |
|--------|------------------|-------------------|
| **Destination** | Local registry or custom dir | Remote OpenPackage backend |
| **Authentication** | Not required | Required |
| **Network** | Local filesystem only | HTTPS upload |
| **Prerelease versions** | Allowed (with warning) | Rejected |
| **Custom output** | Supported (`--output`) | Not supported |
| **Auto-scoping** | No | Yes (if unscoped) |
| **Use Case** | Development, testing, local sharing | Public distribution |

## Integration
- **Replaces**: `pack` command (deprecated, removed)
- **Authentication**: Requires `opkg login` for remote mode
- **Manifest**: Uses same `openpackage.yml` format as other commands
- **File exclusion**: Respects universal file exclusion patterns
- **Package resolution**: Uses same resolution logic across commands

## Implementation
For implementation details, see:
- Main pipeline: `src/core/publish/publish-pipeline.ts`
- Local pipeline: `src/core/publish/local-publish-pipeline.ts`
- Upload (remote): `src/core/publish/publish-upload.ts`
- Errors: `src/core/publish/publish-errors.ts`
- Types: `src/core/publish/publish-types.ts`

Related: [Registry](../registry.md), [Auth](../auth/), [Commands Overview](../commands-overview.md)
