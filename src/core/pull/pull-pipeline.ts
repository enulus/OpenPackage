import { PullOptions, CommandResult } from '../../types/index.js';
import { packageManager } from '../package.js';
import { hasPackageVersion } from '../directory.js';
import { logger } from '../../utils/logger.js';
import { UserCancellationError } from '../../utils/errors.js';
import { parsePackageInstallSpec } from '../../utils/package-name.js';
import { promptOverwriteConfirmation } from '../../utils/prompts.js';
import { Spinner } from '../../utils/spinner.js';
import { formatVersionLabel } from '../../utils/package-versioning.js';
import { fetchRemotePackageMetadata, RemotePackageMetadataResult } from '../remote-pull.js';
import { buildRequestedPaths } from './pull-options.js';
import { displayPackageInfo, displayPullResults } from './pull-output.js';
import { handleMetadataFailure, handleUnexpectedError } from './pull-errors.js';
import { pullRecursive, pullSingle } from './pull-strategies.js';
import { PartialPullConfig, PullPipelineResult } from './pull-types.js';

export interface PullPipelineOptions extends PullOptions {}

export async function runPullPipeline(
  packageInput: string,
  options: PullPipelineOptions
): Promise<CommandResult<PullPipelineResult>> {
  const parsedSpec = parsePackageInstallSpec(packageInput);
  const parsedName = parsedSpec.name;
  const parsedVersion = parsedSpec.version;
  const specPath = parsedSpec.registryPath;
  const requestedPaths = buildRequestedPaths(options.paths, specPath);
  logger.info(`Pulling package '${parsedName}' from remote registry`, { options });

  try {
    const pullOptions = {
      profile: options.profile,
      apiKey: options.apiKey,
      recursive: !!options.recursive,
      paths: requestedPaths
    };

    console.log(`✓ Pulling package '${parsedName}' from remote registry...`);
    console.log(`✓ Version: ${parsedVersion ?? 'latest'}`);
    console.log('');

    const metadataResult = await fetchMetadataWithSpinner(parsedName, parsedVersion, pullOptions);

    if (!metadataResult.success) {
      return handleMetadataFailure(metadataResult, parsedName, parsedVersion);
    }

    const { response, context } = metadataResult;
    const registryUrl = context.registryUrl;
    const profile = context.profile;
    const versionToPull = formatVersionLabel(response.version.version);

    displayPackageInfo(response, parsedVersion, versionToPull, profile);

    if (requestedPaths.length > 0) {
      logPartialPullRequest(requestedPaths, options.recursive);
    }

    const partialConfig = await resolvePartialConfig(requestedPaths, parsedName, versionToPull);
    if (partialConfig === 'skip') {
      return {
        success: true,
        data: {
          packageName: parsedName,
          version: versionToPull,
          files: 0,
          size: response.version.tarballSize,
          checksum: '',
          registry: registryUrl,
          profile,
          isPrivate: response.package.isPrivate,
          downloadUrl: '',
          message: 'Local full version already present; partial pull skipped'
        }
      };
    }

    if (!options.recursive && versionToPull && requestedPaths.length === 0) {
      await handleVersionChecks(parsedName, versionToPull);
    }

    const result = options.recursive
      ? await pullRecursive({ parsedName, versionToPull, response, context, registryUrl, profile })
      : await pullSingle({
          parsedName,
          parsedVersion,
          response,
          context,
          pullOptions,
          registryUrl,
          profile,
          partialConfig: partialConfig ?? undefined
        });

    displayPullResults(result, response);

    return {
      success: true,
      data: result
    };
  } catch (error) {
    logger.debug('Pull pipeline failed', { error, packageName: parsedName });
    return handleUnexpectedError(error, parsedName, parsedVersion);
  }
}

async function fetchMetadataWithSpinner(
  parsedName: string,
  parsedVersion: string | undefined,
  pullOptions: { profile?: string; apiKey?: string; recursive: boolean; paths: string[] }
): Promise<RemotePackageMetadataResult> {
  const metadataSpinner = new Spinner('Querying registry for package...');
  metadataSpinner.start();

  try {
    const result = await fetchRemotePackageMetadata(parsedName, parsedVersion, pullOptions);
    metadataSpinner.stop();
    return result;
  } catch (error) {
    metadataSpinner.stop();
    throw error;
  }
}

async function handleVersionChecks(
  parsedName: string,
  versionToPull: string
): Promise<void> {
  const localVersionExists = await hasPackageVersion(parsedName, versionToPull);
  if (localVersionExists) {
    console.log(`⚠️  Version '${versionToPull}' of package '${parsedName}' already exists locally`);
    console.log('');

    const shouldProceed = await promptOverwriteConfirmation(parsedName, versionToPull);
    if (!shouldProceed) {
      throw new UserCancellationError('User declined to overwrite existing package version');
    }
    console.log('');
  }

  const localExists = await packageManager.packageExists(parsedName);
  if (localExists && !localVersionExists) {
    console.log(`✓ Package '${parsedName}' has other versions locally`);
    console.log('Pulling will add a new version.');
    console.log('');
  }
}

function logPartialPullRequest(requestedPaths: string[], isRecursive: boolean | undefined): void {
  console.log(`✓ Partial pull requested for paths: ${requestedPaths.join(', ')}`);
  if (isRecursive) {
    console.log('✓ Dependencies will be pulled fully; paths apply only to the primary package.');
  }
}

async function resolvePartialConfig(
  requestedPaths: string[],
  parsedName: string,
  versionToPull: string
): Promise<PartialPullConfig | 'skip' | undefined> {
  if (requestedPaths.length === 0) {
    return undefined;
  }

  const localState = await packageManager.getPackageVersionState(parsedName, versionToPull);

  if (localState.exists && !localState.isPartial) {
    console.log(`⚠️  ${parsedName}@${versionToPull} already exists locally (full). Skipping partial pull.`);
    return 'skip';
  }

  if (localState.isPartial) {
    console.log('✓ Existing partial version found locally; merging with remote content.');
  }

  return {
    requestPaths: requestedPaths,
    localState
  };
}

