import * as yaml from 'js-yaml';
import { PackageDependency, PackageYml } from '../types/index.js';
import { readTextFile, writeTextFile } from './fs.js';
import { isScopedName } from './package-name.js';

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
    
    // Auto-migrate old dependency formats
    const migrations = { plugin: false, gitHub: false, subdirectory: false, pathToBase: false };
    const { detectOldPluginNaming, detectOldGitHubNaming } = await import('./plugin-naming.js');

    const RESOURCE_PREFIXES = ['agents/', 'skills/', 'commands/', 'rules/', 'hooks/', 'mcps/'];

    const migrateDep = (dep: PackageDependency): void => {
      delete (dep as any).include;

      const newPluginName = detectOldPluginNaming(dep);
      if (newPluginName) { dep.name = newPluginName; migrations.plugin = true; }

      const newGitHubName = detectOldGitHubNaming(dep);
      if (newGitHubName) { dep.name = newGitHubName; migrations.gitHub = true; }

      if (dep.git && !dep.url) {
        dep.url = dep.git;
        if (dep.ref && !dep.url.includes('#')) { dep.url = `${dep.url}#${dep.ref}`; }
        delete dep.ref;
        delete dep.git;
      }

      if (dep.subdirectory && (dep.git || dep.url) && !dep.base) {
        dep.base = dep.subdirectory.startsWith('./') ? dep.subdirectory.substring(2) : dep.subdirectory;
        delete dep.subdirectory;
        migrations.subdirectory = true;
      }

      if (dep.path && !dep.base) {
        if (dep.url) {
          if (!RESOURCE_PREFIXES.some(p => dep.path!.startsWith(p))) {
            dep.base = dep.path;
            delete dep.path;
            migrations.pathToBase = true;
          }
        } else if (!dep.version) {
          if (dep.path.includes('.openpackage/packages/')) {
            delete dep.path;
          } else {
            dep.base = dep.path;
            delete dep.path;
          }
          migrations.pathToBase = true;
        }
      }
    };

    if (parsed.dependencies) parsed.dependencies.forEach(migrateDep);
    if (parsed['dev-dependencies']) parsed['dev-dependencies'].forEach(migrateDep);
    
    // Mark for logging on write
    if (migrations.plugin) (parsed as any)._needsPluginMigration = true;
    if (migrations.gitHub) (parsed as any)._needsGitHubMigration = true;
    if (migrations.subdirectory) (parsed as any)._needsSubdirectoryMigration = true;
    if (migrations.pathToBase) (parsed as any)._needsPathToBaseMigration = true;

    const validateDependencies = (deps: PackageDependency[] | undefined, section: string): void => {
      if (!deps) return;
      for (const dep of deps) {
        // Source fields: version, base (local path), url (git). path is resource selection, not a source.
        const hasGitSource = dep.git || dep.url;
        const sources = hasGitSource
          ? [dep.version, dep.git, dep.url].filter(Boolean)
          : [dep.version, dep.base, dep.git, dep.url].filter(Boolean);
        
        if (sources.length > 1) {
          throw new Error(
            `openpackage.yml ${section}: dependency '${dep.name}' has multiple sources; specify at most one of version, base, url, or git`
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
        // Validate base field
        if (dep.base !== undefined) {
          if (typeof dep.base !== 'string') {
            throw new Error(
              `openpackage.yml ${section}: dependency '${dep.name}' has invalid base field; must be a string`
            );
          }
          // For git sources, base must be relative (subdirectory within repo)
          if (dep.base.startsWith('/') && (dep.url || dep.git)) {
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
  const flowStyleArrays = ['keywords', 'platforms'];

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

  // Strip empty platforms (removal sentinel from --no-platforms)
  if (Array.isArray(migratedConfig.platforms) && migratedConfig.platforms.length === 0) {
    delete migratedConfig.platforms;
  }

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
    logger.info('✓ Migrated subdirectory fields to base');
    delete (migratedConfig as any)._needsSubdirectoryMigration;
  }

  // Log if path→base migration occurred
  if ((config as any)._needsPathToBaseMigration) {
    const { logger } = await import('./logger.js');
    logger.info('✓ Migrated path fields to base (source navigation)');
    delete (migratedConfig as any)._needsPathToBaseMigration;
  }
  
  const content = serializePackageYml(migratedConfig);
  await writeTextFile(packageYmlPath, content);
}

