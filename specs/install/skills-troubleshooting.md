# Skills Troubleshooting Guide

## Overview

This guide covers common issues, errors, and solutions when working with skills in OpenPackage. If you encounter a problem not listed here, please open an issue on GitHub or ask in the Discord community.

## Common Error Messages

### "Skills installation from marketplace requires --plugins flag"

**Full Error:**
```
✗ Error: Skills installation from marketplace requires --plugins flag
  Use: opkg install <marketplace> --plugins <names> --skills <names>
```

**Cause:**  
You used `--skills` with a marketplace source without specifying `--plugins`.

**Why This Happens:**  
Marketplaces contain multiple plugins. To install skills, OpenPackage needs to know which plugins to search for skills in.

**Solutions:**

1. **Add the --plugins flag** with plugin names:
   ```bash
   opkg install https://github.com/user/marketplace --plugins essentials --skills git docker
   ```

2. **Use interactive mode** (no flags):
   ```bash
   opkg install https://github.com/user/marketplace
   # → Prompts for plugin selection
   # → Prompts for skill selection
   ```

3. **Specify plugins, prompt for skills**:
   ```bash
   opkg install https://github.com/user/marketplace --plugins essentials --skills
   # → Prompts for skill selection from "essentials" only
   ```

---

### "Source does not contain skills/ directory"

**Full Error:**
```
✗ Error: Source does not contain skills/ directory
  Cannot use --skills flag with sources that lack skills
```

**Cause:**  
The source you're trying to install from doesn't have a root `skills/` directory.

**Why This Happens:**  
Not all plugins or packages contain skills. The `--skills` flag can only be used with sources that have a `skills/` directory at their root.

**Solutions:**

1. **Verify the source structure** before installation:
   ```bash
   # Check if the repository has a skills/ directory
   git clone https://github.com/user/plugin
   ls -la plugin/
   # Look for skills/ directory
   ```

2. **Install without --skills flag** to get the full plugin/package:
   ```bash
   opkg install https://github.com/user/plugin
   ```

3. **Check documentation** to confirm the source supports skills:
   - Look for skills documentation in the README
   - Check for `SKILL.md` files in the repository

4. **Use a different source** that contains skills:
   ```bash
   opkg install https://github.com/user/plugin-with-skills --skills git
   ```

---

### "Skills not found: [names]"

**Full Error:**
```
✗ Error: Skills not found: git-advanced, docker-pro
  Available skills: git, docker, kubernetes, coding
```

**Cause:**  
The skill names you specified don't exist in the selected plugins/source.

**Why This Happens:**  
- Typo in skill name
- Skill doesn't exist in the source
- Skill name doesn't match frontmatter or directory name

**Solutions:**

1. **Check the available skills list** in the error message:
   ```
   Available skills: git, docker, kubernetes, coding
   ```
   Use names from this list.

2. **Use interactive mode** to see all available skills:
   ```bash
   opkg install https://github.com/user/plugin --skills
   # → Shows all available skills for selection
   ```

3. **Verify skill names**:
   - Check SKILL.md frontmatter for the `name` field
   - Check directory names under `skills/`
   - Note: Matching is case-insensitive (`Git` matches `git`)

4. **Clone the repository** to explore structure:
   ```bash
   git clone https://github.com/user/plugin
   cd plugin
   find skills -name "SKILL.md"
   # Shows all skills with their paths
   ```

5. **Use correct skill name format**:
   ```bash
   # Correct (matches name or directory)
   opkg install gh@user/plugin --skills git docker
   
   # Incorrect (full path not needed)
   opkg install gh@user/plugin --skills skills/git skills/docker
   ```

---

### "Selected plugins do not contain any skills"

**Full Error:**
```
✗ Error: Selected plugins do not contain any skills
  Plugin 'utilities' has no skills/ directory
  Plugin 'helpers' has no skills/ directory
```

**Cause:**  
The plugins you selected don't contain any skills (no `skills/` directory).

**Why This Happens:**  
Not all plugins in a marketplace have skills. Some plugins may only provide commands, rules, or agents.

**Solutions:**

1. **Select different plugins** that contain skills:
   ```bash
   # Check available plugins with skills
   opkg install https://github.com/user/marketplace
   # → Select plugins that show (X skills)
   ```

2. **Install without --skills flag** to get the full plugins:
   ```bash
   opkg install https://github.com/user/marketplace --plugins utilities helpers
   ```

3. **Check plugin structure** before installation:
   - Look for marketplace documentation
   - Check which plugins contain skills
   - Review plugin directories for `skills/` subdirectories

4. **Use a different combination**:
   ```bash
   # Install plugins without skills normally
   opkg install gh@user/marketplace --plugins utilities
   
   # Install plugins with skills separately
   opkg install gh@user/marketplace --plugins essentials --skills git docker
   ```

---

### "Using directory name as skill name"

**Full Warning:**
```
⚠ Warning: Using directory name 'git-workflow' as skill name
  SKILL.md at skills/git-workflow/ does not contain name in frontmatter
```

**Cause:**  
The SKILL.md file doesn't have a `name` field in its frontmatter.

**Impact:**  
The skill will still install correctly, using the parent directory name as the skill name.

**Resolution (Optional):**

If you're the skill author, add a name field:

```yaml
---
name: git-workflow
version: 1.0.0
description: Git workflow helpers
---
```

**When to Ignore:**  
This is just a warning. If the directory name is descriptive and matches how you reference the skill, no action is needed.

---

### "Failed to parse SKILL.md frontmatter"

**Full Error:**
```
✗ Error: Failed to parse SKILL.md frontmatter
  File: skills/git/SKILL.md
  YAML parse error: bad indentation of a mapping entry
```

**Cause:**  
The YAML frontmatter in SKILL.md has syntax errors.

**Common YAML Errors:**

1. **Invalid indentation:**
   ```yaml
   ---
   name: git-workflow
   author:
   name: John Doe  # Wrong indentation
     email: john@example.com
   ---
   ```
   
   **Fix:**
   ```yaml
   ---
   name: git-workflow
   author:
     name: John Doe
     email: john@example.com
   ---
   ```

2. **Unclosed quotes:**
   ```yaml
   ---
   name: git-workflow
   description: This is a description with "quotes
   ---
   ```
   
   **Fix:**
   ```yaml
   ---
   name: git-workflow
   description: "This is a description with quotes"
   ---
   ```

3. **Missing colon:**
   ```yaml
   ---
   name git-workflow
   version: 1.0.0
   ---
   ```
   
   **Fix:**
   ```yaml
   ---
   name: git-workflow
   version: 1.0.0
   ---
   ```

**Solutions:**

1. **Validate YAML syntax** using an online validator:
   - https://www.yamllint.com/
   - https://yamlchecker.com/

2. **Check common YAML rules:**
   - Use consistent indentation (2 or 4 spaces, not tabs)
   - Add colons after field names
   - Quote strings with special characters
   - Ensure proper nesting for objects

3. **Use a simple format** if complex structures cause issues:
   ```yaml
   ---
   name: git-workflow
   version: 1.0.0
   description: Simple description without special characters
   ---
   ```

4. **Fallback behavior**: If frontmatter parsing fails, the directory name is used as the skill name (installation continues).

---

## Installation Issues

### Skills Not Installing to Expected Location

**Symptoms:**
- Skills installed to wrong directory
- Cannot find installed skill files
- Platform-specific paths incorrect

**Possible Causes:**

1. **Platform detection issue**
2. **Custom platforms.jsonc configuration**
3. **Working directory confusion**

**Solutions:**

1. **Verify platform detection:**
   ```bash
   # Check which platforms are detected
   opkg list
   # Shows installed packages and their target platforms
   ```

2. **Check platforms.jsonc configuration:**
   
   Global config:
   ```bash
   cat ~/.openpackage/platforms.jsonc
   ```
   
   Workspace config:
   ```bash
   cat .openpackage/platforms.jsonc
   ```
   
   Look for custom `skills` mappings:
   ```jsonc
   {
     "cursor": {
       "export": [
         {
           "from": "skills/**/*",
           "to": ".cursor/skills/**/*"  // Custom path
         }
       ]
     }
   }
   ```

3. **Override platform detection** explicitly:
   ```bash
   opkg install gh@user/plugin --skills git --platforms cursor
   ```

4. **Check expected paths per platform:**
   
   | Platform | Default Skills Path |
   |----------|---------------------|
   | Cursor | `.cursor/skills/` |
   | Claude Code | `.claude/skills/` |
   | OpenCode | `.opencode/skills/` |
   | Factory | `.factory/skills/` |
   | Codex | `.codex/skills/` |

5. **Verify installation:**
   ```bash
   # List installed files
   opkg list gh@user/plugin/skills/git
   
   # Check actual file locations
   find . -name "SKILL.md" -path "*/skills/*"
   ```

---

### Partial Skill Installation

**Symptoms:**
- Some skills installed, others failed
- Installation completed with warnings
- Missing expected files

**Cause:**  
Individual skills can fail while others succeed due to conflicts, permissions, or file issues.

**Solutions:**

1. **Check error messages** for failed skills:
   ```
   ✓ Installed git-workflow
   ✗ Failed to install docker-helper: Permission denied
   ✓ Installed kubernetes-utils
   ```

2. **Review specific failure causes:**
   - **Permission errors**: Check file/directory permissions
   - **Conflicts**: Use `--conflicts` flag to control handling
   - **Missing files**: Verify source integrity

3. **Re-install failed skills individually:**
   ```bash
   # Install only the failed skill
   opkg install gh@user/plugin --skills docker-helper --force
   ```

4. **Use conflict handling:**
   ```bash
   # Overwrite existing files
   opkg install gh@user/plugin --skills docker-helper --conflicts overwrite
   
   # Keep both versions
   opkg install gh@user/plugin --skills docker-helper --conflicts keep-both
   ```

5. **Check installation logs:**
   ```bash
   # Look for detailed error information
   opkg list gh@user/plugin/skills/docker-helper
   ```

---

### Permission Errors

**Symptoms:**
```
✗ Error: EACCES: permission denied, open '.cursor/skills/git/workflow.sh'
```

**Causes:**
- Insufficient write permissions for target directory
- Read-only file system
- File ownership issues

**Solutions:**

1. **Check permissions** for target directory:
   ```bash
   ls -la .cursor/skills/
   # Verify you have write access
   ```

2. **Fix directory permissions:**
   ```bash
   # Make directory writable
   chmod -R u+w .cursor/skills/
   ```

3. **Install to global directory** (if workspace permissions are restricted):
   ```bash
   opkg install gh@user/plugin --skills git -g
   # Installs to ~/.cursor/skills/ instead
   ```

4. **Run with appropriate permissions:**
   ```bash
   # On Unix systems, if necessary (use with caution)
   sudo opkg install gh@user/plugin --skills git
   ```

5. **Check file ownership:**
   ```bash
   ls -la .cursor/skills/git/
   # If owned by another user, fix ownership
   sudo chown -R $USER .cursor/skills/
   ```

---

### Path Too Long Errors (Windows)

**Symptoms:**
```
✗ Error: ENAMETOOLONG: name too long
  Path: .cursor/skills/development/git/advanced/workflows/...
```

**Cause:**  
Windows has a 260-character path length limit (MAX_PATH).

**Solutions:**

1. **Install to a shorter workspace path:**
   ```bash
   # Instead of: C:\Users\YourName\Documents\Projects\VeryLongProjectName\...
   # Use: C:\Projects\short-name\
   
   cd C:\Projects\short-name\
   opkg install gh@user/plugin --skills git
   ```

2. **Use global installation** (shorter home directory path):
   ```bash
   opkg install gh@user/plugin --skills git -g
   ```

3. **Enable long path support** (Windows 10 version 1607+):
   
   Via Registry:
   ```
   HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\FileSystem
   LongPathsEnabled = 1
   ```
   
   Via Group Policy:
   - Computer Configuration > Administrative Templates > System > Filesystem
   - Enable "Enable Win32 long paths"

4. **Recommend skill authors** flatten directory structures:
   ```
   # Instead of deeply nested:
   skills/development/git/advanced/workflows/complex/
   
   # Use flatter structure:
   skills/git-advanced-workflows/
   ```

---

## Validation Issues

### Skill Name Conflicts

**Symptoms:**
- Multiple skills with the same name
- Unexpected skill installed
- First match used, others ignored

**Cause:**  
Multiple SKILL.md files with the same `name` in frontmatter.

**Solutions:**

1. **Use unique skill names:**
   ```yaml
   # skills/team-a/git/SKILL.md
   ---
   name: team-a-git
   ---
   
   # skills/team-b/git/SKILL.md
   ---
   name: team-b-git
   ---
   ```

2. **Use namespacing conventions:**
   - Prefix with category: `git-commit`, `git-merge`
   - Prefix with scope: `frontend-testing`, `backend-testing`
   - Prefix with team: `team-a-utils`, `team-b-utils`

3. **Rely on directory names** (don't specify name in frontmatter):
   ```
   skills/
     git-team-a/
       SKILL.md      # No name field, uses "git-team-a"
     git-team-b/
       SKILL.md      # No name field, uses "git-team-b"
   ```

4. **Install by full path** (not yet supported, use unique names):
   ```bash
   # Future: Specify path to disambiguate
   # opkg install gh@user/plugin --skills team-a/git team-b/git
   ```

---

### Missing Version Field

**Symptoms:**
- Skill version shows as 0.0.0
- Version undefined in listings

**Cause:**  
SKILL.md frontmatter doesn't have `version` or `metadata.version` fields.

**Impact:**  
Skills will still install correctly. Version defaults to `0.0.0`.

**Solutions:**

1. **Add version field** to SKILL.md:
   ```yaml
   ---
   name: git-workflow
   version: 1.0.0
   description: Git helpers
   ---
   ```

2. **Use metadata.version** as alternative:
   ```yaml
   ---
   name: git-workflow
   metadata:
     version: 1.0.0
   description: Git helpers
   ---
   ```

3. **Quote version** to ensure string type:
   ```yaml
   ---
   name: git-workflow
   version: "1.0.0"  # Quoted to prevent YAML type confusion
   ---
   ```

4. **Verify version** after installation:
   ```bash
   opkg list
   # Shows installed packages with versions
   ```

---

## Debug Mode

### Enable Verbose Logging

To get detailed information about what's happening during installation:

1. **Set DEBUG environment variable:**
   ```bash
   # Unix/Linux/macOS
   DEBUG=opkg:* opkg install gh@user/plugin --skills git
   
   # Windows (PowerShell)
   $env:DEBUG="opkg:*"
   opkg install gh@user/plugin --skills git
   
   # Windows (Command Prompt)
   set DEBUG=opkg:*
   opkg install gh@user/plugin --skills git
   ```

2. **Filter to specific modules:**
   ```bash
   # Only skills-related logs
   DEBUG=opkg:skills:* opkg install gh@user/plugin --skills git
   
   # Only installer logs
   DEBUG=opkg:install:* opkg install gh@user/plugin --skills git
   ```

3. **Output to file:**
   ```bash
   DEBUG=opkg:* opkg install gh@user/plugin --skills git > install.log 2>&1
   ```

### What to Look For

- **Source detection:** Confirms skills collection found
- **Skill discovery:** Lists all discovered skills
- **Name resolution:** Shows how skill names are matched
- **File mappings:** Details which files are copied where
- **Platform detection:** Confirms target platforms

### Common Debug Patterns

**Skills not detected:**
```
DEBUG opkg:skills:detector Checking for skills/ directory
DEBUG opkg:skills:detector No skills/ directory found at <path>
```
→ Source doesn't contain skills

**Skill name mismatch:**
```
DEBUG opkg:skills:transformer Resolving skill names: ['git', 'docker']
DEBUG opkg:skills:transformer Available skills: ['git-workflow', 'docker-helper']
DEBUG opkg:skills:transformer No exact match for 'git'
```
→ Skill names don't match

**File mapping:**
```
DEBUG opkg:flows:executor Mapping skills/git/workflow.sh
DEBUG opkg:flows:executor   → .cursor/skills/git/workflow.sh
```
→ Shows exact file mappings

---

## Getting Help

### Check Existing Resources

1. **Skills documentation:**
   - [Skills Installation Guide](./skills-installation.md)
   - [SKILL.md Format Spec](./skill-manifest-format.md)

2. **General installation docs:**
   - [Install Command Specs](./README.md)
   - [Plugin Installation](./plugin-installation.md)
   - [Marketplace Installation](./marketplace-installation.md)

### Community Support

1. **Discord Community:**
   - Join: https://discord.gg/W5H54HZ8Fm
   - Ask questions in #support channel
   - Share your issue with error messages and context

2. **GitHub Issues:**
   - Open an issue: https://github.com/enulus/OpenPackage/issues
   - Include:
     - Full error message
     - Command you ran
     - Expected vs actual behavior
     - Debug logs (if available)

3. **Twitter/X:**
   - Follow: @hyericlee
   - DM for support or questions

### Reporting Bugs

When reporting a bug, include:

1. **Command:** The exact command you ran
   ```bash
   opkg install gh@user/plugin --skills git docker
   ```

2. **Error Message:** Full error output
   ```
   ✗ Error: Skills not found: git, docker
     Available skills: git-workflow, docker-helper
   ```

3. **Environment:**
   - OS and version (macOS 14.0, Windows 11, Ubuntu 22.04)
   - Node.js version (`node --version`)
   - OpenPackage version (`opkg --version`)

4. **Source Structure:** If possible, share the skills directory structure
   ```bash
   tree skills/
   ```

5. **Debug Logs:** Run with DEBUG enabled and include output
   ```bash
   DEBUG=opkg:* opkg install ... > debug.log 2>&1
   ```

---

## Related Documentation

- [Skills Installation Guide](./skills-installation.md) - Complete installation documentation
- [SKILL.md Format Specification](./skill-manifest-format.md) - Manifest format details
- [Plugin Installation](./plugin-installation.md) - Plugin-specific installation
- [Marketplace Installation](./marketplace-installation.md) - Marketplace workflows
- [Platform Configuration](../platforms/configuration.md) - Custom platform setup
