import { CommandResult } from '@opkg/core/types/index.js';
import { profileManager } from '@opkg/core/core/profiles.js';
import { ensureOpenPackageDirectories } from '@opkg/core/core/directory.js';
import { logger } from '@opkg/core/utils/logger.js';
import { UserCancellationError } from '@opkg/core/utils/errors.js';
import { API_KEY_SIGNUP_MESSAGE } from '../utils/messages.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveOutput, resolvePrompt } from '@opkg/core/core/ports/resolve.js';
import type { OutputPort } from '@opkg/core/core/ports/output.js';
import type { PromptPort } from '@opkg/core/core/ports/prompt.js';

/**
 * Configure command implementation for profile management
 */

interface ConfigureOptions {
  profile?: string;
  list?: boolean;
  delete?: string | boolean;
}

/**
 * Interactive profile setup
 */
async function setupProfile(profileName: string, out: OutputPort, prm: PromptPort): Promise<CommandResult> {
  try {
    logger.info(`Setting up profile: ${profileName}`);

    // Ensure directories exist
    await ensureOpenPackageDirectories();

    out.info(API_KEY_SIGNUP_MESSAGE);

    // Prompt for API key
    const apiKey = await prm.text(`Enter API key for profile '${profileName}':`, {
      validate: (value: string) => value.length > 0 ? true : 'API key is required'
    });

    const description = await prm.text(`Enter description for profile '${profileName}' (optional):`, {
      initial: profileName === 'default' ? 'Default profile' : ''
    });

    if (!apiKey) {
      throw new UserCancellationError('Profile setup cancelled');
    }

    // Set profile configuration
    await profileManager.setProfile(profileName, {
      description: description || undefined
    });

    // Set profile credentials
    await profileManager.setProfileCredentials(profileName, {
      api_key: apiKey
    });

    out.success(`Profile '${profileName}' configured successfully`);
    
    if (profileName === 'default') {
      out.message('');
      out.info('You can now use remote registry features with this profile.');
    } else {
      out.message('');
      out.info(`You can now use remote registry features with --profile ${profileName}`);
    }

    return {
      success: true,
      data: {
        profile: profileName,
        message: 'Profile configured successfully'
      }
    };
  } catch (error) {
    if (error instanceof UserCancellationError) {
      throw error; // Re-throw to be handled by withErrorHandling
    }
    logger.error(`Failed to setup profile: ${profileName}`, { error });
    return { success: false, error: `Failed to setup profile: ${error}` };
  }
}

/**
 * List all profiles
 */
async function listProfiles(out: OutputPort): Promise<CommandResult> {
  try {
    const profiles = await profileManager.listProfiles();
    
    if (profiles.length === 0) {
      out.info('No profiles configured.');
      out.message('');
      out.info('To create a profile, run:');
      out.info('  opkg configure');
      out.info('  opkg configure --profile <name>');
      return { success: true, data: { profiles: [] } };
    }

    out.info('Configured profiles:');
    out.message('');

    for (const profileName of profiles) {
      const profile = await profileManager.getProfile(profileName);
      const hasCredentials = !!profile?.credentials?.api_key;
      const description = profile?.config?.description || '(no description)';
      
      out.message(`  ${profileName}`);
      out.message(`    Description: ${description}`);
      out.message(`    Credentials: ${hasCredentials ? '\u2705 Configured' : '\u274C Missing'}`);
      out.message('');
    }

    return {
      success: true,
      data: { profiles }
    };
  } catch (error) {
    logger.error('Failed to list profiles', { error });
    return { success: false, error: `Failed to list profiles: ${error}` };
  }
}

/**
 * Delete a profile
 */
async function deleteProfile(profileName: string, out: OutputPort, prm: PromptPort): Promise<CommandResult> {
  try {
    if (profileName === 'default') {
      return { success: false, error: 'Cannot delete the default profile' };
    }

    const exists = await profileManager.hasProfile(profileName);
    if (!exists) {
      return { success: false, error: `Profile '${profileName}' not found` };
    }

    // Confirm deletion
    const confirmed = await prm.confirm(
      `Are you sure you want to delete profile '${profileName}'?`,
      false
    );

    if (!confirmed) {
      throw new UserCancellationError('Profile deletion cancelled');
    }

    await profileManager.deleteProfile(profileName);
    out.success(`Profile '${profileName}' deleted successfully`);

    return {
      success: true,
      data: {
        profile: profileName,
        message: 'Profile deleted successfully'
      }
    };
  } catch (error) {
    if (error instanceof UserCancellationError) {
      throw error; // Re-throw to be handled by withErrorHandling
    }
    logger.error(`Failed to delete profile: ${profileName}`, { error });
    return { success: false, error: `Failed to delete profile: ${error}` };
  }
}


/**
 * Main configure command implementation
 */
async function configureCommand(options: ConfigureOptions, out: OutputPort, prm: PromptPort): Promise<CommandResult> {
  logger.info('Configure command executed', { options });

  // List profiles
  if (options.list) {
    return await listProfiles(out);
  }

  // Delete profile
  if (typeof options.delete === 'string') {
    return await deleteProfile(options.delete, out, prm);
  }
  if (options.delete && options.profile) {
    // Backward compatibility: allow --delete with --profile <name>
    return await deleteProfile(options.profile, out, prm);
  }
  if (options.delete) {
    return { success: false, error: 'Please provide a profile name via --delete <name> or --profile <name>.' };
  }

  // Setup default profile (default behavior)
  if (!options.profile) {
    return await setupProfile('default', out, prm);
  }

  // Setup profile
  return await setupProfile(options.profile, out, prm);
}

/**
 * Setup the configure command
 */
export async function setupConfigureCommand(args: any[]): Promise<void> {
  const [options] = args as [ConfigureOptions];
  const ctx = await createCliExecutionContext();
  const out = resolveOutput(ctx);
  const prm = resolvePrompt(ctx);
  const result = await configureCommand(options, out, prm);
  if (!result.success) {
    throw new Error(result.error || 'Configure operation failed');
  }
}
