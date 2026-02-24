import type { InstallationContext } from '../context.js';
import { checkAndHandleAllPackageConflicts } from '../../operations/conflict-handler.js';
import { logger } from '../../../../utils/logger.js';

/**
 * Process conflicts phase
 * @returns true if should proceed, false if cancelled
 */
export async function processConflictsPhase(ctx: InstallationContext): Promise<boolean> {
  const conflictResult = await checkAndHandleAllPackageConflicts(
    ctx.resolvedPackages as any,
    ctx.options,
    ctx.execution?.interactionPolicy,
    ctx.execution?.prompt,
    ctx.execution?.output
  );
  
  if (!conflictResult.shouldProceed) {
    return false;
  }
  
  // Update resolved packages based on conflict resolution
  ctx.resolvedPackages = ctx.resolvedPackages.filter(pkg => !conflictResult.skippedPackages.includes(pkg.name));
  
  // Store conflict result in context for use in the execute phase
  ctx.conflictResult = conflictResult;
  
  return true;
}
