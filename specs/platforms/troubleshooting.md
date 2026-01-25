# Platform Troubleshooting

Debug, validate, and fix common issues with the platform system.

## Common Errors

### Error: "Platform not detected"

**Symptom:**
```bash
opkg list
# Output:
✗ Cursor not detected
```

**Possible causes:**

1. **Root directory missing**
   ```bash
   # Check if directory exists
   ls -la .cursor
   ```
   
   **Solution:** Create directory
   ```bash
   mkdir .cursor
   ```

2. **Root file missing** (for platforms with root files)
   ```bash
   # Check if root file exists
   ls -la CLAUDE.md
   ```
   
   **Solution:** Create root file or root directory

3. **Wrong directory name** (case-sensitive on Linux/Mac)
   ```bash
   # Wrong:
   .Cursor/    # Capital C
   .cursor_v2/ # Different name
   
   # Correct:
   .cursor/
   ```

4. **Custom rootDir not created**
   ```jsonc
   {
     "cursor": {
       "rootDir": ".cursor-custom"
     }
   }
   ```
   
   **Solution:** Create custom directory
   ```bash
   mkdir .cursor-custom
   ```

### Error: "Flows not executing"

**Symptom:** Files not transformed or written to workspace.

**Possible causes:**

1. **Platform disabled**
   ```jsonc
   {
     "cursor": {
       "enabled": false  // ← Problem
     }
   }
   ```
   
   **Solution:** Remove or set to `true`

2. **Conditional flow not met**
   ```jsonc
   {
     "when": { "platform": "claude" }  // But Cursor detected
   }
   ```
   
   **Solution:** Check condition matches detected platforms

3. **Invalid flow syntax**
   ```bash
   opkg validate platforms --strict
   ```
   
   **Solution:** Fix validation errors

4. **Source file missing in package**
   ```jsonc
   {
     "from": "rules/nonexistent.md"  // File doesn't exist
   }
   ```
   
   **Solution:** Verify source files exist in package

### Error: "Invalid flow schema"

**Symptom:**
```
Error: Flow missing required field 'from'
Error: Flow missing required field 'to'
```

**Solution:** Add required fields
```jsonc
{
  "from": "rules/**/*.md",  // Required
  "to": ".cursor/rules/**/*.mdc"  // Required
}
```

### Error: "Transform not found"

**Symptom:**
```
Error: Unknown transform 'unknown-transform' in pipe
Available: [jsonc, yaml, toml, merge, ...]
```

**Solution:** Use valid transform name
```jsonc
{
  "pipe": ["yaml"]  // Valid built-in transform
}
```

See [Flow Reference](./flow-reference.md#built-in-transforms) for all transforms.

### Error: "Invalid JSONPath"

**Symptom:**
```
Error: Invalid JSONPath expression: '$.invalid..path'
```

**Solution:** Fix JSONPath syntax
```jsonc
{
  "path": "$.servers"  // Valid JSONPath
}
```

**Common JSONPath patterns:**
```jsonc
"$.editor"              // Extract editor object
"$.servers.*"           // All servers
"$.servers[0]"          // First server
"$.servers[?(@.enabled)]"  // Filter servers
```

### Error: "Circular dependency"

**Symptom:**
```
Error: Circular dependency detected: A → B → A
```

**Solution:** Remove circular references in flows. Flows should be unidirectional (package → workspace).

### Warning: "Package overwrites content"

**Symptom:**
```
Warning: Package @user/b overwrites content from @user/a in .cursor/mcp.json
```

**Not an error** - Expected behavior for multi-package composition.

**Solutions:**

1. **Use namespace isolation**
   ```jsonc
   {
     "namespace": true,
     "merge": "deep"
   }
   ```

2. **Use deep merge** (if not already)
   ```jsonc
   {
     "merge": "deep"
   }
   ```

3. **Review package priority** - Later packages override earlier ones

## Validation

### Validate Configuration

```bash
# Basic validation
opkg validate platforms

# Comprehensive validation
opkg validate platforms --strict
```

**What it checks:**
- Required fields present
- Valid types
- Transform names exist
- JSONPath syntax valid
- No circular dependencies
- Schema compliance

**Example output:**
```
✓ Configuration valid
✓ Platform 'cursor': 4 flows valid
✓ Platform 'claude': 3 flows valid
✗ Platform 'custom': Flow 1 missing 'to' field
```

### Validate Specific Platform

```bash
opkg validate platforms --platform=cursor
```

### JSON Output for Scripting

```bash
opkg validate platforms --json
```

```json
{
  "valid": false,
  "errors": [
    {
      "platform": "custom",
      "flow": 1,
      "error": "Missing required field 'to'"
    }
  ]
}
```

## Debugging

### Enable Debug Logging

```bash
# Debug flow execution
DEBUG=opkg:flows opkg install @user/package

# Debug all platform operations
DEBUG=opkg:platforms,opkg:flows opkg install @user/package

# Debug everything
DEBUG=opkg:* opkg install @user/package
```

**Example output:**
```
[flows] Loading platforms config...
[flows] Detected platforms: cursor, claude
[flows] Executing flow: rules/**/*.md → .cursor/rules/**/*.mdc
[flows] Matched file: rules/typescript.md
[flows] Loading source: rules/typescript.md
[flows] Parsing format: markdown
[flows] Applying transforms: none
[flows] Writing target: .cursor/rules/typescript.mdc
[flows] ✓ Success
```

### Dry-Run Mode

Preview without writing files:

```bash
opkg install @user/package --dry-run
```

**Output:**
```
Would create:
  .cursor/rules/typescript.mdc
  .cursor/rules/python.mdc
  .cursor/mcp.json (merged)

Would update:
  .cursor/settings.json (deep merge)

Would skip:
  .windsurf/ (platform not detected)
```

### Check Platform Detection

```bash
opkg list
```

**Output:**
```
Detected platforms:
  ✓ Cursor (.cursor/)
  ✓ Claude (CLAUDE.md)
  ✗ Windsurf
  ✗ Gemini
```

### List Available Platforms

```bash
opkg platforms list
```

**Output:**
```
Available platforms:
  cursor       Cursor                 enabled
  claude       Claude Code            enabled
  windsurf     Windsurf              enabled
  gemini       Gemini Code           disabled
```

## Common Issues

### Issue: Files in Wrong Directory

**Problem:**
```
Expected: .cursor/rules/typescript.mdc
Actual:   .cursor/typescript.mdc
```

**Cause:** Incorrect `to` path

**Solution:** Check flow target includes subdirectory
```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.mdc"  // Include 'rules/' subdirectory
}
```

### Issue: Extension Not Changed

**Problem:**
```
Expected: typescript.mdc
Actual:   typescript.md
```

**Cause:** Target extension not specified

**Solution:** Specify correct extension in flow
```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.mdc"  // Explicit .mdc extension
}
```

### Issue: Merge Not Working

**Problem:** New content replaces existing instead of merging

**Cause:** Missing or wrong merge strategy

**Solution:** Use explicit merge strategy
```jsonc
{
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "merge": "deep"  // Explicitly set merge
}
```

**Remember:**
- Default merge strategy is `"replace"` for arrays/primitives
- Use `"deep"` for object composition
- Use `"shallow"` for top-level merge only

### Issue: Keys Not Mapping

**Problem:** Keys not renamed as expected

**Cause:** Incorrect key mapping syntax

**Solution:** Use correct dot notation
```jsonc
{
  "map": {
    "theme": "workbench.colorTheme"  // Correct: dot notation
  }
}
```

**Common mistakes:**
```jsonc
{
  "map": {
    "theme": "workbench/colorTheme"  // Wrong: slash
    "theme": "workbench->colorTheme" // Wrong: arrow
  }
}
```

### Issue: Format Not Converting

**Problem:** YAML stays YAML instead of converting to JSON

**Cause:** Target extension doesn't match desired format

**Solution:** Use correct target extension
```jsonc
{
  "from": "config.yaml",
  "to": ".cursor/config.json"  // .json extension triggers conversion
}
```

**Auto-detected formats:**
- `.json`, `.jsonc` → JSON
- `.yaml`, `.yml` → YAML
- `.toml` → TOML
- `.md` → Markdown

### Issue: Namespace Not Applied

**Problem:** Content not wrapped in namespace

**Cause:** `namespace` not specified

**Solution:** Enable namespace
```jsonc
{
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "namespace": true,  // Add this
  "merge": "deep"
}
```

### Issue: Conditional Flow Always Skipped

**Problem:** Flow never executes

**Cause:** Condition never true

**Debug:**
```bash
opkg list  # Check detected platforms
```

**Solution:** Fix condition to match environment
```jsonc
{
  "when": { "platform": "cursor" }  // Make sure Cursor is detected
}
```

### Issue: Multiple Packages Conflicting

**Problem:** Last package overwrites previous packages

**Cause:** No namespace isolation

**Solution:** Use namespace + merge
```jsonc
{
  "namespace": true,
  "merge": "deep"
}
```

### Issue: Performance Slow

**Problem:** Installation takes too long

**Possible causes:**

1. **Too many platforms enabled**
   
   **Solution:** Disable unused platforms
   ```jsonc
   {
     "unused-platform": { "enabled": false }
   }
   ```

2. **Complex flows on all files**
   
   **Solution:** Use conditionals to skip unnecessary work
   ```jsonc
   {
     "when": { "exists": "config.yaml" }
   }
   ```

3. **Deep merges on large files**
   
   **Solution:** Use shallow merge if possible
   ```jsonc
   {
     "merge": "shallow"
   }
   ```

## Performance Tips

### 1. Simple Flows Are Fastest

```jsonc
{
  "from": "rules/**/*.md",
  "to": ".cursor/rules/**/*.mdc"
}
```

Direct copy with no transforms is optimized.

### 2. Use Conditionals

Skip unnecessary work:

```jsonc
{
  "when": { "platform": "cursor" }  // Skip if Cursor not detected
}
```

### 3. Multi-Target Reuses Parsing

```jsonc
{
  "from": "config.yaml",
  "to": {
    ".cursor/config.json": {},
    ".claude/config.json": {}
  }
}
```

Source parsed once, serialized twice.

### 4. Disable Unused Platforms

```jsonc
{
  "windsurf": { "enabled": false },
  "cline": { "enabled": false }
}
```

### 5. Shallow Merge When Possible

```jsonc
{
  "merge": "shallow"  // Faster than deep
}
```

## Validation Checklist

Before deploying configuration:

- [ ] Run `opkg validate platforms --strict`
- [ ] Test with `--dry-run`
- [ ] Check platform detection with `opkg list`
- [ ] Verify files written to correct locations
- [ ] Test with multiple packages for conflicts
- [ ] Enable debug logging for complex flows
- [ ] Document custom flows with comments

## Getting Help

### CLI Help

```bash
opkg --help
opkg list --help
opkg install --help
```

### Report Issues

When reporting issues, include:

1. **Configuration files**
   ```bash
   cat .openpackage/platforms.jsonc
   ```

2. **Platform detection**
   ```bash
   opkg list
   ```

3. **Validation output**
   ```bash
   opkg validate platforms --strict
   ```

4. **Debug logs**
   ```bash
   DEBUG=opkg:* opkg install @user/package 2>&1 | tee debug.log
   ```

5. **Package structure**
   ```bash
   tree -L 2 node_modules/@user/package
   ```

## Quick Reference

### Debug Commands

```bash
# Validate configuration
opkg validate platforms --strict

# Check detection
opkg list

# Show platform details
opkg show platforms --platform=cursor

# Dry-run installation
opkg install @user/package --dry-run

# Enable debug logging
DEBUG=opkg:flows opkg install @user/package

# List all platforms
opkg platforms list
```

### Common Fixes

| Problem | Solution |
|---------|----------|
| Platform not detected | Create root directory or root file |
| Flows not executing | Check `enabled: true`, validate flows |
| Files in wrong place | Check `to` path in flow |
| Extensions wrong | Specify extension in `to` path |
| Merge not working | Add `"merge": "deep"` |
| Keys not mapping | Use dot notation in `map` |
| Format not converting | Check target extension |
| Conflicts between packages | Use `"namespace": true` |

## Next Steps

- **Review configuration:** [Configuration](./configuration.md)
- **Learn flow syntax:** [Flows](./flows.md)
- **See examples:** [Examples](./examples.md)
- **View flow reference:** [Flow Reference](./flow-reference.md)
