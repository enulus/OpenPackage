# Platform System Documentation

The **Platform System** is OpenPackage's declarative transformation engine that maps universal package content to platform-specific formats across 14+ AI coding platforms.

## 📚 Documentation Overview

### Getting Started

- **[Overview](./overview.md)** - High-level introduction to the platform system, key concepts, and architecture
- **[Examples](./examples.md)** - Common patterns, practical use cases, and complete working configurations

### Core Concepts

- **[Flows](./flows.md)** - Declarative bidirectional transformation system with explicit export (package → workspace) and import (workspace → package) flows
- **[Map Pipeline](./map-pipeline.md)** - MongoDB-inspired document transformations: 6 core operations, context variables, and pattern matching
- **[Universal Converter](./universal-converter.md)** - Cross-platform package conversion system using import flows for platform-to-universal conversion
- **[Configuration](./configuration.md)** - Structure of `platforms.jsonc`, merge hierarchy, and validation rules
- **[Flow Reference](./flow-reference.md)** - Complete technical reference for all flow fields, transforms, and options

### Implementation Details

- **[Detection](./detection.md)** - How platforms are detected in workspaces (rootDir, rootFile, aliases)
- **[Directory Layout](./directory-layout.md)** - File organization, root directories, subdirectories, and extensions
- **[Troubleshooting](./troubleshooting.md)** - Debug tips, validation, common errors, and performance optimization

### Technical Specification

- **[Specification](./specification.md)** - Formal requirements with SHALL/MUST contracts and scenario-based tests

## Quick Links

- **Quick Start:** See [Examples](./examples.md#quick-start) for zero-config installation
- **Flow Syntax:** See [Flow Reference](./flow-reference.md) for complete schema
- **Debugging:** See [Troubleshooting](./troubleshooting.md#debug-flow-execution)
- **Custom Platform:** See [Configuration](./configuration.md#adding-custom-platforms)

## Key Features

- ✅ **Declarative** - JSON configuration, not code
- ✅ **Bidirectional** - Explicit export (install/apply) and import (save) flows
- ✅ **Type-safe** - IDE autocomplete + schema validation
- ✅ **Powerful** - Simple file copies to complex transformations
- ✅ **Composable** - Multi-package content merging with priority
- ✅ **Format-agnostic** - JSON, YAML, TOML, JSONC, Markdown
- ✅ **Extensible** - Custom handlers for edge cases
- ✅ **Single file** - One configuration with merge hierarchy

## Supported Platforms

Built-in support for 14 platforms: Cursor, Claude, Windsurf, Gemini, Kilo, Cline, Roo-Code, Void, Aide, Zed, Codex, OpenCode, Pi-Mono, Factory.

Custom platforms can be added via configuration overrides.
