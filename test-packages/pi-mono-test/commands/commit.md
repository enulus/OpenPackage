# Commit Command

Generate a semantic commit message following conventional commits.

## Usage

```bash
/commit
```

## Behavior

1. Analyze staged changes with `git diff --cached`
2. Identify the type of change (feat, fix, docs, etc.)
3. Generate clear, concise commit message
4. Follow conventional commits specification

## Examples

```
feat: add user authentication
fix: resolve memory leak in cache
docs: update installation guide
```

## Tags

- git
- commit
- conventional-commits
