import { Command } from 'commander';

import { CommandResult, type ExecutionContext } from '../types/index.js';
import { withErrorHandling, ValidationError } from '../utils/errors.js';
import { createExecutionContext } from '../core/execution-context.js';
import { getRegistryDirectories, listAllPackages, listPackageVersions } from '../core/directory.js';
import { getLocalPackagesDir } from '../utils/paths.js';
import { exists, listDirectories } from '../utils/fs.js';
import { getTreeConnector, getChildPrefix } from '../core/list/list-tree-renderer.js';

// ANSI color codes
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

interface SearchOptions {
  global?: boolean;
  project?: boolean;
  all?: boolean;
}

interface SearchResult {
  projectPackages: string[];
  globalPackages: string[];
  registryPackages: RegistryPackageInfo[];
}

interface RegistryPackageInfo {
  name: string;
  versions: string[];  // sorted latest first
}

/**
 * Scan a /packages directory for package names
 */
async function scanPackagesDirectory(packagesDir: string): Promise<string[]> {
  if (!(await exists(packagesDir))) {
    return [];
  }
  
  const dirs = await listDirectories(packagesDir);
  
  // Filter and sort, handle scoped packages (@scope)
  return dirs
    .filter(name => !name.startsWith('.'))  // Skip hidden dirs
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Scan the /registry directory for packages and versions
 */
async function scanRegistryDirectory(showAll: boolean): Promise<RegistryPackageInfo[]> {
  // Use listAllPackages() which handles scoped packages properly
  const packages = await listAllPackages();
  
  const results: RegistryPackageInfo[] = [];
  
  for (const packageName of packages) {
    // Use listPackageVersions() which filters and sorts versions
    const versions = await listPackageVersions(packageName);
    
    if (versions.length > 0) {
      results.push({
        name: packageName,
        versions  // Already sorted latest-first by listPackageVersions()
      });
    }
  }
  
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Display a packages section with tree rendering
 */
function displayPackagesSection(title: string, packages: string[], prefix: string = ''): void {
  if (packages.length === 0) return;
  
  console.log(dim(title));
  
  for (let i = 0; i < packages.length; i++) {
    const isLast = i === packages.length - 1;
    const connector = getTreeConnector(isLast, false);
    console.log(`${prefix}${connector}${packages[i]}`);
  }
  
  console.log();  // Empty line after section
}

/**
 * Display the registry section with versions
 */
function displayRegistrySection(packages: RegistryPackageInfo[], showAll: boolean, prefix: string = ''): void {
  if (packages.length === 0) return;
  
  console.log(dim('Registry (~/.openpackage/registry):'));
  
  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    const isLast = i === packages.length - 1;
    
    if (showAll && pkg.versions.length > 1) {
      // Show package with nested versions
      const hasBranches = true;
      const connector = getTreeConnector(isLast, hasBranches);
      console.log(`${prefix}${connector}${pkg.name}`);
      
      const childPrefix = getChildPrefix(prefix, isLast);
      
      for (let vi = 0; vi < pkg.versions.length; vi++) {
        const version = pkg.versions[vi];
        const isLastVersion = vi === pkg.versions.length - 1;
        const versionConnector = getTreeConnector(isLastVersion, false);
        console.log(`${childPrefix}${versionConnector}${version}`);
      }
    } else {
      // Show package with latest version only
      const latestVersion = pkg.versions[0];
      const connector = getTreeConnector(isLast, false);
      console.log(`${prefix}${connector}${pkg.name}@${latestVersion}`);
    }
  }
  
  console.log();  // Empty line after section
}

/**
 * Display all search results
 */
function displayResults(
  result: SearchResult, 
  showAll: boolean, 
  showProject: boolean, 
  showGlobal: boolean
): void {
  let hasAnyResults = false;
  
  // Display project packages
  if (showProject && result.projectPackages.length > 0) {
    displayPackagesSection('Project Packages (./.openpackage/packages):', result.projectPackages);
    hasAnyResults = true;
  }
  
  // Display global packages
  if (showGlobal && result.globalPackages.length > 0) {
    displayPackagesSection('Global Packages (~/.openpackage/packages):', result.globalPackages);
    hasAnyResults = true;
  }
  
  // Display registry packages
  if (showGlobal && result.registryPackages.length > 0) {
    displayRegistrySection(result.registryPackages, showAll);
    hasAnyResults = true;
  }
  
  if (!hasAnyResults) {
    console.log(dim('No packages found.'));
  }
}

/**
 * Main search command handler
 */
async function searchCommand(
  options: SearchOptions,
  command: Command
): Promise<CommandResult> {
  const programOpts = command.parent?.opts() || {};
  
  // Validation
  if (options.global && options.project) {
    throw new ValidationError('Cannot use --global and --project together.');
  }
  
  const showBothScopes = !options.global && !options.project;
  const showGlobal = options.global || showBothScopes;
  const showProject = options.project || showBothScopes;
  
  const result: SearchResult = {
    projectPackages: [],
    globalPackages: [],
    registryPackages: []
  };
  
  // Scan project packages
  if (showProject) {
    const projectContext = await createExecutionContext({
      global: false,
      cwd: programOpts.cwd
    });
    const projectPackagesDir = getLocalPackagesDir(projectContext.targetDir);
    result.projectPackages = await scanPackagesDirectory(projectPackagesDir);
  }
  
  // Scan global packages
  if (showGlobal) {
    const globalContext = await createExecutionContext({
      global: true,
      cwd: programOpts.cwd
    });
    const globalPackagesDir = getLocalPackagesDir(globalContext.targetDir);
    result.globalPackages = await scanPackagesDirectory(globalPackagesDir);
  }
  
  // Scan registry (only if global scope)
  if (showGlobal) {
    result.registryPackages = await scanRegistryDirectory(options.all || false);
  }
  
  // Display results
  displayResults(result, options.all || false, showProject, showGlobal);
  
  return { success: true };
}

/**
 * Commander setup
 */
export function setupSearchCommand(program: Command): void {
  program
    .command('search')
    .description('List all available packages in local registry and packages directories')
    .option('-p, --project', 'search project packages only (./.openpackage/packages)')
    .option('-g, --global', 'search global packages and registry only (~/.openpackage/)')
    .option('-a, --all', 'show all versions for registry packages (default: latest only)')
    .action(withErrorHandling(async (options: SearchOptions, command: Command) => {
      await searchCommand(options, command);
    }));
}
