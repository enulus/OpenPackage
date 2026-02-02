# Current Install Architecture Analysis

This document provides a detailed analysis of the current install command implementation to inform the resource-based installation system design.

---

## Overview

The install command follows a modular, phase-based architecture centered around `InstallationContext` objects that flow through a unified pipeline. The system currently supports four source types: registry, git, path, and workspace.

---

## Core Components

### 1. Entry Point: `src/commands/install.ts`

**Responsibilities:**
- Parse CLI options (`--plugins`, `--agents`, `--skills`, `--platforms`, etc.)
- Validate input (target directory, resolution flags, conflict strategy)
- Dispatch to `buildInstallContext()` for context creation
- Handle marketplace detection for git sources (special case before pipeline)
- Execute pipeline via `runUnifiedInstallPipeline()`

**Key Insight:** Marketplace handling is done *before* entering the pipeline because marketplaces require user interaction (plugin selection) that doesn't fit the pipeline model. This pattern should be preserved for resource selection flows.

### 2. Context Building: `src/core/install/unified/context-builders.ts`

**Context Types Created:**
- `buildRegistryInstallContext()` - Registry packages
- `buildPathInstallContext()` - Local directories/tarballs
- `buildGitInstallContext()` - Git repositories
- `buildWorkspaceRootInstallContext()` - Local `.openpackage/` installation

**PackageSource Interface:**
```typescript
interface PackageSource {
  type: 'registry' | 'path' | 'git' | 'workspace';
  packageName: string;
  version?: string;
  
  // Type-specific fields
  gitUrl?: string;
  gitRef?: string;
  gitPath?: string;        // Subdirectory within repo
  localPath?: string;
  sourceType?: 'directory' | 'tarball';
  
  // Resolved after loading
  contentRoot?: string;
  pluginMetadata?: {...};
}
```

**Key Insight:** The current `gitPath` field serves a similar purpose to the proposed "base" concept—it identifies a subdirectory within a repo. However, it's specified at input time, not detected algorithmically.

### 3. Input Classification: `src/utils/package-input.ts`

**Classification Order:**
1. Git source detection (`detectGitSource()`)
2. Tarball detection (`.tgz`, `.tar.gz` extension)
3. Path detection (starts with `/`, `./`, `../`, `~`, or is `.`)
4. Registry name parsing

**Key Insight:** The new resource argument parser should follow a similar pattern but with the order: URL → Resource name → Filepath (as specified in INTENDED_BEHAVIOR.md).

### 4. Git URL Detection: `src/utils/git-url-detection.ts`

**Supported Formats:**
- GitHub shorthand: `gh@owner/repo[/path]`
- GitHub URLs: `https://github.com/owner/repo/tree/ref/path`
- Generic git URLs with hash fragments: `url#ref&path=x`
- Legacy prefixes: `github:`, `git:` (deprecated)

**Current Behavior:**
- `parseGitHubShorthand()`: Treats segments 3+ as `path` (subdirectory)
- Correctly separates repo (`user/repo`) from path

**Key Insight:** This utility is well-suited for the new resource model. The `path` field extracted here becomes the target for base detection.

### 5. Unified Pipeline: `src/core/install/unified/pipeline.ts`

**Pipeline Phases:**
1. **Load Package** - Load from source using appropriate loader
2. **Resolve Dependencies** - Resolve dependency tree (skip for apply/marketplace)
3. **Process Conflicts** - Handle file conflicts with user prompts
4. **Execute Installation** - Run flow-based installation
5. **Update Manifest** - Record in workspace `openpackage.yml`
6. **Report Results** - Display installation summary

**Key Insight:** Base detection should occur in Phase 1 (load) or as a new Phase 1.5, before dependency resolution. The detected base affects all downstream phases.

### 6. Source Loaders: `src/core/install/sources/`

**Loader Interface:**
```typescript
interface PackageSourceLoader {
  canHandle(source: PackageSource): boolean;
  load(source, options, cwd): Promise<LoadedPackage>;
}
```

**Git Source Loader (`git-source.ts`):**
- Clones repo to cache
- Detects if marketplace (returns metadata, lets command handle selection)
- Loads package/plugin metadata from target path
- Returns `LoadedPackage` with `contentRoot` pointing to cloned location

**Path Source Loader:**
- Resolves local path
- Detects plugin type
- Loads package metadata

**Key Insight:** The base detection algorithm should be integrated into the loaders, after cloning/resolving but before package metadata loading.

---

## Flow System

### 7. Platforms Configuration: `platforms.jsonc`

**Structure:**
```jsonc
{
  "global": { "export": [...], "import": [...] },
  "claude": {
    "name": "Claude Code",
    "detection": [".claude", "CLAUDE.md"],
    "export": [
      { "from": "agents/**/*.md", "to": ".claude/agents/**/*.md" },
      { "from": "skills/**/*", "to": ".claude/skills/**/*" },
      ...
    ],
    "import": [...]
  },
  // ... other platforms
}
```

**Key Patterns (from `from` fields):**
- `agents/**/*.md` - Agent files
- `skills/**/*` - Skill directories
- `rules/**/*.md` - Rule files
- `commands/**/*.md` - Command files
- `AGENTS.md` - Root agent file

**Key Insight:** These patterns define what the new system should match against for base detection. The "deepest match" algorithm will find where these patterns begin within a resource path.

### 8. Flow Execution: `src/core/install/flow-based-installer.ts`

**Flow Install Context:**
```typescript
interface FlowInstallContext {
  packageName: string;
  packageRoot: string;        // Source content root
  workspaceRoot: string;      // Destination workspace
  platform: Platform;
  packageVersion: string;
  priority: number;
  dryRun: boolean;
  packageFormat?: any;
  conversionContext?: any;
}
```

**Execution Flow:**
1. Detect package format (universal vs platform-specific)
2. Select installation strategy
3. Execute flows for each platform
4. Track file mappings
5. Return result with conflicts/errors

**Key Insight:** The `packageRoot` in flow context corresponds to the "base" after detection. All flow patterns are applied relative to this root.

### 9. Flow Source Discovery: `src/core/flows/flow-source-discovery.ts`

**Pattern Matching:**
- Uses `minimatch` for glob patterns
- Supports `**` recursive globs
- Supports `{name}` placeholders
- Handles platform-specific variants

**Key Insight:** This same pattern matching logic can be adapted for base detection—matching resource paths against "from" patterns to find the deepest match.

---

## Plugin & Marketplace System

### 10. Plugin Detection: `src/core/install/plugin-detector.ts`

**Detection Order:**
1. `.claude-plugin/plugin.json` → individual plugin
2. `.claude-plugin/marketplace.json` → marketplace

**Key Insight:** This detection already exists and should be integrated into the base detection algorithm as specified in INTENDED_BEHAVIOR.md (marketplace triggers selection flow).

### 11. Marketplace Handler: `src/core/install/marketplace-handler.ts`

**Responsibilities:**
- Parse marketplace manifest
- Prompt user to select plugins (interactive)
- Validate selected plugin names (non-interactive with `--plugins`)
- Install selected plugins via the pipeline

**Key Insight:** This pattern should be extended for the convenience options (`--agents`, `--skills`). When specified, they filter the installation scope similarly to how `--plugins` filters marketplace plugins.

---

## Workspace Manifest

### 12. Package YML: `src/utils/package-yml.ts`

**Dependency Format:**
```yaml
dependencies:
  - name: my-package
    version: "1.0.0"       # Registry source
  - name: gh@user/repo
    url: https://github.com/user/repo.git#main
    path: plugins/my-plugin  # Subdirectory
  - name: local-pkg
    path: ~/packages/local   # Local path
```

**Key Insight:** The `base` field proposed in INTENDED_BEHAVIOR.md should be added here for recording user-selected bases in ambiguous cases.

### 13. Workspace Index: `src/utils/workspace-index-yml.ts`

**Format:**
```yaml
packages:
  my-package:
    path: .openpackage/cache/registry/my-package/1.0.0
    version: "1.0.0"
    files:
      agents/designer.md:
        - .claude/agents/designer.md
        - .cursor/agents/designer.md
```

**Key Insight:** The index already tracks source-to-target file mappings. This should continue to work with the resource model.

---

## Identified Gaps for Resource Model

### 1. Base Detection
**Current:** Implicit (package root or explicit `gitPath`)
**Required:** Algorithmic detection based on manifest presence or pattern matching

### 2. Pattern-Based Filtering
**Current:** All files from package root are candidates
**Required:** Only files matching the detected pattern (relative to base) should be installed

### 3. Ambiguous Base Handling
**Current:** Not supported
**Required:** User prompts when multiple patterns match, with manifest storage

### 4. Convenience Options
**Current:** Only `--plugins` for marketplaces
**Required:** `--agents` and `--skills` for filtering by name

### 5. Frontmatter Parsing
**Current:** Used for agent transformations
**Required:** Also used for matching agent/skill names in convenience options

---

## Integration Points for New System

1. **Resource Argument Parser** → Before `buildInstallContext()`
2. **Base Detector** → Inside source loaders, after content is accessible
3. **Pattern Matcher** → New utility, used by base detector and flow filtering
4. **Convenience Matchers** → After base detection, before flow execution
5. **Ambiguity Prompts** → In command layer, similar to marketplace handling
6. **Manifest Base Field** → In `package-yml.ts` and context builders
