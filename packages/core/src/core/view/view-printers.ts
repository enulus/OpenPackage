/**
 * View Printers
 *
 * Rendering functions for the `opkg view` command output.
 * Shows package contents (metadata, resources, dependencies) — not workspace
 * install state. Uses shared low-level tree primitives from list-tree-renderer.
 */

import type { ListPackageReport, ListFileMapping, ListResourceGroup } from '../list/list-pipeline.js';
import type { RemoteListResult, RemoteListDependency } from '../list/remote-list-resolver.js';
import { flattenResourceGroups, renderFlatResourceList, type TreeRenderConfig } from '../list/list-tree-renderer.js';
import { formatPathForDisplay } from '../../utils/formatters.js';
import {
  dim,
  sectionHeader,
  printMetadataSection,
} from '../list/list-printers.js';
import type { ViewMetadataEntry } from '../list/view-metadata.js';
import type { HeaderInfo } from '../list/scope-data-collector.js';
import type { LocalPackageResult } from './view-pipeline.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';

// ---------------------------------------------------------------------------
// Shared render config for ListFileMapping (no scope/status annotations)
// ---------------------------------------------------------------------------

function createViewFileConfig(pathBase?: string): TreeRenderConfig<ListFileMapping> {
  return {
    formatPath: (file) =>
      pathBase ? formatPathForDisplay(file.target, pathBase) : file.target,
    isMissing: (file) => !file.exists,
    sortFiles: (a, b) => {
      const pathA = pathBase ? formatPathForDisplay(a.target, pathBase) : a.target;
      const pathB = pathBase ? formatPathForDisplay(b.target, pathBase) : b.target;
      return pathA.localeCompare(pathB);
    }
  };
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function printHeader(
  headerInfo: HeaderInfo,
  sourceLabel?: string,
  out?: OutputPort
): void {
  const o = out ?? resolveOutput();
  const version = headerInfo.version ? `@${headerInfo.version}` : '';
  const typeTag = dim(`[${headerInfo.type}]`);
  const pathOrSource = sourceLabel
    ? dim(`(${sourceLabel})`) + ' ' + dim('[remote]')
    : dim(`(${headerInfo.path})`) + ' ' + typeTag;
  o.info(`${headerInfo.name}${version} ${pathOrSource}`);
}

// ---------------------------------------------------------------------------
// Resources section
// ---------------------------------------------------------------------------

function printResourcesSection(
  report: ListPackageReport,
  showFiles: boolean,
  pathBase?: string,
  out?: OutputPort,
): void {
  const o = out ?? resolveOutput();

  if (report.resourceGroups && report.resourceGroups.length > 0) {
    const flatResources = flattenResourceGroups(report.resourceGroups);
    o.info(sectionHeader('Resources', flatResources.length));
    const config = createViewFileConfig(pathBase);
    renderFlatResourceList(flatResources, '', showFiles, config, false, o);
  } else if (report.fileList && report.fileList.length > 0) {
    o.info(sectionHeader('Resources', report.fileList.length));
    const sortedFiles = [...report.fileList].sort((a, b) => a.target.localeCompare(b.target));
    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      const isLast = i === sortedFiles.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const label = file.exists ? dim(file.target) : `${dim(file.target)} \x1b[31m[MISSING]\x1b[0m`;
      o.info(`${connector}${label}`);
    }
  } else {
    o.info(sectionHeader('Resources', 0));
    o.info(dim('└── (no resources)'));
  }
}

// ---------------------------------------------------------------------------
// Dependencies section
// ---------------------------------------------------------------------------

function printDependenciesSection(
  dependencies: string[] | RemoteListDependency[],
  out?: OutputPort,
): void {
  const o = out ?? resolveOutput();
  if (dependencies.length === 0) return;

  o.info(sectionHeader('Dependencies', dependencies.length));
  dependencies.forEach((dep, index) => {
    const isLast = index === dependencies.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    if (typeof dep === 'string') {
      o.info(`${connector}${dep}`);
    } else {
      const versionSuffix = dep.version ? `@${dep.version}` : '';
      o.info(`${connector}${dep.name}${versionSuffix}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Public: unified view printer for local packages
// ---------------------------------------------------------------------------

/**
 * Print package detail view for a locally resolved package.
 * Shows: header, [Metadata], [Resources], [Dependencies].
 */
export function printLocalPackageView(
  result: LocalPackageResult,
  showFiles: boolean,
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();
  const { report, headerInfo, metadata } = result;

  printHeader(headerInfo, undefined, out);
  printMetadataSection(metadata, out);
  printResourcesSection(report, showFiles, report.path, out);

  if (report.dependencies !== undefined && report.dependencies.length > 0) {
    printDependenciesSection(report.dependencies, out);
  }
}

// ---------------------------------------------------------------------------
// Public: unified view printer for remote packages
// ---------------------------------------------------------------------------

/**
 * Print package detail view for a remotely resolved package.
 * Shows: header, [Metadata], [Resources], [Dependencies].
 */
export function printRemotePackageView(
  result: RemoteListResult,
  showFiles: boolean,
  output?: OutputPort
): void {
  const out = output ?? resolveOutput();
  const pkg = result.package;

  const headerInfo: HeaderInfo = {
    name: pkg.name,
    version: pkg.version && pkg.version !== '0.0.0' ? pkg.version : undefined,
    path: result.sourceLabel,
    type: 'package',
  };

  printHeader(headerInfo, result.sourceLabel, out);

  const metadata = result.metadata ?? [];
  printMetadataSection(metadata, out);
  printResourcesSection(pkg, showFiles, undefined, out);
  printDependenciesSection(result.dependencies, out);
}
