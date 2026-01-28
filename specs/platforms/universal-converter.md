# Universal Platform Converter

## Overview

The **Universal Platform Converter** enables OpenPackage to install platform-specific packages (like Claude Code plugins) across different platforms by automatically converting between formats.

**Key capability:** Install a Claude Code plugin directly into Cursor, OpenCode, or any other platform without manual conversion.

## Problem Statement

Previously, OpenPackage expected all packages to be in **universal format** (with `commands/`, `agents/`, `rules/` subdirectories). Platform-specific packages like Claude Code plugins use a different structure (`.claude/commands/`, `.claude/agents/`, etc.).

**The challenge:**
- Claude Code plugins are already in Claude format
- Installing to Claude platform: Should copy files AS-IS (no transformation)
- Installing to other platforms: Need to convert Claude → Universal → Target Platform

## Solution Architecture

### Three-Phase Approach

```
┌─────────────────────────────────────────────────────────┐
│  Phase 1: Format Detection                              │
│  - Analyze package file structure                       │
│  - Determine: universal or platform-specific            │
│  - Calculate confidence score                           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Phase 2: Strategy Selection                            │
│  • Source = Target Platform → Install AS-IS             │
│  • Source ≠ Target Platform → Convert                   │
│  • Universal Format → Standard Flow Installation        │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Phase 3: Execution                                     │
│  - Direct copy (AS-IS)                                  │
│  - OR: Bidirectional flow conversion                    │
│  - OR: Standard flow-based installation                 │
└─────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Format Detector (`format-detector.ts`)

**Purpose:** Identify package format by analyzing file paths.

**Detection heuristics:**
- Universal subdirs: `commands/`, `agents/`, `rules/`, `skills/`, `hooks/`
- Platform-specific dirs: `.claude/`, `.cursor/`, `.opencode/`, etc.
- Platform suffixes in filenames: `mcp.claude.jsonc`, `config.cursor.yaml`
- Confidence scoring based on file distribution

**Example:**
```typescript
import { detectPackageFormat } from './format-detector.js';

const files = [
  { path: '.claude/commands/review.md', content: '...' },
  { path: '.claude/agents/helper.md', content: '...' }
];

const format = detectPackageFormat(files);
// Result:
// {
//   type: 'platform-specific',
//   platform: 'claude',
//   confidence: 0.95,
//   analysis: { ... }
// }
```

**Format types:**
- `'universal'`: OpenPackage universal format
- `'platform-specific'`: Claude, Cursor, OpenCode, etc.

### 2. Flow Inverter (`flow-inverter.ts`)

**Purpose:** Reverse flow transformations to convert platform-specific → universal.

**Key insight:** The `platforms.jsonc` flows already define universal → platform transformations. We can **invert** these flows to go in reverse.

**Inversion rules:**
- **Paths:** Swap `from` ↔ `to`
  ```typescript
  // Original
  { from: "commands/**/*.md", to: ".claude/commands/**/*.md" }
  
  // Inverted
  { from: ".claude/commands/**/*.md", to: "commands/**/*.md" }
  ```

- **Map `$rename`:** Swap key pairs
  ```typescript
  // Original
  { $rename: { "mcp": "mcpServers" } }
  
  // Inverted
  { $rename: { "mcpServers": "mcp" } }
  ```

- **Operations processed in reverse order**
- **Non-reversible operations skipped** (`$set`, `$unset`, `$pipeline` with lossy transforms)
- **Format converters preserved** (`yaml`, `jsonc`, `toml`)
- **Filters skipped** (`filter-empty`, `filter-null`)

### 3. Platform Converter (`platform-converter.ts`)

**Purpose:** High-level orchestration of format conversions.

**Conversion pipeline stages:**
1. **Platform → Universal:** Invert source platform flows
2. **Universal → Target:** Apply target platform flows (handled by installer)

**Example usage:**
```typescript
import { createPlatformConverter } from './platform-converter.js';

const converter = createPlatformConverter(workspaceRoot);

const result = await converter.convert(
  package,
  targetPlatform,
  { dryRun: false }
);

if (result.success) {
  console.log(`Converted ${result.stages.length} stages`);
}
```

### 4. Enhanced Flow-Based Installer

**Purpose:** Integrate converter into installation pipeline.

**Installation strategies:**

#### Strategy 1: Direct Installation (AS-IS)
```
Source: Claude plugin
Target: claude platform
Action: Copy files directly, skip all transformations
```

#### Strategy 2: Convert via Universal
```
Source: Claude plugin
Target: cursor platform
Pipeline:
  1. Detect format (claude platform-specific)
  2. Invert claude flows (.claude/commands/*.md → commands/*.md)
  3. Apply cursor flows (commands/*.md → .cursor/commands/*.md)
```

#### Strategy 3: Standard Flow Installation
```
Source: Universal package
Target: Any platform
Action: Apply platform flows (existing behavior)
```

## Installation Flow

### Full Installation Pipeline

```typescript
async function installPackageWithFlows(context) {
  // 1. Detect package format
  const format = await detectPackageFormat(packageRoot);
  
  // 2. Check for direct installation
  if (shouldInstallDirectly(format, targetPlatform)) {
    return await installDirectly(context, format);
  }
  
  // 3. Check for conversion
  if (needsConversion(format, targetPlatform)) {
    return await installWithConversion(context, format);
  }
  
  // 4. Standard flow-based installation
  return await executeStandardFlows(context);
}
```

### Decision Tree

```
Package Format Detection
├─ Universal Format
│  └─→ Standard flow-based installation
│
├─ Platform-Specific (matches target)
│  └─→ Direct installation (AS-IS)
│
└─ Platform-Specific (different from target)
   └─→ Convert via universal
      ├─ Stage 1: Invert source platform flows
      └─ Stage 2: Apply target platform flows
```

## Usage Examples

### Example 1: Claude Plugin → Claude Platform

```bash
# Install Claude plugin to Claude platform
opkg install path/to/claude-plugin --platforms claude
```

**Behavior:**
- Detects: Claude platform-specific format
- Target: claude platform
- Action: **Direct installation (AS-IS)**
- Result: Files copied to `.claude/` without any transformation

**Console output:**
```
🔌 Detected Claude Code plugin
📦 Installing plugin: my-plugin@1.0.0
✓ Installing my-plugin AS-IS for claude platform (matching format)
✓ Added files: 5
   ├── .claude/commands/review.md
   ├── .claude/commands/test.md
   ├── .claude/agents/helper.md
   └── ...
```

### Example 2: Claude Plugin → Cursor Platform

```bash
# Install Claude plugin to Cursor platform
opkg install path/to/claude-plugin --platforms cursor
```

**Behavior:**
- Detects: Claude platform-specific format
- Target: cursor platform
- Action: **Convert via universal**
  1. Invert claude flows (`.claude/commands/*.md` → `commands/*.md`)
  2. Apply cursor flows (`commands/*.md` → `.cursor/commands/*.md`)

**Console output:**
```
🔌 Detected Claude Code plugin
📦 Installing plugin: my-plugin@1.0.0
🔄 Converting my-plugin from claude to cursor format
✓ Conversion stage: platform-to-universal (5 files)
✓ Applying cursor platform flows
✓ Added files: 5
   ├── .cursor/commands/review.md
   ├── .cursor/commands/test.md
   └── ...
```

### Example 3: Claude Plugin → Multiple Platforms

```bash
# Install to both Claude and Cursor
opkg install path/to/claude-plugin --platforms claude cursor
```

**Behavior:**
- For `claude`: Direct installation (AS-IS)
- For `cursor`: Convert via universal
- Efficient: Conversion happens once, applied to cursor only

### Example 4: Universal Package (Existing Behavior)

```bash
# Standard universal package installation
opkg install @user/package --platforms claude cursor
```

**Behavior:**
- Detects: Universal format
- Action: **Standard flow-based installation** (no changes)
- Claude: Apply claude flows
- Cursor: Apply cursor flows

## Configuration

**No configuration needed!** The system works automatically by:
1. Analyzing file structure
2. Reading existing `platforms.jsonc` flows
3. Inverting flows as needed

## API Reference

### Format Detector

```typescript
/**
 * Detect package format from file list
 */
function detectPackageFormat(files: PackageFile[]): PackageFormat

/**
 * Check if format is platform-specific
 */
function isPlatformSpecific(format: PackageFormat): boolean

/**
 * Check if conversion is needed
 */
function needsConversion(
  format: PackageFormat,
  targetPlatform: Platform
): boolean

/**
 * Check if should install AS-IS
 */
function shouldInstallDirectly(
  format: PackageFormat,
  targetPlatform: Platform
): boolean
```

### Flow Inverter

```typescript
/**
 * Invert a single flow
 */
function invertFlow(flow: Flow, sourcePlatform: Platform): InvertedFlow

/**
 * Invert multiple flows
 */
function invertFlows(flows: Flow[], sourcePlatform: Platform): InvertedFlow[]

/**
 * Check if flow is inverted
 */
function isInvertedFlow(flow: Flow): boolean
```

### Platform Converter

```typescript
/**
 * Convert package to target platform
 */
class PlatformConverter {
  async convert(
    pkg: Package,
    targetPlatform: Platform,
    options?: { dryRun?: boolean }
  ): Promise<ConversionResult>
  
  buildPipeline(
    sourceFormat: PackageFormat,
    targetPlatform: Platform
  ): ConversionPipeline
}

/**
 * Create converter instance
 */
function createPlatformConverter(workspaceRoot: string): PlatformConverter
```

## Implementation Details

### Format Detection Algorithm

```typescript
1. Scan all package files
2. For each file:
   a. Check if path starts with platform dir (.claude/, .cursor/, etc.)
   b. Check if path starts with universal subdir (commands/, agents/, etc.)
   c. Check for platform suffix in filename (mcp.claude.jsonc)
3. Calculate ratios:
   - universalRatio = universalFiles / totalFiles
   - platformRatio = platformSpecificFiles / totalFiles
4. Determine format:
   - If universalRatio > 0.7 → universal
   - If platformRatio > 0.7 → platform-specific (dominant platform)
   - Else → universal (default, low confidence)
```

### Flow Inversion Algorithm

```typescript
1. Swap from ↔ to paths
2. Process map operations in reverse order:
   For each operation:
   - $rename: Swap key pairs
   - $copy: Swap from/to
   - $set/$unset: Skip (not reversible)
   - $switch: Reverse pattern/value pairs
   - $pipeline: Invert operations if possible (see below)
3. Filter pipe transforms:
   - Keep: Format converters (yaml, jsonc, toml)
   - Keep: Merge strategies
   - Skip: Filters (filter-empty, filter-null)
   - Skip: Validation (validate-*)
4. Preserve: merge, when, namespace
5. Remove: embed, section
```

## Testing

### Unit Tests

**Format Detection:**
```typescript
// tests/format-detector.test.ts
- Detect universal format
- Detect Claude platform-specific
- Detect Cursor platform-specific
- Detect platform suffix in filenames
- Handle mixed files
- Provide detailed analysis
```

**Flow Inversion:**
```typescript
// tests/flow-inverter.test.ts
- Swap from/to paths
- Invert $rename operations
- Skip non-reversible operations
- Preserve merge strategy
- Handle pipe transforms
- Invert $copy operations
```

**Platform Converter:**
```typescript
// tests/platform-converter.test.ts
- Build conversion pipeline
- Convert between formats
- Handle matching formats (no conversion)
- Integration scenarios
```

### Integration Tests

```typescript
// tests/install-claude-plugin.test.ts
- Install Claude plugin to claude platform (AS-IS)
- Install Claude plugin to cursor platform (convert)
- Multi-platform installation
- Git-based plugin installation
```

## Performance Considerations

1. **Format Detection:** Fast - only analyzes file paths, no content parsing
2. **Direct Installation:** Fastest - simple file copy, no transformations
3. **Conversion:** Moderate - one conversion to universal, then standard flows
4. **Caching:** Package format cached after first detection

## Limitations

### Non-Reversible Operations

Some flow operations cannot be reliably inverted:

- **`$set`:** Cannot determine original value
- **`$unset`:** Cannot restore removed fields
- **`$pipeline`:** Complex multi-step transformations with lossy operations (e.g., `$map` with case changes)
- **Filters:** Cannot "un-filter" removed content

**Impact:** Conversion may not be 100% lossless for packages with complex transformations.

**Mitigation:** Most platform flows use simple path mappings and basic $rename operations, which invert perfectly.

### Round-Trip Accuracy

Converting `Platform A → Universal → Platform B` may not always equal converting `Platform B → Universal → Platform A` in reverse, due to:
- Non-reversible operations
- Lossy transformations (e.g., filtering, complex string manipulations)

**Best practice:** Keep flows simple and bidirectional-friendly.

## Future Enhancements

1. **Direct Platform-to-Platform:** Skip universal intermediate step for known conversions
2. **Conversion Validation:** Round-trip testing to verify accuracy
3. **Custom Converters:** Plugin system for complex conversions
4. **Conversion Cache:** Store converted packages for faster reinstalls
5. **Partial Conversion:** Convert only specific files/flows

## FAQ

### Q: Will this break existing packages?
**A:** No. Universal packages continue to work exactly as before. The converter only activates for platform-specific packages.

### Q: Can I force AS-IS installation?
**A:** Yes, by targeting the same platform as the source:
```bash
opkg install claude-plugin --platforms claude
```

### Q: What if conversion fails?
**A:** The installer will report errors and fall back gracefully. You can inspect conversion errors with `--dry-run` flag.

### Q: How accurate is format detection?
**A:** Very accurate for typical packages. Confidence scores indicate certainty. Mixed-format packages default to universal (safest).

### Q: Can I convert between any two platforms?
**A:** Yes! The system converts through universal format:
```
Platform A → Universal → Platform B
```

### Q: Does this work with git sources?
**A:** Yes! Format detection and conversion work for all package sources (path, git, registry).

## See Also

- [Platform Flows](./flows.md) - Declarative transformation system
- [Flow Reference](./flow-reference.md) - Complete flow syntax
- [Platform Detection](./detection.md) - Platform identification
- [Installation Behavior](../install/install-behavior.md) - Install semantics
