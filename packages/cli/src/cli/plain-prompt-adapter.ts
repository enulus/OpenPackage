/**
 * Plain Prompt Adapter
 *
 * PromptPort implementation backed by the `prompts` npm package
 * (terkelg/prompts). Provides arrow-key interactive selection,
 * confirm, multiselect, and text input without the box-drawing
 * chrome of @clack/prompts.
 *
 * Used when the CLI commits to "plain" output mode on a TTY.
 */

import prompts from 'prompts';
import type {
  PromptPort,
  PromptChoice,
  PromptGroupChoices,
  TextPromptOptions,
} from '@opkg/core/core/ports/prompt.js';
import { UserCancellationError } from '@opkg/core/utils/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shared onCancel handler -- throws so callers never see `undefined`. */
function onCancel(): never {
  throw new UserCancellationError('Prompt cancelled');
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createPlainPrompt(): PromptPort {
  return {
    // ── confirm ──────────────────────────────────────────────────────
    async confirm(message: string, initial?: boolean): Promise<boolean> {
      const { value } = await prompts(
        {
          type: 'confirm',
          name: 'value',
          message,
          initial: initial ?? false,
        },
        { onCancel },
      );
      return value as boolean;
    },

    // ── select ───────────────────────────────────────────────────────
    async select<T>(
      message: string,
      choices: Array<PromptChoice<T>>,
      hint?: string,
    ): Promise<T> {
      const { value } = await prompts(
        {
          type: 'select',
          name: 'value',
          message,
          choices: choices.map((c) => ({
            title: c.title,
            value: c.value,
            description: c.description,
          })),
          hint,
        },
        { onCancel },
      );
      return value as T;
    },

    // ── multiselect ──────────────────────────────────────────────────
    async multiselect<T>(
      message: string,
      choices: Array<PromptChoice<T>>,
      options?: { hint?: string; min?: number },
    ): Promise<T[]> {
      const { value } = await prompts(
        {
          type: 'multiselect',
          name: 'value',
          message,
          choices: choices.map((c) => ({
            title: c.title,
            value: c.value,
            description: c.description,
          })),
          hint: options?.hint ?? '- Space: select/deselect, Enter: confirm',
          min: options?.min,
        },
        { onCancel },
      );
      return value as T[];
    },

    // ── groupMultiselect ─────────────────────────────────────────────
    async groupMultiselect<T>(
      message: string,
      groups: PromptGroupChoices<T>,
    ): Promise<T[]> {
      // `prompts` has no native grouped multiselect, so we flatten the
      // groups into a single list with "Group / Label" titles.
      const flatChoices: Array<{ title: string; value: T }> = [];
      for (const [groupLabel, items] of Object.entries(groups)) {
        for (const item of items) {
          flatChoices.push({
            title: `${groupLabel} / ${item.label}`,
            value: item.value,
          });
        }
      }

      const { value } = await prompts(
        {
          type: 'multiselect',
          name: 'value',
          message,
          choices: flatChoices.map((c) => ({
            title: c.title,
            value: c.value,
          })),
          hint: '- Space: select/deselect, Enter: confirm',
        },
        { onCancel },
      );
      return value as T[];
    },

    // ── text ─────────────────────────────────────────────────────────
    async text(
      message: string,
      options?: TextPromptOptions,
    ): Promise<string> {
      const userValidate = options?.validate;

      // Detect whether the validator is async by probing with a dummy call.
      // If async, we skip prompts' built-in validate and loop manually.
      let isAsync = false;
      const syncValidate = userValidate
        ? (value: string) => {
            const r = userValidate(value);
            if (r && typeof (r as any).then === 'function') {
              isAsync = true;
              return true; // accept for now, validate after
            }
            if (r === true || r === undefined) return true;
            return r as string;
          }
        : undefined;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value } = await prompts(
          {
            type: 'text',
            name: 'value',
            message,
            initial: options?.initial,
            validate: syncValidate,
          },
          { onCancel },
        );

        const result = (value as string) ?? '';

        // Post-submit async validation
        if (isAsync && userValidate) {
          const asyncResult = await userValidate(result);
          if (asyncResult !== true && asyncResult !== undefined) {
            console.error(`  Error: ${asyncResult}`);
            isAsync = false; // reset for next iteration
            continue;
          }
        }

        return result;
      }
    },
  };
}
