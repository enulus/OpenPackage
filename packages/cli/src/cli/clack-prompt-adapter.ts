/**
 * Clack Prompt Adapter
 * 
 * CLI-specific PromptPort implementation that routes to @clack/prompts
 * for rich interactive terminal prompts.
 * 
 * This is the CLI's implementation of the PromptPort interface defined
 * in core/ports/prompt.ts.
 */

import * as clack from '@clack/prompts';
import type { PromptPort, PromptChoice, PromptGroupChoices, TextPromptOptions } from '@opkg/core/core/ports/prompt.js';
import { UserCancellationError } from '@opkg/core/utils/errors.js';

function handleCancel(result: unknown): void {
  if (clack.isCancel(result)) {
    clack.cancel('Operation cancelled.');
    throw new UserCancellationError('Operation cancelled by user');
  }
}

/**
 * Create a Clack-based PromptPort for interactive terminal sessions.
 */
export function createClackPrompt(): PromptPort {
  return {
    async confirm(message: string, initial?: boolean): Promise<boolean> {
      const result = await clack.confirm({
        message,
        initialValue: initial ?? false,
      });
      handleCancel(result);
      return result as boolean;
    },

    async select<T>(
      message: string,
      choices: Array<PromptChoice<T>>,
      hint?: string
    ): Promise<T> {
      const result = await clack.select({
        message,
        options: choices.map(c => ({
          label: c.title,
          value: c.value,
          ...(c.description ? { hint: c.description } : {}),
        })) as any,
      });
      handleCancel(result);
      return result as T;
    },

    async multiselect<T>(
      message: string,
      choices: Array<PromptChoice<T>>,
      options?: { hint?: string; min?: number }
    ): Promise<T[]> {
      const result = await clack.multiselect({
        message,
        options: choices.map(c => ({
          label: c.title,
          value: c.value,
          ...(c.description ? { hint: c.description } : {}),
        })) as any,
        required: options?.min ? options.min > 0 : false,
      });
      handleCancel(result);
      return result as T[];
    },

    async groupMultiselect<T>(
      message: string,
      groups: PromptGroupChoices<T>
    ): Promise<T[]> {
      const result = await clack.groupMultiselect({
        message,
        options: groups as any,
      });
      handleCancel(result);
      return result as T[];
    },

    async text(
      message: string,
      options?: TextPromptOptions
    ): Promise<string> {
      const result = await clack.text({
        message,
        placeholder: options?.placeholder,
        defaultValue: options?.initial,
        validate: options?.validate ? (async (value: string | undefined) => {
          const r = await options.validate!(value ?? '');
          if (r === true || r === undefined) return undefined;
          return r;
        }) as any : undefined,
      });
      handleCancel(result);
      return result as string;
    },
  };
}
