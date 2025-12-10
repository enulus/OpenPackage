import * as yaml from 'js-yaml';
import { PullPackageDownload, PullPackageResponse } from '../types/api.js';
import { Package, PackageYml } from '../types/index.js';
import { packageManager } from './package.js';
import type { PackageVersionState } from './package.js';
import { ensureRegistryDirectories } from './directory.js';
import { authManager } from './auth.js';
import { createHttpClient, HttpClient } from '../utils/http-client.js';
import { extractPackageFromTarball, verifyTarballIntegrity, ExtractedPackage } from '../utils/tarball.js';
import { logger } from '../utils/logger.js';
import { ConfigError, ValidationError } from '../utils/errors.js';
import { PACKAGE_PATHS } from '../constants/index.js';
import { formatVersionLabel } from '../utils/package-versioning.js';
import { normalizeRegistryPath } from '../utils/registry-entry-filter.js';
import { mergePackageFiles } from '../utils/package-merge.js';

const NETWORK_ERROR_PATTERN = /(fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|network)/i;

function matchesNetworkPattern(value: unknown): boolean {
  return typeof value === 'string' && NETWORK_ERROR_PATTERN.test(value);
}

function isNetworkFailure(error: Error): boolean {
  if (matchesNetworkPattern(error.message)) {
    return true;
  }

  const cause = (error as any).cause;
  if (cause && (matchesNetworkPattern(cause.message) || matchesNetworkPattern(cause.code) || matchesNetworkPattern(cause.errno))) {
    return true;
  }

  if (matchesNetworkPattern((error as any).code) || matchesNetworkPattern((error as any).errno)) {
    return true;
  }

  return false;
}

export interface RemotePullContext {
  httpClient: HttpClient;
  profile: string;
  registryUrl: string;
}

export interface RemotePullOptions {
  profile?: string;
  apiKey?: string;
  quiet?: boolean;
  preFetchedResponse?: PullPackageResponse;
  httpClient?: HttpClient;
  recursive?: boolean;
  paths?: string[];
}

export interface RemoteBatchPullOptions extends RemotePullOptions {
  dryRun?: boolean;
  filter?: (name: string, version: string, download: PullPackageDownload) => boolean;
  skipIfFull?: boolean;
}

export type RemotePullFailureReason =
  | 'not-found'
  | 'access-denied'
  | 'network'
  | 'integrity'
  | 'unknown';

export interface RemotePullFailure {
  success: false;
  reason: RemotePullFailureReason;
  message: string;
  statusCode?: number;
  error?: unknown;
}

export interface RemotePullSuccess {
  success: true;
  name: string;
  version: string;
  response: PullPackageResponse;
  extracted: ExtractedPackage;
  registryUrl: string;
  profile: string;
  downloadUrl: string;
  tarballSize: number;
}

export type RemotePullResult = RemotePullSuccess | RemotePullFailure;

export interface RemotePackageMetadataSuccess {
  success: true;
  context: RemotePullContext;
  response: PullPackageResponse;
}

export type RemotePackageMetadataResult = RemotePackageMetadataSuccess | RemotePullFailure;

export interface BatchDownloadItemResult {
  name: string;
  version: string;
  downloadUrl?: string;
  success: boolean;
  error?: string;
}

export interface RemoteBatchPullResult {
  success: boolean;
  pulled: BatchDownloadItemResult[];
  failed: BatchDownloadItemResult[];
  warnings?: string[];
}

function normalizeDownloadPaths(paths?: string[]): string[] {
  if (!paths || paths.length === 0) {
    return [];
  }

  const normalized = paths
    .filter(path => typeof path === 'string')
    .map(path => path.startsWith('/') ? path.slice(1) : path)
    .map(path => normalizeRegistryPath(path))
    .filter(path => path.length > 0);

  return Array.from(new Set(normalized));
}

export function buildPullEndpoint(
  name: string,
  version?: string,
  options?: { recursive?: boolean; paths?: string[] }
): string {
  const encodedName = encodeURIComponent(name);
  const hasVersion = version && version !== 'latest';
  const endpoint = hasVersion
    ? `/packages/pull/by-name/${encodedName}/v/${encodeURIComponent(version as string)}`
    : `/packages/pull/by-name/${encodedName}`;

  const params: string[] = [];
  if (options?.recursive) {
    params.push('recursive=true');
  }

  const normalizedPaths = normalizeDownloadPaths(options?.paths);
  if (normalizedPaths.length > 0) {
    const encodedPaths = normalizedPaths.map(path => encodeURIComponent(path)).join(',');
    params.push(`paths=${encodedPaths}`);
    params.push('includeManifest=true');
  }

  if (params.length === 0) {
    return endpoint;
  }

  const delimiter = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${delimiter}${params.join('&')}`;
}

/**
 * Parse a download identifier that may contain registry path segments.
 *
 * Supports forms like:
 *   - foo@1.2.3
 *   - foo/bar@1.2.3
 *   - @scope/foo/bar@1.2.3
 *   - foo@1.2.3/path/to/file
 *   - @scope/foo@1.2.3/path/to/file
 *
+ * The registry path (if present) is returned separately so callers can
 * preserve file-level intent once the backend supports file-scoped downloads.
 */
export function parseDownloadIdentifier(
  downloadName: string
): { packageName: string; version: string; registryPath?: string } {
  const atIndex = downloadName.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === downloadName.length - 1) {
    throw new Error(`Invalid download name '${downloadName}'. Expected format '<package>@<version>'.`);
  }

  const rawName = downloadName.slice(0, atIndex);
  const rawVersion = downloadName.slice(atIndex + 1);

  // Parse package name and optional path from the name portion
  let packageName: string;
  let namePath: string | undefined;
  if (rawName.startsWith('@')) {
    const segments = rawName.split('/');
    if (segments.length < 2) {
      throw new Error(`Invalid scoped package in download name '${downloadName}'.`);
    }
    packageName = segments.slice(0, 2).join('/'); // @scope/pkg
    namePath = segments.length > 2 ? segments.slice(2).join('/') : undefined;
  } else {
    const segments = rawName.split('/');
    packageName = segments[0];
    namePath = segments.length > 1 ? segments.slice(1).join('/') : undefined;
  }

  // Parse version and optional path from the version portion
  const versionSegments = rawVersion.split('/');
  const version = versionSegments[0];
  const versionPath = versionSegments.length > 1 ? versionSegments.slice(1).join('/') : undefined;

  if (!packageName || !version) {
    throw new Error(`Invalid download name '${downloadName}'. Expected format '<package>@<version>'.`);
  }

  const registryPathParts = [namePath, versionPath].filter(Boolean) as string[];
  const registryPath = registryPathParts.length > 0 ? registryPathParts.join('/') : undefined;

  return { packageName, version, registryPath };
}

/**
 * Backward-compatible wrapper returning only name/version.
 */
export function aggregateRecursiveDownloads(responses: PullPackageResponse[]): PullPackageDownload[] {
  const aggregated = new Map<string, PullPackageDownload>();

  for (const response of responses) {
    if (!Array.isArray(response.downloads)) {
      continue;
    }

    for (const download of response.downloads) {
      if (!download?.name) {
        continue;
      }

      const existing = aggregated.get(download.name);

      if (!existing) {
        aggregated.set(download.name, download);
        continue;
      }

      if (!existing.downloadUrl && download.downloadUrl) {
        aggregated.set(download.name, download);
      }
    }
  }

  return Array.from(aggregated.values());
}

export function isPartialDownload(download?: PullPackageDownload): boolean {
  return Array.isArray(download?.include);
}

export async function pullDownloadsBatchFromRemote(
  responses: PullPackageResponse | PullPackageResponse[],
  options: RemoteBatchPullOptions = {}
): Promise<RemoteBatchPullResult> {
  const responseArray = Array.isArray(responses) ? responses : [responses];

  if (responseArray.length === 0) {
    return { success: true, pulled: [], failed: [] };
  }

  await ensureRegistryDirectories();

  const context = await createContext(options);
  const httpClient = context.httpClient;

  const downloads = aggregateRecursiveDownloads(responseArray);
  const pulled: BatchDownloadItemResult[] = [];
  const failed: BatchDownloadItemResult[] = [];
  const warnings: string[] = [];
  const stateCache = new Map<string, PackageVersionState>();

  const getLocalState = async (name: string, version: string): Promise<PackageVersionState> => {
    const key = `${name}@${formatVersionLabel(version)}`;
    const cached = stateCache.get(key);
    if (cached) {
      return cached;
    }
    const state = await packageManager.getPackageVersionState(name, version);
    stateCache.set(key, state);
    return state;
  };

  const tasks = downloads.map(async (download) => {
    const identifier = download.name;

    let parsedName: { packageName: string; version: string; registryPath?: string };

    try {
      parsedName = parseDownloadIdentifier(identifier);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Skipping download '${identifier}': ${message}`);
      failed.push({ name: identifier, version: '', downloadUrl: download.downloadUrl, success: false, error: message });
      return;
    }

    const { packageName: name, version } = parsedName;
    const isPartial = isPartialDownload(download);

    try {
      if (options.filter && !options.filter(name, version, download)) {
        return;
      }

      if (!download.downloadUrl) {
        const warning = `Download URL missing for ${identifier}`;
        logger.warn(warning);
        warnings.push(warning);
        failed.push({ name, version, downloadUrl: download.downloadUrl, success: false, error: 'download-url-missing' });
        return;
      }

      if (isPartial && options.skipIfFull !== false) {
        const localState = await getLocalState(name, version);
        if (localState.exists && !localState.isPartial) {
          const skipMessage = `${name}@${version} already exists locally (full); skipping partial download`;
          logger.info(skipMessage);
          warnings.push(skipMessage);
          pulled.push({ name, version, downloadUrl: download.downloadUrl, success: true });
          return;
        }
      }

      if (options.dryRun) {
        pulled.push({ name, version, downloadUrl: download.downloadUrl, success: true });
        return;
      }

      const tarballBuffer = await downloadPackageTarball(httpClient, download.downloadUrl);
      const extracted = await extractPackageFromTarball(tarballBuffer);
      const metadata = buildPackageMetadata(extracted, name, version);

      await packageManager.savePackage(
        { metadata, files: extracted.files },
        { partial: isPartial }
      );

      pulled.push({ name, version, downloadUrl: download.downloadUrl, success: true });
    } catch (error) {
      logger.debug('Batch download failed', { identifier, error });
      failed.push({
        name,
        version,
        downloadUrl: download.downloadUrl,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  await Promise.all(tasks);

  return {
    success: failed.length === 0,
    pulled,
    failed,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

function buildPackageMetadata(
  extracted: ExtractedPackage,
  fallbackName: string,
  fallbackVersion: string
): PackageYml {
  const packageFile = extracted.files.find(
    file => file.path === PACKAGE_PATHS.MANIFEST_RELATIVE
  );

  if (packageFile) {
    try {
      const parsed = yaml.load(packageFile.content) as PackageYml | undefined;

      if (parsed && typeof parsed === 'object' && parsed.name && parsed.version) {
        return parsed;
      }

      logger.debug('Parsed package.yml missing required fields, falling back to inferred metadata', {
        fallbackName,
        fallbackVersion
      });
    } catch (error) {
      logger.debug('Failed to parse package.yml from extracted tarball', {
        fallbackName,
        fallbackVersion,
        error
      });
    }
  }

  return {
    name: fallbackName,
    version: fallbackVersion,
  } as PackageYml;
}

export async function fetchRemotePackageMetadata(
  name: string,
  version: string | undefined,
  options: RemotePullOptions = {}
): Promise<RemotePackageMetadataResult> {
  try {
    await ensureRegistryDirectories();

    const context = await createContext(options);
    const response = await getRemotePackage(
      context.httpClient,
      name,
      version,
      options.recursive,
      options.paths
    );

    return {
      success: true,
      context,
      response
    };
  } catch (error) {
    return mapErrorToFailure(error);
  }
}

export async function pullPackageFromRemote(
  name: string,
  version?: string,
  options: RemotePullOptions = {}
): Promise<RemotePullResult> {
  try {
    const metadataResult = options.preFetchedResponse
      ? await createResultFromPrefetched(options)
      : await fetchRemotePackageMetadata(name, version, options);

    if (!metadataResult.success) {
      return metadataResult;
    }

    const { context, response } = metadataResult;
    const primaryDownload = resolvePrimaryDownload(response);
    if (!primaryDownload?.downloadUrl) {
      return {
        success: false,
        reason: 'access-denied',
        message: 'Package download not available for this account',
      };
    }

    const isPartial = isPartialDownload(primaryDownload);
    const tarballBuffer = await downloadPackageTarball(context.httpClient, primaryDownload.downloadUrl);

    const expectedSize = isPartial ? undefined : response.version.tarballSize;
    if (!verifyTarballIntegrity(tarballBuffer, expectedSize)) {
      return {
        success: false,
        reason: 'integrity',
        message: 'Tarball integrity verification failed'
      };
    }

    const extracted = await extractPackageFromTarball(tarballBuffer);

    await savePackageToLocalRegistry(response, extracted, {
      partial: isPartial
    });

    return {
      success: true,
      name: response.package.name,
      version: formatVersionLabel(response.version.version),
      response,
      extracted,
      registryUrl: context.registryUrl,
      profile: context.profile,
      downloadUrl: primaryDownload.downloadUrl,
      tarballSize: response.version.tarballSize
    };
  } catch (error) {
    return mapErrorToFailure(error);
  }
}

function resolvePrimaryDownload(response: PullPackageResponse): PullPackageDownload | undefined {
  if (!Array.isArray(response.downloads) || response.downloads.length === 0) {
    return undefined;
  }

  const primaryMatch = response.downloads.find(download => download.name === response.package.name && download.downloadUrl);
  if (primaryMatch?.downloadUrl) {
    return primaryMatch;
  }

  const fallbackMatch = response.downloads.find(download => download.downloadUrl);
  return fallbackMatch;
}

async function createResultFromPrefetched(options: RemotePullOptions): Promise<RemotePackageMetadataResult> {
  if (!options.preFetchedResponse) {
    throw new Error('preFetchedResponse missing from options');
  }

  const context = await createContext(options);

  return {
    success: true,
    context,
    response: options.preFetchedResponse
  };
}

async function createContext(options: RemotePullOptions): Promise<RemotePullContext> {
  const authOptions = {
    profile: options.profile,
    apiKey: options.apiKey
  };

  const httpClient = options.httpClient || await createHttpClient(authOptions);
  const profile = authManager.getCurrentProfile(authOptions);
  const registryUrl = authManager.getRegistryUrl();

  return {
    httpClient,
    profile,
    registryUrl
  };
}

async function getRemotePackage(
  httpClient: HttpClient,
  name: string,
  version?: string,
  recursive?: boolean,
  paths?: string[],
): Promise<PullPackageResponse> {
  const finalEndpoint = buildPullEndpoint(name, version, { recursive, paths });
  logger.debug(`Fetching remote package metadata`, {
    name,
    version: version ?? 'latest',
    endpoint: finalEndpoint,
    recursive: !!recursive,
    hasPaths: !!paths && paths.length > 0
  });
  return await httpClient.get<PullPackageResponse>(finalEndpoint);
}

async function downloadPackageTarball(httpClient: HttpClient, downloadUrl: string): Promise<Buffer> {
  const downloadHost = (() => {
    try {
      return new URL(downloadUrl).host;
    } catch {
      return '';
    }
  })();
  const registryHost = (() => {
    try {
      return new URL(authManager.getRegistryUrl()).host;
    } catch {
      return '';
    }
  })();
  const shouldSkipAuth = downloadHost !== '' && registryHost !== '' && downloadHost !== registryHost;
  const buffer = await httpClient.downloadFile(downloadUrl, { skipAuth: shouldSkipAuth });
  return Buffer.from(buffer);
}

async function savePackageToLocalRegistry(
  response: PullPackageResponse,
  extracted: ExtractedPackage,
  saveOptions: { partial?: boolean } = {}
): Promise<void> {
  const metadata: PackageYml & Record<string, unknown> = {
    name: response.package.name,
    version: response.version.version,
    description: response.package.description,
    keywords: response.package.keywords,
    private: response.package.isPrivate
  };

  (metadata as any).files = extracted.files.map(file => file.path);
  (metadata as any).created = response.version.createdAt;
  (metadata as any).updated = response.version.updatedAt;

  let files = extracted.files;

  if (saveOptions.partial) {
    try {
      const existing = await packageManager.loadPackage(response.package.name, response.version.version);
      files = mergePackageFiles(existing.files, files);
    } catch {
      // No existing version; keep files as-is
    }
  }

  await packageManager.savePackage(
    { metadata: metadata as PackageYml, files },
    { partial: Boolean(saveOptions.partial) }
  );
}

function mapErrorToFailure(error: unknown): RemotePullFailure {
  logger.debug('Remote pull operation failed', { error });

  if (error instanceof ValidationError) {
    return {
      success: false,
      reason: 'integrity',
      message: error.message,
      error
    };
  }

  if (error instanceof ConfigError) {
    return {
      success: false,
      reason: 'access-denied',
      message: error.message,
      error
    };
  }

  if (error instanceof Error) {
    const apiError = (error as any).apiError;

    if (apiError?.statusCode === 404) {
      const failure: RemotePullFailure = {
        success: false,
        reason: 'not-found',
        message: error.message,
        statusCode: 404,
        error
      };
      return failure;
    }

    if (apiError?.statusCode === 401 || apiError?.statusCode === 403) {
      return {
        success: false,
        reason: 'access-denied',
        message: error.message,
        statusCode: apiError.statusCode,
        error
      };
    }

    if (isNetworkFailure(error)) {
      return {
        success: false,
        reason: 'network',
        message: error.message,
        error
      };
    }

    return {
      success: false,
      reason: 'unknown',
      message: error.message,
      error
    };
  }

  return {
    success: false,
    reason: 'unknown',
    message: 'Unknown error occurred',
    error
  };
}


