import { planRemoteDownloadsForPackage } from '../install/remote-flow.js';
import { recordBatchOutcome } from '../install/remote-reporting.js';
import { formatVersionLabel } from '../../utils/package-versioning.js';
import { Spinner } from '../../utils/spinner.js';
import { pullDownloadsBatchFromRemote, pullPackageFromRemote, RemotePullContext, RemotePullFailure } from '../remote-pull.js';
import { PullPackageResponse } from '../../types/api.js';
import { PullPipelineResult, PartialPullConfig } from './pull-types.js';

interface PullSingleParams {
  parsedName: string;
  parsedVersion: string | undefined;
  response: PullPackageResponse;
  context: RemotePullContext;
  pullOptions: { profile?: string; apiKey?: string; recursive: boolean; paths?: string[] };
  registryUrl: string;
  profile: string;
  partialConfig?: PartialPullConfig;
}

interface PullRecursiveParams {
  parsedName: string;
  versionToPull: string;
  response: PullPackageResponse;
  context: RemotePullContext;
  registryUrl: string;
  profile: string;
}

export async function pullSingle({
  parsedName,
  parsedVersion,
  response,
  context,
  pullOptions,
  registryUrl,
  profile,
  partialConfig
}: PullSingleParams): Promise<PullPipelineResult> {
  const downloadSpinner = new Spinner('Downloading package tarball...');
  downloadSpinner.start();

  try {
    const pullResult = await pullPackageFromRemote(parsedName, parsedVersion, {
      ...pullOptions,
      preFetchedResponse: response,
      httpClient: context.httpClient,
      paths: partialConfig?.requestPaths
    });
    downloadSpinner.stop();

    if (!pullResult.success) {
      throw pullResult;
    }

    const extracted = pullResult.extracted;
    const resolvedVersion = formatVersionLabel(pullResult.response.version.version);

    return {
      packageName: pullResult.response.package.name,
      version: resolvedVersion,
      files: extracted.files.length,
      size: pullResult.response.version.tarballSize ?? 0,
      checksum: extracted.checksum,
      registry: registryUrl,
      profile,
      isPrivate: pullResult.response.package.isPrivate,
      downloadUrl: pullResult.downloadUrl,
      message: 'Package pulled and installed successfully'
    };
  } catch (error) {
    downloadSpinner.stop();
    throw error;
  }
}

export async function pullRecursive({
  parsedName,
  versionToPull,
  response,
  context,
  registryUrl,
  profile
}: PullRecursiveParams): Promise<PullPipelineResult> {
  const { downloadKeys, warnings: planWarnings } = await planRemoteDownloadsForPackage(
    { success: true, context, response },
    {}
  );

  if (planWarnings.length > 0) {
    planWarnings.forEach(warning => console.log(`⚠️  ${warning}`));
    console.log('');
  }

  if (downloadKeys.size === 0) {
    console.log('✓ All packages already exist locally, nothing to pull');
    console.log('');
    return {
      packageName: parsedName,
      version: versionToPull,
      files: 0,
      size: response.version.tarballSize ?? 0,
      checksum: '',
      registry: registryUrl,
      profile,
      isPrivate: response.package.isPrivate,
      downloadUrl: '',
      message: 'All packages already exist locally'
    };
  }

  const downloadSpinner = new Spinner(`Downloading ${downloadKeys.size} package(s) from remote registry...`);
  downloadSpinner.start();

  try {
    const batchResult = await pullDownloadsBatchFromRemote(response, {
      httpClient: context.httpClient,
      profile: context.profile,
      dryRun: false,
      filter: (dependencyName, dependencyVersion) => {
        const downloadKey = `${dependencyName}@${dependencyVersion}`;
        return downloadKeys.has(downloadKey);
      },
      skipIfFull: true
    });
    downloadSpinner.stop();

    recordBatchOutcome('Pulled packages', batchResult, [], false);

    if (!batchResult.success) {
      throw {
        success: false,
        reason: 'network',
        message: `Failed to pull ${batchResult.failed.length} package(s)`
      } as RemotePullFailure;
    }

    const mainPackageResult = batchResult.pulled.find(item => item.name === parsedName && item.version === versionToPull);

    return {
      packageName: parsedName,
      version: versionToPull,
      files: mainPackageResult ? 0 : 0,
      size: response.version.tarballSize ?? 0,
      checksum: '',
      registry: registryUrl,
      profile,
      isPrivate: response.package.isPrivate,
      downloadUrl: mainPackageResult?.downloadUrl || '',
      message: `Successfully pulled ${batchResult.pulled.length} package(s) (${batchResult.failed.length} failed)`
    };
  } catch (error) {
    downloadSpinner.stop();
    throw error;
  }
}


