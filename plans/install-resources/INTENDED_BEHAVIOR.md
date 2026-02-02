Here's the ideal algorithm in my mind for the install command resource installation.

# Install command resource-spec arg (first arg)

The install arg can be of the folllowing types:
- URL that supports github
- Resource name, with or without `@` symbol
- filepath
(Should be resolved in this order)

# Resources definition

Resources are essentially files specified under a "base", and the installation detects/filters what to install using `platforms.jsonc`

For each install, we must define a "base", the parent of a resource, to know which part to actually install to per platform dirs defined and outlined in `platforms.jsonc`. The "bases" are detected using the following algorithm:
- Existence of a `openpackage.yml`, if at root of the resource name/path, then that is the "base"
- Existence of a `.claude-plugin/marketplace.json` at root of the resource name/path, then we trigger claude plugin selection flow for user to select the "base"
- Existence of a `.claude-plugin/plugin.json`, if at root of the resource name/path, then that is the "base"
- Any of the segments matching any of the "from" flows defined in platforms.jsonc, using **deepest match resolution** (see below).
- Priority in that order

## Deepest Match Resolution

When multiple "from" patterns could match a path, select the pattern whose match begins at the **deepest segment** (furthest from root). This maximizes the "base" portion and minimizes the destination path structure.

For example, given path `/skills/git/agents/manager.md`:
- `skills/**/*` matches starting at segment index 0 (4 segments matched)
- `agents/**/*.md` matches starting at segment index 2 (2 segments matched)
- **Deepest match wins**: `agents/**/*.md` because it starts at index 2, making base = `/skills/git/`

So for example, a "from" flow has "skills/**/*", it finds the deepest matching segment and that becomes the resource, and the parent becomes the "base".

For example: `gh@wshobson/agents/plugins/javascript-typescript/agents/typescript-pro.md`
- Matches `agents/**/*.md` and thus `/plugins/javascript-typescript/` is the "base", will install to per platform dirs as `.cursor/agents/typescript-pro.md`, etc.

For example: `gh@wshobson/agents/plugins/ui-design/agents/`
- Matches `agents/**/*.md` and thus `/plugins/ui-design/` is the "base", will install each file in this base that matches `agents/**/*.md` to per platform dirs as `.cursor/agents/ios-design.md`, `.cursor/agents/android-design.md`, `.opencode/agents/ios-design.md`, `.opencode/agents/android-design.md` etc.

For example: `gh@wshobson/agents/skills/git/agents/manager.md`
- Matches `skills/**/*` AND `agents/**/*.md`, which is ambiguous as base could be `/` or `/skills/git/`
- In this case, during installation, must prompt user to select which is the "base", and we would need to record a (new) `base` field for that dependency entry in workspace `.openpackage/openpackage.yml` manifest file
- If force or non-interactive option specified, then we respect the base field specified in manifest, if no manifest or no base specified, then default to **deepest match** (the pattern that starts furthest from root, resulting in the most specific base)

If any of the specified dirs is empty, we still record this path in the workspace `.openpackage/openpackage.yml` manifest, and show succeeded with 0 installs (this means user is simply specifying a dependency, dir content could be populated later).

# Resource names

For names, first two segments of a resource name always points to some repo:
- If prefixed with gh it's a github repo and is in format `gh@user/repo`
- If not prefixed then it's a local repo OR a remote repo from openpackage.dev

The remaining segments will point to a specific filepath, can be dir or file, and this is the resource it's pointing to.

For example: `gh@wshobson/agents/plugins/javascript-typescript/agents/typescript-pro.md`
- `wshobson/agents` is the repo
- `/plugins/javascript-typescript/agents/typescript-pro.md` is the path

# Resource URLs

For urls:
- Parse github url for username, repo, and filepath
- Same as above case for resource names, we simply parse for the repo and then the file segment

For example: `https://github.com/enulus/OpenPackage/blob/main/schemas/platforms-v1.json`
- `enulus/OpenPackage` is the repo
- `/schemas/platforms-v1.json` is the path

# Resource filepaths

For filepaths (absolute or relative):
1. Resolve to absolute path
2. Verify path exists → error if path not found
3. Apply the same base detection algorithm as remote resources:
   - Check for `openpackage.yml` at resource path root
   - Check for `.claude-plugin/marketplace.json` at resource path root
   - Check for `.claude-plugin/plugin.json` at resource path root
   - Match against "from" patterns in platforms.jsonc (deepest match resolution)
4. If no pattern matches and no manifest found → error (path does not match any installable pattern)
5. Install using the detected base, same as remote resources

No special treatment for paths inside the current workspace - user explicitly specified the path, so proceed with installation.

For example: `/Users/me/projects/my-agents/agents/typescript-pro.md`
- Pattern `agents/**/*.md` matches at segment `agents/typescript-pro.md`
- Base = `/Users/me/projects/my-agents/`
- Installs to `.cursor/agents/typescript-pro.md`

For example: `/Users/me/skills/git-tools/SKILL.md`
- Pattern `skills/**/*` matches at segment `skills/git-tools/SKILL.md`
- Base = `/Users/me/`
- Installs full `/Users/me/skills/git-tools/` directory to `.cursor/skills/git-tools/`

For example: `/Users/me/random/foo.txt`
- No pattern matches → Error: path does not match any installable pattern

# Install options

As for options `--plugins`, `--agents`, and `--skills`, these are "convenience options", where we try to find resources under a resource arg as the root for matching the conditions below to install, and could install multiple resources if multiple specified, failures should be noted (not found, etc.) and installation skipped, install ones that are valid. 
- The `--plugins` option check existence of root `.claude-plugin/marketplace.json` at path specified in resource-spec, the plugin location will be defined in `.claude-plugin/marketplace.json`. If no agents or skills options specified while plugins is specified, then install all specified plugins. If agents and/or skills specified and plugins is specified, then filter in those plugins (only install agents/skills that are inside the specified plugins). If an agent/skill name matches something OUTSIDE the specified plugins, then error (since we're scoping within these specified plugins)
- The `--agents` is a convenience matcher for the `agents/**/*.md` "from" field in `platforms.jsonc`, at root, with each agent name matching frontmatter "name" field, fallback to the `.md` file name (deepest match if multiple).
- The `--skills` is a convenience matcher for the `skills/**/*` "from" field in `platforms.jsonc`, at root, with each skill name matching frontmatter of a nested `SKILL.md` file that has frontmatter "name" field (this means to install ALL content in parent dir, including the SKILL.md file), fallback to matching dirname (installs ALL content in this dir) (deepest match if multiple). `SKILL.md` must exist, this file name is case sensitive.

For example: `opkg i gh@wshobson/agents --plugins javascript-typescript --agents typescript-pro`
- Existing repo `wshobson/agents` with `.claude-plugin/marketplace.json` specifying plugin name javasecipt-typescript pointing to path `/plugins/javascript-typescript`, contains `/agents/typecript-pro.md`
- Attempts to find `.claude-plugin/marketplace.json` at root of `wshobson/agents` repo, then matches the plugins dir, that dir becomes the "base", then looks for matching `agents/**/*.md` as specified above, then we install that file. In the end only the `typescript-pro.md` (has name: typescript-pro in frontmatter) file is installed.

For example: `opkg i @hyericlee/essentials --agents designer`
- Existing repo `hyericlee/essentials` with `/agents/designer.md`
- Attempts to match `agents/**/*.md` as specified above, with deepest match resolution, and in the end the full `/agents/designer.md` contents is installed to `.cursor/agents/designer.md`, `.opencode/agents/designer.md`. etc.

For example: `opkg i gh@vercel-labs/skills --skills ios-design`
- Existing repo `vercel-labs/skills` with `/skills/ios-design/SKILL.md`
- Attempts to match `skills/**/*` as specified above, with deepest match resolution, and in the end the full `/skills/ios-design/` contents is installed to `.cursor/skills/ios-design`, `.opencode/skills/ios-design`. etc.

For example: `opkg i gh@vercel-labs/skills --skills android-design`
- Existing repo `vercel-labs/skills` with `/skills/design/android-design/SKILL.md`
- Attempts to match `skills/**/*` as specified above, with deepest match resolution, and in the end the full `/skills/design/android-design/` contents is installed to `.cursor/skills/design/android-design`, `.opencode/skills/design/android-design`. etc.

Impportant: Convenience options could be expanded in the future, to support matching `--commands`, `--rules`, etc. so be sure the logic must be robust, modular, and logically sound.

# Resource versioning

Only allow specifying versions at the root repo level, if not specified default to unversioned, in case of GitHub repo it's the default branch.

# File installations

All installs should resolve to the "base", then follow filtering via `platforms.jsonc` and futher filtering via the specific path (dir or file), then the convenience options.