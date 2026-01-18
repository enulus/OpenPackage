import { Command } from 'commander';

import { CommandResult } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { runStatusPipeline, type StatusPackageReport } from '../core/status/status-pipeline.js';
import { logger } from '../utils/logger.js';

function printPackageLine(pkg: StatusPackageReport): void {
  const icon = pkg.state === 'synced' ? '✓' : pkg.state === 'missing' ? '✗' : '~';
  const version = pkg.version ? `@${pkg.version}` : '';
  const suffix = pkg.state === 'partial' 
    ? `  (${pkg.existingFiles}/${pkg.totalFiles} files)`
    : '';
  console.log(`${icon} ${pkg.name}${version}  ${pkg.state}  ${pkg.path}${suffix}`);
}

async function statusCommand(): Promise<CommandResult> {
  const cwd = process.cwd();
  logger.info(`Checking package status for directory: ${cwd}`);

  try {
    const result = await runStatusPipeline();
    const packages = result.data?.packages ?? [];

    console.log(`✓ Package status for: ${cwd}`);
    
    if (packages.length === 0) {
      console.log('(no packages in index)');
      return { success: true, data: { packages: [] } };
    }

    for (const pkg of packages) {
      printPackageLine(pkg);
    }

    const synced = packages.filter(p => p.state === 'synced').length;
    const partial = packages.filter(p => p.state === 'partial').length;
    const missing = packages.filter(p => p.state === 'missing').length;

    // Build summary message
    const parts: string[] = [];
    if (synced > 0) parts.push(`${synced} synced`);
    if (partial > 0) parts.push(`${partial} partial`);
    if (missing > 0) parts.push(`${missing} missing`);
    
    console.log(`Summary: ${parts.join(', ')} (${packages.length} total)`);

    return { success: true, data: { packages } };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw error;
  }
}

export function setupStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show package installation status')
    .action(withErrorHandling(async () => {
      await statusCommand();
    }));
}
