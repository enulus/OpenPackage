# Complete Guide to Subagent Frontmatter Configuration

## Overview

Both Claude Code and OpenCode support subagent configuration through YAML frontmatter in Markdown files. This comprehensive guide details all available frontmatter fields, their purposes, valid values, and use cases for each platform.

---

## Platform Comparison

| Feature | Claude Code | OpenCode |
|---------|------------|----------|
| **Configuration Format** | YAML frontmatter in Markdown | YAML frontmatter in Markdown + JSON in config file |
| **File Locations** | `.claude/agents/`, `~/.claude/agents/` | `.opencode/agents/`, `~/.config/opencode/agents/` |
| **Config Files** | Markdown files only | Markdown files or `opencode.json` |
| **Primary Agents** | Yes (Build, Plan) | Yes (Build, Plan) |
| **Subagents** | Yes (General, Explore, custom) | Yes (General, Explore, custom) |
| **CLI Support** | `--agents` JSON flag | `opencode.json` configuration |

---

## Claude Code Subagent Frontmatter Fields

### Required Fields

#### `name`
- **Type:** String
- **Required:** Yes
- **Description:** Unique identifier for the subagent using lowercase letters and hyphens
- **Format:** Lowercase alphanumeric characters and hyphens only (no spaces or underscores)
- **Example:** `code-reviewer`, `db-reader`, `data-scientist`
- **Notes:**
  - Must be unique within scope (session, project, or user level)
  - Used when referencing the subagent via `@mention` or in CLI
  - The filename (without `.md` extension) becomes the agent name in OpenCode

#### `description`
- **Type:** String
- **Required:** Yes
- **Description:** Brief explanation of what the subagent does and when to use it
- **Guidelines:**
  - Keep to 1-2 sentences
  - Include trigger phrases like "Use proactively when..." to encourage automatic delegation
  - Be specific about the subagent's purpose and domain
- **Examples:**
  - `"Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code."`
  - `"Execute read-only database queries. Use when analyzing data or generating reports."`
  - `"Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues."`
- **Notes:**
  - Claude uses this description to decide when to automatically delegate tasks
  - Phrases like "use proactively" signal that Claude should invoke this agent more frequently

---

### Optional Fields

#### `model`
- **Type:** String (one of: `sonnet`, `opus`, `haiku`, `inherit`)
- **Required:** No
- **Default:** `sonnet`
- **Description:** Specifies which AI model the subagent uses
- **Valid Values:**
  - `sonnet` - Claude 3.5 Sonnet (balanced capability and speed)
  - `opus` - Claude 3 Opus (most capable, slower)
  - `haiku` - Claude 3 Haiku (fastest, less capable)
  - `inherit` - Use the same model as the parent conversation
- **Use Cases:**
  - `haiku` - Fast read-only exploration, quick lookups
  - `sonnet` - Default for balanced tasks (code review, debugging)
  - `opus` - Complex analysis, creative tasks
  - `inherit` - Maintaining consistency with main conversation
- **Examples:**
  ```yaml
  model: sonnet
  model: haiku
  model: inherit
  ```
- **Performance Considerations:**
  - `haiku` is cheapest and fastest (good for Explore subagent)
  - `sonnet` is middle ground (recommended default)
  - `opus` is most capable but slower and more expensive
  - `inherit` ensures same reasoning level as parent

#### `tools`
- **Type:** Comma-separated string or array
- **Required:** No
- **Default:** All tools inherited from parent conversation
- **Description:** Whitelist of tools the subagent can access
- **Available Tools (Claude Code):**
  - Read-only: `Read`, `Grep`, `Glob`
  - Write operations: `Write`, `Edit`
  - Shell access: `Bash`
  - Other: `AskUserQuestion`, `CreateSubagent`
  - MCP tools (if configured)
- **Format:**
  - Comma-separated: `Read, Grep, Glob, Bash`
  - Can use pipe for alternatives: `Edit|Write`
  - Wildcard patterns supported
- **Examples:**
  ```yaml
  tools: Read, Grep, Glob          # Read-only tools
  tools: Read, Edit, Bash, Grep    # Analysis with modifications
  tools: Bash                       # Bash only
  tools: Read, Grep, Glob, Bash    # Full access for code review
  ```
- **Common Combinations:**
  - **Code Reviewer:** `Read, Grep, Glob, Bash` (no Edit/Write)
  - **Debugger:** `Read, Edit, Bash, Grep, Glob`
  - **Data Scientist:** `Bash, Read, Write`
  - **Explorer:** `Read, Grep, Glob`
- **Notes:**
  - If omitted, subagent inherits all tools from parent
  - Using `tools` field creates an allowlist (only specified tools available)
  - Combine with `disallowedTools` to refine permissions

#### `disallowedTools`
- **Type:** Comma-separated string or array
- **Required:** No
- **Default:** None
- **Description:** Blacklist of tools to deny, removed from inherited or specified list
- **Format:**
  - Comma-separated: `Write, Edit`
  - Can use pipe: `Write|Edit`
  - Wildcard patterns supported
- **Examples:**
  ```yaml
  tools: Read, Grep, Glob, Bash
  disallowedTools: Write, Edit
  ```
- **Use Cases:**
  - Restrict inherited tools without specifying full allowlist
  - Remove specific dangerous tools from broader sets
  - Combine with `tools` field for precise control
- **Precedence:**
  - `disallowedTools` takes precedence over `tools`
  - Last matching rule wins (be specific after wildcards)

#### `permissionMode`
- **Type:** String (one of: `default`, `acceptEdits`, `dontAsk`, `bypassPermissions`, `plan`)
- **Required:** No
- **Default:** `default`
- **Description:** Controls how the subagent handles permission prompts
- **Valid Values:**

  | Mode | Behavior | Use Case |
  |------|----------|----------|
  | `default` | Standard permission checking with prompts | Safe default, user confirmation required |
  | `acceptEdits` | Auto-accept file edits without prompting | Trusted automated workflows |
  | `dontAsk` | Auto-deny permission prompts (explicitly allowed tools still work) | Safe exploration without prompts |
  | `bypassPermissions` | Skip all permission checks (cannot be overridden) | Full automation, careful use |
  | `plan` | Plan mode - read-only exploration | Analysis without modifications |

- **Examples:**
  ```yaml
  permissionMode: default        # Ask user for each action
  permissionMode: acceptEdits    # Auto-accept file changes
  permissionMode: dontAsk        # Deny unclear requests silently
  permissionMode: plan           # Read-only analysis mode
  ```
- **Inheritance & Override:**
  - Subagents inherit permission context from parent conversation
  - Subagent can override parent mode EXCEPT if parent uses `bypassPermissions`
  - If parent has `bypassPermissions`, that takes precedence
- **Important Security Notes:**
  - `bypassPermissions` is most permissive (use with caution)
  - `plan` mode is safest for untrusted operations
  - Combine with restricted `tools` list for maximum safety

#### `skills`
- **Type:** Array of skill names or paths
- **Required:** No
- **Default:** None
- **Description:** Skills to load into the subagent's context at startup
- **Behavior:**
  - Full skill content is injected into subagent context
  - Subagents do NOT inherit skills from parent conversation
  - Skills are loaded at subagent initialization
- **Examples:**
  ```yaml
  skills:
    - eslint-rules
    - performance-optimization
  ```
- **Notes:**
  - Skills must be defined elsewhere (in Claude Code skills system)
  - Only subagent-specific skills are injected
  - Useful for domain expertise or coding standards
  - Can include multiple skills in an array
- **Use Cases:**
  - Inject company coding standards for code reviewer
  - Load database schema definitions for data analyst
  - Include performance benchmarks for optimization specialist

#### `hooks`
- **Type:** Object with event keys
- **Required:** No
- **Default:** None
- **Description:** Lifecycle hooks that run during subagent execution
- **Hook Events:**

  | Event | Matcher Input | When It Fires | Example Use |
  |-------|---------------|---------------|-------------|
  | `PreToolUse` | Tool name (e.g., "Bash") | Before subagent uses a tool | Validate bash commands, prevent dangerous operations |
  | `PostToolUse` | Tool name (e.g., "Edit") | After subagent uses a tool | Run linter after edits, post-process results |
  | `Stop` | None | When subagent finishes | Cleanup, logging, teardown |

- **Hook Structure:**
  ```yaml
  hooks:
    PreToolUse:
      - matcher: "Bash"
        hooks:
          - type: command
            command: "./scripts/validate-command.sh"
    PostToolUse:
      - matcher: "Edit|Write"
        hooks:
          - type: command
            command: "./scripts/run-linter.sh"
  ```
- **Hook Types:**
  - `type: command` - Execute a shell script or command
  - Receives JSON input via stdin containing tool context
  - Exit code 0 = allow, Exit code 2 = block operation

- **Hook Input Schema (JSON via stdin):**
  ```json
  {
    "tool_name": "Bash",
    "tool_input": {
      "command": "npm test"
    },
    "working_directory": "/path/to/project"
  }
  ```

- **Examples:**

  **Bash validation (read-only queries):**
  ```yaml
  hooks:
    PreToolUse:
      - matcher: "Bash"
        hooks:
          - type: command
            command: "./scripts/validate-readonly-query.sh"
  ```

  **Run linter after edits:**
  ```yaml
  hooks:
    PostToolUse:
      - matcher: "Edit|Write"
        hooks:
          - type: command
            command: "./scripts/run-linter.sh"
  ```

  **Both pre and post:**
  ```yaml
  hooks:
    PreToolUse:
      - matcher: "Bash"
        hooks:
          - type: command
            command: "./scripts/validate-command.sh $TOOL_INPUT"
    PostToolUse:
      - matcher: "Edit|Write"
        hooks:
          - type: command
            command: "./scripts/run-linter.sh"
    Stop:
      - type: command
        command: "./scripts/cleanup.sh"
  ```

- **Exit Codes:**
  - `0` - Continue with tool execution
  - `1` - General error, show message to user
  - `2` - Block operation, show stderr as error message
  - Other codes - Treat as error

- **Common Validation Scripts:**
  - SQL read-only validation (check for INSERT/UPDATE/DELETE)
  - Bash command whitelisting (prevent dangerous commands)
  - File path validation (prevent access to sensitive directories)
  - Dependency checking (ensure required tools installed)

---

## OpenCode Agent Configuration Fields

OpenCode supports agent configuration in both YAML frontmatter (Markdown files) and JSON format (`opencode.json` config file). Below are fields specific to OpenCode:

### Configuration Locations

1. **Markdown files** (YAML frontmatter):
   - Global: `~/.config/opencode/agents/`
   - Project: `.opencode/agents/`
   - Filename (without `.md`) becomes agent name

2. **JSON config** (`opencode.json`):
   ```json
   {
     "agents": {
       "review": {
         "description": "...",
         "tools": {...},
         "permissions": {...}
       }
     }
   }
   ```

### Required Fields

#### `description`
- **Type:** String
- **Required:** Yes
- **Description:** Brief description of agent purpose
- **Examples:** Same as Claude Code

#### `mode` (OpenCode-specific in some contexts)
- **Type:** String (one of: `primary`, `subagent`, `all`)
- **Required:** No
- **Default:** `all`
- **Description:** Determines how the agent can be used
- **Values:**
  - `primary` - Main agents switchable with Tab key
  - `subagent` - Agents invoked with `@mention` or by other agents
  - `all` - Can be used as either
- **Examples:**
  ```yaml
  mode: subagent
  mode: primary
  mode: all
  ```
- **Notes:**
  - Primary agents shown in Tab switcher
  - Subagents available via @ mention
  - Defaults to `all` for maximum flexibility

---

### Optional Fields

#### `temperature`
- **Type:** Float (0.0 to 1.0)
- **Required:** No
- **Default:** Model-specific (typically 0 for most models, 0.55 for Qwen)
- **Description:** Controls randomness and creativity of LLM responses
- **Range Guidance:**
  - `0.0 - 0.2`: Very focused and deterministic (ideal for analysis, code review)
  - `0.3 - 0.5`: Balanced responses with some creativity (general development)
  - `0.6 - 1.0`: More creative and varied (brainstorming, exploration)
- **Examples:**
  ```yaml
  temperature: 0.0    # Deterministic code analysis
  temperature: 0.3    # Balanced development
  temperature: 0.8    # Creative exploration
  ```
- **Use Cases:**
  - `0.0` for code reviewers and analyzers
  - `0.1-0.3` for debugging and fixing
  - `0.5-0.7` for planning and ideation
  - `0.8+` for creative tasks

#### `maxSteps`
- **Type:** Integer
- **Required:** No
- **Default:** None (continue until completion)
- **Description:** Maximum number of agentic iterations before forcing text-only response
- **Purpose:** Cost control and preventing infinite loops
- **Behavior:**
  - When limit reached, agent receives special prompt to summarize work
  - Responds with summary and recommended remaining tasks
  - Prevents runaway tool usage
- **Examples:**
  ```yaml
  maxSteps: 10    # Allow up to 10 tool calls
  maxSteps: 5     # Conservative limit for cost control
  ```
- **Notes:**
  - Useful when budgeting LLM token costs
  - Step = one tool invocation or reasoning cycle
  - Omit for unlimited iterations

#### `disabled`
- **Type:** Boolean
- **Required:** No
- **Default:** `false`
- **Description:** Disable the agent from being used
- **Examples:**
  ```yaml
  disabled: true
  ```
- **Use Cases:**
  - Temporarily disable experimental agents
  - Disable agents during maintenance
  - Hide agents without deleting configuration

#### `prompt`
- **Type:** String (path to file or inline string)
- **Required:** No
- **Default:** Uses provided system prompt from Markdown body
- **Description:** Path to custom system prompt file or inline prompt
- **Behavior:**
  - Path is relative to config file location
  - Works for both global and project-specific configs
  - Can reference external prompt files for organization
- **Examples:**
  ```yaml
  prompt: ./prompts/code-review.md
  prompt: ./systems/analyzer-instructions.txt
  ```
- **Notes:**
  - Alternative to inline Markdown body
  - Useful for long or shared prompts
  - Paths relative to config location

#### `model`
- **Type:** String
- **Required:** No
- **Default:** Provider default or OpenCode configuration
- **Description:** Override default model for this agent
- **Format:** `provider/model-id`
- **OpenCode Zen Models:**
  - `opencode/gpt-5.1-codex` - GPT 5.1 Codex
  - Other provider models follow `provider/model-id` pattern
- **Examples:**
  ```yaml
  model: opencode/gpt-5.1-codex
  model: provider/faster-model          # For planning agents
  model: provider/most-capable-model    # For complex tasks
  ```
- **Use Cases:**
  - Use faster models for planning agents
  - Use most capable models for analysis
  - Balance cost vs capability per agent

#### `tools`
- **Type:** Object/Record with boolean values or wildcard strings
- **Required:** No
- **Default:** All tools enabled
- **Description:** Enable/disable specific tools for this agent
- **Format:**
  ```yaml
  tools:
    read: true
    write: true
    bash: false
    "mcp-server/*": false   # Wildcard to disable all from MCP server
  ```
- **Tool Names:** Depends on OpenCode configuration
- **Examples:**
  ```yaml
  tools:
    file_edit: true
    bash: true
    read: true
    write: false
  
  tools:
    "*": true                # Enable all
    "dangerous_tool": false  # Except one
  ```
- **Notes:**
  - Can enable/disable individual tools
  - Supports wildcards for bulk operations
  - Defaults to all enabled

#### `permissions`
- **Type:** Object with nested configuration
- **Required:** No
- **Default:** Standard permission checking
- **Description:** Control permissions for file operations, bash, and web fetching
- **Structure:**
  ```yaml
  permissions:
    edit: "ask"          # For file edits
    bash: "allow"        # For bash commands
    webfetch: "deny"     # For web requests
    task: "allow"        # For subagent invocation
  ```
- **Permission Levels:**
  - `"ask"` - Prompt user for each operation
  - `"allow"` - Allow without prompting
  - `"deny"` - Disable completely
- **Task Permissions (Special):**
  - Controls which subagents this agent can invoke
  - Uses glob patterns: `permission.task: "pattern"`
  - Set to `"deny"` to prevent subagent invocation
- **Bash Command Specific Permissions:**
  ```yaml
  permissions:
    bash:
      "*": "ask"                    # Ask for all by default
      "npm install": "allow"        # Allow specific commands
      "rm -rf": "deny"              # Block dangerous commands
      "docker *": "deny"            # Block command patterns
  ```
- **Examples:**
  ```yaml
  permissions:
    edit: "ask"
    bash: "allow"
    webfetch: "deny"
  
  permissions:
    bash:
      "*": "ask"
      "git": "allow"
      "node": "allow"
      "rm": "deny"
    task:
      "general": "allow"
      "*": "deny"
  ```
- **Precedence:**
  - Last matching rule wins
  - Put wildcards first, then specific rules
  - Agent permissions can override parent

#### `hidden`
- **Type:** Boolean
- **Required:** No
- **Default:** `false`
- **Description:** Hide subagent from @ autocomplete menu
- **Purpose:** Internal agents only invoked programmatically
- **Behavior:**
  - Not shown in @ mention autocomplete
  - Can still be invoked via Task tool by other agents
  - Useful for utility agents not meant for direct use
- **Examples:**
  ```yaml
  hidden: true    # Don't show in autocomplete
  ```
- **Use Cases:**
  - Internal helper agents
  - Experimental/testing agents
  - Agents only called by other agents

#### Additional Provider-Specific Fields
- **Type:** Any (passed through to provider)
- **Description:** Any additional fields are passed to the provider as model options
- **Example (OpenAI reasoning models):**
  ```yaml
  thinking:
    type: enabled
    budget_tokens: 10000
  ```
- **Notes:**
  - Highly provider and model specific
  - Check provider documentation for available options
  - Useful for fine-tuning model behavior

---

## Complete Frontmatter Examples

### Example 1: Code Reviewer (Claude Code)
```yaml
---
name: code-reviewer
description: Expert code review specialist. Proactively reviews code for quality, security, and maintainability. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: inherit
---

You are a senior code reviewer ensuring high standards of code quality and security.

When invoked:
1. Run git diff to see recent changes
2. Focus on modified files
3. Begin review immediately

Review checklist:
- Code is clear and readable
- Functions and variables are well-named
- No duplicated code
- Proper error handling
- No exposed secrets or API keys
- Input validation implemented
- Good test coverage
- Performance considerations addressed

Provide feedback organized by priority:
- Critical issues (must fix)
- Warnings (should fix)
- Suggestions (consider improving)

Include specific examples of how to fix issues.
```

### Example 2: Database Reader with Hooks (Claude Code)
```yaml
---
name: db-reader
description: Execute read-only database queries. Use when analyzing data or generating reports.
tools: Bash
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/validate-readonly-query.sh"
---

You are a database analyst with read-only access. Execute SELECT queries to answer questions about the data.

When asked to analyze data:
1. Identify which tables contain the relevant data
2. Write efficient SELECT queries with appropriate filters
3. Present results clearly with context

You cannot modify data. If asked to INSERT, UPDATE, DELETE, or modify schema, explain that you only have read access.
```

### Example 3: Debugger (Claude Code)
```yaml
---
name: debugger
description: Debugging specialist for errors, test failures, and unexpected behavior. Use proactively when encountering any issues.
tools: Read, Edit, Bash, Grep, Glob
permissionMode: acceptEdits
---

You are an expert debugger specializing in root cause analysis.

When invoked:
1. Capture error message and stack trace
2. Identify reproduction steps
3. Isolate the failure location
4. Implement minimal fix
5. Verify solution works

Debugging process:
- Analyze error messages and logs
- Check recent code changes
- Form and test hypotheses
- Add strategic debug logging
- Inspect variable states

For each issue, provide:
- Root cause explanation
- Evidence supporting the diagnosis
- Specific code fix
- Testing approach
- Prevention recommendations

Focus on fixing the underlying issue, not the symptoms.
```

### Example 4: Data Scientist (Claude Code)
```yaml
---
name: data-scientist
description: Data analysis expert for SQL queries, BigQuery operations, and data insights. Use proactively for data analysis tasks and queries.
tools: Bash, Read, Write
model: sonnet
---

You are a data scientist specializing in SQL and BigQuery analysis.

When invoked:
1. Understand the data analysis requirement
2. Write efficient SQL queries
3. Use BigQuery command line tools (bq) when appropriate
4. Analyze and summarize results
5. Present findings clearly

Key practices:
- Write optimized SQL queries with proper filters
- Use appropriate aggregations and joins
- Include comments explaining complex logic
- Format results for readability
- Provide data-driven recommendations

For each analysis:
- Explain the query approach
- Document any assumptions
- Highlight key findings
- Suggest next steps based on data

Always ensure queries are efficient and cost-effective.
```

### Example 5: OpenCode Agent Configuration (JSON)
```json
{
  "agents": {
    "review": {
      "description": "Code reviewer for quality and security",
      "temperature": 0.1,
      "maxSteps": 20,
      "model": "provider/fast-model",
      "tools": {
        "read": true,
        "bash": true,
        "write": false
      },
      "permissions": {
        "bash": {
          "*": "ask",
          "grep": "allow",
          "rm": "deny"
        }
      }
    },
    "analyzer": {
      "description": "Analyze code patterns and performance",
      "temperature": 0.0,
      "model": "provider/capable-model",
      "disabled": false,
      "hidden": false
    }
  }
}
```

### Example 6: OpenCode Markdown Agent
```yaml
---
name: performance-optimizer
description: Analyze and optimize code performance. Use proactively for performance improvements.
model: opencode/gpt-5.1-codex
temperature: 0.2
mode: subagent
maxSteps: 15
permissions:
  edit: "ask"
  bash: "allow"
---

You are a performance optimization specialist. When invoked, analyze code for performance improvements.

Key areas to examine:
1. Algorithm complexity (O(n) patterns)
2. Memory usage and leaks
3. Loop optimizations
4. Caching opportunities
5. Database query efficiency

Provide:
- Current performance assessment
- Specific bottlenecks identified
- Recommended optimizations with rationale
- Expected performance improvement
- Implementation examples
```

---

## Configuration File Locations

### Claude Code
```
User-level (all projects):     ~/.claude/agents/
Project-level (this project):  .claude/agents/
CLI (this session only):       --agents '{"name": {...}}'
Plugin subagents:              Plugin package agents/ directory
```

### OpenCode
```
Global (all projects):         ~/.config/opencode/agents/
Project (this project):        .opencode/agents/
Config file (JSON):            .opencode/opencode.json or opencode.json
Priority order:                CLI flag â†’ Project â†’ Global â†’ Plugin
```

---

## Tool Availability by Platform

### Claude Code Built-in Tools
- **Read Operations:** Read, Grep, Glob
- **Write Operations:** Write, Edit
- **System:** Bash
- **Interaction:** AskUserQuestion, CreateSubagent
- **MCP:** Custom MCP server tools (if configured)

### OpenCode Built-in Tools
- Configurable tools depend on OpenCode setup
- MCP server integration available
- CLI tools accessible via bash

---

## Best Practices

### 1. Naming Conventions
- Use lowercase with hyphens: `code-reviewer`, `db-analyzer`
- Be descriptive: `performance-optimizer` not `opt`
- Use consistent prefixes for related agents: `test-runner`, `test-debugger`

### 2. Description Quality
- Include proactive usage hints: "Use proactively when..."
- Be specific about when/how to use
- Keep to 1-2 sentences
- Examples: "Code review specialist. Use immediately after code changes."

### 3. Tool Restrictions
- Principle of least privilege: only grant necessary tools
- Use allowlist (`tools`) over blacklist (`disallowedTools`)
- Combine with appropriate `permissionMode`
- Read-only agents: `Read, Grep, Glob` only

### 4. Model Selection
- Use `inherit` for consistency in same workflow
- Use `haiku` for fast, simple operations
- Use `sonnet` as default balance
- Use `opus` for complex analysis or reasoning
- Match cost expectations: faster models cheaper

### 5. Permission Management
- `default` for user-interactive agents
- `acceptEdits` for trusted automated workflows
- `dontAsk` for safe exploration
- `bypassPermissions` rarely (full automation, high risk)
- `plan` for read-only with analysis

### 6. Hook Implementation
- Validate before allowing operations
- Exit code 0 = allow, 2 = block
- Pass helpful error messages via stderr
- Keep scripts lightweight and fast
- Test hooks thoroughly before deploying

### 7. Skills Configuration
- Load only essential skills to save context
- Don't duplicate parent conversation skills
- Keep skills focused and domain-specific

### 8. Temperature Settings (OpenCode)
- Code analysis: `0.0-0.1` (deterministic)
- Implementation: `0.2-0.4` (focused with minor variation)
- Planning: `0.5-0.7` (balanced creativity)
- Brainstorming: `0.8-1.0` (high creativity)

---

## Migration Between Platforms

### Claude Code â†’ OpenCode

Claude Code Frontmatter:
```yaml
---
name: reviewer
description: Review code
tools: Read, Grep, Glob, Bash
model: sonnet
permissionMode: default
---
```

OpenCode Markdown Equivalent:
```yaml
---
name: reviewer
description: Review code
model: opencode/gpt-5.1-codex
temperature: 0.0
mode: subagent
permissions:
  bash: "ask"
---
```

OpenCode JSON Equivalent:
```json
{
  "agents": {
    "reviewer": {
      "description": "Review code",
      "temperature": 0.0,
      "mode": "subagent"
    }
  }
}
```

---

## Troubleshooting

### Agent Not Being Invoked
- Check `description` field includes proactive usage hints
- Verify agent is not `hidden: true` if expecting @ mention
- Ensure agent name is correctly spelled
- Check permissions allow the required operations

### Hook Validation Not Working
- Verify script is executable: `chmod +x script.sh`
- Check exit codes: 0 (allow), 2 (block)
- Debug by testing script directly
- Ensure JSON input parsing in script
- Check command path is relative to working directory

### Wrong Model Being Used
- Check `model` field is set correctly
- Verify model ID format: `provider/model-id` for OpenCode
- For Claude Code: `sonnet`, `opus`, `haiku`, or `inherit`
- Check parent agent's model if using `inherit`

### Tools Not Available
- Verify tool name is correct
- Check tool is not in `disallowedTools`
- Ensure tool is specified in `tools` field (if using allowlist)
- For MCP tools: check MCP server is enabled
- Verify permissions don't deny the tool

### Performance Issues
- Reduce `maxSteps` to limit iterations (OpenCode)
- Use `haiku` model for faster responses
- Reduce `temperature` for more deterministic output
- Limit unnecessary tools in `tools` field
- Optimize hook validation scripts

---

## Additional Resources

### Claude Code Documentation
- [Subagents Documentation](https://code.claude.com/docs/en/sub-agents)
- [Agent SDK](https://code.claude.com/docs/en/agents-sdk)
- [Hooks Documentation](https://code.claude.com/docs/en/hooks)
- [Permission System](https://code.claude.com/docs/en/permissions)

### OpenCode Documentation
- [Agents Documentation](https://opencode.ai/docs/agents/)
- [Configuration Guide](https://opencode.ai/docs/configuration/)
- [OpenCode Repository](https://github.com/anomalyco/opencode)

---

## Summary Table: Field Availability

| Field | Claude Code | OpenCode | Required | Type |
|-------|------------|----------|----------|------|
| `name` | âœ“ | âœ“ | Yes | String |
| `description` | âœ“ | âœ“ | Yes | String |
| `tools` | âœ“ | âœ“ | No | String/Array |
| `disallowedTools` | âœ“ | âœ— | No | String/Array |
| `model` | âœ“ | âœ“ | No | String |
| `temperature` | âœ— | âœ“ | No | Float (0.0-1.0) |
| `maxSteps` | âœ— | âœ“ | No | Integer |
| `permissionMode` | âœ“ | âœ— | No | String |
| `permissions` | âœ— | âœ“ | No | Object |
| `mode` | âœ— | âœ“ | No | String |
| `skills` | âœ“ | âœ— | No | Array |
| `hooks` | âœ“ | âœ— | No | Object |
| `disabled` | âœ— | âœ“ | No | Boolean |
| `prompt` | âœ— | âœ“ | No | String |
| `hidden` | âœ“ | âœ“ | No | Boolean |

---

## Conclusion

Both Claude Code and OpenCode provide flexible subagent configuration systems. Key differences:

- **Claude Code** focuses on tools, permissions, and hooks for fine-grained control
- **OpenCode** emphasizes model selection, temperature, and step limits for cost/behavior control

Choose appropriate fields based on your needs, and leverage platform-specific features for optimal agent behavior. Combine multiple fields strategically for powerful, specialized agents.