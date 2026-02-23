/**
 * Prompt Port Interface
 * 
 * Defines the contract for all interactive user prompts.
 * Core logic uses this interface instead of the `prompts` npm package
 * or @clack/prompts directly.
 * 
 * Implementations:
 *   - ClackPromptAdapter (CLI): routes to @clack/prompts
 *   - NonInteractivePromptAdapter (CI/default): throws on prompt attempts
 *   - GUI adapter (Tauri): routes to frontend dialogs via IPC
 */

/**
 * A single choice option for select/multiselect prompts.
 */
export interface PromptChoice<T = string> {
  title: string;
  value: T;
  description?: string;
}

/**
 * A grouped set of choices for grouped multiselect prompts.
 */
export interface PromptGroupChoices<T = string> {
  [groupLabel: string]: Array<{ label: string; value: T }>;
}

/**
 * Options for text input prompts.
 */
export interface TextPromptOptions {
  initial?: string;
  placeholder?: string;
  /**
   * Validate the user's input. Return `true` or `undefined` if valid,
   * or a string error message if invalid.
   *
   * Async validators are supported but note: because @clack/core does not
   * await validate results, async validators are handled via a post-submit
   * retry loop in the CLI adapter rather than inline validation.
   */
  validate?: (value: string) => string | true | undefined | Promise<string | true | undefined>;
}

/**
 * PromptPort defines all interactive prompt operations.
 */
export interface PromptPort {
  /** Prompt for a yes/no confirmation */
  confirm(message: string, initial?: boolean): Promise<boolean>;

  /** Prompt user to select one item from a list */
  select<T>(
    message: string,
    choices: Array<PromptChoice<T>>,
    hint?: string
  ): Promise<T>;

  /** Prompt user to select multiple items from a list */
  multiselect<T>(
    message: string,
    choices: Array<PromptChoice<T>>,
    options?: { hint?: string; min?: number }
  ): Promise<T[]>;

  /** Prompt user to select from grouped options */
  groupMultiselect<T>(
    message: string,
    groups: PromptGroupChoices<T>
  ): Promise<T[]>;

  /** Prompt user for text input */
  text(
    message: string,
    options?: TextPromptOptions
  ): Promise<string>;
}
