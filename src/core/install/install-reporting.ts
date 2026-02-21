import type { PackageRemoteResolutionOutcome } from './types.js';
import type { RelocatedFile } from './conflicts/file-conflict-resolver.js';
import { extractRemoteErrorReason } from '../../utils/error-reasons.js';
import { formatPathForDisplay, getTreeConnector } from '../../utils/formatters.js';

/**
 * Data required to render the install report.
 *
 * Replaces the previous 13-positional-parameter signature with a single
 * options object for clarity and extensibility.
 */
export interface InstallReportData {
  packageName: string;
  resolvedPackages: any[];
  platformResult: { platforms: string[]; created: string[] };
  options: any;
  mainPackage?: any;
  installedFiles?: string[];
  updatedFiles?: string[];
  rootFileResults?: { installed: string[]; updated: string[]; skipped: string[] };
  missingPackages?: string[];
  missingPackageOutcomes?: Record<string, PackageRemoteResolutionOutcome>;
  errorCount?: number;
  errors?: string[];
  /** When true, show "dependency recorded in your manifest" for 0-install success. Defaults to true. */
  isDependencyInstall?: boolean;
  /** True when namespace conflict resolution was triggered */
  namespaced?: boolean;
  /** Files that were physically relocated on disk during namespace resolution */
  relocatedFiles?: RelocatedFile[];
}

// ============================================================================
// Helper: render a list of items with correct tree connectors
// ============================================================================

function renderTreeList(items: string[], indent: string = '  '): void {
  for (let i = 0; i < items.length; i++) {
    const connector = getTreeConnector(i === items.length - 1);
    console.log(`${indent}${connector}${items[i]}`);
  }
}

// ============================================================================
// Main display function
// ============================================================================

export function displayInstallationResults(data: InstallReportData): void {
  const {
    packageName,
    resolvedPackages,
    platformResult,
    mainPackage,
    installedFiles,
    updatedFiles,
    rootFileResults,
    missingPackages,
    missingPackageOutcomes,
    errorCount,
    errors,
    isDependencyInstall = true,
    namespaced,
    relocatedFiles,
  } = data;

  // Check if installation actually succeeded
  const hadErrors = (errorCount && errorCount > 0) || false;
  const installedAnyFiles = (installedFiles && installedFiles.length > 0) ||
                            (updatedFiles && updatedFiles.length > 0) ||
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

  // Handle empty directory/filtered installs (0 files but still success)
  if (!installedAnyFiles && !hadErrors) {
    let summaryText = `✓ Succeeded ${packageName}`;
    if (mainPackage) {
      summaryText += `@${mainPackage.version}`;
    }
    summaryText += ' with 0 installs';
    console.log(`${summaryText}`);
    console.log(`💡 No files matched the specified filters or directory is empty`);
    if (isDependencyInstall) {
      console.log(`   The dependency has been recorded in your manifest.`);
    }
    return;
  }

  // ── Main success header ───────────────────────────────────────────────
  let summaryText = `✓ Installed ${packageName}`;
  if (mainPackage) {
    summaryText += `@${mainPackage.version}`;
  }
  console.log(`${summaryText}`);

  // ── Dependency packages ───────────────────────────────────────────────
  const dependencyPackages = resolvedPackages.filter(f => !f.isRoot);
  if (dependencyPackages.length > 0) {
    console.log(`✓ Installed dependencies: ${dependencyPackages.length}`);
    const depLines = dependencyPackages.map(dep => {
      const packageSpecifier =
        typeof dep.name === 'string' && (dep.name.startsWith('@') || dep.name.startsWith('gh@'))
          ? dep.name
          : `@${dep.name}`;
      return `${packageSpecifier}@${dep.version}`;
    });
    renderTreeList(depLines);
  }
  console.log(`✓ Total packages processed: ${resolvedPackages.length}`);

  // ── Installed files ───────────────────────────────────────────────────
  if (installedFiles && installedFiles.length > 0) {
    const header = namespaced
      ? `✓ Installed files: ${installedFiles.length} (namespaced)`
      : `✓ Installed files: ${installedFiles.length}`;
    console.log(header);
    const sortedFiles = [...installedFiles].sort((a, b) => a.localeCompare(b));
    renderTreeList(sortedFiles.map(f => formatPathForDisplay(f)));
  }

  // ── Updated files ─────────────────────────────────────────────────────
  if (updatedFiles && updatedFiles.length > 0) {
    const header = namespaced
      ? `✓ Updated files: ${updatedFiles.length} (namespaced)`
      : `✓ Updated files: ${updatedFiles.length}`;
    console.log(header);
    const sortedFiles = [...updatedFiles].sort((a, b) => a.localeCompare(b));
    renderTreeList(sortedFiles.map(f => formatPathForDisplay(f)));
  }

  // ── Relocated files (namespace-triggered moves) ───────────────────────
  if (relocatedFiles && relocatedFiles.length > 0) {
    console.log(`✓ Relocated files: ${relocatedFiles.length}`);
    const lines = relocatedFiles.map(
      r => `${formatPathForDisplay(r.from)} → ${formatPathForDisplay(r.to)}`
    );
    renderTreeList(lines);
  }

  // ── Root files ────────────────────────────────────────────────────────
  if (rootFileResults) {
    const totalRootFiles = rootFileResults.installed.length + rootFileResults.updated.length;
    if (totalRootFiles > 0) {
      console.log(`✓ Root files: ${totalRootFiles} file(s)`);

      const rootLines: string[] = [];
      if (rootFileResults.installed.length > 0) {
        const sortedInstalled = [...rootFileResults.installed].sort((a, b) => a.localeCompare(b));
        for (const file of sortedInstalled) {
          rootLines.push(`${formatPathForDisplay(file)} (created)`);
        }
      }
      if (rootFileResults.updated.length > 0) {
        const sortedUpdated = [...rootFileResults.updated].sort((a, b) => a.localeCompare(b));
        for (const file of sortedUpdated) {
          rootLines.push(`${formatPathForDisplay(file)} (updated)`);
        }
      }
      renderTreeList(rootLines);
    }
  }

  // ── Platform directories ──────────────────────────────────────────────
  if (platformResult.created.length > 0) {
    console.log(`✓ Created platform directories: ${platformResult.created.join(', ')}`);
  }

  // ── Partial failure: errors during an otherwise-successful install ────
  if (hadErrors && errors && errors.length > 0) {
    console.log(`⚠ Errors during installation: ${errors.length}`);
    renderTreeList(errors);
  }

  // ── Missing dependencies ──────────────────────────────────────────────
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
