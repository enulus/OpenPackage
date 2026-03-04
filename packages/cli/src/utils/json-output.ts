/**
 * Shared JSON output utility for CLI commands.
 * Single source of truth for all --json output across every command.
 */

/**
 * Print data as formatted JSON to stdout.
 * Uses 2-space indent for readability.
 */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}
