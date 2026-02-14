import { formatPathForDisplay, formatFileCount } from '../../utils/formatters.js';
import type { UnpublishData } from './unpublish-types.js';

/**
 * Display success message after unpublish operation
 */
export function displayUnpublishSuccess(data: UnpublishData, cwd: string): void {
  const displayPath = formatPathForDisplay(data.path, cwd);
  
  console.log(''); // Spacing
  
  if (data.versionsRemoved === 1 && data.version) {
    // Single version unpublished
    console.log(`✓ Unpublished ${data.packageName}@${data.version}`);
  } else {
    // All versions unpublished
    console.log(`✓ Unpublished ${data.packageName} (${data.versionsRemoved} versions)`);
  }
  
  console.log(`✓ Removed: ${formatFileCount(data.fileCount)}`);
  console.log(`✓ From: ${displayPath}`);
  
  // Show remaining versions if any
  if (data.remainingVersions.length > 0) {
    console.log('');
    console.log(`💡 Remaining versions: ${data.remainingVersions.join(', ')}`);
  }
  
  console.log('');
}
