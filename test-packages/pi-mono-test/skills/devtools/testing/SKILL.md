---
name: testing
description: Test execution and validation tools
tags:
  - testing
  - validation
  - qa
---

# Testing Skill

Comprehensive testing utilities for running and validating tests.

## Overview

This skill provides automated test execution, result analysis, and coverage reporting capabilities.

## Capabilities

### 1. Run Tests

Execute test suites with various configurations:

```bash
# Run all tests
./scripts/test.sh all

# Run specific test file
./scripts/test.sh unit src/utils/fs.test.ts

# Run with coverage
./scripts/test.sh coverage
```

### 2. Analyze Results

Parse test output and provide:
- Pass/fail summary
- Failed test details
- Performance metrics
- Coverage statistics

### 3. Generate Reports

Create formatted test reports:
- HTML coverage reports
- JUnit XML for CI integration
- Markdown summaries

## Usage Examples

### Example 1: Run All Tests

```bash
./scripts/test.sh all
```

Expected output:
```
Running all tests...
✅ 142 passed
❌ 2 failed
⏱️  Completed in 3.2s
```

### Example 2: Debug Failed Test

```bash
./scripts/test.sh debug src/core/save.test.ts
```

Shows detailed failure information with stack traces.

## Configuration

Configure test behavior via environment variables:

- `TEST_TIMEOUT` - Maximum test duration (default: 5000ms)
- `TEST_PARALLEL` - Run tests in parallel (default: true)
- `TEST_VERBOSE` - Show detailed output (default: false)

## Dependencies

- Test framework: Bun test
- Coverage: Built-in coverage tool
- Assertion library: Bun expect

## Tags

testing, qa, validation, automation
