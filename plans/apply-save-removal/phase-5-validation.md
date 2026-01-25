# Phase 5: Validation & Testing

## Objective
Verify that all changes are successful, the build passes, remaining tests pass, and all commands work correctly.

## Steps

### 5.1 Build Verification

**Commands to Run:**

```bash
# Clean build
npm run clean  # If clean script exists
rm -rf dist/

# Fresh build
npm run build

# Verify no errors
echo $?  # Should output 0

# Check for TypeScript errors
npx tsc --noEmit

# Verify dist/ output
ls -la dist/
# Should contain compiled files
```

**Expected Output:**
- ✅ Build completes without errors
- ✅ No TypeScript compilation errors
- ✅ dist/ directory populated with compiled code
- ⚠️ Warnings acceptable (but document them)

---

### 5.2 Import Resolution Check

**Commands to Run:**

```bash
# Check for broken imports
grep -r "from.*save" src/ | grep -v node_modules
grep -r "from.*apply" src/ | grep -v node_modules
grep -r "buildApplyContext" src/
grep -r "runSaveToSourcePipeline" src/
grep -r "setupSaveCommand" src/
grep -r "setupApplyCommand" src/

# All should return zero results
```

**Expected Output:**
- ✅ No imports to deleted save/apply modules
- ✅ No references to removed functions

---

### 5.3 Test Suite Execution

**Commands to Run:**

```bash
# Run all remaining tests
npm test

# If tests fail, run individually to isolate issues
npm test -- tests/core/add/
npm test -- tests/core/remove/
npm test -- tests/core/install/
npm test -- tests/integration/

# Check test coverage (optional)
npm run test:coverage  # If script exists
```

**Expected Results:**
- ✅ All remaining tests pass
- ✅ No test failures due to missing modules
- ✅ No test failures due to removed functionality

**If tests fail:**
1. Check if test imports deleted code
2. Update test to use new workflow
3. Document changes in test file

---

### 5.4 Command Functionality Smoke Tests

Run manual smoke tests for all affected commands:

#### Install Command
```bash
# Test basic install
./bin/openpackage install

# Test single package install
./bin/openpackage install <test-package>

# Test with options
./bin/openpackage install <test-package> --dry-run
./bin/openpackage install <test-package> --force

# Verify help
./bin/openpackage install --help
```

**Expected:**
- ✅ Commands execute without errors
- ✅ Help text displays correctly
- ✅ Options work as documented

---

#### Add Command
```bash
# Test add without package (workspace root)
./bin/openpackage add test-file.md

# Test add with package
./bin/openpackage add <test-package> test-file.md

# Verify --apply removed from help
./bin/openpackage add --help | grep apply
# Should return zero results

# Test that --apply flag errors
./bin/openpackage add <test-package> test-file.md --apply
# Should error: unknown option '--apply'
```

**Expected:**
- ✅ Add works without --apply flag
- ✅ Help text doesn't mention --apply
- ✅ Using --apply flag produces error

---

#### Remove Command
```bash
# Test remove without package (workspace root)
./bin/openpackage remove test-file.md

# Test remove with package
./bin/openpackage remove <test-package> test-file.md

# Verify --apply removed from help
./bin/openpackage remove --help | grep apply
# Should return zero results

# Test that --apply flag errors
./bin/openpackage remove <test-package> test-file.md --apply
# Should error: unknown option '--apply'
```

**Expected:**
- ✅ Remove works without --apply flag
- ✅ Help text doesn't mention --apply
- ✅ Using --apply flag produces error

---

#### Status Command
```bash
# Test status
./bin/openpackage status

# Test status for specific package
./bin/openpackage status <test-package>

# Verify help
./bin/openpackage status --help
```

**Expected:**
- ✅ Status command works
- ✅ No references to save/apply in output

---

#### New Command
```bash
# Test new package creation
./bin/openpackage new test-new-package

# Verify help
./bin/openpackage new --help
```

**Expected:**
- ✅ New command works
- ✅ Help text doesn't mention save workflow

---

### 5.5 Main Help Text Verification

```bash
# Check main help
./bin/openpackage --help

# Search for save/apply
./bin/openpackage --help | grep -i save
./bin/openpackage --help | grep -i apply
# Both should return zero results

# Verify command list
./bin/openpackage --help | grep -E "install|add|remove|status|new"
# Should show all remaining commands
```

**Expected:**
- ✅ Help displays correctly
- ✅ No save or apply in command list
- ✅ All other commands listed
- ✅ Examples don't reference save/apply

---

### 5.6 Error Handling Verification

Test that removed commands produce helpful errors:

```bash
# Try to run removed commands
./bin/openpackage save
./bin/openpackage apply

# Expected: "error: unknown command 'save'" or similar
```

**Expected:**
- ✅ Clear error message for removed commands
- ⚠️ Consider adding helpful migration hint in error handler (optional)

---

### 5.7 Linting & Code Quality

```bash
# Run linter (if configured)
npm run lint

# Check for unused imports
# (depends on linter configuration)

# Check for dead code warnings
```

**Expected:**
- ✅ No linting errors
- ✅ No unused import warnings
- ⚠️ Some warnings acceptable (document them)

---

### 5.8 Documentation Verification

```bash
# Verify README
cat README.md | grep -i "opkg save\|opkg apply"
# Should return zero results (or only unrelated)

# Verify specs
grep -r "opkg save" specs/
grep -r "opkg apply" specs/
# Should return zero results

# Check for broken internal links
# (manual review or use markdown link checker)
```

**Expected:**
- ✅ No save/apply references in user docs
- ✅ No broken documentation links
- ✅ Migration guide present (if applicable)

---

### 5.9 Type System Verification

```bash
# Check for unused types
npx tsc --noUnusedLocals --noEmit

# Search for SaveOptions type
grep -r "SaveOptions" src/
# Should return zero results

# Search for apply-specific types
grep -r "ApplyOptions" src/
grep -r "SaveResult" src/
# Should return zero results
```

**Expected:**
- ✅ No unused type errors
- ✅ No references to removed types
- ✅ Type inference works correctly

---

### 5.10 Integration Testing

Run full end-to-end workflow tests:

```bash
# Create test workspace
mkdir -p /tmp/opkg-test-workspace
cd /tmp/opkg-test-workspace

# Initialize
./bin/openpackage new test-package

# Add files
echo "# Test" > test.md
./bin/openpackage add test-package test.md

# Install
./bin/openpackage install test-package

# Status
./bin/openpackage status

# Remove
./bin/openpackage remove test-package test.md

# Uninstall
./bin/openpackage uninstall test-package

# Clean up
cd -
rm -rf /tmp/opkg-test-workspace
```

**Expected:**
- ✅ Full workflow completes without errors
- ✅ No references to save/apply in output
- ✅ All commands work as expected

---

## Validation Checklist

Use this checklist to track validation progress:

### Build & Compilation
- [ ] `npm run build` succeeds
- [ ] `npx tsc --noEmit` passes
- [ ] No broken imports
- [ ] dist/ directory populated

### Tests
- [ ] All remaining tests pass
- [ ] No test failures due to removed code
- [ ] Test coverage acceptable

### Commands
- [ ] `opkg install` works
- [ ] `opkg add` works (no --apply)
- [ ] `opkg remove` works (no --apply)
- [ ] `opkg list` works
- [ ] `opkg new` works
- [ ] `opkg uninstall` works

### Help Text
- [ ] Main help clean (no save/apply)
- [ ] `opkg add --help` clean
- [ ] `opkg remove --help` clean
- [ ] All help text displays correctly

### Error Handling
- [ ] `opkg save` produces error
- [ ] `opkg apply` produces error
- [ ] `--apply` flag produces error

### Documentation
- [ ] README.md clean
- [ ] specs/ directory clean
- [ ] No broken links
- [ ] Migration guide present

### Code Quality
- [ ] Linter passes
- [ ] No unused imports
- [ ] No type errors
- [ ] No dead code warnings

---

## Issue Resolution

If validation fails, follow this process:

1. **Identify the issue:**
   - Which test/command failed?
   - What's the error message?

2. **Trace the root cause:**
   - Is it a missed deletion?
   - Is it a broken import?
   - Is it a type error?

3. **Fix the issue:**
   - Update the affected file
   - Verify the fix locally
   - Re-run validation

4. **Document the fix:**
   - Update relevant phase document
   - Note in validation log

---

## Success Criteria

All of the following must be true:

- ✅ Build succeeds without errors
- ✅ TypeScript compilation passes
- ✅ All remaining tests pass
- ✅ Install command works correctly
- ✅ Add command works (no --apply)
- ✅ Remove command works (no --apply)
- ✅ Status, new, uninstall commands work
- ✅ Help text clean (no save/apply references)
- ✅ Documentation clean
- ✅ No broken imports or type errors
- ✅ Linter passes (or documented warnings)

---

## Deliverables

1. **Validation Report:**
   - List of all tests run
   - Results of each test
   - Any issues encountered and resolved

2. **Test Coverage Report:**
   - Coverage before/after removal
   - Any significant coverage changes

3. **Performance Metrics** (optional):
   - Build time before/after
   - Test suite time before/after
   - Binary size before/after

4. **Known Issues** (if any):
   - Document any minor issues
   - Plan for follow-up fixes

---

## Final Sign-Off

Before merging:

- [ ] All validation steps completed
- [ ] All success criteria met
- [ ] Documentation reviewed
- [ ] Changes committed with clear message
- [ ] Pull request created (if applicable)
- [ ] Team review completed (if applicable)

---

## Estimated Time
2-3 hours (includes fixing any discovered issues)
