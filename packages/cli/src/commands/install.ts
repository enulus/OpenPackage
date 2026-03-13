/**
 * Install Command
 *
 * CLI definition only - all orchestration logic is in the orchestrator module.
 */
import { Command } from 'commander';
import type { InstallOptions } from '@opkg/core/types/index.js';
import { createOrchestrator } from '@opkg/core/core/install/orchestrator/index.js';
import { normalizeInstallOptions } from '@opkg/core/core/install/preprocessing/index.js';
import { createCliExecutionContext } from '../cli/context.js';
import { createTelemetryCollector } from '@opkg/core/core/telemetry.js';
import { createHttpClient } from '@opkg/core/core/http-client.js';
import { silentOutput } from '@opkg/core/core/ports/console-output.js';
import { printJson } from '../utils/json-output.js';

/**
 * Setup install command
 */
export async function setupInstallCommand(args: any[]): Promise<void> {
  const [packageName, options, command] = args as [
    string | undefined,
    InstallOptions & {
      agents?: string[];
      skills?: string[];
      rules?: string[];
      commands?: string[];
      conflicts?: string;
      interactive?: boolean;
      json?: boolean;
      namespace?: boolean | string;
    },
    Command
  ];

  // Validate mutually exclusive options
  if (options.interactive && (options.agents || options.skills || options.rules || options.commands)) {
    throw new Error('--interactive cannot be used with --agents, --skills, --rules, or --commands. Use --interactive for interactive selection or specify filters directly.');
  }

  // Get program-level options (for --cwd)
  const programOpts = command.parent?.opts() || {};

  // Create telemetry collector
  const telemetryCollector = await createTelemetryCollector('install');

  // Create execution context with CLI ports and telemetry
  const execContext = await createCliExecutionContext({
    global: options.global,
    cwd: programOpts.cwd,
    interactive: options.interactive,
    // --interactive is known-interactive; marketplace detection may upgrade
    // to rich later via commitOutputMode in the orchestrator.
    outputMode: options.interactive ? 'rich' : undefined,
  });

  // Suppress spinner/info output during --json execution
  if (options.json) {
    execContext.output = silentOutput;
  }

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

  // JSON output path
  if (options.json) {
    printJson({
      success: result.success,
      data: result.data ?? null,
      ...(result.error ? { error: result.error } : {}),
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
    });
    if (!result.success) {
      process.exitCode = 1;
    }
    return;
  }

  // Handle result
  if (!result.success) {
    if (result.error === 'Package not found') {
      return; // Already displayed message
    }
    if (result.error?.endsWith('failed to install')) {
      process.exitCode = 1;
      return; // Already displayed detailed failure info
    }
    throw new Error(result.error || 'Installation operation failed');
  }
}
