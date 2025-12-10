import { Command } from 'commander'
import { withErrorHandling } from '../utils/errors.js'
import { authManager } from '../core/auth.js'
import { profileManager } from '../core/profiles.js'
import { logger } from '../utils/logger.js'

type LogoutOptions = {
	profile?: string
}

export function setupLogoutCommand(program: Command): void {
	program
		.command('logout')
		.description('Remove stored API key for a profile')
		.option('--profile <profile>', 'profile to log out')
		.action(
			withErrorHandling(async (options: LogoutOptions) => {
				const profileName = authManager.getCurrentProfile({
					profile: options.profile,
				})

				if (profileName === '<api-key>') {
					console.log('No stored credentials when using --api-key directly.')
					return
				}

				try {
					await profileManager.clearProfileCredentials(profileName)
					console.log(`✓ Credentials removed for profile "${profileName}".`)
				} catch (error) {
					logger.debug('Failed to clear credentials during logout', { error })
					throw error
				}
			}),
		)
}

