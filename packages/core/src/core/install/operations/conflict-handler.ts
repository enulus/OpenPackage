import { join } from 'path';
import { InstallOptions } from '../../../types/index.js';
import type { InteractionPolicy } from '../../../core/interaction-policy.js';
import { PromptTier } from '../../../core/interaction-policy.js';
import type { ResolvedPackage } from '../../dependency-resolver/types.js';
import { checkExistingPackageInMarkdownFiles } from '../../openpackage.js';
import { parsePackageYml } from '../../../utils/package-yml.js';
import { exists } from '../../../utils/fs.js';
import { logger } from '../../../utils/logger.js';
import { getLocalPackageDir } from '../../../utils/paths.js';
import { FILE_PATTERNS } from '../../../constants/index.js';
import { getVersionInfoFromDependencyTree } from '../install-helpers.js';
import type { OutputPort } from '../../ports/output.js';
import type { PromptPort } from '../../ports/prompt.js';
import { resolvePrompt, resolveOutput } from '../../ports/resolve.js';

/**
 * Get currently installed version from .openpackage/packages/<package>/openpackage.yml
 */
async function getInstalledPackageVersion(cwd: string, packageName: string): Promise<string | undefined> {
  try {
    const packageDir = getLocalPackageDir(cwd, packageName);
    const packageYmlPath = join(packageDir, FILE_PATTERNS.OPENPACKAGE_YML);
    if (await exists(packageYmlPath)) {
      const config = await parsePackageYml(packageYmlPath);
      return config.version;
    }
  } catch {
    // ignore parse errors; treat as unknown
  }
  return undefined;
}

/**
 * Check for conflicts with all packages in the dependency tree
 */
export async function checkAndHandleAllPackageConflicts(
  resolvedPackages: ResolvedPackage[],
  options: InstallOptions,
  policy?: InteractionPolicy,
  prompt?: PromptPort,
  output?: OutputPort
): Promise<{ shouldProceed: boolean; skippedPackages: string[]; forceOverwritePackages: Set<string> }> {
  const cwd = process.cwd();
  const skippedPackages: string[] = [];
  const forceOverwritePackages = new Set<string>();
  const p = prompt ?? resolvePrompt();
  const out = output ?? resolveOutput();
  
  // Check each package in the dependency tree for conflicts
  for (const resolved of resolvedPackages) {
    const existingCheck = await checkExistingPackageInMarkdownFiles(cwd, resolved.name);
    
    if (existingCheck.found) {
      const versionInfo = await getVersionInfoFromDependencyTree(resolved.name, resolvedPackages);
      const existingVersion = existingCheck.version || await getInstalledPackageVersion(cwd, resolved.name);
      

      
      if (options.dryRun) {
        // In dry run mode, proceed; per-file logic will report decisions
        continue;
      }
      
      if (options.force) {
        // When --force is used, automatically overwrite all conflicts
        logger.info(`Force flag set - automatically overwriting package '${resolved.name}' v${existingVersion}`);
        forceOverwritePackages.add(resolved.name);
        continue;
      }
      
      // Prompt per package overwrite confirmation when existing detected
      if (policy && !policy.canPrompt(PromptTier.Confirmation)) {
        out.warn(`Skipping '${resolved.name}' (already exists). Use --force to overwrite.`);
        skippedPackages.push(resolved.name);
      } else {
        const versionSuffix = existingVersion ? ` (${existingVersion})` : '';
        const confirmed = await p.confirm(
          `Package '${resolved.name}' already exists${versionSuffix}. Overwrite all files?`
        );
        if (confirmed) {
          forceOverwritePackages.add(resolved.name);
        } else {
          skippedPackages.push(resolved.name);
        }
      }
      continue;
    }
  }
  
  return { shouldProceed: true, skippedPackages, forceOverwritePackages };
}
