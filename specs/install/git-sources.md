### `opkg install` – Git Sources

This document specifies how `install` supports installing packages from **git repositories**.

---

## 1. Supported inputs

### 1.1 CLI inputs

- **`opkg install git:<url>[#ref]`**
  - Installs a package from a git repository URL.
  - `ref` is optional and may be a branch, tag, or commit SHA.

- **`opkg install github:<owner>/<repo>[#ref]`**
  - Convenience shorthand for GitHub.
  - Equivalent to:
    - `opkg install git:https://github.com/<owner>/<repo>.git[#ref]`

---

## 2. package.yml schema

Dependencies in `.openpackage/package.yml` support git sources via:

```yaml
packages:
  - name: somepkg
    git: https://example.com/org/repo.git
    ref: main
```

Rules:
- Each dependency entry MUST specify **exactly one** source field: `version`, `path`, or `git`.
- `ref` is only valid when `git` is present.
- Git dependencies MUST NOT specify `version` (git dependencies are source-pinned, not semver-ranged).

---

## 3. Resolution and installation behavior

- `install` clones the repository to a temporary directory using the system `git` executable.
- If `ref` is provided:
  - For branch/tag: clone the specified ref.
  - For commit SHA: clone and checkout that SHA (best-effort shallow fetch).
- The cloned repository MUST contain `.openpackage/package.yml` at its root.
- The installed package version is read from the cloned repo’s `.openpackage/package.yml`.
- The rest of the install flow matches path installs:
  - Dependencies are resolved recursively.
  - Content is installed to the workspace platforms.

---

## 4. Limitations (intentional in v1)

- No lockfile or commit pinning is persisted (no `resolvedSha` field).
- No clone caching (each install may re-clone).
- No monorepo subdirectory support (package must live at repo root).
- Authentication behavior is delegated to `git` (credentials configured in the user’s environment).

