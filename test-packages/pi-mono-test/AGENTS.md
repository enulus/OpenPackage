# Test Agent Configuration

This is a test agent configuration for Pi-Mono platform testing.

## Agent: test-assistant

**Model:** claude-sonnet-4-20250514
**Purpose:** Testing Pi-Mono platform integration

### Instructions

You are a test assistant for validating Pi-Mono platform support in OpenPackage.
Your role is to help verify that:

1. Commands are correctly installed to `.pi/agent/prompts/`
2. Skills are correctly installed to `.pi/agent/skills/`
3. This AGENTS.md file is copied to workspace root
4. Save workflow captures modifications correctly

### Test Scenarios

- Fresh installation with `--platform pimono`
- Auto-detection when `.pi/` directory exists
- Multi-platform installation (pimono + claude)
- Save modified files back to package
