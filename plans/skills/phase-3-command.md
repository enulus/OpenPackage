# Phase 3: Command Integration

## Overview

This phase integrates the skills feature into the CLI command layer, adding the `--skills` option to the install command and implementing the routing logic to handle both marketplace and standalone skills installation flows.

## Objectives

1. Add `--skills` CLI option with proper configuration
2. Implement option validation and normalization
3. Add routing logic to detect and handle skills collections
4. Create marketplace skills installation handler
5. Create standalone skills installation handler
6. Integrate with existing installation pipeline

## Module: Install Command

### Location
`src/commands/install.ts`

---

## CLI Option Configuration

### Add --skills Option
**Location:** `setupInstallCommand` function

**Configuration:**
- Option name: `--skills <names...>`
- Type: Variadic (space-separated values)
- Description: "Install specific skills from skills collection. For marketplaces: must be paired with --plugins. For standalone: filters to install only specified skills."
- Optional: Yes
- Example values: `git docker coding`

**Pattern Consistency:**
Follows same variadic pattern as existing `--plugins <names...>` option for consistency in CLI interface.

---

## Option Normalization

### normalizeSkillsOption Function
**Signature:** `(value: string[] | undefined) => string[] | undefined`

**Purpose:** Normalize and deduplicate skill names from CLI input.

**Algorithm:**
1. Check if value is undefined or empty array
2. If empty: Return undefined
3. Create Set from array to deduplicate
4. Convert back to array
5. Return array if non-empty, otherwise undefined

**Usage:** Called in command action handler before passing options to installation logic.

**Pattern Reuse:** Exact same logic as existing `normalizePluginsOption` function.

---

## Validation Functions

### validateSkillsOptions Function
**Signature:** `(options: InstallOptions) => void`

**Purpose:** Early validation of skills option usage.

**Algorithm:**
1. If `options.skills` is undefined or empty: Return early (no validation needed)
2. Additional validations will occur after source detection (marketplace vs standalone)
3. This function primarily serves as placeholder for any global skills validation

**Error Conditions:**
- None at this stage - validation happens after source type is determined

**Design Rationale:**
Defer most validation until after source detection, similar to how `--plugins` validation works. The `--skills` flag has different requirements for marketplace vs standalone sources.

---

## Installation Flow Modifications

### Modified installCommand Function
**Location:** Main command handler in `install.ts`

**Key Decision Points:**

#### 1. After Marketplace Detection
**Location:** After detecting `pluginMetadata?.pluginType === 'marketplace'`

**Logic:**
```
IF marketplace detected:
  IF --skills flag provided and non-empty:
    → Route to handleMarketplaceSkillsInstallation
  ELSE:
    → Route to existing handleMarketplaceInstallation
```

**Integration Point:** Insert check immediately after marketplace detection, before existing `handleMarketplaceInstallation` call.

#### 2. After Non-Marketplace Source Loading
**Location:** After loading package/plugin, before pipeline execution

**Logic:**
```
IF --skills flag provided and non-empty:
  Call detectSkillsInDirectory on source.contentRoot
  
  IF source is NOT a skills collection:
    → Throw error: "Source does not contain skills/ directory"
  
  Call validateSkillExists with requested skills
  
  IF any skills invalid:
    → Throw error with list of invalid skills and available skills
  
  → Route to handleStandaloneSkillsInstallation with valid skills
```

**Integration Point:** Insert after package loading, before existing pipeline call for non-marketplace sources.

---

## Handler Functions

### handleMarketplaceSkillsInstallation
**Signature:** `async (context: InstallationContext, options: InstallOptions, cwd: string) => Promise<CommandResult>`

**Purpose:** Handle skills installation from marketplace source.

**Algorithm:**

1. **Validate Prerequisites:**
   - Check `options.plugins` is provided and non-empty
   - If missing: Throw error with clear message about requirement
   
2. **Parse Marketplace:**
   - Use existing marketplace parsing logic (already done in parent flow)
   - Access via `context.source.pluginMetadata.manifestPath`
   
3. **Validate Plugins:**
   - Reuse existing `validatePluginNames` from marketplace-handler
   - If invalid: Throw error with available plugin list
   
4. **Discover Skills:**
   - Call `parseSkillsFromMarketplace(marketplaceDir, marketplace, selectedPlugins)`
   - Check if any plugins contain skills
   - If no skills found: Throw error about selected plugins lacking skills
   
5. **Selection Mode:**
   - **If `options.skills` provided (non-interactive):**
     - Call `validateSkillSelections(skillsCollection, options.skills)`
     - If invalid skills: Display error with available skills, exit with failure
     - Use valid selections
   - **Else (interactive):**
     - Call `promptSkillSelection(skillsCollection)`
     - If user cancels or selects nothing: Exit gracefully with message
   
6. **Installation:**
   - Extract git context from loaded source:
     - Git URL: `context.source.gitUrl`
     - Git ref: `context.source.gitRef`
     - Commit SHA: `context.source._commitSha` or from source metadata
   - Call `installMarketplaceSkills(marketplaceDir, selections, gitContext, options, cwd)`
   - Return result

**Error Messages:**

- Missing `--plugins`:
  ```
  Error: Skills installation from marketplace requires --plugins flag to specify which plugins to search for skills.
  
  Example: opkg install <marketplace-url> --plugins essentials --skills git docker
  ```

- No skills in selected plugins:
  ```
  Error: Selected plugins do not contain any skills.
  
  Selected plugins: plugin1, plugin2
  Skills directory must be at root of plugin: plugins/<plugin-name>/skills/
  ```

- Invalid skill names:
  ```
  Error: Skills not found: skill-a, skill-c
  
  Available skills in selected plugins:
    [plugin1] skill-b - Git workflow helper
    [plugin1] skill-d - Code review
    [plugin2] skill-e - Testing suite
  ```

**Dependencies:**
- `parseMarketplace` from `marketplace-handler.ts`
- `validatePluginNames` from `marketplace-handler.ts`
- `parseSkillsFromMarketplace` from `skills-marketplace-handler.ts`
- `promptSkillSelection` from `skills-marketplace-handler.ts`
- `validateSkillSelections` from `skills-marketplace-handler.ts`
- `installMarketplaceSkills` from `skills-marketplace-handler.ts`

---

### handleStandaloneSkillsInstallation
**Signature:** `async (context: InstallationContext, selectedSkills: DiscoveredSkill[], options: InstallOptions, cwd: string) => Promise<CommandResult>`

**Purpose:** Handle skills installation from standalone plugin, package, or repository source.

**Algorithm:**

1. **Initialize Results Tracking:**
   - Create results array for aggregation
   - Initialize success/failure counters
   
2. **Display Header:**
   - Show "Installing N skills..." message
   
3. **Process Each Skill:**
   - For each skill in `selectedSkills`:
     - Compute full skill directory path:
       - Base: `context.source.contentRoot`
       - Skill path: `skill.skillPath`
       - Full path: `join(contentRoot, skillPath)`
     - Build skill transform context:
       - `gitUrl`: `context.source.gitUrl` (if git source)
       - `path`: `skill.skillPath`
       - `repoPath`: `context.source.contentRoot`
       - `skillName`: `skill.name`
     - Call `transformSkillToPackage(skillDir, skill.frontmatter, transformContext)`
     - Build install context for transformed package:
       - Use transformed package
       - Set appropriate source metadata
       - If git source: Set `gitSourceOverride` for manifest recording
     - Call `runUnifiedInstallPipeline(skillContext)`
     - Collect result with skill name
     - Display progress (✓ or ❌)
   
4. **Aggregate Results:**
   - Count successes and failures
   - Collect error messages
   
5. **Display Summary:**
   - Show installation statistics
   - List any failures with error details
   
6. **Return Result:**
   - Success: true if at least one skill installed
   - Data: Counts and individual results
   - Error: Message if all failed

**Progress Display:**
```
Installing 3 skills...
✓ git (1.0.0)
✓ docker (2.1.0)
❌ coding: SKILL.md not found

✓ Successfully installed: 2 skills
❌ Failed: 1 skill
  coding: SKILL.md not found
```

**Error Handling:**
- Individual skill failure: Log error, continue with remaining
- All skills fail: Return failure with aggregated errors
- Partial success: Return success with failure warnings

**Dependencies:**
- `transformSkillToPackage` from `skills-transformer.ts`
- `runUnifiedInstallPipeline` from `unified/pipeline.ts`
- `buildInstallContext` helpers for context creation

---

## Modified installCommand Flow

### Complete Flow Diagram

```
installCommand(packageInput, options)
  ↓
Validate inputs (existing)
  ↓
Build install context(s) (existing)
  ↓
IF bulk install (array of contexts):
  → runBulkInstall (existing) ← NO SKILLS SUPPORT IN BULK
  ↓
IF git source:
  Load package to detect type (existing)
  ↓
  IF marketplace detected:
    ├─ IF --skills provided:
    │    → handleMarketplaceSkillsInstallation ← NEW
    │       ├─ Validate --plugins required
    │       ├─ Parse marketplace (existing)
    │       ├─ Discover skills in plugins
    │       ├─ Select skills (interactive or explicit)
    │       └─ Install skills
    │
    └─ ELSE:
         → handleMarketplaceInstallation (existing)
            └─ Install plugins
  ↓
  IF NOT marketplace AND --skills provided:
    Detect if skills collection
    ↓
    IF NOT skills collection:
      → Throw error: "Source does not contain skills/"
    ↓
    Validate requested skills exist
    ↓
    IF invalid skills:
      → Throw error with available skills
    ↓
    → handleStandaloneSkillsInstallation ← NEW
       ├─ Transform each skill to package
       ├─ Install each skill package
       └─ Return aggregated results
  ↓
  ELSE (no --skills flag):
    Create resolved packages (existing)
    ↓
    → runUnifiedInstallPipeline (existing)
```

---

## Action Handler Updates

### Command Action Handler
**Location:** `.action()` callback in `setupInstallCommand`

**Modifications:**

1. **After platform normalization, add:**
   ```
   // Normalize skills
   if (options.skills) {
     options.skills = normalizeSkillsOption(options.skills as any);
   }
   ```

2. **Validation remains same:**
   - Call `validateSkillsOptions(options)` (currently no-op)
   - Main validation happens in handler functions after source detection

3. **Execute install:**
   - Call `installCommand(packageName, options)` as existing
   - Error handling remains same

---

## Testing Strategy

### Integration Tests Location
`tests/commands/install-skills-integration.test.ts`

### Test Coverage

#### Marketplace Skills Tests
- **Interactive Mode:**
  - Marketplace with `--plugins` only → show skill selection prompt
  - User selects skills → installs selected skills
  - User cancels selection → exits gracefully
  
- **Non-Interactive Mode:**
  - Marketplace with `--plugins` and `--skills` → installs specified skills
  - Invalid skill names → shows error with available skills
  - Mix of valid/invalid skills → shows error
  
- **Error Cases:**
  - Marketplace with `--skills` but no `--plugins` → error
  - Plugins with no skills → error
  - Empty skills selection → exits gracefully

#### Standalone Skills Tests
- **Plugin/Package with Skills:**
  - Source with `--skills` flag → detects skills, installs specified
  - Interactive mode → prompts for skill selection
  - Invalid skill names → error with available skills
  
- **Repository with Skills:**
  - Repo with root `skills/` directory → detects and installs
  - Nested skills → preserves path structure
  
- **Error Cases:**
  - Source without `skills/` directory + `--skills` flag → error
  - No SKILL.md files found → error

#### Integration with Existing Flow
- **Without `--skills` flag:**
  - Marketplace → installs plugins as before (no regression)
  - Plugin → installs full plugin as before (no regression)
  - Package → installs package as before (no regression)

---

## Implementation Checklist

- [x] Add `--skills <names...>` option to `setupInstallCommand`
- [x] Implement `normalizeSkillsOption` function
- [x] Implement `validateSkillsOptions` function (placeholder)
- [x] Add marketplace skills routing in `installCommand`
- [x] Add standalone skills routing in `installCommand`
- [x] Implement `handleMarketplaceSkillsInstallation` handler
- [x] Implement `handleStandaloneSkillsInstallation` handler
- [x] Update command action handler to normalize skills option
- [x] Create `install-skills-integration.test.ts`
- [x] Write marketplace skills integration tests
- [x] Write standalone skills integration tests
- [x] Write error case tests
- [x] Verify no regressions in existing install flows
- [x] Verify all tests pass

---

## Success Criteria

- [x] `--skills` option available in CLI help text
- [x] Option properly normalizes space-separated values
- [x] Marketplace + plugins + skills works in interactive mode
- [x] Marketplace + plugins + skills works in non-interactive mode
- [x] Standalone source + skills works in both modes
- [x] Error messages are clear and actionable
- [x] Skills-only installation excludes other content (commands, agents)
- [x] Git source information preserved in manifest
- [x] Skills install to correct platform-specific paths
- [x] All integration tests pass
- [x] No regressions in existing install command functionality

---

## Dependencies for Next Phase

**Phase 4 Requirements:**
- Command integration complete for loader updates
- Skills detection available for git package loader
- Handler functions available for testing

**Exports Used:**
```typescript
// From Phase 1
import { detectSkillsInDirectory, validateSkillExists } from '../core/install/skills-detector.js';

// From Phase 2
import { 
  parseSkillsFromMarketplace,
  promptSkillSelection,
  validateSkillSelections,
  installMarketplaceSkills
} from '../core/install/skills-marketplace-handler.js';
import { transformSkillToPackage } from '../core/install/skills-transformer.js';
```

---

## Integration Notes

### Routing Logic
The routing decision tree ensures:
1. Marketplace sources require `--plugins` with `--skills`
2. Standalone sources work with `--skills` alone
3. Without `--skills`, existing behavior preserved
4. Early validation catches misconfigurations

### Error Message Consistency
Follow existing error message patterns:
- Clear problem statement
- Show what was provided vs what's available
- Provide actionable example usage
- Use consistent formatting (bullet points, code examples)

### Progress Display
Maintain consistency with existing output:
- Use spinners for individual operations
- Use check marks (✓) and X marks (❌) for results
- Show summaries with counts
- Display errors with context

### Command Help Text
Update help text to clearly explain:
- `--skills` usage and requirements
- Difference between marketplace and standalone usage
- Examples for common use cases
- Relationship between `--plugins` and `--skills`

### Graceful Degradation
Ensure the feature degrades gracefully:
- If user provides `--skills` but cancels selection: Exit cleanly
- If no skills found: Clear error, not crash
- If partial installation: Show what succeeded, what failed
- Preserve existing behavior when `--skills` not used
