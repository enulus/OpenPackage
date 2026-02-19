# Implementation Plan: Flat Resource List Output

## Overview

Update the `opkg list` resources output from a hierarchical, category-grouped tree to a flat list where each resource is formatted as `category/namespace`. Namespace = subpath + filename/dirname without extension (path under the category directory).

**Before:**
```
├─┬ rules (1)
│ └─┬ custom-rules [project]
│   └── .cursor/rules/custom-rules.mdc
├─┬ agents (4)
│ ├─┬ agent-creator [project]
│ │ ├── .cursor/agents/agent-creator.md
│ │ └── .opencode/agents/agent-creator.md
```

**After:**
```
├── rules/custom-rules [project]
├── agents/agent-creator [project]
│   ├── .cursor/agents/agent-creator.md
│   └── .opencode/agents/agent-creator.md
```

---

## Architecture

### 1. Resource Namespace Module (New)

**Location:** `src/core/resources/resource-namespace.ts`

**Purpose:** Single source of truth for deriving `category/namespace` from paths. Reusable across list pipeline, scope merger, and future consumers (e.g., resolver, view).

```typescript
// Core function: derive full resource identifier from a path
export function deriveResourceFullName(
  path: string,           // Source key, target path, or workspace path
  resourceType: string,   // Singular: rule, agent, skill, etc.
  options?: { categoryDir?: string }  // Optional: explicit category dir if path has platform prefix
): string;

// Returns: "rules/custom-rules" | "rules/basics/custom-rules" | "agents/agent-creator" | "skills/my-skill"
```

**Logic:**
- **File-based types** (rules, agents, commands, hooks): Path under category → strip extension from last segment → namespace. E.g. `basics/custom-rules.mdc` → `basics/custom-rules`.
- **Skill (directory-based):** Path under category → first segment is skill dir → namespace = that dir. E.g. `my-skill/readme.md` → `my-skill`.
- **Other:** Same as file-based.
- **MCP:** Single special identifier `mcps/MCP Server Configuration` or similar.
- **Platform-prefixed paths** (e.g. `.cursor/rules/...`): Strip known platform roots to get `rules/...`, then apply above.

**Dependencies:** `resource-registry` (DIR_TO_TYPE, toPluralKey), `resource-naming` (stripExtension).

**Exports:**
- `deriveResourceFullName(path, resourceType, options?)`
- `parsePathUnderCategory(path, categoryDir)` — internal helper, can be exported if needed elsewhere

---

### 2. Extend Source Key Classifier (Optional Enhancement)

**Location:** `src/core/resources/source-key-classifier.ts`

**Option A:** Add `deriveNamespaceFromSourceKey(sourceKey)` that returns `{ resourceType, namespace }`, where namespace includes subpath. Then full name = `toPluralKey(resourceType)/namespace`.

**Option B:** Keep `classifySourceKey` as-is for backward compatibility (used by resource-builder, installed-resources). Add a new function `classifySourceKeyWithNamespace(sourceKey)` that returns `{ resourceType, resourceName, namespace, fullName }`.

**Recommendation:** Option B — minimal impact on existing callers. New function used only by list pipeline.

---

### 3. List Pipeline Changes

**Location:** `src/core/list/list-pipeline.ts`

**Changes to `groupFilesIntoResources`:**
- Use `classifySourceKeyWithNamespace` (or call `deriveResourceFullName` with the source key and resource type) to compute `fullName` = `category/namespace`.
- Use `fullName` as both:
  - `resource.name` (display + identity)
  - Map key for deduplication (replace `resourceType::resourceName` with `resourceType::fullName` or just `fullName` since it’s globally unique).
- Preserve `resource.resourceType` for type ordering.
- No structural change to `ListResourceGroup` — still `{ resourceType, resources[] }`, but each resource’s `name` is now `category/namespace`.

**Data shape stays compatible:** `ListResourceInfo.name` becomes `rules/custom-rules` instead of `custom-rules`.

---

### 4. Scope Data Collector Changes

**Location:** `src/core/list/scope-data-collector.ts`

**Untracked files:**
- `file.workspacePath` = e.g. `.cursor/rules/basics/custom-rules.mdc`
- `file.category` = `rules` (from flow pattern)
- Call `deriveResourceFullName(file.workspacePath, normalizeType(file.category))` to get full name.
- Use full name as resource key and `resource.name`.
- Handle `other` type: keep `uncategorized` as namespace, full name = `other/uncategorized`.

**Merge logic:**
- Deduplication key remains `resource.name` (which is now `category/namespace`).
- Sorting: sort by `resource.name` (full name), which naturally groups by category then namespace.

---

### 5. List Tree Renderer & Printers

**Location:** `src/core/list/list-tree-renderer.ts`, `src/core/list/list-printers.ts`

**New flat render mode:**

Instead of rendering:
```
group (N) → resource [badge] → files
```

Render:
```
resource [badge] → files (if --files)
```

**Implementation:**
- Add `renderFlatResourceList(resources, prefix, showFiles, config)` in `list-tree-renderer.ts`.
- Input: flat array of `EnhancedResourceInfo[]` (flattened from all groups).
- Each line: `├── rules/custom-rules [project]` or with files as children.
- Reuse `renderResource()` logic for a single resource + its files, but call it in a loop over a flat list.

**Print flow:**
- `printResourcesView` receives `EnhancedResourceGroup[]`.
- **New behavior:** Flatten groups into a single `EnhancedResourceInfo[]`, sort by `resource.name`.
- Call `renderFlatResourceList` instead of iterating over groups and calling `renderResourceGroup`.

**Compatibility:**
- Deps view (`printDepsView`) still uses `renderResourceGroup` for package-level resource display — that can stay hierarchical (package → rules → custom-rules) or be updated separately. Plan assumes **only** the main resources view changes for now.

---

### 6. Deps View Consideration

**Location:** `src/core/list/list-printers.ts` — `printDepsView`

When `--files` is used, deps view shows resources under each package. Options:
- **A)** Keep current hierarchy (package → rules (1) → custom-rules → files).
- **B)** Use flat format here too: package → rules/custom-rules → files.

**Recommendation:** A for Phase 1 — scope creep control. B can be a follow-up if desired.

---

## Module Dependency Graph

```
resource-registry (DIR_TO_TYPE, toPluralKey)
       ↓
resource-naming (stripExtension)
       ↓
resource-namespace (NEW) ← deriveResourceFullName, parsePathUnderCategory
       ↓
source-key-classifier ← classifySourceKeyWithNamespace (optional, or inline in list-pipeline)
       ↓
list-pipeline (groupFilesIntoResources)
scope-data-collector (mergeTrackedAndUntrackedResources)
       ↓
list-tree-renderer ← renderFlatResourceList (NEW)
       ↓
list-printers ← printResourcesView (updated)
```

---

## File Change Summary

| File | Action |
|------|--------|
| `src/core/resources/resource-namespace.ts` | **Create** — namespace derivation |
| `src/core/resources/source-key-classifier.ts` | **Extend** — optional `classifySourceKeyWithNamespace` or use resource-namespace directly |
| `src/core/list/list-pipeline.ts` | **Modify** — `groupFilesIntoResources` to set `resource.name = fullName` |
| `src/core/list/scope-data-collector.ts` | **Modify** — untracked merge to use `deriveResourceFullName` |
| `src/core/list/list-tree-renderer.ts` | **Modify** — add `renderFlatResourceList` |
| `src/core/list/list-printers.ts` | **Modify** — `printResourcesView` to flatten and use flat render |

---

## Edge Cases

1. **Skills with multiple files:** All files in `skills/my-skill/` map to one resource `skills/my-skill`. Namespace = directory name.
2. **Nested rules:** `rules/basics/custom-rules.mdc` → `rules/basics/custom-rules`.
3. **Other type:** Single synthetic resource `other/uncategorized` with all uncategorized files.
4. **MCP:** `mcps/MCP Server Configuration` (or adjust to fit MCP semantics).
5. **Platform prefix:** `.cursor/rules/foo.mdc`, `.opencode/rules/foo.mdc` → both resolve to `rules/foo`. Dedup by full name.
6. **Same resource, multiple platforms:** One resource `rules/custom-rules` with multiple files across `.cursor/` and `.opencode/`.

---

## Resolver / Uninstall Compatibility

- **resource-builder** and **resource-resolver** still use short `resourceName` (e.g. `custom-rules`).
- List shows `rules/custom-rules`.
- **Phase 1:** No resolver changes. Users continue to uninstall with short names.
- **Phase 2 (optional):** Extend resolver to accept `rules/custom-rules` for disambiguation when multiple resources share a short name.

---

## Testing Strategy

1. **Unit tests** for `deriveResourceFullName` covering:
   - Flat: `rules/custom-rules.mdc` → `rules/custom-rules`
   - Nested: `rules/basics/custom-rules.mdc` → `rules/basics/custom-rules`
   - Skills: `skills/my-skill/readme.md` → `skills/my-skill`
   - Platform-prefixed: `.cursor/rules/foo.mdc` → `rules/foo`
   - Other, MCP

2. **Integration tests** for `groupFilesIntoResources` with nested source keys.

3. **E2E** for `opkg list` and `opkg list -f` to verify flat output.

---

## Phased Rollout

**Phase 1 (MVP):**
- Add `resource-namespace.ts`.
- Update list pipeline + scope-data-collector + printers for flat output.
- Deps view unchanged.

**Phase 2 (Optional):**
- Resolver support for `category/namespace` input.
- Deps view flat format.
- Any other commands that display resource names.
