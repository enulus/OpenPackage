import type { PackageRemoteResolutionOutcome } from './types.js';
import type { RelocatedFile } from './conflicts/file-conflict-resolver.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';
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

function renderTreeList(items: string[], output: OutputPort, indent: string = '  '): void {
  for (let i = 0; i < items.length; i++) {
    const connector = getTreeConnector(i === items.length - 1);
    output.info(`${indent}${connector}${items[i]}`);
  }
}

// ============================================================================
// Main display function
// ============================================================================

export function displayInstallationResults(data: InstallReportData, output: OutputPort = resolveOutput()): void {
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
    output.error(`Failed to install ${packageName}${mainPackage ? `@${mainPackage.version}` : ''}`);
    if (errors && errors.length > 0) {
      output.error(`Installation errors:`);
      for (const error of errors) {
        output.info(`   • ${error}`);
      }
    }
    return;
  }

  // Handle empty directory/filtered installs (0 files but still success)
  if (!installedAnyFiles && !hadErrors) {
    let summaryText = `Succeeded ${packageName}`;
    if (mainPackage) {
      summaryText += `@${mainPackage.version}`;
    }
    summaryText += ' with 0 installs';
    output.success(`${summaryText}`);
    output.info(`💡 No files matched. The package directory may be empty or filters excluded all content.`);
    if (isDependencyInstall) {
      output.info(`   The dependency has been recorded in your manifest.`);
    }
    return;
  }

  // ── Main success header ───────────────────────────────────────────────
  let summaryText = `Installed ${packageName}`;
  if (mainPackage) {
    summaryText += `@${mainPackage.version}`;
  }
  output.success(`${summaryText}`);

  // ── Dependency packages ───────────────────────────────────────────────
  const dependencyPackages = resolvedPackages.filter(f => !f.isRoot);
  if (dependencyPackages.length > 0) {
    output.success(`Installed dependencies: ${dependencyPackages.length}`);
    const depLines = dependencyPackages.map(dep => {
      const packageSpecifier =
        typeof dep.name === 'string' && (dep.name.startsWith('@') || dep.name.startsWith('gh@'))
          ? dep.name
          : `@${dep.name}`;
      return `${packageSpecifier}@${dep.version}`;
    });
    renderTreeList(depLines, output);
  }
  output.success(`Total packages processed: ${resolvedPackages.length}`);

  // ── Installed files ───────────────────────────────────────────────────
  if (installedFiles && installedFiles.length > 0) {
    const header = namespaced
      ? `Installed files: ${installedFiles.length} (namespaced)`
      : `Installed files: ${installedFiles.length}`;
    output.success(header);
    const sortedFiles = [...installedFiles].sort((a, b) => a.localeCompare(b));
    renderTreeList(sortedFiles.map(f => formatPathForDisplay(f)), output);
  }

  // ── Updated files ─────────────────────────────────────────────────────
  if (updatedFiles && updatedFiles.length > 0) {
    const header = namespaced
      ? `Updated files: ${updatedFiles.length} (namespaced)`
      : `Updated files: ${updatedFiles.length}`;
    output.success(header);
    const sortedFiles = [...updatedFiles].sort((a, b) => a.localeCompare(b));
    renderTreeList(sortedFiles.map(f => formatPathForDisplay(f)), output);
  }

  // ── Relocated files (namespace-triggered moves) ───────────────────────
  if (relocatedFiles && relocatedFiles.length > 0) {
    output.success(`Relocated files: ${relocatedFiles.length}`);
    const lines = relocatedFiles.map(
      r => `${formatPathForDisplay(r.from)} → ${formatPathForDisplay(r.to)}`
    );
    renderTreeList(lines, output);
  }

  // ── Root files ────────────────────────────────────────────────────────
  if (rootFileResults) {
    const totalRootFiles = rootFileResults.installed.length + rootFileResults.updated.length;
    if (totalRootFiles > 0) {
      output.success(`Root files: ${totalRootFiles} file(s)`);

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
      renderTreeList(rootLines, output);
    }
  }

  // ── Platform directories ──────────────────────────────────────────────
  if (platformResult.created.length > 0) {
    output.success(`Created platform directories: ${platformResult.created.join(', ')}`);
  }

  // ── Partial failure: errors during an otherwise-successful install ────
  if (hadErrors && errors && errors.length > 0) {
    output.warn(`Errors during installation: ${errors.length}`);
    renderTreeList(errors, output);
  }

  // ── Missing dependencies ──────────────────────────────────────────────
  if (missingPackages && missingPackages.length > 0) {
    output.warn(`Missing dependencies detected:`);
    for (const missing of missingPackages) {
      const reasonLabel = formatMissingDependencyReason(missingPackageOutcomes?.[missing]);
      output.info(`   • ${missing} (${reasonLabel})`);
    }
    output.info(`💡 To resolve missing dependencies:`);
    output.info(`   • Create locally: opkg new <package-name>`);
    output.info(`   • Install from registry/git: opkg install ${missingPackages.join(' ')}`);
    output.info(`   • Remove from openpackage.yml`);
    output.info('');
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
