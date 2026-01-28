import { logger } from '../../utils/logger.js';
import type { PublishResult } from './publish-types.js';

export class PublishError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

export function handlePublishError(
  error: unknown,
  packageName?: string,
  version?: string
): PublishResult {
  logger.error('Publish operation failed', { error, packageName, version });

  if (error instanceof PublishError) {
    console.error(`❌ ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }

  if (error instanceof Error) {
    const message = error.message;
    
    // Handle common error patterns
    if (message.includes('ENOENT') || message.includes('not found')) {
      console.error(`❌ Package file not found`);
      return {
        success: false,
        error: 'Package file not found',
      };
    }

    if (message.includes('authentication') || message.includes('unauthorized')) {
      console.error(`❌ Authentication failed. Run "opkg login" to configure credentials.`);
      return {
        success: false,
        error: 'Authentication failed',
      };
    }

    if (message.includes('network') || message.includes('ECONNREFUSED')) {
      console.error(`❌ Network error: Unable to connect to registry`);
      return {
        success: false,
        error: 'Network error',
      };
    }

    console.error(`❌ ${message}`);
    return {
      success: false,
      error: message,
    };
  }

  const errorMessage = String(error);
  console.error(`❌ Unexpected error: ${errorMessage}`);
  return {
    success: false,
    error: errorMessage,
  };
}
