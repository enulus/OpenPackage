/**
 * Status Command
 * 
 * Shows workspace file status - tracked and untracked files.
 */

import { Command } from 'commander';
import { CommandResult } from '../types/index.js';
import { withErrorHandling } from '../utils/errors.js';
import { runStatusPipeline, type StatusOptions } from '../core/status/status-pipeline.js';
import { createExecutionContext, getDisplayTargetDir } from '../core/execution-context.js';
import { logger } from '../utils/logger.js';
import type { TrackedFile } from '../core/status/tracked-files-collector.js';
import type { UntrackedScanResult } from '../core/list/untracked-files-scanner.js';

// ANSI escape codes for styling
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

function green(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

function red(text: string): string {
  return `${RED}${text}${RESET}`;
}

/**
 * Format summary output (default view)
 */
function printStatusSummary(
  trackedCount: number,
  untrackedCount: number,
  workspaceDir: string
): void {
  console.log(`Workspace: ${workspaceDir}`);
  console.log(`Tracked: ${trackedCount} | Untracked: ${untrackedCount}`);
  console.log();
  console.log(dim("Tip: Use --tracked or --untracked to see file lists"));
}

/**
 * Format tracked files output
 */
function printTrackedFiles(
  trackedFiles: import('../core/status/tracked-files-collector.js').TrackedFilesResult,
  workspaceDir: string
): void {
  if (trackedFiles.totalFiles === 0) {
    console.log('No tracked files found.');
    console.log();
    console.log(dim('No packages installed. Run \'opkg install\' to add packages.'));
    return;
  }

  console.log(`Tracked files (${trackedFiles.totalFiles}):`);
  
  if (trackedFiles.missingFiles > 0) {
    console.log(dim(`  ${green('✓')} ${trackedFiles.existingFiles} present | ${red('✗')} ${trackedFiles.missingFiles} missing`));
  }
  
  console.log();

  // Group by platform
  const sortedPlatforms = Array.from(trackedFiles.platformGroups.keys()).sort();
  
  for (const platform of sortedPlatforms) {
    const files = trackedFiles.platformGroups.get(platform)!;
    console.log(`${platform}:`);
    
    // Group by package
    const packageMap = new Map<string, typeof files>();
    for (const file of files) {
      const packageKey = file.packageVersion 
        ? `${file.packageName}@${file.packageVersion}`
        : file.packageName;
      
      if (!packageMap.has(packageKey)) {
        packageMap.set(packageKey, []);
      }
      packageMap.get(packageKey)!.push(file);
    }
    
    // Sort packages
    const sortedPackages = Array.from(packageMap.keys()).sort();
    
    for (let pkgIdx = 0; pkgIdx < sortedPackages.length; pkgIdx++) {
      const packageKey = sortedPackages[pkgIdx];
      const packageFiles = packageMap.get(packageKey)!;
      const isLastPackage = pkgIdx === sortedPackages.length - 1;
      const pkgPrefix = isLastPackage ? '└─' : '├─';
      const pkgIndent = isLastPackage ? '  ' : '│ ';
      
      console.log(`${pkgPrefix}┬ ${packageKey}:`);
      
      // Group by category (extract from path)
      const categoryMap = new Map<string, typeof packageFiles>();
      for (const file of packageFiles) {
        // Extract category from workspace path (e.g., .cursor/agents/... -> agents)
        const pathParts = file.workspacePath.split('/');
        const category = pathParts.length > 2 ? pathParts[1] : 'root';
        
        if (!categoryMap.has(category)) {
          categoryMap.set(category, []);
        }
        categoryMap.get(category)!.push(file);
      }
      
      // Sort categories
      const sortedCategories = Array.from(categoryMap.keys()).sort();
      
      for (let catIdx = 0; catIdx < sortedCategories.length; catIdx++) {
        const category = sortedCategories[catIdx];
        const categoryFiles = categoryMap.get(category)!;
        const isLastCategory = catIdx === sortedCategories.length - 1;
        const catPrefix = isLastCategory ? '└─' : '├─';
        const catIndent = isLastCategory ? '  ' : '│ ';
        
        console.log(`${pkgIndent}${catPrefix}┬ ${category}/`);
        
        for (let fileIdx = 0; fileIdx < categoryFiles.length; fileIdx++) {
          const file = categoryFiles[fileIdx];
          const isLastFile = fileIdx === categoryFiles.length - 1;
          const filePrefix = isLastFile ? '└──' : '├──';
          const status = file.exists ? green('✓') : red('✗');
          const statusLabel = file.exists ? '' : red(' [MISSING]');
          
          console.log(`${pkgIndent}${catIndent}${filePrefix} ${status} ${dim(file.workspacePath)}${statusLabel}`);
        }
      }
    }
    
    console.log();
  }
}

/**
 * Format untracked files output
 */
function printUntrackedFiles(
  result: UntrackedScanResult,
  workspaceDir: string
): void {
  if (result.totalFiles === 0) {
    console.log('No untracked files detected.');
    console.log();
    console.log(dim('All files matching platform patterns are tracked in the index.'));
    return;
  }
  
  console.log(`Untracked files (${result.totalFiles}):`);
  console.log();
  
  // Group by platform
  const sortedPlatforms = Array.from(result.platformGroups.keys()).sort();
  
  for (const platform of sortedPlatforms) {
    const files = result.platformGroups.get(platform)!;
    console.log(`${platform}:`);
    
    // Sub-group by category
    const categoryMap = new Map<string, typeof files>();
    for (const file of files) {
      if (!categoryMap.has(file.category)) {
        categoryMap.set(file.category, []);
      }
      categoryMap.get(file.category)!.push(file);
    }
    
    // Sort categories
    const sortedCategories = Array.from(categoryMap.keys()).sort();
    
    for (let catIdx = 0; catIdx < sortedCategories.length; catIdx++) {
      const category = sortedCategories[catIdx];
      const categoryFiles = categoryMap.get(category)!;
      const isLastCategory = catIdx === sortedCategories.length - 1;
      const catPrefix = isLastCategory ? '└─' : '├─';
      const catIndent = isLastCategory ? '  ' : '│ ';
      
      console.log(`${catPrefix}┬ ${category}/`);
      
      for (let fileIdx = 0; fileIdx < categoryFiles.length; fileIdx++) {
        const file = categoryFiles[fileIdx];
        const isLastFile = fileIdx === categoryFiles.length - 1;
        const filePrefix = isLastFile ? '└──' : '├──';
        
        console.log(`${catIndent}${filePrefix} ${dim(file.workspacePath)}`);
      }
    }
    
    console.log();
  }
}

/**
 * Status command handler
 */
async function statusCommand(
  options: StatusOptions,
  command: Command
): Promise<CommandResult> {
  // Get program-level options (for --cwd)
  const programOpts = command.parent?.opts() || {};
  
  // Create execution context
  const execContext = await createExecutionContext({
    global: options.global,
    cwd: programOpts.cwd
  });
  
  const displayDir = getDisplayTargetDir(execContext);

  // Run status pipeline
  const result = await runStatusPipeline(execContext, options);
  
  if (!result.success || !result.data) {
    return result;
  }

  // Display results based on options
  if (options.tracked && result.data.trackedFiles) {
    printTrackedFiles(result.data.trackedFiles, displayDir);
  } else if (options.untracked && result.data.untrackedFiles) {
    printUntrackedFiles(result.data.untrackedFiles, displayDir);
  } else {
    // Summary view
    printStatusSummary(
      result.data.trackedCount,
      result.data.untrackedCount,
      displayDir
    );
  }

  return { success: true };
}

/**
 * Setup status command
 */
export function setupStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show workspace file status')
    .option('-g, --global', 'show status for home directory (~/) instead of current workspace')
    .option('--tracked', 'show all tracked files from workspace index')
    .option('--untracked', 'show files detected by platforms but not tracked in index')
    .option('--platforms <platforms...>', 'filter by specific platforms (e.g., cursor, claude, opencode)')
    .action(withErrorHandling(async (options: StatusOptions, command: Command) => {
      await statusCommand(options, command);
    }));
}
