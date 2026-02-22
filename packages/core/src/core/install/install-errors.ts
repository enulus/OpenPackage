import type { InstallVersionSelectionResult } from './version-selection.js';
import type { PackageRemoteResolutionOutcome, InstallResolutionMode } from './types.js';

export function buildNoVersionFoundError(
  packageName: string,
  constraint: string,
  selection: InstallVersionSelectionResult['selection'],
  mode: InstallResolutionMode
): Error {
  const stableList = formatVersionList(selection.availableStable);
  const prereleaseList = formatVersionList(selection.availablePrerelease);
  const suggestions = [
    'Edit .openpackage/openpackage.yml or adjust the CLI range, then retry.',
    'Create a new package version locally using opkg new.'
  ];

  if (mode === 'local-only') {
    suggestions.push('Re-run without --local to include remote versions in resolution.');
  }

  const message = [
    `No version of '${packageName}' satisfies '${constraint}'.`,
    `Available stable versions: ${stableList}`,
    `Available WIP/pre-release versions: ${prereleaseList}`,
    'Suggested next steps:',
    ...suggestions.map(suggestion => `  • ${suggestion}`)
  ].join('\n');

  return new Error(message);
}

export function formatVersionList(versions: string[]): string {
  if (!versions || versions.length === 0) {
    return 'none';
  }
  return versions.join(', ');
}

export function mapReasonLabelToOutcome(
  reasonLabel: string
): PackageRemoteResolutionOutcome['reason'] {
  switch (reasonLabel) {
    case 'not found in remote registry':
    case 'not found in registry':
      return 'not-found';
    case 'access denied':
      return 'access-denied';
    case 'network error':
      return 'network';
    case 'integrity check failed':
      return 'integrity';
    default:
      return 'unknown';
  }
}

