import { authManager } from '@opkg/core/core/auth.js';
import {
	startDeviceAuthorization,
	pollForDeviceToken,
	persistTokens,
	openBrowser,
} from '@opkg/core/core/device-auth.js';
import { profileManager } from '@opkg/core/core/profiles.js';
import { logger } from '@opkg/core/utils/logger.js';
import { UserCancellationError } from '@opkg/core/utils/errors.js';
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

	out.info(`A browser will open for you to confirm sign-in.\n\nUser code: ${authorization.userCode}\nVerification URL: ${authorization.verificationUri}`);
	out.info('If the browser does not open, visit the URL and enter the code above.');

	openBrowser(authorization.verificationUriComplete);

	const abortController = new AbortController();
	const cleanupKeyListener = setupCancelListener(abortController);

	try {
		const tokens = await pollForDeviceToken({
			deviceCode: authorization.deviceCode,
			intervalSeconds: authorization.interval,
			expiresInSeconds: authorization.expiresIn,
			signal: abortController.signal,
		});

		cleanupKeyListener();

		await persistTokens(profileName, tokens);

		const username = tokens.username ?? (await resolveUsername(tokens.apiKey));
		if (username) {
			await profileManager.setProfileDefaultScope(profileName, `@${username}`);
			out.success(`Default scope set to @${username} for profile "${profileName}".`);
		} else {
			logger.debug('Could not derive username from API key; default scope not set');
		}

		out.success('Login successful.');
		out.success(`API key stored for profile "${profileName}".`);
	} catch (error: any) {
		cleanupKeyListener();
		if (abortController.signal.aborted) {
			out.warn('Operation cancelled.');
			throw new UserCancellationError('Operation cancelled by user');
		}
		logger.debug('Device login failed', { error });
		throw error;
	}
}

function setupCancelListener(abortController: AbortController): () => void {
	const stdin = process.stdin;
	const wasRaw = stdin.isRaw;
	const wasListening = stdin.listenerCount('data') > 0;

	if (stdin.isTTY) {
		stdin.setRawMode(true);
		stdin.resume();
	}

	const onData = (data: Buffer) => {
		const key = data.toString();
		// Escape key (\x1b without [ following, i.e. bare escape)
		if (key === '\x1b' || key === '\x03') {
			abortController.abort();
		}
	};

	stdin.on('data', onData);

	return () => {
		stdin.off('data', onData);
		if (stdin.isTTY) {
			stdin.setRawMode(wasRaw ?? false);
			if (!wasListening) {
				stdin.pause();
			}
		}
	};
}

async function resolveUsername(apiKey: string): Promise<string | undefined> {
	try {
		return await getCurrentUsername({ apiKey });
	} catch (error) {
		logger.debug('Unable to resolve username from API key', { error });
		return undefined;
	}
}
