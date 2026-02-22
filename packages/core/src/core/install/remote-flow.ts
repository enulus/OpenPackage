import type { RemotePackageMetadataSuccess, RemoteBatchPullResult, RemotePullFailure } from '../remote-pull.js';
import type { ResolvedPackage } from '../dependency-resolver/types.js';
import type { PackageRemoteResolutionOutcome } from './types.js';
import {
  fetchRemotePackageMetadata,
  pullDownloadsBatchFromRemote,
  aggregateRecursiveDownloads,
  parseDownloadIdentifier,
  isPartialDownload
} from '../remote-pull.js';
import { packageManager } from '../package.js';
import { getVersionInfoFromDependencyTree } from '../../utils/install-helpers.js';

import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';
import { computeMissingDownloadKeys, createDownloadKey } from './download-keys.js';
import { extractRemoteErrorReason } from '../../utils/error-reasons.js';
import { recordBatchOutcome } from './remote-reporting.js';
import { mapReasonLabelToOutcome } from './install-errors.js';

function extractReasonFromFailure(failure: RemotePullFailure): string {
  switch (failure.reason) {
    case 'not-found':
      return 'not found in remote registry';
    case 'access-denied':
      return 'access denied';
    case 'network':
      return 'network error';
    case 'integrity':
      return 'integrity check failed';
    default:
      return failure.message ? extractRemoteErrorReason(failure.message) : 'unknown error';
  }
}

/**
 * Fetch metadata for missing dependencies
 */
export async function fetchMissingDependencyMetadata(
  missing: string[],
  resolvedPackages: ResolvedPackage[],
  opts: {
    dryRun: boolean;
    profile?: string;
    apiKey?: string;
    alreadyWarnedPackages?: Set<string>;
    onFailure?: (name: string, failure: RemotePullFailure) => void;
  },
  output?: OutputPort
): Promise<RemotePackageMetadataSuccess[]> {
  const out = output ?? resolveOutput();
  const { dryRun, alreadyWarnedPackages } = opts;
  const uniqueMissing = Array.from(new Set(missing));
  const metadataResults: RemotePackageMetadataSuccess[] = [];

  const metadataSpinner = dryRun ? null : out.spinner();
  if (metadataSpinner) metadataSpinner.start(`Fetching metadata for ${uniqueMissing.length} missing package(s)...`);

  try {
    for (const missingName of uniqueMissing) {
      let requiredVersion: string | undefined;
      try {
        const versionInfo = await getVersionInfoFromDependencyTree(missingName, resolvedPackages);
        requiredVersion = versionInfo.requiredVersion;
      } catch (error) {
        // Failed to determine required version, continue without it
      }

      const metadataResult = await fetchRemotePackageMetadata(missingName, requiredVersion, { recursive: true, profile: opts.profile, apiKey: opts.apiKey });
      if (!metadataResult.success) {
        // Skip warning if we already warned about this package during resolution
        if (!alreadyWarnedPackages?.has(missingName)) {
          const packageLabel = requiredVersion ? `${missingName}@${requiredVersion}` : missingName;
          const reason = extractReasonFromFailure(metadataResult);
          // Avoid garbled output by stopping the spinner before printing
          // warning messages, since the spinner writes to the same stdout line.
          if (metadataSpinner) {
            metadataSpinner.stop();
          }
          out.warn(`Remote pull failed for \`${packageLabel}\` (reason: ${reason})`);
        }
        opts.onFailure?.(missingName, metadataResult);
        continue;
      }

      metadataResults.push(metadataResult);
    }
  } finally {
    if (metadataSpinner) metadataSpinner.stop();
  }

  return metadataResults;
}

/**
 * Pull missing dependencies from remote
 */
export async function pullMissingDependencies(
  metadata: RemotePackageMetadataSuccess[],
  keysToDownload: Set<string>,
  opts: { dryRun: boolean; profile?: string; apiKey?: string },
  output?: OutputPort
): Promise<RemoteBatchPullResult[]> {
  const out = output ?? resolveOutput();
  const { dryRun } = opts;
  const batchResults: RemoteBatchPullResult[] = [];
  const warnings: string[] = [];

  if (keysToDownload.size > 0 || dryRun) {
    const spinner = dryRun ? null : out.spinner();
    if (spinner) spinner.start(`Pulling ${keysToDownload.size} missing dependency package(s) from remote...`);

    try {
      const remainingKeys = new Set(keysToDownload);

      for (const metadataResult of metadata) {
        if (!dryRun && remainingKeys.size === 0) {
          break;
        }

        const batchResult = await pullDownloadsBatchFromRemote(metadataResult.response, {
          httpClient: metadataResult.context.httpClient,
          profile: opts.profile || metadataResult.context.profile,
          apiKey: opts.apiKey,
          dryRun,
          filter: (dependencyName, dependencyVersion) => {
            const key = createDownloadKey(dependencyName, dependencyVersion);
            if (!keysToDownload.has(key)) {
              return false;
            }

            if (dryRun) {
              return true;
            }

            if (!remainingKeys.has(key)) {
              return false;
            }

            remainingKeys.delete(key);
            return true;
          }
        });

        batchResults.push(batchResult);
      }
    } finally {
      if (spinner) spinner.stop();
    }
  }

  return batchResults;
}

export function updateRemoteOutcomesFromBatch(
  batchResult: RemoteBatchPullResult,
  remoteOutcomes: Record<string, PackageRemoteResolutionOutcome>
): void {
  if (!batchResult.failed || batchResult.failed.length === 0) {
    return;
  }

  for (const failure of batchResult.failed) {
    const reasonLabel = extractRemoteErrorReason(failure.error ?? 'Unknown error');
    const reasonTag = mapReasonLabelToOutcome(reasonLabel);
    const packageName = failure.name;
    const message = `Remote pull failed for \`${packageName}\` (reason: ${reasonLabel})`;

    remoteOutcomes[packageName] = {
      name: packageName,
      reason: reasonTag,
      message
    };
  }
}

function computeRetryEligibleMissing(
  names: string[],
  remoteOutcomes: Record<string, PackageRemoteResolutionOutcome>
): string[] {
  return names.filter(name => {
    const outcome = remoteOutcomes[name];
    if (!outcome) {
      return true;
    }
    return outcome.reason !== 'not-found' && outcome.reason !== 'access-denied';
  });
}

export interface PullMissingDependenciesContext {
  missingPackages: string[];
  resolvedPackages: ResolvedPackage[];
  remoteOutcomes: Record<string, PackageRemoteResolutionOutcome>;
  warnedPackages: Set<string>;
  dryRun: boolean;
  profile?: string;
  apiKey?: string;
}

export interface PullMissingDependenciesResult {
  pulledAny: boolean;
  warnings: string[];
}

export async function pullMissingDependenciesIfNeeded(
  context: PullMissingDependenciesContext
): Promise<PullMissingDependenciesResult> {
  const retryEligibleMissing = computeRetryEligibleMissing(context.missingPackages, context.remoteOutcomes);
  if (retryEligibleMissing.length === 0) {
    return { pulledAny: false, warnings: [] };
  }

  const metadataResults = await fetchMissingDependencyMetadata(retryEligibleMissing, context.resolvedPackages, {
    dryRun: context.dryRun,
    profile: context.profile,
    apiKey: context.apiKey,
    alreadyWarnedPackages: context.warnedPackages,
    onFailure: (name, failure) => {
      context.remoteOutcomes[name] = {
        name,
        reason: failure.reason,
        message: failure.message ?? `Remote pull failed for \`${name}\``
      };
    }
  });

  if (metadataResults.length === 0) {
    return { pulledAny: false, warnings: [] };
  }

  const keysToDownload = new Set<string>();
  for (const metadata of metadataResults) {
    const aggregated = aggregateRecursiveDownloads([metadata.response]);
    const missingKeys = await computeMissingDownloadKeys(aggregated);
    missingKeys.forEach(key => keysToDownload.add(key));
  }

  const batchResults = await pullMissingDependencies(metadataResults, keysToDownload, {
    dryRun: context.dryRun,
    profile: context.profile,
    apiKey: context.apiKey
  });

  const warnings: string[] = [];
  for (const batchResult of batchResults) {
    recordBatchOutcome('Pulled dependencies', batchResult, warnings, context.dryRun);
    updateRemoteOutcomesFromBatch(batchResult, context.remoteOutcomes);
  }

  return { pulledAny: metadataResults.length > 0, warnings };
}


