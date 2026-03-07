/**
 * Which Printers
 *
 * Output formatting for `opkg which` results.
 */

import type { WhichResult } from './which-pipeline.js';
import { formatPathForDisplay } from '../../utils/formatters.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

// ---------------------------------------------------------------------------
// ANSI helpers (reused from list-printers pattern)
// ---------------------------------------------------------------------------

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

// ---------------------------------------------------------------------------
// Printers
// ---------------------------------------------------------------------------

export function printWhichResults(
  query: string,
  results: WhichResult[],
  options: { files?: boolean },
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();

  if (results.length === 0) {
    out.info(`"${query}" not found in any installed package.`);
    out.info(dim('Hint: run `opkg ls` to see all installed resources.'));
    return;
  }

  for (let i = 0; i < results.length; i++) {
    printSingleResult(results[i], options, out);
  }
}

function printSingleResult(
  result: WhichResult,
  options: { files?: boolean },
  out: OutputPort
): void {
  const untrackedTag = result.kind === 'untracked' ? ' [untracked]' : '';
  const globalTag = result.scope === 'global' ? ` ${dim('[global]')}` : '';
  out.info(`${result.resourceName} ${dim(`(${result.resourceType})`)}${untrackedTag}${globalTag}`);

  if (result.kind === 'untracked') {
    out.info(`  ${dim('Not installed from any package')}`);
    return;
  }

  if (result.packageName) {
    const version = result.packageVersion ? `@${result.packageVersion}` : '';
    out.info(`  ${dim('Package:')}  ${result.packageName}${version}`);
  }

  if (result.packageSourcePath) {
    out.info(`  ${dim('Source:')}   ${formatPathForDisplay(result.packageSourcePath)}`);
  }

  if (options.files && result.targetFiles.length > 0) {
    out.info(`  ${dim('Files:')}`);
    for (const file of result.targetFiles) {
      out.info(`    ${formatPathForDisplay(file)}`);
    }
  }
}
