# Git Status Command

Show detailed git repository status with helpful context.

## Usage

```bash
/git-status
```

## Behavior

1. Run `git status --short --branch`
2. Show current branch and remote tracking
3. List modified, staged, and untracked files
4. Provide suggestions for next actions

## Example Output

```
On branch feature/pi-mono
Your branch is up to date with 'origin/feature/pi-mono'

Modified files:
  M platforms.jsonc
  
Untracked files:
  test-packages/

Suggestions:
- Stage changes: git add <file>
- Commit: git commit -m "message"
```

## Tags

- git
- status
- version-control
