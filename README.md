
<p align="center">
  <a href="https://github.com/enulus/OpenPackage">
    <picture>
      <source srcset="assets/openpackage_ascii_dark.png" media="(prefers-color-scheme: dark)">
      <source srcset="assets/openpackage_ascii_light.png" media="(prefers-color-scheme: light)">
      <img src="assets/openpackage_ascii_light.png" alt="OpenPackage logo" height="64">
    </picture>
  </a>
</p>

<p align="center">The package manager for coding agent configs.</p>
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

OpenPackage enables simple, modular management of coding agent configs, providing unified installation, management, and packaging of rules, commands, agents, skills, and MCPs for any platform, any codebase.

## Why OpenPackage?

Modern AI coding tools are powerful and efficient when rules, commands, subagents, and skills are properly setup. Unfortunately, these files remain difficult to organize and manage.  

OpenPackage provides a centralized and universal interface for installing, uninstalling, and packaging coding agent config files for simplified management and distribution.

- **Simplified config management** - Install & uninstall rules, commands, agents, skills  and MCPs with a single command
- **Consistent dependencies** - Declare and package sets of config files for organization and reuse
- **Universal compatability** - Built in cross-platform conversions and install target resolutions
- **Community driven** - Compose packages together to create powerful workflows that continuously evolve

## Use cases

- Install Agents, Skills, and Claude Plugins to any coding platform
- Sync rules, commands, agents, skills, and MCPs across platforms
- Reuse files and configs across multiple codebases
- Simplified, modular management and install/uninstall of configs and specs

## How it works

At its core, OpenPackage is a lightweight CLI package manager that performs installs and uninstalls of config files, with the ability to keep track of file sources and dependencies, plus packaging capabilities.

It's basically a much more powerful, universal, and open source version of Vercel Skills and Claude Code Plugins.

## Install OpenPackage

npm
```bash
npm install -g opkg 
```

## Quick start

### Install resources

```bash title="Terminal"
opkg install <resource>
```  
Installs all files from a specified resource into the codebase at cwd, formatted and converted to per platform conventions and into their respective dirs.

#### Install resources (packages, plugins, rules, commands, agents, and skills)

```bash title="Terminal"
# OpenPackage local or remote packages
opkg install <package-name>

# Github repos
opkg install gh@<owner>/<repo>

# GitHub URLs
opkg install https://github.com/<owner>/<repo>/<path-to-resource>

# Local path to package or Claude Plugin
opkg install <path-to-dir>

# Git URLs
opkg install git@<host>:<repo>.git

# Examples
opkg install essentials
opkg install gh@anthropics/claude-code --plugins code-review
opkg install gh@wshobson/agents --plugins ui-design --agents ui-designer
opkg install gh@wshobson/agents/plugins/ui-design/agents/ui-designer
opkg install gh@vercel-labs/agent-skills --skills react-best-practices
opkg install https://github.com/anthropics/claude-code/tree/main/plugins/code-review
opkg install https://github.com/wshobson/agents/tree/main/plugins/ui-design/ui-designer.md
opkg install https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices
```  

#### Options

| Option | Description |
| --- | --- |
| `-g, --global`               | Install to user directory instead of project |
| `-a, --agents <agents...>`   | Install specific agents by name |
| `-s, --skills <skills...>`   | Install specific skills by name |
| `--plugins <plugins...>`     | Install specific plugins by name |
| `--platforms`                | Install to only specified platforms |
| `--remote`                   | Install from remote source / skip cache |

### List installed resources
```bash title="Terminal"
opkg list             # Lists resources installed to workspace at cwd
opkg list <package>   # Lists installed files for specified resource
```  
Use the list command to show an overview of packages and files installed.

#### Options

| Option | Description |
| --- | --- |
| `-p, --project`              | Lists only project scoped packages & resource file count |
| `-g, --global`               | Lists only user scoped packages & resource file count |
| `-a, --all`                  | Lists all packages recursively (includes nested) |
| `-f, --files`                | Lists all resource files |
| `-t, --tracked`              | Lists all packages & resources tracked by OpenPackage |
| `-u, --untracked`            | Lists all resources not tracked by OpenPackage |
| `--platforms`                | Lists packages & files from specified platforms |

### Uninstall packages
```bash title="Terminal"
opkg uninstall <package>
```  
Removes all files for a package from the codebase at cwd.

#### Options

| Option | Description |
| --- | --- |
| `-g, --global`               | Uninstall from user directory |

> [!TIP]  
> Learn more by heading over to the [official docs](https://openpackage.dev/docs).

### Compose packages

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
opkg add .cursor/commands/clean.md --to <package>    # Adds workspace file or dir to package
opkg remove commands/clean.md --from <package>       # Removes file or dir from package
```  

> [!TIP]  
> Learn more about packages from the [packages doc](https://openpackage.dev/docs/packages) on our official docs.

## Supported Platforms & Files

OpenPackage performs installation and platform sync of files for supported AI coding platforms outlined by the table below.  

| Platform | Directory | Root file | Rules | Commands | Agents | Skills | MCP |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Antigravity | .agent/ | | rules/ | workflows/ | | skills/ | |
| Augment Code | .augment/ | | rules/ | commands/ | | | |
| Claude Code | .claude/ | CLAUDE.md | rules/ | commands/ | agents/ | skills/ | .mcp.json (root) |
| Codex | .codex/ | AGENTS.md | | prompts/ | | skills/ | config.toml |
| Cursor | .cursor/ | AGENTS.md | rules/ | commands/ | agents/ | skills/ | mcp.json |
| Factory | .factory/ | AGENTS.md | | commands/ | droids/ | skills/ | mcp.json |
| Kilo Code | .kilocode/ | AGENTS.md | rules/ | workflows/ | | skills/ | mcp.json |
| Kiro | .kiro/ | | steering/ | | | | settings/mcp.json |
| OpenCode | .opencode/ | AGENTS.md | | command/ | agent/ | skills/ | opencode.json |
| Pi-Mono | .pi/ | AGENTS.md | | agent/prompts/ | | agent/skills/ | |
| Qwen Code | .qwen/ | QWEN.md | | | agents/ | skills/ | settings.json |
| Roo | .roo/ | AGENTS.md | | commands/ | | skills/ | mcp.json |
| Warp | .warp/ | WARP.md | | | | |
| Windsurf | .windsurf/ | | rules/ | | | skills/ | |

The built-in `platforms.jsonc` defines supported platforms, but can be overridden by user configs:
- Global: `~/.openpackage/platforms.jsonc` (`.json`)
- Workspace: `<cwd>/.openpackage/platforms.jsonc` (`.json`)

Deep-merged (local > global > built-in) for per-project customization.

## Contributing

We would love your help building a more open source and universally compatible agentic coding ecosystem.  

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
