
<p align="center">
  <a href="https://github.com/enulus/OpenPackage">
    <picture>
      <source srcset="assets/openpackage_ascii_dark.png" media="(prefers-color-scheme: dark)">
      <source srcset="assets/openpackage_ascii_light.png" media="(prefers-color-scheme: light)">
      <img src="assets/openpackage_ascii_light.png" alt="OpenPackage logo" height="64">
    </picture>
  </a>
</p>

<p align="center">Universal plugins for coding agents.</p>
<p align="center">
<a href="https://www.npmjs.com/package/opkg " target="blank">
  <img src="https://img.shields.io/npm/v/opkg?style=flat-square" alt="Npm package for OpenPackage">
</a>
<a href="./LICENSE">
  <img alt="License: Apache-2.0" src="https://img.shields.io/github/license/enulus/openpackage?style=flat-square" />
</a>
<a href="https://discord.gg/W5H54HZ8Fm" target="blank">
  <img src="https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white&style=flat-square" alt="OpenPackage Discord">
</a>
<br /><br />
</p>

<p align="center">
  Follow <a href="https://x.com/hyericlee">@hyericlee on X</a> for updates · Join the <a href="https://discord.gg/W5H54HZ8Fm">OpenPackage Discord</a> for help and questions.
</p>

# OpenPackage

OpenPackage turns your AI coding setups into reusable modules, allowing instant installs to any platform for consistent workflows across projects and teams. **No API keys. No MCP.** 

## Why OpenPackage?

Modern AI coding tools are powerful, but lack organization, reusability, and efficiency.
- Rules, commands, subagents, and skills scattered across multiple projects.
- Familiar workflows rebuilt for each project, incompatible between AI coding platforms.
- Specs across individuals and codebases, diverging, unversioned, and incohesive.

OpenPackage manages the complexity of cross-platform conversions, composition, and portability of configs, so you can build faster.

- Install & sync pre-built workflows to speed up coding. No more reinventing the wheel.
- Reuse rules, slash commands, and skills across multiple codebases and platforms.
- Share and compose packages together to create powerful workflows that continuously evolve.

## How it works

At its core, OpenPackage is a lightweight CLI tool for creating versioned, AI coding platform agnostic packages, each contaning sets of specs and coding config files for simplified installs, uninstalls, and distribution. It's basically Claude Code Plugins, but universal, more powerful, and open source.

1. Declare a package
2. Add rules, commands, subagents, skills, mcp configs, specs, docs etc.
3. Install and sync to multiple codebases

## Use cases

- Install Claude Code Plugins to any coding platform
- Reuse files and configs across multiple codebases
- Sync configs across multiple platforms
- Modular management of specs, rules, commands, agents, skills, and MCPs

## Quick start

### Install

npm
```bash
npm install -g opkg 
```

### Compose a package

```bash title="Terminal"
opkg new <package>
```

Then manually add/update/remove files to and from the package following this structure:

```txt title="Structure"
<package>
│   
│   # Package files
├── openpackage.yml       # The OpenPackage manifest, required
├── README.md             # LICENSE.md, CONTRIBUTING.md, etc.
│   
│   # Content files
├── rules/                # Rule files
├── commands/             # Command files (slash commands)
├── agents/               # Agent files (subagents)
├── skills/               # Skill files (skills)
├── root/                 # Any other root dirs or files (Ex: specs/, docs/, tests/, etc.)
├── AGENTS.md             # Platform root file
├── mcp.jsonc             # MCP config file
│   
│   # Custom files
└── <other>               # Customizable via `platforms.jsonc` overrides/extensions
```

You can also use the `add` and `remove` commands to add/remove files to/from a package.

```bash title="Terminal"
opkg add <package> .cursor/commands/clean.md    # Adds workspace file or dir to package
opkg remove <package> commands/clean.md         # Removes file or dir from package
```  

> [!TIP]  
> Learn more about packages from the [packages doc](https://openpackage.dev/docs/packages) on our official docs.

### Install packages
```bash title="Terminal"
opkg install <package>
```  
Installs all files from a package into the codebase at cwd, formatted and converted to per platform conventions and into their respective dirs.

The install command supports various package sources:
```bash title="Terminal"
opkg install essentials               # Local/remote registry
opkg install ../packages/essentials/  # Local path
opkg install github:https://github.com/enulus/awesome-openpackage.git   # GitHub package repo
opkg install github:https://github.com/anthropics/claude-code.git       # GitHub Claude Code Plugins marketplace
```  


### Uninstall packages
```bash title="Terminal"
opkg uninstall <package>
```  
Removes all files for a package from the codebase at cwd.

> [!TIP]  
> Learn more by heading over to the [official docs](https://openpackage.dev/docs).

## Supported Platforms

OpenPackage performs installation and platform sync of files for supported AI coding platforms outlined by the table below.  

| Platform | Directory | Root file | Rules | Commands | Agents | Skills | MCP |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Antigravity | .agent/ | | rules/ | workflows/ |  | | |
| Augment Code | .augment/ | | rules/ | commands/ |  | | |
| Claude Code | .claude/ | CLAUDE.md | | commands/ | agents/ | skills/ | .mcp.json |
| Codex | .codex/ | AGENTS.md | | prompts/ | | | |
| Cursor | .cursor/ | AGENTS.md | rules/ | commands/ | | | mcp.json |
| Factory | .factory/ | AGENTS.md | | commands/ | droids/ | | |
| Kilo Code | .kilocode/ | AGENTS.md | rules/ | workflows/ | |  | |
| Kiro | .kiro/ | | steering/ |  | | | |
| OpenCode | .opencode/ | AGENTS.md | | command/ | agent/ | skills/ | opencode.json |
| Qwen Code | .qwen/ | QWEN.md | | | agents/ | | |
| Roo | .roo/ | AGENTS.md | | commands/ | | | |
| Warp | .warp/ | WARP.md | | | | |
| Windsurf | .windsurf/ | | rules/ |  | | | |

The built-in `platforms.jsonc` defines supported platforms, but can be overridden by user configs:
- Global: `~/.openpackage/platforms.jsonc` (`.json`)
- Workspace: `<cwd>/.openpackage/platforms.jsonc` (`.json`)

Deep-merged (local > global > built-in) for per-project customization.

## Contributing

We would love your help building the future of package management for agentic coding.  

Feel free to create [PRs](https://github.com/enulus/OpenPackage/pulls) and [Github issues](https://github.com/enulus/OpenPackage/issues) for:
- Bugs
- Feature requests
- Support for new platforms
- Missing standard behavior
- Documentation

## Links

- [Official Website and Registry](https://openpackage.dev)
- [Documentation](https://openpackage.dev/docs)
- [Discord](https://discord.gg/W5H54HZ8Fm)
- [Creator X (Twitter)](https://x.com/hyericlee)
