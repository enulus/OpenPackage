/**
 * Interactive File Selector
 * 
 * Provides fuzzy file selection with dynamic header showing selected files.
 * Uses custom AutocompletePrompt that updates the header in real-time.
 */

import { note, log } from '@clack/prompts';
import { promptFileSelector } from './file-selector-with-header.js';
import { scanWorkspaceFiles } from './file-scanner.js';
import { logger } from './logger.js';

/**
 * Options for interactive file selection
 */
export interface FileSelectionOptions {
  /** Base directory to scan from (default: process.cwd()) */
  cwd?: string;
  
  /** Specific directory path to scan (overrides cwd if provided) */
  basePath?: string;
  
  /** Prompt message to display (default: 'Select files') */
  message?: string;
  
  /** Placeholder text when no input (default: 'Type to search files...') */
  placeholder?: string;
  
  /** Maximum items to display at once (default: 10) */
  maxItems?: number;
  
  /** Additional directories to exclude from scanning */
  excludeDirs?: string[];
  
  /** Show intro note before prompt (default: true) */
  showIntro?: boolean;
  
  /** Fuzzy search threshold (0-1, default: 0.5) */
  fuzzyThreshold?: number;
}

/**
 * Display an interactive fuzzy file selector with dynamic header
 * 
 * Features:
 * - Dynamic header showing selected files (updates in real-time)
 * - Fuzzy search with real-time filtering
 * - Space to toggle selection
 * - Enter to confirm
 * 
 * @param options - Selection options
 * @returns Array of selected relative file paths, or null if cancelled
 * 
 * @example
 * const files = await interactiveFileSelect({ cwd: process.cwd() });
 * if (files) {
 *   console.log('Selected:', files);
 * } else {
 *   console.log('Cancelled');
 * }
 */
export async function interactiveFileSelect(
  options: FileSelectionOptions = {}
): Promise<string[] | null> {
  const {
    cwd = process.cwd(),
    basePath,
    message = 'Select files to add',
    placeholder = 'Type to search files...',
    maxItems = 10,
    excludeDirs = [],
    showIntro = true,
    fuzzyThreshold = 0.5
  } = options;
  
  const scanDir = basePath || cwd;
  
  try {
    // Show helpful intro note
    if (showIntro) {
      note(
        'The selected files will be shown above as you select them.\n' +
        'Type to search • Space to select • Enter to confirm',
        'Interactive File Selection'
      );
    }
    
    // Scan workspace for all files
    logger.debug('Scanning workspace for files', { scanDir });
    const allFiles = await scanWorkspaceFiles({ cwd, basePath, excludeDirs });
    
    // Check if any files found
    if (allFiles.length === 0) {
      logger.warn('No files found in workspace');
      note('No files found in the workspace directory', 'No Files');
      return null;
    }
    
    logger.debug(`Found ${allFiles.length} files to display`);
    
    // Display the file selector with dynamic header
    const selectedFiles = await promptFileSelector({
      message,
      files: allFiles,
      placeholder,
      maxItems,
      fuzzyThreshold
    });
    
    // Check if user cancelled or selected nothing
    if (!selectedFiles || selectedFiles.length === 0) {
      logger.debug('No files selected or user cancelled');
      return null;  // Prompt handles its own cancellation display
    }
    
    logger.debug(`User selected ${selectedFiles.length} file(s)`, { selectedFiles });
    
    // Show summary after selection
    const fileList = selectedFiles.length <= 5
      ? selectedFiles.join('\n')
      : selectedFiles.slice(0, 5).join('\n') + `\n... and ${selectedFiles.length - 5} more`;
    
    log.success(`Selected ${selectedFiles.length} file(s):\n${fileList}`);
    
    return selectedFiles;
    
  } catch (error) {
    logger.error('Error during file selection', { error });
    throw new Error(`File selection failed: ${error}`);
  }
}

/**
 * Display an interactive fuzzy file selector for single file selection
 * 
 * @param options - Selection options
 * @returns Selected relative file path, or null if cancelled
 */
export async function interactiveFileSelectSingle(
  options: FileSelectionOptions = {}
): Promise<string | null> {
  const result = await interactiveFileSelect({
    ...options,
    message: options.message || 'Select a file'
  });
  
  if (!result || result.length === 0) {
    return null;
  }
  
  // Return the first selected file
  return result[0];
}
