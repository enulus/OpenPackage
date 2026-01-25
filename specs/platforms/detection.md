# Platform Detection

## Overview

The platform system detects which AI coding platforms are present in a workspace to determine which flows should execute. Detection uses multiple signals and respects configuration settings.

## Detection Signals

### 1. Root Directory Detection

A platform is detected if its **root directory** exists in the workspace.

**Example:**
```bash
# Cursor detected
.cursor/           # Directory exists
├── rules/
└── settings.json

# Claude detected
.claude/           # Directory exists
├── agents/
└── skills/
```

**Configuration:**
```jsonc
{
  "cursor": {
    "rootDir": ".cursor"  // Checked for existence
  }
}
```

**Detection logic:**
```typescript
const cursorDetected = fs.existsSync(path.join(workspace, ".cursor"));
```

### 2. Root File Detection

A platform is detected if its **root file** exists at the project root.

**Example:**
```bash
project/
├── CLAUDE.md      # Claude detected (even without .claude/ dir)
├── GEMINI.md      # Gemini detected
└── src/
```

**Configuration:**
```jsonc
{
  "claude": {
    "rootDir": ".claude",
    "rootFile": "CLAUDE.md"  // Checked for existence
  }
}
```

**Detection logic:**
```typescript
const claudeDetected = 
  fs.existsSync(path.join(workspace, ".claude")) ||
  fs.existsSync(path.join(workspace, "CLAUDE.md"));
```

### 3. Combined Detection

Both signals are checked independently:

```bash
# Scenario 1: Directory only
.cursor/          # ✓ Cursor detected

# Scenario 2: Root file only
CLAUDE.md         # ✓ Claude detected (no .claude/ dir needed)

# Scenario 3: Both present
.gemini/          # ✓ Gemini detected
GEMINI.md         # ✓ (redundant but valid)

# Scenario 4: Neither present
                  # ✗ Windsurf not detected
```

## Enabled Flag

Platforms must be **enabled** to execute flows, even if detected.

### Default Behavior

Platforms are **enabled by default** if not specified:

```jsonc
{
  "cursor": {
    "name": "Cursor",
    "rootDir": ".cursor",
    // enabled: true (implicit)
    "flows": []
  }
}
```

### Disabling Platforms

Set `enabled: false` to disable a platform:

```jsonc
{
  "windsurf": {
    "enabled": false  // Flows won't execute even if detected
  }
}
```

**Use cases:**
- Temporarily disable platform without removing config
- Override built-in platform in workspace
- Testing/debugging specific platforms

### Detection vs. Enabled

| Detected | Enabled | Result |
|----------|---------|--------|
| ✓        | ✓       | **Flows execute** |
| ✓        | ✗       | Flows skipped (disabled) |
| ✗        | ✓       | Flows skipped (not present) |
| ✗        | ✗       | Flows skipped |

## Platform Identities

### Platform IDs

Each platform has a **lowercase identifier** used as the top-level key:

```jsonc
{
  "cursor": { /* ... */ },      // ID: cursor
  "claude": { /* ... */ },      // ID: claude
  "windsurf": { /* ... */ }     // ID: windsurf
}
```

**Naming convention:**
- Lowercase
- Kebab-case for multi-word names
- Must be unique

### Platform Names

Human-readable display names:

```jsonc
{
  "cursor": {
    "name": "Cursor"  // Display name
  }
}
```

**Used in:**
- CLI output
- Status displays
- Error messages

## Aliases

Platforms can define **CLI-friendly aliases** for easier reference.

### Configuration

```jsonc
{
  "claude": {
    "name": "Claude Code",
    "aliases": ["claudecode", "claude-code"]
  },
  "cursor": {
    "name": "Cursor",
    "aliases": ["cursorcli", "cursor-editor"]
  }
}
```

### Alias Resolution

Aliases are resolved **case-insensitively** to canonical platform IDs:

```bash
# All resolve to 'cursor'
opkg install --platform=cursor
opkg install --platform=Cursor
opkg install --platform=cursorcli
opkg install --platform=CURSORCLI
```

**Resolution order:**
1. Check if input matches platform ID (case-insensitive)
2. Check if input matches any alias (case-insensitive)
3. If no match, treat as unknown platform

### Built-in Aliases

Common built-in aliases:

| Platform | ID | Aliases |
|----------|----|----|
| Cursor | `cursor` | `cursorcli` |
| Claude | `claude` | `claudecode` |
| Windsurf | `windsurf` | `windsurfcli` |
| Gemini | `gemini` | `geminicli`, `geminicode` |
| Kilo | `kilo` | `kilocode` |
| Codex | `codex` | `codexcli` |

## Detection API

### Detecting All Platforms

Check which platforms are present:

```typescript
import { detectPlatforms } from '@/core/platforms';

const results = detectPlatforms(workspaceDir);
// [
//   { id: 'cursor', name: 'Cursor', detected: true },
//   { id: 'claude', name: 'Claude Code', detected: false },
//   ...
// ]
```

### Getting Detected Platforms

Filter to only detected platforms:

```typescript
const detected = results.filter(r => r.detected);
// [{ id: 'cursor', name: 'Cursor', detected: true }]
```

### Checking Specific Platform

```typescript
const isCursorDetected = results.some(r => r.id === 'cursor' && r.detected);
```

## Universal Root Files

Some root files are **universal** and not attributed to a specific platform.

### AGENTS.md

The `AGENTS.md` file is treated as universal:

```bash
project/
├── AGENTS.md      # Universal, not platform-specific
├── CLAUDE.md      # Claude-specific
└── .cursor/
```

**Behavior:**
- Not used for platform detection
- Installed to workspace root for all platforms
- Typically defined in `global.flows`

```jsonc
{
  "global": {
    "flows": [
      { "from": "AGENTS.md", "to": "AGENTS.md" }
    ]
  }
}
```

## CLI Commands

### Check Detected Platforms

```bash
opkg list
```

**Output:**
```
Detected platforms:
  ✓ Cursor (.cursor/)
  ✓ Claude (CLAUDE.md)
  ✗ Windsurf
```

### Validate Platform Configuration

```bash
opkg validate platforms
```

**Checks:**
- All platforms properly configured
- Required fields present
- Detection signals valid

### List Available Platforms

```bash
opkg platforms list
```

**Output:**
```
Available platforms:
  cursor       Cursor
  claude       Claude Code
  windsurf     Windsurf
  ...
```

### Show Platform Details

```bash
opkg platforms show cursor
```

**Output:**
```
Platform: Cursor
ID: cursor
Root Directory: .cursor
Aliases: cursorcli
Enabled: true
Flows: 5 configured
```

## Detection in Flows

### Platform-Conditional Flows

Flows can check platform detection:

```jsonc
{
  "from": "mcp.jsonc",
  "to": ".cursor/mcp.json",
  "when": { "platform": "cursor" }
}
```

**Behavior:**
- Flow executes only if Cursor is **detected**
- Respects `enabled` flag
- Skipped silently if not detected

### Multi-Platform Conditionals

```jsonc
{
  "from": "config.yaml",
  "to": ".ai/config.json",
  "when": {
    "or": [
      { "platform": "cursor" },
      { "platform": "claude" }
    ]
  }
}
```

Executes if **any** platform is detected.

## Advanced Detection Scenarios

### Scenario 1: Legacy Directory Structure

Platform detected but incomplete:

```bash
.cursor/           # ✓ Detected
# Missing: .cursor/rules/, .cursor/commands/
```

**Behavior:**
- Platform detected
- Flows execute
- Directories created as needed

### Scenario 2: Root File Only

Platform detected via root file:

```bash
CLAUDE.md          # ✓ Claude detected
# No .claude/ directory
```

**Behavior:**
- Platform detected
- Flows create `.claude/` as needed
- Root file preserved

### Scenario 3: Custom Root Directory

Override built-in root directory:

```jsonc
{
  "cursor": {
    "rootDir": ".cursor-custom"
  }
}
```

**Detection:**
```bash
.cursor-custom/    # ✓ Detected (not .cursor/)
```

### Scenario 4: Disabled Built-in Platform

Workspace disables a platform:

```jsonc
// workspace/.openpackage/platforms.jsonc
{
  "windsurf": {
    "enabled": false
  }
}
```

```bash
.windsurf/         # ✓ Directory exists
# ✗ Platform disabled - flows skipped
```

## Detection Best Practices

### 1. Use Standard Directories

Stick to built-in root directories when possible:
```bash
.cursor/
.claude/
.windsurf/
```

### 2. Add Root Files for Clarity

Use platform-specific root files:
```bash
CLAUDE.md
GEMINI.md
QWEN.md
```

### 3. Test Detection

Always verify detection before assuming:
```bash
opkg list
```

### 4. Document Custom Directories

If overriding, document why:
```jsonc
{
  "cursor": {
    // Custom directory for monorepo setup
    "rootDir": ".cursor-workspace"
  }
}
```

### 5. Disable Unused Platforms

For performance, disable unused platforms:
```jsonc
{
  "cline": { "enabled": false },
  "roo-code": { "enabled": false }
}
```

## Troubleshooting

### Platform Not Detected

**Check directory:**
```bash
ls -la .cursor
```

**Check root file:**
```bash
ls -la CLAUDE.md
```

**Check configuration:**
```bash
opkg validate platforms
```

### Platform Detected But Flows Not Running

**Check enabled flag:**
```jsonc
{
  "cursor": {
    "enabled": true  // Must be true
  }
}
```

**Check flow conditions:**
```jsonc
{
  "when": { "platform": "cursor" }  // Must match detected platform
}
```

### Wrong Platform Detected

**Check root directory naming:**
```bash
# Wrong
.Cursor/           # Case-sensitive on Linux
.cursor_old/       # Different name

# Correct
.cursor/
```

### Multiple Platforms Detected

This is normal and expected:
```bash
.cursor/           # ✓ Cursor
.claude/           # ✓ Claude
.windsurf/         # ✓ Windsurf
```

All detected platforms execute their flows.

## Next Steps

- **Learn directory layout:** [Directory Layout](./directory-layout.md)
- **Configure platforms:** [Configuration](./configuration.md)
- **Debug detection:** [Troubleshooting](./troubleshooting.md)
