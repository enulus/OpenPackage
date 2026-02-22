import { authManager } from '@opkg/core/core/auth.js';
import {
	startDeviceAuthorization,
	pollForDeviceToken,
	persistTokens,
	openBrowser,
} from '@opkg/core/core/device-auth.js';
import { profileManager } from '@opkg/core/core/profiles.js';
import { logger } from '@opkg/core/utils/logger.js';
import { getCurrentUsername } from '@opkg/core/core/api-keys.js';
import { createCliExecutionContext } from '../cli/context.js';
import { resolveOutput } from '@opkg/core/core/ports/resolve.js';

type LoginOptions = {
	profile?: string;
};

export async function setupLoginCommand(args: any[]): Promise<void> {
	const [options] = args as [LoginOptions];
	const ctx = await createCliExecutionContext();
	const out = resolveOutput(ctx);

	const profileName = authManager.getCurrentProfile({
		profile: options.profile,
	});

	out.info(`Using profile: ${profileName}`);

	const authorization = await startDeviceAuthorization();

	out.info('A browser will open for you to confirm sign-in.');
	out.info(`User code: ${authorization.userCode}`);
	out.info(`Verification URL: ${authorization.verificationUri}`);
	out.message('');
	out.info('If the browser does not open, visit the URL and enter the code above.');

	openBrowser(authorization.verificationUriComplete);

	try {
		const tokens = await pollForDeviceToken({
			deviceCode: authorization.deviceCode,
			intervalSeconds: authorization.interval,
			expiresInSeconds: authorization.expiresIn,
		});

		await persistTokens(profileName, tokens);

		const username = tokens.username ?? (await resolveUsername(profileName));
		if (username) {
			await profileManager.setProfileDefaultScope(profileName, `@${username}`);
			out.success(`Default scope set to @${username} for profile "${profileName}".`);
		} else {
			logger.debug('Could not derive username from API key; default scope not set');
		}

		out.message('');
		out.success('Login successful.');
		out.success(`API key stored for profile "${profileName}".`);
	} catch (error: any) {
		logger.debug('Device login failed', { error });
		throw error;
	}
}

async function resolveUsername(profileName: string): Promise<string | undefined> {
	try {
		return await getCurrentUsername({ profile: profileName });
	} catch (error) {
		logger.debug('Unable to resolve username from API key', { error });
		return undefined;
	}
}
