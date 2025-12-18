# OpenPackage

<a href="https://www.npmjs.com/package/opkg " target="blank">
  <img src="https://img.shields.io/npm/v/opkg?style=flat-square" alt="Npm package for OpenPackage">
</a>
<a href="https://discord.gg/W5H54HZ8Fm"  target="blank">
  <img src="https://img.shields.io/badge/Discord-%235865F2.svg?&logo=discord&logoColor=white&style=flat-square" alt="OpenPackage Discord">
</a>
<br /><br />

OpenPackage is the package manager for AI coding.

Save and sync rules, slash commands, agents, and more.  
Build reusable packages for use across multiple projects and AI coding platforms.

Learn more in the official docs: [openpackage.dev/docs](https://openpackage.dev/docs).

Looking to discover, download, or publish packages?  
Check out the official OpenPackage registry: [openpackage.dev/packages](https://openpackage.dev/packages). 

> [!NOTE]  
> For latest news and updates, follow the creator's X (Twitter) account
> [@hyericlee](https://x.com/hyericlee)

## Installation

npm
```bash
npm install -g opkg 
```
## Use Cases

### Reuse files across multiple codebases
Reuse rules, slash commands, and more across multiple codebases.

#### Single file
```bash title="Terminal"
# In current codebase
opkg save f specs/nextjs.md
# In another codebase
opkg install f/specs/nextjs.md
```  

#### Multiple files via package
```bash title="Terminal"
# In current codebase
opkg save essentials
# In another codebase
opkg install essentials
```  

> [!NOTE]  
> You can also use command `openpackage` instead of `opkg`

### Sync files across multiple platforms
Automatically sync your rules, slash commands, and more across multiple platform.
```bash title="Terminal"
# Current codebase has .cursor, .claude, .opencode directories
opkg save essentials .cursor/commands/essentials
# OpenPackage CLI automatically generates/syncs the same command files across all platforms.

# Before save:
# .cursor/commands/essentials/cleanup.md

# After save:
# .cursor/commands/essentials/cleanup.md
# .claude/commands/essentials/cleanup.md
# .opencode/command/essentials/cleanup.md
```  

### Modular management of files
Create domain specific packages for modular reuse.
```bash title="Terminal"
# Create typescript package
opkg save typescript .cursor/rules/typescript

# Create scalable-nextjs package
opkg save scalable-nextjs .cursor/rules/nextjs

# Create scalable-nestjs package
opkg save scalable-nestjs .cursor/rules/nestjs

# Create mongodb package
opkg save mongodb .cursor/rules/mongodb

# In your NextJS codebase
opkg install typescript
opkg install scalable-nextjs

# In your NestJS codebase
opkg install typescript
opkg install scalable-nestjs
opkg install mongodb
```  

## Usage

> [!TIP]  
> We highly recommend reading [the packages doc](https://openpackage.dev/docs/packages) to understand how packages work.

### Save a file

```bash title="Terminal"
opkg save <package> <path-to-dir-or-file>
```  
Adds the file to the specified package and saves to local registry for reuse and sharing.

### Create a package

#### In a project/workspace 

```bash title="Terminal"
opkg init <package>
```  
Initializes a package at `.openpackage/packages/<package>/` and generates the package's `package.yml` manifest file. This method is ideal for creating/managing multiple packages within existing projects. 
```bash title="Terminal"
opkg add <package> <path-to-dir-or-file>
```  
Use the `add` command to add files from the workspace to a package. You can also directly create/update the package files in `.openpackage/packages/<package>/` (see Package Structure below for details).


#### In a dedicated codebase for the package
```bash title="Terminal"
opkg init
```  
Initializes a package at cwd and generates the package's `package.yml` manifest file. Use this to dedicate the codebase to the package itself (see Package Structure below for details on structuring a package).


### Save a package
```bash title="Terminal"
opkg save [package]
```  
Save the set of dirs and files as a package for reuse and cross-platform sync (prerelease).  
Also performs sync of universal subdir content across detected AI coding platform dirs.

### Finalize/pack a package
```bash title="Terminal"
opkg pack [package]
```  
Save the package as a stable non-prerelease version ready for push (upload).

### List packages
```bash title="Terminal"
opkg list
```  
Use the list command to show all packages currently saved to the local registry.  

### Show package details
```bash title="Terminal"
opkg show <package>
```  
The show command outputs the details of the package and lists all included files.

### Install a package
```bash title="Terminal"
opkg install <package>
```  
Use the install command to add all files under the specified package to the codebase at cwd.

### Uninstall a package
```bash title="Terminal"
opkg uninstall <package>
```  
Use the uninstall command to remove all files for the specified package from the codebase at cwd.

### Authenticate CLI
```bash title="Terminal"
opkg login
```  
Use the `login` command to authenticate the CLI for pushing packages to the [official OpenPackage registry](https://openpackage.dev).

### Push a package to remote
```bash title="Terminal"
opkg push <package>
```  
Use the `push` command to upload a package to the [official OpenPackage registry](https://openpackage.dev).

### Pull a package from remote
```bash title="Terminal"
opkg pull <package>
```  
Use the `pull` command to download a package from the [official OpenPackage registry](https://openpackage.dev) to the local registry.

> [!TIP]  
> Learn more by heading over to the [official docs](https://openpackage.dev/docs).

## Package Structure

Packages are composed using the following directory structure:

```txt title="Structure"
<package>
├── .openpackage/
│   ├── package.yml # The OpenPackage manifest, required
│   ├── rules/
│   │   └── # Rule files
│   ├── commands/
│   │   └── # Command files (slash commands)
│   ├── agents/
│   │   └── # Agent files (subagents)
│   └── skills/
│       └── # Skill files (Claude Code skills)
├── <dirs-or-files>
│   └── # Any other root dirs or files (Ex: specs/, docs/, tests/, etc.)
├── README.md # Metadata files (LICENSE.md, CONTRIBUTING.md, etc.)
└── AGENTS.md # Platform root file
```

There are two ways to compose packages:
- In a project workspace: `opkg init <package>` will create a package in `.openpackage/packages/<packages>/`
- In a dedicated package codebase: `opkg init` will create a package at cwd (similar to npm, pypi, etc.)

## Supported Platforms

OpenPackage performs installation and platform sync of files for supported AI coding platforms outlined by the table below.  

> [!NOTE]  
> OpenPackage searches and includes markdown files under supported platform directories as well as any other workspace directories.

| Platform | Directory | Root file | Rules | Commands | Agents | Skills |
| --- | --- | --- | --- | --- | --- | --- |
| Augment Code | .augment/ | | rules/ | commands/ | | |
| Claude Code | .claude/ | CLAUDE.md | | commands/ | agents/ | skills/ |
| Codex | .codex/ | AGENTS.md | | prompts/ | | |
| Cursor | .cursor/ | AGENTS.md | rules/ | commands/ | | |
| Factory | .factory/ | AGENTS.md | | commands/ | droids/ | |
| Kilo Code | .kilocode/ | AGENTS.md | rules/ | workflows/ | | |
| Kiro | .kiro/ | | steering/ | | | |
| OpenCode | .opencode/ | AGENTS.md | | command/ | agent/ | |
| Qwen Code | .qwen/ | QWEN.md | | | agents/ | |
| Roo | .roo/ | AGENTS.md | | commands/ | | |
| Warp | .warp/ | WARP.md | | | |
| Windsurf | .windsurf/ | | rules/ | | | |

The built-in `platforms.jsonc` defines supported platforms, but can be overridden by user configs:
- Global: `~/.openpackage/platforms.jsonc` (`.json`)
- Local: `<project>/.openpackage/platforms.jsonc` (`.json`)

Deep-merged (local > global > built-in) for per-project customization.

## Contributing

We would love your help building the future of package management for AI coding.  

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
