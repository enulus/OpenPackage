import * as yaml from 'js-yaml';
import { PackageDependency, PackageYml } from '../types/index.js';
import { readTextFile, writeTextFile } from './fs.js';
import { isScopedName } from '../core/scoping/package-scoping.js';

/**
 * Parse openpackage.yml file with validation and backward compatibility
 */
export async function parsePackageYml(packageYmlPath: string): Promise<PackageYml> {
  try {
    const content = await readTextFile(packageYmlPath);
    const parsed = yaml.load(content) as PackageYml;
    const isPartial = (parsed as any).partial === true;
    
    // Backward compatibility: migrate old keys to new keys
    if (parsed.packages && !parsed.dependencies) {
      parsed.dependencies = parsed.packages;
    }
    // Delete old key to ensure it doesn't persist through round-trip serialization
    delete parsed.packages;
    
    if (parsed['dev-packages'] && !parsed['dev-dependencies']) {
      parsed['dev-dependencies'] = parsed['dev-packages'];
    }
    // Delete old key to ensure it doesn't persist through round-trip serialization
    delete parsed['dev-packages'];
    
    // Auto-migrate old plugin naming format
    let needsPluginMigration = false;
    let needsGitHubMigration = false;
    let needsSubdirectoryMigration = false;
    const { detectOldPluginNaming, detectOldGitHubNaming } = await import('./plugin-naming.js');
    
    if (parsed.dependencies) {
      for (const dep of parsed.dependencies) {
        // Ignore deprecated include field from legacy manifests
        delete (dep as any).include;

        // Check for old plugin naming (marketplace name vs repo name)
        const newPluginName = detectOldPluginNaming(dep);
        if (newPluginName) {
          dep.name = newPluginName;
          needsPluginMigration = true;
        }
        
        // Check for old GitHub naming (@username/repo vs gh@username/repo)
        const newGitHubName = detectOldGitHubNaming(dep);
        if (newGitHubName) {
          dep.name = newGitHubName;
          needsGitHubMigration = true;
        }
        
        // Migrate git → url and ref → embed in url
        if (dep.git && !dep.url) {
          dep.url = dep.git;
          if (dep.ref) {
            // Only embed ref if url doesn't already have one
            if (!dep.url.includes('#')) {
              dep.url = `${dep.url}#${dep.ref}`;
            }
            delete dep.ref;
          }
          delete dep.git;
        }
        
        // Migrate subdirectory field to path field
        if (dep.subdirectory && (dep.git || dep.url) && !dep.path) {
          // Normalize path: strip leading ./ if present
          const normalizedPath = dep.subdirectory.startsWith('./')
            ? dep.subdirectory.substring(2)
            : dep.subdirectory;
          dep.path = normalizedPath;
          delete dep.subdirectory;
          needsSubdirectoryMigration = true;
        }
      }
    }
    
    if (parsed['dev-dependencies']) {
      for (const dep of parsed['dev-dependencies']) {
        // Ignore deprecated include field from legacy manifests
        delete (dep as any).include;

        // Check for old plugin naming (marketplace name vs repo name)
        const newPluginName = detectOldPluginNaming(dep);
        if (newPluginName) {
          dep.name = newPluginName;
          needsPluginMigration = true;
        }
        
        // Check for old GitHub naming (@username/repo vs gh@username/repo)
        const newGitHubName = detectOldGitHubNaming(dep);
        if (newGitHubName) {
          dep.name = newGitHubName;
          needsGitHubMigration = true;
        }
        
        // Migrate git → url and ref → embed in url
        if (dep.git && !dep.url) {
          dep.url = dep.git;
          if (dep.ref) {
            // Only embed ref if url doesn't already have one
            if (!dep.url.includes('#')) {
              dep.url = `${dep.url}#${dep.ref}`;
            }
            delete dep.ref;
          }
          delete dep.git;
        }
        
        // Migrate subdirectory field to path field
        if (dep.subdirectory && (dep.git || dep.url) && !dep.path) {
          // Normalize path: strip leading ./ if present
          const normalizedPath = dep.subdirectory.startsWith('./')
            ? dep.subdirectory.substring(2)
            : dep.subdirectory;
          dep.path = normalizedPath;
          delete dep.subdirectory;
          needsSubdirectoryMigration = true;
        }
      }
    }
    
    // Mark for logging on write
    if (needsPluginMigration) {
      (parsed as any)._needsPluginMigration = true;
    }
    if (needsGitHubMigration) {
      (parsed as any)._needsGitHubMigration = true;
    }
    if (needsSubdirectoryMigration) {
      (parsed as any)._needsSubdirectoryMigration = true;
    }
    
    const validateDependencies = (deps: PackageDependency[] | undefined, section: string): void => {
      if (!deps) return;
      for (const dep of deps) {
        // For git/url sources, path is a subdirectory, not a source
        // For non-git sources, path is a source
        const hasGitSource = dep.git || dep.url;
        const sources = hasGitSource
          ? [dep.version, dep.git, dep.url].filter(Boolean)
          : [dep.version, dep.path, dep.git, dep.url].filter(Boolean);
        
        if (sources.length > 1) {
          throw new Error(
            `openpackage.yml ${section}: dependency '${dep.name}' has multiple sources; specify at most one of version, path, url, or git`
          );
        }
        if (dep.ref && !(dep.git || dep.url)) {
          throw new Error(
            `openpackage.yml ${section}: dependency '${dep.name}' has ref but no git/url source`
          );
        }
        // Validate legacy subdirectory field (should have been migrated)
        if (dep.subdirectory && !hasGitSource) {
          throw new Error(
            `openpackage.yml ${section}: dependency '${dep.name}' has subdirectory field without git/url source`
          );
        }
        // Warn if both subdirectory and path exist (shouldn't happen after migration)
        if (dep.subdirectory && dep.path) {
          throw new Error(
            `openpackage.yml ${section}: dependency '${dep.name}' has both subdirectory and path fields; use path only`
          );
        }
        // Phase 5: Validate base field
        if (dep.base !== undefined) {
          // Base should be a string (relative path)
          if (typeof dep.base !== 'string') {
            throw new Error(
              `openpackage.yml ${section}: dependency '${dep.name}' has invalid base field; must be a string`
            );
          }
          // Base should not start with / or be absolute
          if (dep.base.startsWith('/')) {
            throw new Error(
              `openpackage.yml ${section}: dependency '${dep.name}' has absolute base path; base must be relative to repository root`
            );
          }
        }
      }
    };
    
    // Validate required fields
    if (!parsed.name) {
      throw new Error('openpackage.yml must contain a name field');
    }

    if (isPartial) {
      (parsed as any).partial = true;
    } else {
      delete (parsed as any).partial;
    }

    // Validate both old and new keys
    validateDependencies(parsed.dependencies, 'dependencies');
    validateDependencies(parsed['dev-dependencies'], 'dev-dependencies');
    validateDependencies(parsed.packages, 'packages');
    validateDependencies(parsed['dev-packages'], 'dev-packages');
    
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse openpackage.yml: ${error}`);
  }
}

/**
 * Write openpackage.yml file with consistent formatting
 */
export function serializePackageYml(config: PackageYml): string {
  // First generate YAML with default block style
  let content = yaml.dump(config, {
    indent: 2,
    noArrayIndent: true,
    sortKeys: false,
    quotingType: '"', // Prefer double quotes for consistency
    lineWidth: -1, // Disable line wrapping to prevent folded scalar style (>-)
  });

  // Ensure scoped names (starting with @ or gh@) are quoted
  const scoped = isScopedName(config.name);
  if (scoped) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('name:')) {
        const valueMatch = lines[i].match(/name:\s*(.+)$/);
        if (valueMatch) {
          const value = valueMatch[1].trim();
          if (!value.startsWith('"') && !value.startsWith("'")) {
            lines[i] = lines[i].replace(/name:\s*(.+)$/, `name: "${config.name}"`);
          }
        }
        break;
      }
    }
    content = lines.join('\n');
  }

  // Convert arrays from block style to flow style
  const flowStyleArrays = ['keywords'];

  for (const arrayField of flowStyleArrays) {
    const arrayValue = config[arrayField as keyof PackageYml];
    if (Array.isArray(arrayValue) && arrayValue.length > 0) {
      const lines = content.split('\n');
      const result: string[] = [];
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];

        if (line.trim() === `${arrayField}:`) {
          const arrayFlow = `${arrayField}: [${arrayValue.join(', ')}]`;
          result.push(arrayFlow);

          i++;
          while (i < lines.length && lines[i].trim().startsWith('-')) {
            i++;
          }
          continue;
        }

        result.push(line);
        i++;
      }

      content = result.join('\n');
    }
  }

  return content;
}

export async function writePackageYml(packageYmlPath: string, config: PackageYml): Promise<void> {
  // Auto-migrate old keys to new keys when writing
  const migratedConfig = { ...config };
  
  // Rename packages -> dependencies
  if (migratedConfig.packages && !migratedConfig.dependencies) {
    migratedConfig.dependencies = migratedConfig.packages;
  }
  delete migratedConfig.packages;
  
  // Rename dev-packages -> dev-dependencies
  if (migratedConfig['dev-packages'] && !migratedConfig['dev-dependencies']) {
    migratedConfig['dev-dependencies'] = migratedConfig['dev-packages'];
  }
  delete migratedConfig['dev-packages'];
  
  // Clean up legacy fields from all dependencies
  const cleanLegacyFields = (deps: PackageDependency[] | undefined) => {
    if (!deps) return;
    for (const dep of deps) {
      delete dep.subdirectory;
      delete dep.git;
      delete dep.ref;
      delete (dep as any).include;
    }
  };
  
  cleanLegacyFields(migratedConfig.dependencies);
  cleanLegacyFields(migratedConfig['dev-dependencies']);
  
  // Log if plugin naming was migrated
  if ((config as any)._needsPluginMigration) {
    const { logger } = await import('./logger.js');
    logger.info('✓ Migrated plugin naming to new format');
    delete (migratedConfig as any)._needsPluginMigration;
  }
  
  // Log if GitHub naming was migrated
  if ((config as any)._needsGitHubMigration) {
    const { logger } = await import('./logger.js');
    logger.info('✓ Migrated GitHub package names to new format');
    delete (migratedConfig as any)._needsGitHubMigration;
  }
  
  // Log if subdirectory field was migrated
  if ((config as any)._needsSubdirectoryMigration) {
    const { logger } = await import('./logger.js');
    logger.info('✓ Migrated subdirectory fields to path');
    delete (migratedConfig as any)._needsSubdirectoryMigration;
  }
  
  const content = serializePackageYml(migratedConfig);
  await writeTextFile(packageYmlPath, content);
}

