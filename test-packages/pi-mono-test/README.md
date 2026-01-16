# Pi-Mono Test Package

Test package for validating Pi-Mono platform support in OpenPackage.

## Purpose

This package is used to test and validate that the Pi-Mono platform integration works correctly across all workflows:

1. **Fresh Installation** - Installing to clean workspace
2. **Auto-Detection** - Detecting `.pi/` directory automatically
3. **Save Workflow** - Capturing workspace changes back to package
4. **Multi-Platform** - Installing to multiple platforms simultaneously
5. **Nested Structures** - Preserving directory hierarchies

## Package Contents

### Commands (3 files)

- `commands/commit.md` - Generate semantic commit messages
- `commands/deploy.md` - Deploy to production
- `commands/git/status.md` - Enhanced git status (nested)

### Skills (2 skills)

1. **devtools/testing** - Test execution utilities
   - `SKILL.md` - Main skill documentation
   - `scripts/test.sh` - Bash script for running tests

2. **projectmanagement/task-tracking** - Task management
   - `SKILL.md` - Task tracking documentation

### Agent Configuration

- `AGENTS.md` - Test agent configuration

## Expected Installation Structure

When installed with `opkg install pi-mono-test --platform pimono`, the following structure should be created:

```
workspace/
├── AGENTS.md                                    # From global flow
└── .pi/
    └── agent/
        ├── prompts/
        │   ├── commit.md                        # From commands/
        │   ├── deploy.md
        │   └── git/
        │       └── status.md                    # Nested structure preserved
        └── skills/
            ├── devtools/
            │   └── testing/
            │       ├── SKILL.md                 # From skills/
            │       └── scripts/
            │           └── test.sh
            └── projectmanagement/
                └── task-tracking/
                    └── SKILL.md
```

## Testing Scenarios

### Scenario 1: Fresh Install

```bash
# Create test workspace
mkdir test-workspace && cd test-workspace

# Install package
opkg install ../test-packages/pi-mono-test --platform pimono

# Verify structure
ls -la AGENTS.md
ls -la .pi/agent/prompts/
ls -la .pi/agent/skills/
```

**Expected:**
- ✅ All files installed to correct locations
- ✅ Nested directory structure preserved
- ✅ AGENTS.md copied to workspace root
- ✅ File permissions maintained (test.sh executable)

### Scenario 2: Auto-Detection

```bash
# Create workspace with .pi directory
mkdir test-workspace-2 && cd test-workspace-2
mkdir -p .pi/agent/{prompts,skills}

# Install without --platform flag
opkg install ../test-packages/pi-mono-test

# Should auto-detect pimono platform
```

**Expected:**
- ✅ Platform auto-detected from `.pi/` directory
- ✅ Files installed correctly

### Scenario 3: Save Changes

```bash
# Modify installed files
echo "# Updated commit command" >> .pi/agent/prompts/commit.md
echo "# New command" > .pi/agent/prompts/new-command.md

# Save changes back to package
opkg save pi-mono-test

# Verify changes captured
cat commands/commit.md  # Should contain "Updated"
cat commands/new-command.md  # Should exist
```

**Expected:**
- ✅ Modified files synced back to package
- ✅ New files added to package
- ✅ Directory structure preserved

### Scenario 4: Multi-Platform

```bash
# Install to multiple platforms
opkg install pi-mono-test --platform pimono
opkg install pi-mono-test --platform claude

# Verify both platforms
ls -la .pi/agent/
ls -la .claude/
```

**Expected:**
- ✅ Both `.pi/` and `.claude/` directories created
- ✅ Same content in different structures
- ✅ No conflicts between platforms

## Verification Checklist

After installation, verify:

- [ ] `AGENTS.md` exists in workspace root
- [ ] `.pi/agent/prompts/commit.md` exists
- [ ] `.pi/agent/prompts/deploy.md` exists
- [ ] `.pi/agent/prompts/git/status.md` exists (nested)
- [ ] `.pi/agent/skills/devtools/testing/SKILL.md` exists
- [ ] `.pi/agent/skills/devtools/testing/scripts/test.sh` exists and is executable
- [ ] `.pi/agent/skills/projectmanagement/task-tracking/SKILL.md` exists
- [ ] File content matches original package files

## Package Metadata

- **Name:** pi-mono-test
- **Version:** 1.0.0
- **Platforms:** pimono, claude, cursor
- **License:** MIT
- **Author:** OpenPackage Team

## Notes

- This package is designed for testing only
- Commands and skills are examples, not functional implementations
- Nested command structure tests glob pattern `commands/**/*.md`
- Skills test both flat and nested directory structures
