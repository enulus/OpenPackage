/**
 * Interaction Policy
 * 
 * Single source of truth for whether the CLI can prompt the user.
 * Created once at command entry and threaded through all handlers.
 * 
 * Prompt Tiers:
 *   0 - Required:           Platform selection, marketplace plugin pick
 *   1 - Disambiguation:     Ambiguous base directory selection
 *   2 - Confirmation:       Overwrite confirmations
 *   3 - ConflictResolution: Version conflict selection
 *   4 - OptionalMenu:       --interactive resource selection menus
 */

export enum PromptTier {
  Required = 0,
  Disambiguation = 1,
  Confirmation = 2,
  ConflictResolution = 3,
  OptionalMenu = 4,
}

export type InteractionMode = 'never' | 'auto' | 'always';

export interface InteractionPolicy {
  readonly mode: InteractionMode;
  readonly isTTY: boolean;
  canPrompt(tier: PromptTier): boolean;
}

/**
 * Create an interaction policy from command options.
 * 
 * Mode resolution:
 *   --interactive + TTY  → 'always' (all tiers allowed)
 *   --interactive + !TTY → throws (user explicitly asked for interactive)
 *   CI=true or !TTY      → 'never'  (no prompts, errors or safe defaults)
 *   default TTY           → 'auto'   (ambient prompts for tiers 0-3, never tier 4)
 */
export function createInteractionPolicy(options: {
  interactive?: boolean;
  force?: boolean;
}): InteractionPolicy {
  const isTTY = process.stdin.isTTY === true;

  let mode: InteractionMode;
  if (options.interactive) {
    if (!isTTY) {
      throw new Error(
        '--interactive requires an interactive terminal (TTY). ' +
        'Use specific filters (--agents, --skills, etc.) for non-interactive installs.'
      );
    }
    mode = 'always';
  } else if (!isTTY || process.env.CI === 'true') {
    mode = 'never';
  } else {
    mode = 'auto';
  }

  return {
    mode,
    isTTY,
    canPrompt(tier: PromptTier): boolean {
      if (mode === 'never') return false;
      if (mode === 'always') return true;
      // 'auto': allow ambient prompts (tiers 0-3), never tier 4 (optional menus)
      return tier < PromptTier.OptionalMenu;
    }
  };
}
