import { PACKAGE_PATHS } from '../../constants/index.js';
import type { PushPackageResponse } from '../../types/api.js';
import type { Package } from '../../types/index.js';
import { formatFileSize } from '../../utils/formatters.js';
import type { HttpClient } from '../../utils/http-client.js';
import { normalizePathForProcessing } from '../../utils/path-normalization.js';
import { Spinner } from '../../utils/spinner.js';
import { createFormDataForUpload, createTarballFromPackage } from '../../utils/tarball.js';
import { serializePackageYml } from '../../utils/package-yml.js';

export function preparePackageForUpload(pkg: Package, uploadName: string): Package {
  if (pkg.metadata.name === uploadName) {
    return pkg;
  }

  const manifestPath = normalizePathForProcessing(PACKAGE_PATHS.MANIFEST_RELATIVE);
  const updatedMetadata = { ...pkg.metadata, name: uploadName };
  let manifestUpdated = false;

  const updatedFiles = pkg.files.map((file) => {
    if (normalizePathForProcessing(file.path) === manifestPath) {
      manifestUpdated = true;
      const content = serializePackageYml(updatedMetadata);
      return { ...file, content };
    }
    return file;
  });

  if (!manifestUpdated) {
    throw new Error('openpackage.yml not found in package files');
  }

  return {
    metadata: updatedMetadata,
    files: updatedFiles,
  };
}

export async function createPublishTarball(pkg: Package) {
  console.log('✓ Creating tarball...');
  const tarballInfo = await createTarballFromPackage(pkg);
  console.log(`✓ Created tarball (${pkg.files.length} files, ${formatFileSize(tarballInfo.size)})`);
  return tarballInfo;
}

export async function uploadPackage(
  httpClient: HttpClient,
  packageName: string,
  uploadVersion: string | undefined,
  tarballInfo: Awaited<ReturnType<typeof createTarballFromPackage>>
): Promise<PushPackageResponse> {
  const formData = createFormDataForUpload(packageName, uploadVersion, tarballInfo);
  const uploadSpinner = new Spinner('Uploading to registry...');
  return withSpinner(uploadSpinner, () =>
    httpClient.uploadFormData<PushPackageResponse>('/packages/push', formData)
  );
}

async function withSpinner<T>(spinner: Spinner, fn: () => Promise<T>): Promise<T> {
  spinner.start();
  try {
    return await fn();
  } finally {
    spinner.stop();
  }
}
