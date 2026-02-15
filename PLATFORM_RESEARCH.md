# Platform Research Notes

Quick reference for researching AI coding platforms for OpenPackage integration.

## Current Scope (IMPORTANT)

**Resource types being updated:**
- ✅ **Rules** - Adding/updating mappings
- ✅ **Commands** - Adding/updating mappings
- ✅ **Agents** - Adding/updating mappings
- ✅ **MCP** - Adding/updating mappings

**Resource types NOT in scope:**
- ❌ **Workflows** - UI-managed, not file-based
- ❌ **Hooks** - UI-managed, not file-based
- ✅ **Skills** - Already 100% correct, NO changes needed

**CRITICAL**: Skills mappings are already implemented correctly across all platforms. Research focuses exclusively on identifying and adding missing rules, commands, agents, and MCP support to enhance existing platform configurations.

## Research Strategy

### Parallel Exploration
- Launch 5-8 explore agents simultaneously with "very thorough" setting
- Total time: ~90-120 min regardless of platform count
- When discovering shared directories (`.agents`), research the full ecosystem

### Search Priority
1. Official documentation (docs site, GitHub README)
2. JSON schemas / TypeScript types
3. Example configurations
4. Community resources

### Platform Categories
- **Minimal** (no additional resources beyond skills): 5-10 min research
- **Moderate** (1-2 additional resources): 20-30 min research
- **Comprehensive** (3+ additional resources): 45-60 min research

**Note**: Research time excludes skills since those are already implemented.

## What to Identify

For each platform (rules, commands, agents, MCP only):
1. **Directory structure** - Project vs global paths for in-scope resources
2. **Resource types** - Rules, commands, agents, MCP (NOT skills, workflows, or hooks)
3. **File formats** - Extensions, frontmatter schemas
4. **Conversions** - Model/tool names, permission mappings
5. **MCP support** - Location and format

**Note**: Skip skills research entirely - those mappings are already correct.

## Key Patterns Discovered

### Resource Type Adoption (14 platforms researched)
- **Skills**: 100% adoption (Agent Skills spec - agentskills.io) - ✅ Already implemented correctly
- **MCP**: 87.5% adoption (Claude Code `mcpServers` format) - 🔄 Adding/updating
- **Agents**: ~50% adoption - 🔄 Adding/updating
- **Rules**: ~37% adoption - 🔄 Adding/updating
- **Commands**: ~25% adoption - 🔄 Adding/updating
- **Workflows/Hooks**: UI-managed, not file-based - ❌ Not in scope

### Shared Ecosystems
- `.agents/` - Amp, Kimi, Replit, Goose
- `.github/agents/` - GitHub Copilot (NOT `.agents`)

## Critical Implementation Rules

### $switch Statements (CRITICAL)
Only use when case "value" and "default" strings are DIFFERENT:
- ✅ VALID: `"value": ".config/opencode/"` vs `"default": ".opencode/"`
- ❌ INVALID: `"value": ".adal/skills/"` vs `"default": ".adal/skills/"` (identical = redundant)

**Verification**: Compare strings literally. If identical, remove the switch entirely.

### Valid File Mapping Patterns
- ✅ **Many-to-many**: `rules/**/*.md` → `.platform/rules/**/*.md`
- ✅ **One-to-one**: `AGENTS.md` → `PLATFORM.md`
- ✅ **Array-to-one**: `["mcp.jsonc", "mcp.json"]` → `.platform/mcp.json`
- ❌ **INVALID: Many-to-one**: `rules/**/*.md` → `single-file.md`
- ❌ **INVALID: One-to-many**: `single-file.md` → `rules/**/*.md`

### Comment Guidelines
**DO include:**
- Format differences: "Amp uses 'checks' terminology for rules"
- File extensions: "CodeBuddy uses .mdc extension"
- Platform-specific notes: "Continue prefers YAML format"

**DON'T include:**
- Temporal markers: ~~"PRIORITY 1"~~, ~~"Critical update"~~
- Compatibility fallbacks when conversions handle it

## Common Mistakes to Avoid

1. **Redundant $switch statements** - Verify strings are different
2. **Many-to-one file mappings** - System cannot auto-consolidate files
3. **Compatibility fallbacks** - Let conversion system handle cross-platform compatibility
4. **Over-researching minimal platforms** - Quick assessment first
5. **Not validating original file** - Check for pre-existing errors before changes
6. **Temporal comments** - Explain "why", not "when"

## Implementation Checklist

- [ ] Validate original `platforms.jsonc` file first
- [ ] Read file with Read tool before editing
- [ ] Use native platform paths only (no compatibility fallbacks)
- [ ] Verify $switch statements have DIFFERENT strings
- [ ] Validate mapping patterns (no many-to-one or one-to-many)
- [ ] Include only timeless comments
- [ ] Run switch validation script
- [ ] Validate syntax with `allowTrailingComma: true`
- [ ] Check `git diff` for unintended changes

## Switch Validation Script

```bash
python3 << 'EOF'
import re
with open('platforms.jsonc', 'r') as f:
    lines = f.readlines()
i = 0
while i < len(lines):
    if '$$targetRoot' in lines[i]:
        case_val = default_val = None
        for j in range(i, min(i + 12, len(lines))):
            if '"value"' in lines[j] and case_val is None:
                match = re.search(r'"value":\s*"([^"]+)"', lines[j])
                if match: case_val = match.group(1)
            elif '"default"' in lines[j]:
                match = re.search(r'"default":\s*"([^"]+)"', lines[j])
                if match:
                    default_val = match.group(1)
                    break
        if case_val and default_val and case_val == default_val:
            print(f"❌ REDUNDANT at line {i+1}: '{case_val}'")
    i += 1
EOF
```

## Resource Type Patterns

### Skills (NOT IN SCOPE - Already 100% correct)
- Format: Directory with `SKILL.md` (Agent Skills spec)
- Status: All mappings already implemented correctly
- Action: DO NOT research or modify skills mappings

### Rules (IN SCOPE)
- Format: `.md` files in platform directory
- Frontmatter: Optional conditionals
- Conversion: Auto-preserved

### MCP (IN SCOPE)
- Format: JSON/JSONC with `mcpServers` root key (87.5% adoption)
- Exception: Goose uses `extensions` in YAML
- Conversion: Usually none (except Codex TOML)

### Agents/Commands (IN SCOPE)
- Format: Markdown in dedicated subdirectory
- Naming: Platform-specific terminology
- Conversion: Usually none

## Best Practices

1. **Clarify scope upfront** - Focus on rules, commands, agents, and MCP only
2. **Skip skills research** - Those mappings are already 100% correct
3. **Batch similar platforms** - Research shared ecosystems together
4. **Document uncertainties** - Use ✅/❌/❓ consistently
5. **Compare to existing platforms** - Check `platforms.jsonc` for patterns
6. **Quality over speed** - "Needs verification" is acceptable, guessing is not
7. **Test incrementally** - Validate each platform change separately
