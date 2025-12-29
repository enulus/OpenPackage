### Nested Packages and Parent Packages

#### Workspace Structure with Nested Packages

```text
<workspace-root>/                              # root package (package root = cwd/)
  openpackage.yml                              # root package manifest (payload)
  commands/                                    # root package universal content (payload)
    shared-command.md
  rules/
    shared-rule.md
  AGENTS.md                                    # root package root file (payload)
  root/                                        # direct copy: copied 1:1 to workspace root (payload)
    tools/
      helper.sh                                # → installs to <workspace>/tools/helper.sh
  docs/                                        # other root-level content (NOT installed)
    README.md
  .openpackage/                                # workspace-local metadata (not payload)
    openpackage.yml                            # workspace manifest (dependency intent)
    openpackage.index.yml                      # workspace index (never in registry payload)
    packages/                                  # nested packages directory
      alpha/                                   # nested package (package root = .openpackage/packages/alpha/)
        openpackage.yml                        # cached payload mirror
        commands/
          alpha-command.md
        root/                                  # direct copy for nested package
          scripts/
            setup.sh                           # → installs to <workspace>/scripts/setup.sh
        docs/                                  # NOT installed
          notes.md
      beta/                                    # nested package (package root = .openpackage/packages/beta/)
        openpackage.yml                        # cached payload mirror
        rules/
          beta-rule.md
```

---

#### Key Rules

- Each `.openpackage/packages/<name>/` directory is its **own canonical package root**, with:
  - Its own `openpackage.yml` at the package root (marks it as a package)
  - Its own universal subdirs at the package root (e.g., `commands/`, `rules/`)
  - Its own root-level content (root files, `root/` directory, etc.)

- The **parent root package never inlines** `.openpackage/packages/<name>/` into its own payload.

- Registry entries for `alpha` and `beta` are created **independently** from their respective package roots.

- **Only the workspace root package** can have a `.openpackage/packages/` directory. Nested packages cannot have further nested packages.

---

#### Package Root Locations

| Package Type | Package Root Path |
|--------------|-------------------|
| Workspace root | `cwd/` |
| Nested `alpha` | `cwd/.openpackage/packages/alpha/` |
| Nested `beta` | `cwd/.openpackage/packages/beta/` |

---

#### Identical Internal Structure

Both root and nested packages have **identical internal structure**:

```text
<package-root>/
  openpackage.yml
  <universal-subdirs>/
  <root-level-content>/
  <root-files>
```

This uniformity ensures packages can be:
- Moved between workspace root and nested locations
- Copied to/from registry without structural changes
- Processed by the same code paths regardless of location

