import type { PackageRemoteResolutionOutcome } from './types.js';
import { extractRemoteErrorReason } from '../../utils/error-reasons.js';
import { formatPathForDisplay } from '../../utils/formatters.js';

export function formatSelectionSummary(
  source: 'local' | 'remote' | 'path',
  packageName: string,
  version: string
): string {
  // Don't add @ prefix if name already starts with @ or gh@
  const packageSpecifier = (packageName.startsWith('@') || packageName.startsWith('gh@')) 
    ? packageName 
    : `@${packageName}`;
  const sourceLabel = source === 'path' ? 'local path' : source;
  return `✓ Selected ${sourceLabel} ${packageSpecifier}@${version}`;
}

export function displayInstallationResults(
  packageName: string,
  resolvedPackages: any[],
  platformResult: { platforms: string[]; created: string[] },
  options: any,
  mainPackage?: any,
  allAddedFiles?: string[],
  allUpdatedFiles?: string[],
  rootFileResults?: { installed: string[]; updated: string[]; skipped: string[] },
  missingPackages?: string[],
  missingPackageOutcomes?: Record<string, PackageRemoteResolutionOutcome>,
  errorCount?: number,
  errors?: string[]
): void {
  // Check if installation actually succeeded
  const hadErrors = (errorCount && errorCount > 0) || false;
  const installedAnyFiles = (allAddedFiles && allAddedFiles.length > 0) || 
                            (allUpdatedFiles && allUpdatedFiles.length > 0) ||
                            (rootFileResults && (rootFileResults.installed.length > 0 || rootFileResults.updated.length > 0));
  
  if (hadErrors && !installedAnyFiles) {
    // Complete failure - nothing was installed
    console.log(`❌ Failed to install ${packageName}${mainPackage ? `@${mainPackage.version}` : ''}`);
    if (errors && errors.length > 0) {
      console.log(`\n❌ Installation errors:`);
      for (const error of errors) {
        console.log(`   • ${error}`);
      }
    }
    return;
  }
  
  // Phase 6: Handle empty directory/filtered installs (0 files but still success)
  if (!installedAnyFiles && !hadErrors) {
    let summaryText = `✓ Succeeded ${packageName}`;
    if (mainPackage) {
      summaryText += `@${mainPackage.version}`;
    }
    summaryText += ' with 0 installs';
    console.log(`${summaryText}`);
    console.log(`💡 No files matched the specified filters or directory is empty`);
    console.log(`   The dependency has been recorded in your manifest.`);
    return;
  }
  
  let summaryText = `✓ Installed ${packageName}`;
  if (mainPackage) {
    summaryText += `@${mainPackage.version}`;
  }

  console.log(`${summaryText}`);

  const dependencyPackages = resolvedPackages.filter(f => !f.isRoot);
  if (dependencyPackages.length > 0) {
    console.log(`✓ Installed dependencies: ${dependencyPackages.length}`);
    for (const dep of dependencyPackages) {
      // Don't add @ prefix if name already starts with @ or gh@
      const packageSpecifier =
        typeof dep.name === 'string' && (dep.name.startsWith('@') || dep.name.startsWith('gh@'))
          ? dep.name
          : `@${dep.name}`;
      console.log(`   ├── ${packageSpecifier}@${dep.version}`);
    }
  }
  console.log(`✓ Total packages processed: ${resolvedPackages.length}`);

  if (allAddedFiles && allAddedFiles.length > 0) {
    console.log(`✓ Added files: ${allAddedFiles.length}`);
    const sortedFiles = [...allAddedFiles].sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles) {
      console.log(`   ├── ${formatPathForDisplay(file)}`);
    }
  }

  if (allUpdatedFiles && allUpdatedFiles.length > 0) {
    console.log(`✓ Updated files: ${allUpdatedFiles.length}`);
    const sortedFiles = [...allUpdatedFiles].sort((a, b) => a.localeCompare(b));
    for (const file of sortedFiles) {
      console.log(`   ├── ${formatPathForDisplay(file)}`);
    }
  }

  if (rootFileResults) {
    const totalRootFiles = rootFileResults.installed.length + rootFileResults.updated.length;
    if (totalRootFiles > 0) {
      console.log(`✓ Root files: ${totalRootFiles} file(s)`);

      if (rootFileResults.installed.length > 0) {
        const sortedInstalled = [...rootFileResults.installed].sort((a, b) => a.localeCompare(b));
        for (const file of sortedInstalled) {
          console.log(`   ├── ${formatPathForDisplay(file)} (created)`);
        }
      }

      if (rootFileResults.updated.length > 0) {
        const sortedUpdated = [...rootFileResults.updated].sort((a, b) => a.localeCompare(b));
        for (const file of sortedUpdated) {
          console.log(`   ├── ${formatPathForDisplay(file)} (updated)`);
        }
      }
    }
  }

  if (platformResult.created.length > 0) {
    console.log(`✓ Created platform directories: ${platformResult.created.join(', ')}`);
  }

  if (missingPackages && missingPackages.length > 0) {
    console.log(`\n⚠️  Missing dependencies detected:`);
    for (const missing of missingPackages) {
      const reasonLabel = formatMissingDependencyReason(missingPackageOutcomes?.[missing]);
      console.log(`   • ${missing} (${reasonLabel})`);
    }
    console.log(`\n💡 To resolve missing dependencies:`);
    console.log(`   • Create locally: opkg new <package-name>`);
    console.log(`   • Install from registry/git: opkg install ${missingPackages.join(' ')}`);
    console.log(`   • Remove from openpackage.yml`);
    console.log('');
  }
}

function formatMissingDependencyReason(outcome?: PackageRemoteResolutionOutcome): string {
  if (!outcome) {
    return 'not found in registry';
  }

  switch (outcome.reason) {
    case 'not-found':
      return 'not found in remote registry';
    case 'access-denied':
      return 'access denied';
    case 'network':
      return 'network error';
    case 'integrity':
      return 'integrity check failed';
    default:
      return extractRemoteErrorReason(outcome.message || 'unknown error');
  }
}

