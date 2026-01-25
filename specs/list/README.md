# List Command

`opkg list` reports the state of installed packages, validating sources and sync status via hashes. Helps debug drifts between source and workspace.

## Purpose
- N/A direction: Read-only inspection.
- Uses unified index to check all packages.

## Flow
1. Read `.openpackage/openpackage.index.yml`.
2. For each package:
   - Resolve/validate source path exists.
   - Compare source files vs. workspace mappings using content hashes.
   - Classify: Synced (✅), Modified (⚠️ workspace changed), Missing (❌ source/path issue).
3. Output table/report; optional verbose.

## Output Example
```
✅ my-rules@1.0.0  synced    ./.openpackage/packages/my-rules/
⚠️ shared@1.2.3   modified  ~/.openpackage/packages/shared/
❌ community@1.0.0 missing   ~/.openpackage/registry/community/1.0.0/
```

## Options
- `--verbose`: File-level details.
- `--json`: Machine-readable.
- Filter by package.

## Errors
- Corrupt index: Repair hints.
- Path access issues.

## Integration
- Ties to index schema [Package Index](package/package-index-yml.md).
- Useful before save (see modified) or uninstall.
- See [Commands Overview](commands-overview.md).

Impl: [List Pipeline](../core/list/list-pipeline.ts).