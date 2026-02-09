/**
 * Install Command
 * 
 * CLI definition only - all orchestration logic is in the orchestrator module.
 */
import { Command } from 'commander';
import type { CommandResult, InstallOptions } from '../types/index.js';
import { withErrorHandling } from '../utils/errors.js';
import { createOrchestrator } from '../core/install/orchestrator/index.js';
import { normalizeInstallOptions } from '../core/install/preprocessing/index.js';
import { createExecutionContext } from '../core/execution-context.js';
import { createTelemetryCollector } from '../utils/telemetry.js';
import { createHttpClient } from '../utils/http-client.js';

/**
 * Setup install command
 */
export function setupInstallCommand(program: Command): void {
  program
    .command('install')
    .alias('i')
    .description('Install packages to workspace')
    .argument(
      '[resource-spec]',
      'resource to install (package[@version], gh@owner/repo, https://github.com/owner/repo, /path/to/local, or git@host:repo.git)'
    )
    .option('-g, --global', 'install to home directory (~/) instead of current workspace')
    .option('-a, --agents <names...>', 'install specific agents by name (matches frontmatter name or filename)')
    .option('-s, --skills <names...>', 'install specific skills by name (matches SKILL.md frontmatter name or directory name)')
    .option('-r, --rules <names...>', 'install specific rules by name (matches frontmatter name or filename)')
    .option('-c, --commands <names...>', 'install specific commands by name (matches frontmatter name or filename)')
    .option('--plugins <names...>', 'install specific plugins from marketplace (bypasses interactive selection)')
    .option('--platforms <platforms...>', 'install to specific platforms (e.g., cursor claudecode opencode)')
    .option('--dry-run', 'preview changes without applying them')
    .option('--force', 'overwrite existing files')
    .option('--conflicts <strategy>', 'conflict handling strategy: keep-both, overwrite, skip, or ask')
    .option('--dev', 'add resource to dev-dependencies (instead of dependencies)')
    .option('--remote', 'pull and install from remote registry, ignoring local versions')
    .option('--local', 'resolve and install using only local registry versions, skipping remote metadata and pulls')
    .option('--profile <profile>', 'profile to use for authentication')
    .option('--api-key <key>', 'API key for authentication (overrides profile)')
    .option('--list', 'interactively select resources to install (agents, skills, commands, etc.)')
    .action(withErrorHandling(async (
      packageName: string | undefined, 
      options: InstallOptions & { 
        agents?: string[]; 
        skills?: string[];
        rules?: string[];
        commands?: string[];
        conflicts?: string;
        list?: boolean;
      },
      command: Command
    ) => {
      // Validate mutually exclusive options
      if (options.list && (options.agents || options.skills || options.rules || options.commands)) {
        throw new Error('--list cannot be used with --agents, --skills, --rules, or --commands. Use --list for interactive selection or specify filters directly.');
      }
      
      // Get program-level options (for --cwd)
      const programOpts = command.parent?.opts() || {};
      
      // Create telemetry collector
      const telemetryCollector = await createTelemetryCollector('install');
      
      // Create execution context with telemetry
      const execContext = await createExecutionContext({
        global: options.global,
        cwd: programOpts.cwd
      });
      
      // Add telemetry collector to context
      if (telemetryCollector) {
        execContext.telemetryCollector = telemetryCollector;
      }
      
      // Normalize all options at CLI boundary
      const normalizedOptions = normalizeInstallOptions(options);
      
      // Create and execute orchestrator with execution context
      const orchestrator = createOrchestrator();
      const result = await orchestrator.execute(packageName, normalizedOptions, execContext);
      
      // Flush telemetry (truly fire-and-forget, non-blocking)
      if (telemetryCollector && result.success) {
        // Run in background without blocking command completion
        setImmediate(() => {
          createHttpClient({
            apiKey: options.apiKey,
            profile: options.profile
          })
            .then(httpClient => telemetryCollector.flush(httpClient))
            .catch(() => {
              // Silent failure - already logged in telemetry module
            });
        });
      }
      
      // Handle result
      if (!result.success) {
        if (result.error === 'Package not found') {
          return; // Already displayed message
        }
        throw new Error(result.error || 'Installation operation failed');
      }
    }));
}
