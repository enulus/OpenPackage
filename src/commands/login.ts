import { Command } from 'commander';
import { withErrorHandling } from '../utils/errors.js';
import { authManager } from '../core/auth.js';
import {
	startDeviceAuthorization,
	pollForDeviceToken,
	persistTokens,
	openBrowser,
} from '../core/device-auth.js';
import { profileManager } from '../core/profiles.js';
import { logger } from '../utils/logger.js';
import { getCurrentUsername } from '../core/api-keys.js';

type LoginOptions = {
	profile?: string;
};

export function setupLoginCommand(program: Command): void {
	program
		.command('login')
		.description('Authenticate with OpenPackage using the device authorization flow')
		.option('--profile <profile>', 'profile to use for authentication')
		.action(
			withErrorHandling(async (options: LoginOptions) => {
				const profileName = authManager.getCurrentProfile({
					profile: options.profile,
				});

				console.log(`Using profile: ${profileName}`);

				const authorization = await startDeviceAuthorization();

				console.log('A browser will open for you to confirm sign-in.');
				console.log(`User code: ${authorization.userCode}`);
				console.log(`Verification URL: ${authorization.verificationUri}`);
				console.log('');
				console.log('If the browser does not open, visit the URL and enter the code above.');

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
						console.log(`✓ Default scope set to @${username} for profile "${profileName}".`);
					} else {
						logger.debug('Could not derive username from API key; default scope not set');
					}

					console.log('');
					console.log('✓ Login successful.');
					console.log(`✓ API key stored for profile "${profileName}".`);
				} catch (error: any) {
					logger.debug('Device login failed', { error });
					throw error;
				}
			})
		);
}

async function resolveUsername(profileName: string): Promise<string | undefined> {
	try {
		return await getCurrentUsername({ profile: profileName });
	} catch (error) {
		logger.debug('Unable to resolve username from API key', { error });
		return undefined;
	}
}

