import { spawn } from 'child_process';
import { logger } from '../utils/logger.js';
import { createHttpClient } from '../utils/http-client.js';
import { profileManager } from './profiles.js';

export type DeviceAuthorizationStart = {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
	expiresIn: number;
	interval: number;
};

export type DeviceTokenResult = {
	apiKey: string;
	keyPrefix?: string;
	expiresAt?: string;
	userId: string;
	username?: string;
};

const POLL_SLOWDOWN_SECONDS = 5;

export async function startDeviceAuthorization(): Promise<DeviceAuthorizationStart> {
	const client = await createHttpClient();
	const response = await client.post<{
		device_code: string;
		user_code: string;
		verification_uri: string;
		verification_uri_complete: string;
		expires_in: number;
		interval: number;
	}>(
		'/auth/device/authorize',
		{ clientId: 'opkg-cli', scope: 'openid', deviceName: 'opkg-cli' },
		{ headers: { 'Content-Type': 'application/json' }, skipAuth: true, timeout: 30000 }
	);

	return {
		deviceCode: response.device_code,
		userCode: response.user_code,
		verificationUri: response.verification_uri,
		verificationUriComplete: response.verification_uri_complete,
		expiresIn: response.expires_in,
		interval: response.interval,
	};
}

export async function pollForDeviceToken(params: {
	deviceCode: string;
	intervalSeconds: number;
	expiresInSeconds: number;
}): Promise<DeviceTokenResult> {
	const client = await createHttpClient();
	const expiresAt = Date.now() + params.expiresInSeconds * 1000;
	let intervalMs = params.intervalSeconds * 1000;

	while (Date.now() < expiresAt) {
		try {
			const tokenResponse = await client.post<{
				apiKey: string;
				keyPrefix?: string;
				expiresAt?: string;
				userId: string;
				username?: string;
			}>(
				'/auth/device/token',
				{ deviceCode: params.deviceCode },
				{ headers: { 'Content-Type': 'application/json' }, skipAuth: true, timeout: 30000 }
			);

			return {
				apiKey: tokenResponse.apiKey,
				keyPrefix: tokenResponse.keyPrefix,
				expiresAt: tokenResponse.expiresAt,
				userId: tokenResponse.userId,
				username: tokenResponse.username,
			};
		} catch (error: any) {
			const apiError = error?.apiError?.error as string | undefined;
			const code = apiError || 'authorization_pending';
			if (code === 'authorization_pending') {
				// continue polling
			} else if (code === 'slow_down') {
				intervalMs += POLL_SLOWDOWN_SECONDS * 1000;
			} else if (code === 'expired_token') {
				throw new Error('Device code expired. Please run "opkg login" again.');
			} else if (code === 'access_denied') {
				throw new Error('Access denied. Please restart the login flow.');
			} else {
				throw error;
			}
		}

		await wait(intervalMs);
	}

	throw new Error('Device code expired. Please run "opkg login" again.');
}

export async function persistTokens(
	profileName: string,
	tokens: DeviceTokenResult
): Promise<void> {
	await profileManager.setProfileCredentials(profileName, { api_key: tokens.apiKey });
}

export function openBrowser(url: string): void {
	const platform = process.platform;
	let command = '';

	if (platform === 'darwin') {
		command = 'open';
	} else if (platform === 'win32') {
		command = 'start';
	} else {
		command = 'xdg-open';
	}

	try {
		spawn(command, [url], { stdio: 'ignore', detached: true }).unref();
	} catch (error) {
		logger.debug('Failed to open browser automatically', { error, url });
	}
}

function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

