# Phase 4: Documentation Update

## Objective
Remove all references to save/apply commands from documentation, specs, and help text.

## Steps

### 4.1 Delete Specification Directories

**Directories to Delete:**
```
specs/save/              (9 spec files)
specs/apply/             (5 spec files)
```

**Files in `specs/save/`:**
- README.md
- save-conflict-resolution.md
- save-file-discovery.md
- save-frontmatter-overrides.md
- save-modes-inputs.md
- save-naming-scoping.md
- save-package-detection.md
- save-registry-sync.md
- save-versioning.md

**Files in `specs/apply/`:**
- README.md
- apply-behavior.md
- apply-command.md
- conflicts.md
- index-effects.md

**Rationale:** These entire directories document removed functionality.

---

### 4.2 Update Root README.md

**File to Modify:** `README.md`

**Changes:**

1. **Remove from Quick Start section:**
   - Delete any `opkg save` examples
   - Delete any `opkg apply` examples
   - Remove references to save/apply workflow

2. **Update Command List:**
   ```markdown
   <!-- DELETE these entries if present: -->
   - opkg save
   - opkg apply
   
   <!-- Keep these: -->
   - opkg install
   - opkg add
   - opkg remove
   - opkg new
   - opkg list
   - opkg uninstall
   ```

3. **Remove workflow examples mentioning save/apply:**
   - Search for `opkg save`
   - Search for `opkg apply`
   - Replace with install-based workflows

4. **Update "Compose a package" section:**
   - Keep `opkg new` and `opkg add` examples
   - Remove any `opkg save` references
   - Emphasize direct source editing workflow

**Example replacement:**
```markdown
<!-- OLD -->
Then use `opkg save` to publish changes back to the package.

<!-- NEW -->
Then use `opkg install <package>` to sync changes to your workspace.
```

---

### 4.3 Update specs/commands-overview.md

**File to Modify:** `specs/commands-overview.md`

**Changes:**

1. Remove save command section
2. Remove apply command section
3. Update command table/list to exclude save and apply
4. Update workflow diagrams that reference save/apply

**Commands to document:**
- ✅ install
- ✅ uninstall
- ✅ add
- ✅ remove
- ✅ new
- ✅ status
- ✅ set
- ✅ configure
- ✅ login/logout

---

### 4.4 Update specs/cli-options.md

**File to Modify:** `specs/cli-options.md`

**Changes:**

1. **Remove --apply flag documentation:**
   ```markdown
   <!-- DELETE section for --apply flag -->
   ```

2. **Update command flag tables:**
   - Remove apply-specific flags
   - Keep install, add, remove flags

3. **Update flag compatibility matrix:**
   - Remove save/apply rows
   - Keep install/add/remove columns

---

### 4.5 Update specs/add/README.md

**File to Modify:** `specs/add/README.md`

**Changes:**

1. **Remove --apply flag references:**
   - Delete flag description
   - Remove examples using --apply

2. **Update workflow examples:**
   ```markdown
   <!-- OLD -->
   opkg add mypackage file.md --apply

   <!-- NEW -->
   opkg add mypackage file.md
   opkg install mypackage  # To sync to workspace
   ```

3. **Remove apply-related notes:**
   - Delete sections about automatic workspace sync
   - Emphasize two-step workflow (add then install)

---

### 4.6 Update specs/remove/README.md

**File to Modify:** `specs/remove/README.md`

**Changes:**

1. **Remove --apply flag references**
2. **Update workflow examples** (similar to add)
3. **Remove apply-related notes**

---

### 4.7 Update specs/architecture.md

**File to Modify:** `specs/architecture.md`

**Changes:**

1. **Remove save/apply pipeline descriptions**
2. **Update architectural diagrams:**
   - Remove save pipeline flow
   - Remove apply pipeline flow
   - Keep install pipeline

3. **Update command flow section:**
   - Remove save → registry flow
   - Remove workspace → apply → platforms flow
   - Keep install → platforms flow

---

### 4.8 Update Other Spec References

**Files to Search and Update:**

```bash
# Find all spec files mentioning save/apply
grep -r "opkg save" specs/
grep -r "opkg apply" specs/
grep -r "\`save\`" specs/
grep -r "\`apply\`" specs/
```

**Common references to update:**
- `specs/install/install-behavior.md` - May reference apply
- `specs/platforms/flows.md` - May reference save/apply in examples
- `specs/package/README.md` - May reference save workflow
- `specs/new/README.md` - May reference save in package creation flow

**Action for each:** Replace save/apply references with install-based alternatives

---

### 4.9 Update Help Text in index.ts

**File to Modify:** `src/index.ts`

**Changes:**

1. **Update usage examples in formatHelp:**
   ```typescript
   // OLD
   output += 'opkg save <pkg>        save workspace edits back to package\n';
   
   // REMOVE - no replacement needed
   ```

2. **Update "All commands" section:**
   ```typescript
   // OLD
   output += '    new, add, remove, save, set, apply, status,\n';
   
   // NEW
   output += '    new, add, remove, set, status,\n';
   ```

3. **Verify help examples don't reference save/apply:**
   - Remove any quick-start hints about save/apply
   - Keep install-centric workflow examples

---

### 4.10 Search for Stray References

**Commands to run:**

```bash
# Search entire codebase for save/apply references
grep -r "opkg save" . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git
grep -r "opkg apply" . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git
grep -r "'save'" . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git | grep -i command
grep -r "'apply'" . --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git | grep -i command

# Check for save/apply in comments
grep -r "//.*save" src/ | grep -i "opkg\|command"
grep -r "//.*apply" src/ | grep -i "opkg\|command"
```

**Action:** Update or remove any found references

---

## Verification

After completing Phase 4:

```bash
# Verify spec directories deleted
ls -d specs/save/          # Should error
ls -d specs/apply/         # Should error

# Search for remaining references
grep -r "opkg save" specs/
grep -r "opkg apply" specs/
# Both should return zero results

# Check README
cat README.md | grep -i "save\|apply"
# Should only return results unrelated to commands

# Verify help text
./bin/openpackage --help | grep -i "save\|apply"
# Should return zero results
```

---

## Expected State

After Phase 4:
- ✅ Spec directories deleted
- ✅ README.md updated
- ✅ All spec files cleaned
- ✅ Help text clean
- ✅ No references to save/apply in user-facing docs
- ✅ Install-based workflows documented

---

## Files Modified
- `README.md`
- `specs/commands-overview.md`
- `specs/cli-options.md`
- `specs/add/README.md`
- `specs/remove/README.md`
- `specs/architecture.md`
- `src/index.ts` (help text only)
- Various spec files with stray references

## Directories Deleted
- `specs/save/` (9 files)
- `specs/apply/` (5 files)

## Estimated Time
1-1.5 hours

---

## Replacement Patterns

When updating docs, use these replacement patterns:

| Old Pattern | New Pattern |
|-------------|-------------|
| `opkg save <pkg>` | `opkg install <pkg>` (for re-sync) |
| `opkg apply` | `opkg install` (for platform sync) |
| `opkg add <pkg> <file> --apply` | `opkg add <pkg> <file>` + `opkg install <pkg>` |
| `save → apply workflow` | `add → install workflow` |
| `workspace → save → source` | Direct source editing |
| Platform sync via apply | Platform sync via install |

---

## Additional Documentation Tasks

1. **Create CHANGELOG entry** (if exists):
   ```markdown
   ## Breaking Changes
   - Removed `opkg save` command
   - Removed `opkg apply` command
   - Removed `--apply` flag from `add` and `remove` commands
   
   ## Migration Guide
   - Use `opkg install <package>` to re-sync files instead of `opkg apply`
   - Edit package sources directly instead of using save workflow
   ```

2. **Update MIGRATION.md** (if exists):
   - Document the workflow changes
   - Provide examples of new patterns

3. **Update CONTRIBUTING.md** (if exists):
   - Remove references to save/apply development
   - Update command list for contributors
