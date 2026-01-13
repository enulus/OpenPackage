# Git Cache Architecture

This document specifies the structured Git cache system used for cloning and caching Git repositories.

---

## 1. Overview

The Git cache provides:
- **Deterministic paths**: Same repository/commit always uses same location
- **Automatic reuse**: Detects and reuses existing cached commits
- **Persistent storage**: Cache survives reboots (unlike temp directories)
- **Space efficiency**: Uses shallow clones (`--depth 1`)
- **Metadata tracking**: Stores repository and commit information for debugging

---

## 2. Cache structure

### 2.1 Base directory

All Git clones are cached at:
```
~/.openpackage/cache/git/
```

### 2.2 Directory hierarchy

```
~/.openpackage/cache/git/
├── <url-hash-12>/              # Repository (by URL hash)
│   ├── .opkg-repo.json         # Repository metadata
│   ├── <commit-sha-7>/         # Commit checkout
│   │   ├── .git/               # Git repository data
│   │   ├── .opkg-commit.json   # Commit metadata
│   │   └── <repository files>
│   └── <commit-sha-7>/         # Another commit
│       └── ...
└── <url-hash-12>/              # Another repository
    └── ...
```

**Path components**:
- `<url-hash-12>`: 12 hex characters (48 bits) - hash of normalized Git URL
- `<commit-sha-7>`: 7 hex characters - first 7 chars of resolved commit SHA

---

## 3. URL hash generation

### 3.1 Normalization

URLs are normalized before hashing to ensure consistency:

**Transformations**:
1. Convert to lowercase
2. Remove `.git` suffix
3. Normalize GitHub SSH to HTTPS format:
   - `git@github.com:owner/repo.git` → `https://github.com/owner/repo`
4. Normalize other SSH formats:
   - `git@host:owner/repo.git` → `https://host/owner/repo`
5. Remove trailing slashes

**Examples**:
| Original URL | Normalized URL |
|--------------|----------------|
| `https://github.com/User/Repo.git` | `https://github.com/user/repo` |
| `git@github.com:anthropics/claude-code.git` | `https://github.com/anthropics/claude-code` |
| `https://gitlab.com/group/project.git` | `https://gitlab.com/group/project` |

### 3.2 Hash computation

- Algorithm: SHA-256
- Length: First 12 hex characters (48 bits)
- Collision probability: ~10^-10 with 1000 repos
- Deterministic: Same normalized URL always produces same hash

**Implementation**:
```typescript
function computeGitUrlHash(url: string): string {
  const normalized = normalizeGitUrl(url);
  const hash = createHash('sha256').update(normalized).digest('hex');
  return hash.substring(0, 12);
}
```

---

## 4. Commit SHA resolution

### 4.1 Resolution process

When cloning a repository:
1. Clone repository to temporary location within cache
2. Resolve current HEAD to full commit SHA (40 chars)
3. Truncate to 7 characters for directory name
4. Move to final location: `<url-hash>/<commit-sha-7>/`

### 4.2 Ref handling

**Branch or tag specified**:
- Clone with `--branch <ref>`
- Resolve to commit SHA after clone
- Directory named by commit SHA (not branch name)

**Commit SHA specified**:
- Clone default branch
- Fetch and checkout specific commit
- Directory named by commit SHA

**No ref specified**:
- Clone default branch
- Resolve HEAD to commit SHA
- Directory named by commit SHA

**Result**: Different branches/tags pointing to same commit → same cache location

---

## 5. Metadata files

### 5.1 Repository metadata

**Location**: `~/.openpackage/cache/git/<url-hash>/.opkg-repo.json`

**Schema**:
```json
{
  "url": "https://github.com/anthropics/claude-code.git",
  "normalized": "https://github.com/anthropics/claude-code",
  "lastFetched": "2025-01-13T10:30:00Z"
}
```

**Fields**:
- `url`: Original Git URL (as provided by user)
- `normalized`: Normalized URL used for hashing
- `lastFetched`: Timestamp of most recent fetch operation

### 5.2 Commit metadata

**Location**: `~/.openpackage/cache/git/<url-hash>/<commit-sha-7>/.opkg-commit.json`

**Schema**:
```json
{
  "url": "https://github.com/anthropics/claude-code.git",
  "commit": "abc1234567890abcdef",
  "ref": "main",
  "subdirectory": "plugins/commit-commands",
  "clonedAt": "2025-01-13T10:30:00Z",
  "lastAccessed": "2025-01-13T12:00:00Z"
}
```

**Fields**:
- `url`: Git URL for this commit
- `commit`: Full commit SHA (40 chars)
- `ref`: Branch/tag name if specified (optional)
- `subdirectory`: Subdirectory path if specified (optional)
- `clonedAt`: Timestamp when commit was first cloned
- `lastAccessed`: Timestamp of most recent access

---

## 6. Clone operations

### 6.1 Initial clone

When cloning a new commit:
1. Generate cache paths:
   - `repoDir = ~/.openpackage/cache/git/<url-hash>/`
   - `tempPath = <repoDir>/.temp-clone`
2. Create repo directory if needed
3. Write `.opkg-repo.json` metadata
4. Clone to temporary path:
   - `git clone --depth 1 [--branch <ref>] <url> <tempPath>`
5. Resolve commit SHA from HEAD
6. Check if commit already cached (rare race condition)
7. Move temp path to final location: `<repoDir>/<commit-sha-7>/`
8. Write `.opkg-commit.json` metadata

### 6.2 Cache hit

When requested commit is already cached:
1. Check if directory exists: `~/.openpackage/cache/git/<url-hash>/<commit-sha-7>/`
2. Read and validate `.opkg-commit.json`
3. Update `lastAccessed` timestamp
4. Return path to cached commit
5. Skip clone entirely

### 6.3 Subdirectory handling

Subdirectories are accessed within the cloned repository:
- Clone full repository to cache
- Return path to subdirectory: `<commit-dir>/<subdirectory>/`
- Validate subdirectory exists before returning

**Example**:
```
Cache: ~/.openpackage/cache/git/a1b2c3d4e5f6/abc1234/
Subdirectory: plugins/commit-commands
Return: ~/.openpackage/cache/git/a1b2c3d4e5f6/abc1234/plugins/commit-commands/
```

---

## 7. Shallow clone details

### 7.1 Clone depth

All clones use `--depth 1` (shallow clone):
- Fetches only the latest commit
- Significantly smaller repository size
- Faster clone times
- Sufficient for package installation

**Comparison**:
| Clone Type | Size | Time |
|------------|------|------|
| Full clone | ~100MB | 10s |
| Shallow clone (`--depth 1`) | ~10MB | 2s |

### 7.2 Limitations

Shallow clones have limited Git history:
- Cannot `git log` beyond fetched commit
- Cannot easily determine branch history
- May need additional fetch for some operations

**Acceptable for OpenPackage** because:
- Only need files at specific commit
- Not performing Git operations after clone
- Can re-clone if full history needed

---

## 8. Cache management

### 8.1 Current behavior

- Cache grows indefinitely (no automatic cleanup)
- Multiple commits of same repository stored separately
- No size limits enforced

### 8.2 Future enhancements

**Cache cleanup**:
- Remove commits not accessed in N days
- Remove commits not referenced in any workspace
- Size-based cleanup (when cache exceeds threshold)

**Cache commands** (not yet implemented):
```bash
opkg cache list              # List all cached repositories
opkg cache show <url>        # Show commits for specific repository
opkg cache clean             # Clean old/unused cache entries
opkg cache clean --all       # Remove entire cache
opkg cache clean <url>       # Remove specific repository
```

**Cache statistics**:
- Total cache size
- Number of repositories
- Number of commits
- Last accessed timestamps

---

## 9. Error handling

### 9.1 Clone failures

If clone operation fails:
1. Clean up temporary clone directory
2. Preserve existing cache entries
3. Return error to caller
4. Do not write metadata files

### 9.2 Corrupted cache

If cache directory is corrupted:
- Next clone attempt will detect missing/invalid metadata
- Re-clone automatically
- Corrupted entries can be manually deleted

### 9.3 Disk space

If disk is full:
- Clone fails with disk space error
- User must free space or clean cache
- No automatic cleanup on low disk space

---

## 10. Benefits and trade-offs

### 10.1 Benefits

✅ **Deterministic**: Same repo/commit → same path  
✅ **Fast reinstalls**: Reuses existing cache  
✅ **Debuggable**: Metadata files show what's cached  
✅ **Persistent**: Survives reboots  
✅ **Space efficient**: Shallow clones  
✅ **Collision resistant**: 48-bit hash

### 10.2 Trade-offs

⚠️ **Disk usage**: Cache grows over time  
⚠️ **No automatic cleanup**: User must manage cache  
⚠️ **Shallow history**: Limited Git operations  
⚠️ **Branch updates**: No automatic update detection

---

## 11. Implementation notes

### 11.1 URL parsing

Supports multiple Git URL formats:
- HTTPS: `https://github.com/owner/repo.git`
- SSH: `git@github.com:owner/repo.git`
- SSH with protocol: `ssh://git@github.com:owner/repo.git`
- Git protocol: `git://github.com/owner/repo.git`

All formats are normalized to HTTPS for hashing.

### 11.2 Path safety

- All paths use filesystem-safe characters
- Commit SHAs are hex (safe for all filesystems)
- URL hashes are hex (safe for all filesystems)
- No special character handling needed

### 11.3 Concurrency

**Current implementation**:
- No file locking or coordination
- Rare race condition possible (same commit cloned simultaneously)
- Race is detected and handled (one clone succeeds, others reuse)

**Future consideration**:
- File locking for clone operations
- Atomic directory moves
- Retry logic for transient failures

---

## 12. Related specifications

- [Git Sources](./git-sources.md): Git install behavior
- [Install Behavior](./install-behavior.md): Overall install flow
- [Claude Code Plugin Support](./install-behavior.md#9-claude-code-plugin-support): Plugin installation

---

## 13. Examples

### 13.1 GitHub plugin marketplace

**Command**:
```bash
opkg install github:anthropics/claude-code#subdirectory=plugins/commit-commands
```

**Process**:
1. Normalize URL: `https://github.com/anthropics/claude-code`
2. Compute hash: `a1b2c3d4e5f6`
3. Clone to: `~/.openpackage/cache/git/a1b2c3d4e5f6/.temp-clone`
4. Resolve commit: `abc1234567890abcdef`
5. Move to: `~/.openpackage/cache/git/a1b2c3d4e5f6/abc1234/`
6. Return path: `~/.openpackage/cache/git/a1b2c3d4e5f6/abc1234/plugins/commit-commands/`

### 13.2 GitLab project

**Command**:
```bash
opkg install git:https://gitlab.com/company/project.git#v1.0.0
```

**Process**:
1. Normalize URL: `https://gitlab.com/company/project`
2. Compute hash: `x9y8z7w6v5u4`
3. Clone with tag: `git clone --depth 1 --branch v1.0.0 <url>`
4. Resolve commit: `def5678901234abcdef`
5. Move to: `~/.openpackage/cache/git/x9y8z7w6v5u4/def5678/`
6. Return path: `~/.openpackage/cache/git/x9y8z7w6v5u4/def5678/`

### 13.3 Cache reuse

**First install**:
```bash
opkg install github:user/plugin
# Clones to: ~/.openpackage/cache/git/k4l5m6n7o8p9/ghi9012/
```

**Second install** (same commit):
```bash
opkg install github:user/plugin
# Detects existing cache
# Reuses: ~/.openpackage/cache/git/k4l5m6n7o8p9/ghi9012/
# No clone needed
```
