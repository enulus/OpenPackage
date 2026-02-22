/**
 * Install Helpers
 * Helper utilities specific to installation
 */

export { discoverAndCategorizeFiles } from './file-discovery.js';

// Format detection
export {
  loadPackageFileList,
  detectFormatFromDirectory,
  detectFormatWithContextFromDirectory
} from './format-detection.js';

// Result logging
export {
  logConflicts,
  logErrors,
  logConflictMessages,
  logErrorMessages,
  logInstallationResult
} from './result-logging.js';

// Result aggregation
export {
  mergeFileMappings,
  mergeWorkspaceFileMappings,
  aggregateFlowResults,
  collectConflictMessages,
  collectErrorMessages
} from './result-aggregation.js';

// Conflict detection
export {
  trackTargetFiles,
  generateConflictReports,
  type FileTargetWriter
} from './conflict-detection.js';
