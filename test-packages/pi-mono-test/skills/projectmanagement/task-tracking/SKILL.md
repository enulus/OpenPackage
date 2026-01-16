---
name: task-tracking
description: Track and manage project tasks
tags:
  - project-management
  - tasks
  - productivity
---

# Task Tracking Skill

Simple task tracking and management for project workflows.

## Overview

This skill provides task creation, tracking, and completion workflows to help manage project work effectively.

## Capabilities

### 1. Create Tasks

Generate task definitions with:
- Unique identifiers
- Clear descriptions
- Priority levels
- Time estimates
- Dependencies

### 2. Track Progress

Monitor task status:
- ⏳ Not Started
- 🔄 In Progress
- ✅ Complete
- ❌ Blocked

### 3. List Tasks

View tasks by:
- Status
- Priority
- Assignee
- Due date

## Usage Examples

### Example 1: Create Task

```markdown
## Task: Add Pi-Mono Support

**Priority:** High
**Estimate:** 2 hours
**Status:** In Progress

### Description
Add Pi-Mono platform support to OpenPackage

### Steps
1. Add platform definition
2. Create test package
3. Run integration tests
4. Update documentation
```

### Example 2: Update Status

```bash
# Mark task as complete
echo "✅ Complete" > .tasks/task-001-status.txt
```

## Best Practices

1. **Clear Descriptions** - Write actionable task descriptions
2. **Realistic Estimates** - Base estimates on actual data
3. **Regular Updates** - Update status frequently
4. **Track Blockers** - Document dependencies clearly

## Integration

Works with:
- GitHub Issues
- Linear
- Jira
- Local markdown files

## Tags

project-management, tasks, tracking, productivity
