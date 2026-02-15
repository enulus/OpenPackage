/**
 * File Selector with Dynamic Header
 * 
 * Custom AutocompletePrompt that shows selected files in a dynamic header
 * that updates in real-time as selections change.
 */

import { AutocompletePrompt, isCancel } from '@clack/core';
import { search } from 'fast-fuzzy';
import pico from 'picocolors';
import type { Key } from 'node:readline';

/**
 * Options for file selector with dynamic header
 */
export interface FileSelectorOptions {
  /** Prompt message */
  message: string;
  
  /** All available files */
  files: string[];
  
  /** Placeholder text */
  placeholder?: string;
  
  /** Maximum items to show */
  maxItems?: number;
  
  /** Fuzzy search threshold */
  fuzzyThreshold?: number;
}

/**
 * File option for autocomplete
 */
interface FileOption {
  value: string;
  label: string;
}

/**
 * Custom AutocompletePrompt that shows selected files above the search UI
 */
export class FileSelectorWithHeader extends AutocompletePrompt<FileOption> {
  private allFiles: string[];
  private fuzzyThreshold: number;
  private message: string;
  private placeholder: string;
  private maxVisibleItems: number;

  constructor(options: FileSelectorOptions) {
    const fileOptions: FileOption[] = options.files.map(file => ({
      value: file,
      label: file
    }));

    super({
      options: fileOptions,
      multiple: true,
      render() {
        return this.renderWithHeader();
      }
    } as any);

    this.allFiles = options.files;
    this.message = options.message;
    this.placeholder = options.placeholder || 'Type to search...';
    this.maxVisibleItems = options.maxItems || 10;
    this.fuzzyThreshold = options.fuzzyThreshold || 0.5;

    // Override the options to provide dynamic filtering
    this.setupFuzzyFiltering();
  }

  /**
   * Setup fuzzy filtering based on user input
   */
  private setupFuzzyFiltering(): void {
    // Listen to userInput changes to update filtered options
    this.on('userInput', () => {
      this.updateFilteredOptions();
    });
  }

  /**
   * Update filtered options based on current user input
   */
  private updateFilteredOptions(): void {
    const input = this.userInput;
    
    let filteredFiles: string[];
    
    if (!input || input.trim() === '') {
      filteredFiles = this.allFiles;
    } else {
      filteredFiles = search(input, this.allFiles, {
        threshold: this.fuzzyThreshold,
        ignoreCase: true,
        returnMatchData: false
      }) as string[];
    }

    // Update filteredOptions (this is a public property we can modify)
    this.filteredOptions = filteredFiles.map(file => ({
      value: file,
      label: file
    }));
  }

  /**
   * Main render method with dynamic header
   */
  private renderWithHeader(): string {
    // Handle final states with collapsed rendering
    if (this.state === 'cancel') {
      return this.renderCancelled();
    }
    
    if (this.state === 'submit') {
      // Treat empty selection as cancellation
      if (this.selectedValues.length === 0) {
        return this.renderCancelled();
      }
      return this.renderSubmitted();
    }
    
    // Render full interactive UI for active/initial/error states
    const sections: string[] = [];

    // === DYNAMIC HEADER SECTION ===
    sections.push(this.renderSelectedFilesHeader());

    // === PROMPT SECTION ===
    sections.push(this.renderSearchSection());

    // === OPTIONS LIST ===
    sections.push(this.renderOptionsList());

    // === FOOTER ===
    sections.push(this.renderFooter());

    return sections.join('\n');
  }

  /**
   * Render the selected files header using Clack's simple log-style format
   */
  private renderSelectedFilesHeader(): string {
    const count = this.selectedValues.length;
    const lines: string[] = [];
    
    // Title line with guide
    const title = count === 0 
      ? `Selected: ${pico.dim('none (use Space to select)')}`
      : `Selected: ${pico.cyan(`${count} file${count === 1 ? '' : 's'}`)}`;
    
    lines.push(`${pico.cyan('│')}  ${title}`);
    
    // Show selected files (up to 5)
    if (count > 0) {
      const displayCount = Math.min(5, count);
      for (let i = 0; i < displayCount; i++) {
        const file = this.selectedValues[i];
        lines.push(`${pico.cyan('│')}  ${pico.dim('✓ ' + file)}`);
      }
      
      // Show "... and X more" if there are more
      if (count > displayCount) {
        lines.push(`${pico.cyan('│')}  ${pico.dim(`... and ${count - displayCount} more`)}`);
      }
    }
    
    // Separator line
    lines.push(pico.cyan('│'));
    
    return lines.join('\n');
  }

  /**
   * Render the search section
   */
  private renderSearchSection(): string {
    const matchCount = this.filteredOptions.length;
    const totalCount = this.allFiles.length;

    const stateSymbol = pico.cyan('◆');
    const searchLabel = pico.dim('Search:');
    const input = this.userInput || pico.gray(this.placeholder);
    const cursor = this.state === 'active' ? pico.cyan('█') : '';
    const matches = matchCount !== totalCount
      ? pico.dim(` (${matchCount} ${matchCount === 1 ? 'match' : 'matches'})`)
      : '';

    return `${stateSymbol}  ${this.message}\n${pico.cyan('│')}  ${searchLabel} ${input}${cursor}${matches}`;
  }

  /**
   * Render the options list
   */
  private renderOptionsList(): string {
    const lines: string[] = [];
    const visibleOptions = this.filteredOptions.slice(0, this.maxVisibleItems);

    if (visibleOptions.length === 0) {
      lines.push(`${pico.cyan('│')}  ${pico.gray('No matches found')}`);
      return lines.join('\n');
    }

    for (let i = 0; i < visibleOptions.length; i++) {
      const option = visibleOptions[i];
      const isSelected = this.selectedValues.includes(option.value);
      const isCursor = i === this.cursor;

      // Checkbox
      const checkbox = isSelected ? pico.cyan('◼') : pico.dim('◻');

      // Cursor indicator
      const cursorMark = isCursor ? pico.cyan('▸') : ' ';

      // File name
      let fileName = option.label;
      if (isCursor) {
        fileName = pico.cyan(fileName);
      } else if (isSelected) {
        fileName = pico.white(fileName);
      } else {
        fileName = pico.dim(fileName);
      }

      lines.push(`${pico.cyan('│')} ${cursorMark} ${checkbox} ${fileName}`);
    }

    // Show scroll indicator
    if (this.filteredOptions.length > this.maxVisibleItems) {
      const remaining = this.filteredOptions.length - this.maxVisibleItems;
      lines.push(`${pico.cyan('│')}  ${pico.gray(`... ${remaining} more`)}`);
    }

    return lines.join('\n');
  }

  /**
   * Render the footer with hints
   */
  private renderFooter(): string {
    const hints = pico.dim('Space: select • Enter: confirm • Esc: cancel');
    return `${pico.cyan('└')}  ${hints}`;
  }

  /**
   * Render the collapsed cancelled state
   */
  private renderCancelled(): string {
    const symbol = pico.red('■');  // Red square for cancelled
    const end = pico.gray('└');
    
    return `${symbol}  ${this.message}\n${end}  ${pico.dim('Operation cancelled')}`;
  }

  /**
   * Render the collapsed submitted state (for successful selection)
   */
  private renderSubmitted(): string {
    const symbol = pico.green('◇');  // Green hollow diamond for success
    const bar = pico.gray('│');
    
    const count = this.selectedValues.length;
    const status = pico.dim(`${count} file${count === 1 ? '' : 's'} selected`);
    
    return `${symbol}  ${this.message}\n${bar}  ${status}`;
  }
}

/**
 * Helper function to create and run the file selector
 */
export async function promptFileSelector(
  options: FileSelectorOptions
): Promise<string[] | null> {
  const selector = new FileSelectorWithHeader(options);
  const result = await selector.prompt();

  if (isCancel(result)) {
    return null;
  }

  return result as string[];
}
