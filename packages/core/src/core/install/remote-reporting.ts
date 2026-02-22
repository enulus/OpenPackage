import type { RemoteBatchPullResult, RemotePullFailure } from '../remote-pull.js';
import { createDownloadKey } from './download-keys.js';
import { extractRemoteErrorReason } from '../../utils/error-reasons.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

/**
 * Record the outcome of a batch pull operation
 */
export function recordBatchOutcome(
  label: string,
  result: RemoteBatchPullResult,
  warnings: string[],
  dryRun: boolean,
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();
  if (result.warnings) {
    warnings.push(...result.warnings);
  }

  const successful = result.pulled.map(item => createDownloadKey(item.name, item.version));
  const failed = result.failed.map(item => ({
    key: createDownloadKey(item.name, item.version),
    error: item.error ?? 'Unknown error'
  }));

  if (dryRun) {
    if (successful.length > 0) {
      out.info(`Would ${label}: ${successful.join(', ')}`);
    }

    if (failed.length > 0) {
      for (const failure of failed) {
        const reason = extractRemoteErrorReason(failure.error);
        const message = `Dry run: remote pull would fail for \`${failure.key}\` (reason: ${reason})`;
        out.warn(message);
        warnings.push(message);
      }
    }

    return;
  }

  if (successful.length > 0) {
    out.success(`${label}: ${successful.length}`);
      for (const key of successful) {
        out.info(`   ├── ${key}`);
      }
  }

  if (failed.length > 0) {
    for (const failure of failed) {
      const reason = extractRemoteErrorReason(failure.error);
      const message = `Remote pull failed for \`${failure.key}\` (reason: ${reason})`;
      out.warn(message);
      warnings.push(message);
    }
  }
}

/**
 * Describe a remote failure in a user-friendly way
 */
export function describeRemoteFailure(label: string, failure: RemotePullFailure): string {
  switch (failure.reason) {
    case 'not-found':
      return `Package '${label}' not found in remote registry`;
    case 'access-denied':
      return failure.message || `Access denied pulling ${label}`;
    case 'network':
      return failure.message || `Network error pulling ${label}`;
    case 'integrity':
      return failure.message || `Integrity check failed pulling ${label}`;
    default:
      return failure.message || `Failed to pull ${label}`;
  }
}
