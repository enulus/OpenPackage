import { logger } from '../../utils/logger.js';
import type { PublishResult } from './publish-types.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

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
  version?: string,
  output?: OutputPort
): PublishResult {
  const out = output ?? resolveOutput();
  logger.debug('Publish operation failed', { error, packageName, version });

  if (error instanceof PublishError) {
    out.error(error.message);
    return {
      success: false,
      error: error.message,
    };
  }

  if (error instanceof Error) {
    const message = error.message;
    
    // Handle common error patterns
    if (message.includes('ENOENT') || message.includes('not found')) {
      out.error('Package file not found');
      return {
        success: false,
        error: 'Package file not found',
      };
    }

    if (message.includes('authentication') || message.includes('unauthorized')) {
      out.error('Authentication failed. Run "opkg login" to configure credentials.');
      return {
        success: false,
        error: 'Authentication failed',
      };
    }

    if (message.includes('network') || message.includes('ECONNREFUSED')) {
      out.error('Network error: Unable to connect to registry');
      return {
        success: false,
        error: 'Network error',
      };
    }

    out.error(message);
    return {
      success: false,
      error: message,
    };
  }

  const errorMessage = String(error);
  out.error(`Unexpected error: ${errorMessage}`);
  return {
    success: false,
    error: errorMessage,
  };
}
