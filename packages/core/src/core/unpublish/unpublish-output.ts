import { formatPathForDisplay, formatFileCount } from '../../utils/formatters.js';
import type { OutputPort } from '../ports/output.js';
import { resolveOutput } from '../ports/resolve.js';
import type { UnpublishData } from './unpublish-types.js';

/**
 * Display success message after unpublish operation
 */
export function displayUnpublishSuccess(data: UnpublishData, cwd: string, output?: OutputPort): void {
  const out = output ?? resolveOutput();
  const displayPath = formatPathForDisplay(data.path, cwd);
  
  out.info(''); // Spacing
  
  if (data.versionsRemoved === 1 && data.version) {
    // Single version unpublished
    out.success(`Unpublished ${data.packageName}@${data.version}`);
  } else {
    // All versions unpublished
    out.success(`Unpublished ${data.packageName} (${data.versionsRemoved} versions)`);
  }
  
  out.success(`Removed: ${formatFileCount(data.fileCount)}`);
  out.success(`From: ${displayPath}`);
  
  // Show remaining versions if any
  if (data.remainingVersions.length > 0) {
    out.info('');
    out.info(`Remaining versions: ${data.remainingVersions.join(', ')}`);
  }
  
  out.info('');
}
