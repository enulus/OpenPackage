import { authManager } from '@opkg/core/core/auth.js'
import { profileManager } from '@opkg/core/core/profiles.js'
import { logger } from '@opkg/core/utils/logger.js'
import { createCliExecutionContext } from '../cli/context.js'
import { resolveOutput } from '@opkg/core/core/ports/resolve.js'

type LogoutOptions = {
	profile?: string
}

export async function setupLogoutCommand(args: any[]): Promise<void> {
	const [options] = args as [LogoutOptions]
	const ctx = await createCliExecutionContext()
	const out = resolveOutput(ctx)

	const profileName = authManager.getCurrentProfile({
		profile: options.profile,
	})

	if (profileName === '<api-key>') {
		out.info('No stored credentials when using --api-key directly.')
		return
	}

	try {
		await profileManager.clearProfileCredentials(profileName)
		out.success(`Credentials removed for profile "${profileName}".`)
	} catch (error) {
		logger.debug('Failed to clear credentials during logout', { error })
		throw error
	}
}
