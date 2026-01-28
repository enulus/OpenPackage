# Publish Command

`opkg publish` publishes a package from the current working directory to the remote OpenPackage registry, similar to `npm publish`. It requires the current directory to contain a valid `openpackage.yml` file.

## Purpose & Direction
- **CWD → Remote Registry**: Publishes package directly from current directory to remote.
- Authentication: Required (via profile or API key).
- Precondition: `openpackage.yml` must exist in current directory with valid metadata.
- Key: Simple, immediate publishing workflow without local registry intermediate.

## Comparison with Pack

| Aspect | `pack` | `publish` |
|--------|--------|-----------|
| **Source** | Named package or path | Current directory only |
| **Destination** | Local registry (`~/.openpackage/registry/`) | Remote registry (OpenPackage backend) |
| **Authentication** | Not required | Required |
| **Network** | Local filesystem only | Network request |
| **Use Case** | Local development workflow | Distribution to community |

## Flow
1. Verify `openpackage.yml` exists in current working directory
2. Parse manifest and validate required fields (`name`, `version`)
3. Validate version is stable semver (no prerelease versions allowed)
4. Authenticate with remote registry (via `--profile` or `--api-key`)
5. Resolve package name (auto-scope with username if unscoped)
6. Collect all package files from CWD (excludes junk: `.git`, `node_modules`, etc.)
7. Create tarball from collected files
8. Upload tarball to remote registry via `/packages/push` API endpoint
9. Display success message with package details

## Authentication
Publish requires authentication via one of:
- **Profile**: `--profile <name>` - Uses saved credentials from `opkg login`
- **API Key**: `--api-key <key>` - Direct API key override

See [Auth](../auth/) for authentication details.

## Package Scoping
If package name in `openpackage.yml` is unscoped (no `@username/` prefix), publish automatically adds your username scope:
- Manifest: `name: my-package`
- Published as: `@username/my-package`

If already scoped, uses the exact name from manifest:
- Manifest: `name: @myorg/my-package`
- Published as: `@myorg/my-package`

See [Scope Management](../scope-management.md) for details.

## Version Requirements
- **Required**: `openpackage.yml` must contain a `version` field
- **Valid semver**: Must be valid semantic version (e.g., `1.0.0`, `2.1.3`)
- **No prereleases**: Prerelease versions (e.g., `1.0.0-beta.1`) are rejected
- **No bumping**: Uses exact version from manifest (no auto-increment)

## File Collection
Publishes all files in current directory except:
- `.git/` and other VCS directories
- `node_modules/` and dependency directories
- Build artifacts and temporary files
- Files matching universal exclusion patterns

See [Registry Payload](../package/registry-payload-and-copy.md) for exclusion rules.

## Options
- `--profile <profile>`: Specify authentication profile (default: `default`)
- `--api-key <key>`: Override with direct API key (skips profile lookup)

## Examples

### Basic Publish
```bash
cd ~/projects/my-package
opkg publish                     # Publishes CWD to remote registry
```

### With Authentication Options
```bash
opkg publish --profile production  # Use specific profile
opkg publish --api-key xyz123     # Use API key directly
```

### Typical Workflow
```bash
cd ~/projects/my-package
# Edit package files...
opkg set --ver 1.2.0              # Update version in openpackage.yml
opkg publish                      # Publish to remote
```

## Output
Success output shows:
- Package name (with scope)
- Version published
- Tarball size
- Checksum (first 12 chars)
- Registry URL
- Optional message from server

Example:
```
Publishing package '@username/my-package'...
Profile: default
Registry: https://backend.openpackage.dev/v1

✓ Creating tarball...
✓ Created tarball (25 files, 48.3 KB)
Uploading to registry...

✓ Package published successfully!

Package: @username/my-package
Version: 1.2.0
Size: 48.3 KB
Checksum: a3f5d8e9c1b2...
Registry: https://backend.openpackage.dev/v1
```

## Errors

### No openpackage.yml
```
❌ No openpackage.yml found in current directory
   Run this command from a package root directory
```
**Solution**: Navigate to package directory or create `openpackage.yml`

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

### Prerelease Version
```
❌ Prerelease versions cannot be published: 1.0.0-beta.1
```
**Solution**: Remove prerelease suffix or publish as stable version

### Authentication Failed
```
❌ Authentication failed. Run "opkg login" to configure credentials.
```
**Solution**: Run `opkg login` to authenticate or use `--api-key`

### Network Error
```
❌ Network error: Unable to connect to registry
```
**Solution**: Check internet connection and registry availability

## Integration
- Complements `pack` command (pack → local registry, publish → remote registry)
- Requires `opkg login` for authentication setup
- Uses same manifest format as other commands
- Respects universal file exclusion patterns
- Auto-scoping follows same rules as push (deprecated)

## Implementation
For implementation details, see:
- Pipeline: `src/core/publish/publish-pipeline.ts`
- Upload: `src/core/publish/publish-upload.ts`
- Errors: `src/core/publish/publish-errors.ts`

Related: [Pack](../pack/), [Registry](../registry.md), [Auth](../auth/), [Commands Overview](../commands-overview.md)
