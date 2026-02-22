import { AuthOptions } from '../types/index.js';
import { profileManager } from './profiles.js';
import { logger } from '../utils/logger.js';
import { ConfigError } from '../utils/errors.js';
import { getVersion } from '../utils/package.js';

/**
 * Authentication management for OpenPackage CLI
 * Handles credential resolution and validation
 */


class AuthManager {
	/**
	 * Get API key following credential precedence:
	 * 1. Command line options (--api-key)
	 * 2. Profile credentials file (explicit profile, env var, or default)
	 *
	 * If an explicit profile is requested via options.profile but doesn't exist
	 * or has no credentials, an error is thrown instead of falling back to default.
	 */
	async getApiKey(options: AuthOptions = {}): Promise<string | null> {
		try {
			if (options.apiKey !== undefined) {
				if (!options.apiKey || options.apiKey.trim() === '') {
					throw new ConfigError(
						'API key provided via --api-key is empty. Please provide a valid API key.',
					)
				}
				logger.debug('Using API key from command line options')
				return options.apiKey
			}

			const profileName = options.profile || process.env.OPENPACKAGEPROFILE || 'default'
			const isExplicitProfile = !!options.profile
			logger.debug(`Using profile: ${profileName}${isExplicitProfile ? ' (explicit)' : ''}`)

			const profile = await profileManager.getProfile(profileName)
			if (profile?.credentials?.api_key) {
				logger.debug(`Using API key from profile: ${profileName}`)
				return profile.credentials.api_key
			}

			if (isExplicitProfile) {
				if (!profile) {
					throw new ConfigError(
						`Profile '${profileName}' not found. Please configure it with "opkg configure --profile ${profileName}"`,
					)
				}
				if (!profile.credentials?.api_key) {
					throw new ConfigError(
						`Profile '${profileName}' has no API key configured. Please configure it with "opkg configure --profile ${profileName}"`,
					)
				}
			}

			if (profileName !== 'default') {
				const defaultProfile = await profileManager.getProfile('default')
				if (defaultProfile?.credentials?.api_key) {
					logger.debug('Using API key from default profile')
					return defaultProfile.credentials.api_key
				}
			}

			logger.warn('No API key found in any credential source')
			return null
		} catch (error) {
			logger.error('Failed to get API key', { error })
			if (error instanceof ConfigError) {
				throw error
			}
			throw new ConfigError(`Failed to get API key: ${error}`)
		}
	}

	getRegistryUrl(): string {
		const registryUrl = 'https://backend.openpackage.dev/v1'
		// const registryUrl = 'http://localhost:3000/v1'
		logger.debug(`Using registry URL: ${registryUrl}`)
		return registryUrl
	}

	async validateAuth(options: AuthOptions = {}): Promise<{ registryUrl: string }> {
		const registryUrl = this.getRegistryUrl()
		const apiKey = await this.getApiKey(options)
		if (!apiKey) {
			throw new ConfigError(
				'No authentication found. Run "opkg login" to configure a profile API key.',
			)
		}
		return { registryUrl }
	}

	getCurrentProfile(options: AuthOptions = {}): string {
		if (options.apiKey !== undefined && options.apiKey) {
			return '<api-key>'
		}
		return options.profile || process.env.OPENPACKAGEPROFILE || 'default'
	}

	async isAuthenticated(options: AuthOptions = {}): Promise<boolean> {
		try {
			const registryUrl = this.getRegistryUrl()
			if (!registryUrl) {
				return false
			}
			const apiKey = await this.getApiKey(options)
			return !!apiKey
		} catch (error) {
			logger.debug('Authentication check failed', { error })
			return false
		}
	}

	async getAuthHeaders(options: AuthOptions = {}): Promise<Record<string, string>> {
		const registryUrl = this.getRegistryUrl()
		if (!registryUrl) {
			throw new ConfigError('Registry URL is not configured')
		}

		const apiKey = await this.getApiKey(options)
		if (apiKey) {
			return {
				'X-API-Key': apiKey,
				'User-Agent': `openpackage-cli/${getVersion()}`,
			}
		}

		throw new ConfigError(
			'No authentication found. Run "opkg login" to configure a profile API key.',
		)
	}

	async getAuthInfo(options: AuthOptions = {}): Promise<{
		profile: string
		hasApiKey: boolean
		hasRegistryUrl: boolean
		source: string
	}> {
		const profile = this.getCurrentProfile(options)
		const apiKey = await this.getApiKey(options)
		const registryUrl = this.getRegistryUrl()

		let source = 'none'
		if (options.apiKey) {
			source = 'command-line'
		} else if (apiKey) {
			source = 'profile'
		}

		return {
			profile,
			hasApiKey: !!apiKey,
			hasRegistryUrl: !!registryUrl,
			source,
		}
	}
}

// Create and export a singleton instance
export const authManager = new AuthManager();

// Export the class for testing purposes
export { AuthManager };
