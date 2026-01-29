# Skills Installation Testing Guide

**Purpose**: Quick reference for testing the skills installation refactor  
**Date**: January 29, 2026

---

## Quick Start

### Build the Project
```bash
cd opkg-cli
npm run build
```

### Create Test Workspace
```bash
mkdir -p /tmp/opkg-test
cd /tmp/opkg-test
rm -rf .openpackage .cursor
```

---

## Test Scenarios

### Test 1: Single Skill from Marketplace Plugin ⭐ **CRITICAL**

**Command:**
```bash
cd /tmp/opkg-test
opkg install gh@wshobson/agents --plugins ui-design --skills mobile-ios-design
```

**Expected Behavior:**
- ✅ Only 4 files installed:
  - `SKILL.md`
  - `references/hig-patterns.md`
  - `references/ios-navigation.md`
  - `references/swiftui-components.md`
- ✅ Package name: `gh@wshobson/agents/plugins/ui-design/skills/mobile-ios-design@0.0.0`
- ✅ Files installed to: `.cursor/skills/mobile-ios-design/`

**Validation:**
```bash
# Check file count
find .cursor/skills/mobile-ios-design -type f | wc -l
# Expected: 4

# List files
find .cursor/skills/mobile-ios-design -type f

# Check workspace manifest
cat .openpackage/openpackage.yml | grep mobile-ios-design
```

**Success Criteria:**
- File count is exactly 4 (not 40+)
- No extra skills installed
- Package name includes full path

---

### Test 2: Multiple Skills from Same Plugin

**Command:**
```bash
cd /tmp/opkg-test
rm -rf .openpackage .cursor
opkg install gh@wshobson/agents --plugins ui-design --skills mobile-ios-design,web-component-design
```

**Expected Behavior:**
- ✅ 2 separate package entries
- ✅ Each skill has only its own files
- ✅ Independent packages (can uninstall separately)

**Validation:**
```bash
# Check both skills installed
ls .cursor/skills/
# Expected: mobile-ios-design, web-component-design

# Check package entries
cat .openpackage/openpackage.yml | grep "ui-design/skills"
# Expected: 2 entries

# Check file counts
find .cursor/skills/mobile-ios-design -type f | wc -l
find .cursor/skills/web-component-design -type f | wc -l
```

**Success Criteria:**
- Both skills installed separately
- No file overlap
- Can uninstall one without affecting the other

---

### Test 3: Skill from Path-Based Source

**Setup:**
```bash
# Create test package
mkdir -p /tmp/test-skills/skills/{git,docker}
cat > /tmp/test-skills/openpackage.yml << 'EOF'
name: test-skills
version: 0.0.1
EOF

echo "# Git Skill" > /tmp/test-skills/skills/git/SKILL.md
echo "# Git Ref" > /tmp/test-skills/skills/git/reference.md
echo "# Docker Skill" > /tmp/test-skills/skills/docker/SKILL.md
echo "# Docker Ref" > /tmp/test-skills/skills/docker/reference.md
```

**Command:**
```bash
cd /tmp/opkg-test
rm -rf .openpackage .cursor
opkg install /tmp/test-skills --skills git
```

**Expected Behavior:**
- ✅ Only git skill files installed (2 files)
- ✅ Docker skill NOT installed
- ✅ Package name: `test-skills/skills/git@0.0.1`

**Validation:**
```bash
# Check only git skill present
ls .cursor/skills/
# Expected: git (NOT docker)

# Check file count
find .cursor/skills/git -type f | wc -l
# Expected: 2

# Verify docker not installed
ls .cursor/skills/docker 2>/dev/null
# Expected: error (directory does not exist)
```

**Success Criteria:**
- Only filtered skill installed
- Other skills ignored
- Correct file count

---

### Test 4: Regular Plugin Installation (No Filter)

**Command:**
```bash
cd /tmp/opkg-test
rm -rf .openpackage .cursor
opkg install gh@wshobson/agents --plugins ui-design
```

**Expected Behavior:**
- ✅ ALL files installed (agents, commands, skills, etc.)
- ✅ No filtering applied
- ✅ Standard plugin installation

**Validation:**
```bash
# Check all subdirectories present
ls .cursor/
# Expected: agents/, commands/, rules/, skills/, etc.

# Check all skills installed
ls .cursor/skills/
# Expected: ALL skills from ui-design plugin
```

**Success Criteria:**
- Entire plugin installed
- No files missing
- Normal behavior (no regression)

---

### Test 5: Uninstall Filtered Skill

**Command:**
```bash
cd /tmp/opkg-test
opkg install gh@wshobson/agents --plugins ui-design --skills mobile-ios-design
opkg uninstall "gh@wshobson/agents/plugins/ui-design/skills/mobile-ios-design"
```

**Expected Behavior:**
- ✅ Skill files removed
- ✅ Package entry removed from manifest
- ✅ Other packages unaffected

**Validation:**
```bash
# Check skill removed
ls .cursor/skills/mobile-ios-design 2>/dev/null
# Expected: error (directory does not exist)

# Check manifest
cat .openpackage/openpackage.yml | grep mobile-ios-design
# Expected: no output (entry removed)
```

**Success Criteria:**
- Files cleanly removed
- No orphaned entries
- Successful uninstall

---

## Debugging Commands

### Check What Files Were Discovered

Add this debug output to `flow-source-discovery.ts`:
```typescript
logger.debug('Discovered sources', {
  pattern: flow.from,
  skillFilter,
  matchCount: matches.length,
  matches: matches.slice(0, 5)  // First 5 matches
});
```

### Check Install Context

Add debug output in `flow-based-strategy.ts`:
```typescript
logger.debug('Installing with context', {
  packageName,
  packageRoot,
  skillFilter: skillFilter || 'none',
  platform
});
```

### Enable Debug Logging
```bash
export DEBUG=opkg:*
opkg install ...
```

---

## Common Issues & Solutions

### Issue: Still Installing All Files

**Symptom**: 40+ files installed instead of 4

**Possible Causes:**
1. skillFilter not being set in command handler
2. skillFilter not propagated through pipeline
3. Filter logic not applied during discovery

**Debug Steps:**
```bash
# Check if filter is set
# Add debug logging in skills-marketplace-handler.ts:
logger.debug('Setting skillFilter', { skillFilter: subdirPath });

# Check if filter reaches discovery
# Add debug logging in flow-source-discovery.ts:
logger.debug('matchPattern called', { pattern, skillFilter });
```

### Issue: No Files Installed

**Symptom**: 0 files installed

**Possible Causes:**
1. skillFilter path incorrect (e.g., missing prefix)
2. Path normalization issue
3. Filter too restrictive

**Debug Steps:**
```bash
# Check actual directory structure
ls -R /path/to/package/skills/

# Check filter path
# Should match: "plugins/ui-design/skills/mobile-ios-design"
# NOT: "/plugins/..." or "mobile-ios-design" alone
```

### Issue: Package Name Wrong

**Symptom**: Package name doesn't include skill path

**Possible Cause:** Package name not set correctly in marketplace handler

**Debug Steps:**
Check `handleSkillsCollectionInstallation` in `skills-marketplace-handler.ts`

---

## Success Metrics

### Critical Success Criteria
- ✅ Test 1 installs exactly 4 files (not 40+)
- ✅ Test 2 installs 2 independent packages
- ✅ Test 3 filters correctly from path source
- ✅ Test 4 works normally (no regression)
- ✅ Test 5 uninstalls cleanly

### Performance Benchmarks
- File discovery should take <100ms for typical plugin
- No temp directories created during installation
- Single file walk per installation

---

## Reporting Results

### Test Result Template

```markdown
## Test Results - [Date]

### Test 1: Single Skill from Marketplace
- Status: ✅ PASS / ❌ FAIL
- Files Installed: X (expected: 4)
- Package Name: [actual name]
- Notes: [any issues or observations]

### Test 2: Multiple Skills
- Status: ✅ PASS / ❌ FAIL
- Packages Created: X (expected: 2)
- Notes: [any issues or observations]

[Continue for each test...]

### Overall Assessment
- All Critical Tests: ✅ PASS / ❌ FAIL
- Regression Issues: None / [list issues]
- Performance: Acceptable / [describe problems]
- Ready for Production: YES / NO
```

---

## Next Steps After Testing

### If All Tests Pass ✅
1. Update SKILLS_REFACTOR_STATUS.md with test results
2. Mark as production-ready
3. Create PR/commit for review
4. Update documentation

### If Tests Fail ❌
1. Document specific failures
2. Debug using steps above
3. Fix issues
4. Re-run tests
5. Consider rollback if unfixable

---

**Happy Testing!** 🎉

For detailed implementation notes, see:
- `IMPLEMENTATION_COMPLETE.md` - What was done
- `SKILLS_REFACTOR_STATUS.md` - Full technical details
