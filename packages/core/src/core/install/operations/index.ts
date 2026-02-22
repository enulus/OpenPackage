/**
 * Install Operations
 * Core installation operations exported for use by pipelines
 */

export { installOrSyncRootFiles, type RootFileOperationResult, type RootFileInput } from './root-files.js';
export { checkAndHandleAllPackageConflicts } from './conflict-handler.js';
export {
  performIndexBasedInstallationPhases,
  type InstallationPhasesParams,
  type InstallationPhasesResult,
  type ConflictSummary
} from './installation-executor.js';
