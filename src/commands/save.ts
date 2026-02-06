import { Command } from 'commander';

import { withErrorHandling } from '../utils/errors.js';
import { runSaveToSourcePipeline, type SaveToSourceOptions } from '../core/save/save-to-source-pipeline.js';
import type { SaveReport } from '../core/save/save-result-reporter.js';

/**
 * Display save operation results
 */
function displaySaveResults(data: any): void {
  // Handle simple message format (early exits)
  if (typeof data.message === 'string' && !data.report) {
    console.log(data.message);
    return;
  }
  
  // Handle report format (full pipeline execution)
  const report: SaveReport = data.report;
  
  // Display formatted message
  console.log(data.message);
  
  // Show detailed file list if files were saved
  if (report && report.writeResults && report.writeResults.length > 0) {
    const successfulWrites = report.writeResults.filter(r => r.success);
    
    if (successfulWrites.length > 0) {
      console.log('');
      console.log('  Files saved:');
      
      // Sort by registry path for consistent display
      const sorted = [...successfulWrites].sort((a, b) =>
        a.operation.registryPath.localeCompare(b.operation.registryPath)
      );
      
      for (const result of sorted) {
        const { registryPath, isPlatformSpecific, platform } = result.operation;
        const label = isPlatformSpecific && platform
          ? `${registryPath} (${platform})`
          : `${registryPath} (universal)`;
        console.log(`   ├── ${label}`);
      }
    }
  }
  
  // Show hint about syncing to workspace
  if (report && report.filesSaved > 0) {
    console.log('');
    console.log('💡 Changes saved to package source.');
    console.log('   To sync changes to workspace, run:');
    console.log(`     opkg install ${report.packageName}`);
  }
}

export function setupSaveCommand(program: Command): void {
  program
    .command('save')
    .argument('<package-name>', 'package name to save workspace changes to')
    .description('Save workspace edits back to mutable package source')
    .option('-f, --force', 'auto-select newest when conflicts occur')
    .action(
      withErrorHandling(async (packageName: string, options: SaveToSourceOptions) => {
        const result = await runSaveToSourcePipeline(packageName, options);
        if (!result.success) {
          throw new Error(result.error || 'Save operation failed');
        }

        // Display results
        if (result.data) {
          displaySaveResults(result.data);
        }
      })
    );
}
