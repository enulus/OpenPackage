### OpenPackage CLI Specs

This directory contains the **canonical** implementation-guiding specifications for the OpenPackage CLI.

The codebase currently reflects the **v0.7.0 architecture** (path-based source of truth, mutable vs immutable sources, unified workspace index, directory-based local registry), but the specs are organized by **topic** rather than by version.

---

#### Where to look

- **Package structure & payload rules**: `specs/package/`
  - Payload boundary + registry copy rules: `specs/package/registry-payload-and-copy.md`
  - Universal vs root-level content + mapping terminology: `specs/package/universal-content.md`
  - Index file schema: `specs/package/package-index-yml.md`
  - Root layout expectations: `specs/package/package-root-layout.md`
- **Install**: `specs/install/`
  - CLI UX + scenarios (including partial installs via registry paths and `files:`): `specs/install/install-behavior.md`
  - Git installs: `specs/install/git-sources.md`
- **Apply/sync**: `specs/apply/`
- **Save**: `specs/save/`
- **Push**: `specs/push/`
- **Auth**: `specs/auth/`
- **Platforms**: `specs/platforms.md`
- **Global CLI flags**: `specs/cli-options.md`

---

#### Note on the former `specs/0.7.0/` directory

The prior versioned folder `specs/0.7.0/` was an architectural bundle used during rollout. Its contents were consolidated into the topic-based specs above and the directory was removed to avoid stale/duplicated docs.

