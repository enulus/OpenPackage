# Uninstall Command

`opkg uninstall` removes a package's files/mappings from workspace without touching source. Cleans index/yml/root files.

## Purpose
- Workspace cleanup: Reverse of install/apply.
- Safe: Only mapped content; source persists.
- Precise: Removes only what the package contributed, preserving other packages' content.

## Flow
1. Read index for package entry/mappings.
2. Delete workspace files/dirs per mappings (platforms/root).
3. For merged files with key tracking, remove only package's keys.
4. Update root files (e.g., remove package section from AGENTS.md).
5. Remove package from index.
6. Remove dep from openpackage.yml.
7. Optional: Prune unused registry if applicable.

## File Removal Strategies

### 1. Simple File Mappings

When a file is owned entirely by one package (no merge):

```yaml
files:
  rules/typescript.md:
    - .cursor/rules/typescript.md
```

**Behavior:** File is deleted entirely.

### 2. Merged Files with Key Tracking

When a file is shared by multiple packages with deep/shallow merge:

```yaml
files:
  mcp.jsonc:
    - target: .opencode/opencode.json
      merge: deep
      keys:
        - mcp.server1
        - mcp.server2
```

**Behavior:** 
- Load the target file (`.opencode/opencode.json`)
- Remove only the tracked keys (`mcp.server1`, `mcp.server2`)
- Delete empty parent objects after key removal
- If file becomes empty, delete it; otherwise save updated content
- Other packages' keys are preserved

**Example:**

Before uninstall:
```json
{
  "mcp": {
    "server1": { "url": "http://localhost:3000" },
    "server2": { "url": "http://localhost:4000" },
    "server3": { "url": "http://localhost:5000" }
  }
}
```

After uninstalling package with keys `[mcp.server1, mcp.server2]`:
```json
{
  "mcp": {
    "server3": { "url": "http://localhost:5000" }
  }
}
```

### 3. Composite Merge (Delimiter-Based)

When a file uses composite merge strategy:

```yaml
files:
  AGENTS.md:
    - target: CLAUDE.md
      merge: composite
```

**Behavior:**
- Remove content between `<!-- package: name -->` ... `<!-- -->` markers
- Preserve other packages' sections
- Preserve manual edits outside markers

**Example:**

Before uninstall:
```markdown
<!-- package: package-a -->
Instructions from Package A
<!-- -->

<!-- package: package-b -->
Instructions from Package B
<!-- -->
```

After uninstalling `package-a`:
```markdown
<!-- package: package-b -->
Instructions from Package B
<!-- -->
```

## Key Tracking for Merged Files

### What is Key Tracking?

When packages use flow-based key mappings with merge strategies (`deep` or `shallow`), the workspace index tracks the **transformed keys** each package contributes to merged files. This enables precise removal during uninstall.

### When Keys Are Tracked

**Keys tracked when:**
- ✅ Flow uses `merge: 'deep'` or `merge: 'shallow'`
- ✅ Target file will be shared by multiple packages

**Keys NOT tracked when:**
- ❌ `merge: 'replace'` (whole file owned by one package)
- ❌ `merge: 'composite'` (delimiter-based tracking used instead)
- ❌ Simple file copy (no merge)

### Key Notation

Keys are stored in dot-notation format representing nested object paths:

```
mcp.server1          → { mcp: { server1: {...} } }
editor.fontSize      → { editor: { fontSize: 14 } }
servers.db.host      → { servers: { db: { host: "..." } } }
```

### Flow Example with Key Transformation

Consider this flow:

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".opencode/opencode.json",
  "pipe": ["filter-comments"],
  "map": {
    "mcpServers.*": "mcp.*"  // Key transformation!
  },
  "merge": "deep"
}
```

**Package source (`mcp.jsonc`):**
```json
{
  "mcpServers": {
    "server1": { "url": "http://localhost:3000" },
    "server2": { "url": "http://localhost:4000" }
  }
}
```

**After install**, workspace index tracks the **transformed** keys:
```yaml
packages:
  my-mcp-package:
    files:
      mcp.jsonc:
        - target: .opencode/opencode.json
          merge: deep
          keys:
            - mcp.server1    # Note: transformed from mcpServers.server1
            - mcp.server2    # Note: transformed from mcpServers.server2
```

**On uninstall:**
1. Load `.opencode/opencode.json`
2. Remove `mcp.server1` and `mcp.server2` (the transformed keys)
3. Save updated file or delete if empty

### Why Track Transformed Keys?

**The problem:** If we tracked source keys (`mcpServers.*`), we couldn't find them in the target file because they were transformed to `mcp.*`.

**The solution:** Track the **output** keys (after transformation), not the input keys. This works regardless of transformation complexity.

### Parent Cleanup

When removing keys, the uninstaller automatically cleans up empty parent objects:

```json
// Before removal
{
  "mcp": {
    "server1": { "url": "..." },
    "server2": { "url": "..." }
  }
}

// After removing mcp.server1 and mcp.server2
// The entire "mcp" object is removed because it's now empty
{}
```

## Options
- `--dry-run`: Preview deletions.
- Force without prompt.

## Example
```bash
opkg uninstall my-pkg  # Deletes mappings; updates files/index/yml
```

## Errors
- Package not installed.
- Files in use (rare; force?).

## Integration
- Uses same discovery as status/install.
- Post-uninstall: Re-add via install/add.
- See [Commands Overview](../commands-overview.md).
- See implementation: `src/core/uninstall/`
  - `uninstall-pipeline.ts` - Main orchestration
  - `flow-aware-uninstaller.ts` - Flow-aware file removal
  - `uninstall-file-discovery.ts` - File discovery

Root file handling: [Root Files](../package/package-root-layout.md).

Key tracking implementation: `src/core/flows/flow-key-extractor.ts`.