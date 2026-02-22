/**
 * Search Command (CLI layer)
 *
 * Thin shell over core/search/search-pipeline.ts.
 * Handles CLI arg parsing and delegates display to search-display.ts.
 */

import { Command } from 'commander';

import { CommandResult } from '@opkg/core/types/index.js';
import { createCliExecutionContext } from '../cli/context.js';
import { runSearchPipeline, type SearchOptions } from '@opkg/core/core/search/search-pipeline.js';
import { displayResults, displayJson } from './search-display.js';

async function searchCommand(
  query: string | undefined,
  options: SearchOptions,
  command: Command
): Promise<CommandResult> {
  const programOpts = command.parent?.opts() || {};
  const explicitSources = options.project || options.global || options.registry;

  const result = await runSearchPipeline({
    query,
    showProject: options.project || !explicitSources,
    showGlobal: options.global || !explicitSources,
    showRegistry: options.registry || !explicitSources,
    createContext: (opts) => createCliExecutionContext({ global: opts.global, cwd: opts.cwd }),
    cwd: programOpts.cwd,
  });

  if (options.json) {
    displayJson(result);
  } else {
    displayResults(result, options.all || false);
  }

  return { success: true };
}

export async function setupSearchCommand(args: any[]): Promise<void> {
  const [query, options, command] = args as [string | undefined, SearchOptions, Command];
  await searchCommand(query, options, command);
}
