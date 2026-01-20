import { Command } from 'commander';
import type { CommandResult, InstallOptions } from '../types/index.js';
import type { InstallationContext } from '../core/install/unified/context.js';
import { withErrorHandling } from '../utils/errors.js';
import { normalizePlatforms } from '../utils/platform-mapper.js';
import { buildApplyContext } from '../core/install/unified/context-builders.js';
import { runUnifiedInstallPipeline } from '../core/install/unified/pipeline.js';

/**
 * Main apply command handler
 */
async function applyCommand(
  packageName: string | undefined,
  options: InstallOptions
): Promise<CommandResult> {
  const cwd = process.cwd();
  
  // Handle bulk apply when no package name specified
  if (!packageName) {
    const contexts = await buildApplyContext(cwd, undefined, options);
    return await applyBulk(contexts);
  }
  
  // Apply single package
  const ctx = await buildApplyContext(cwd, packageName, options);
  return await runUnifiedInstallPipeline(ctx);
}

/**
 * Apply multiple packages (workspace root + all installed packages)
 */
async function applyBulk(contexts: InstallationContext[]): Promise<CommandResult> {
  if (contexts.length === 0) {
    return {
      success: false,
      error:
        `No packages installed in this workspace.\n` +
        `Run 'opkg install <package-name>' to install a package first.`
    };
  }
  
  console.log(`✓ Applying ${contexts.length} package${contexts.length === 1 ? '' : 's'}\n`);
  
  for (const ctx of contexts) {
    const result = await runUnifiedInstallPipeline(ctx);
    
    if (!result.success) {
      return result; // Stop on first failure
    }
  }
  
  return { success: true };
}

/**
 * Setup apply command
 */
export function setupApplyCommand(program: Command): void {
  program
    .command('apply')
    .description('Apply/sync package across platforms')
    .argument(
      '[package-name]',
      'package name to apply (optional - applies workspace-level files and all installed packages if not specified)'
    )
    .option('-f, --force', 'overwrite existing files without prompting')
    .option('--dry-run', 'plan apply without writing files')
    .option('--platforms <platforms...>', 'apply to specific platforms (e.g., cursor claudecode opencode)')
    .action(
      withErrorHandling(async (packageName: string | undefined, options: InstallOptions) => {
        // Normalize platforms
        options.platforms = normalizePlatforms(options.platforms);
        
        const result = await applyCommand(packageName, options);
        
        if (!result.success) {
          throw new Error(result.error || 'Apply operation failed');
        }
      })
    );
}
