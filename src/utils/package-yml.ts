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
    if (parsed['dev-packages'] && !parsed['dev-dependencies']) {
      parsed['dev-dependencies'] = parsed['dev-packages'];
    }
    
    const validateDependencies = (deps: PackageDependency[] | undefined, section: string): void => {
      if (!deps) return;
      for (const dep of deps) {
        const sources = [dep.version, dep.path, dep.git].filter(Boolean);
        if (sources.length > 1) {
          throw new Error(
            `openpackage.yml ${section}: dependency '${dep.name}' has multiple sources; specify at most one of version, path, or git`
          );
        }
        if (dep.ref && !dep.git) {
          throw new Error(
            `openpackage.yml ${section}: dependency '${dep.name}' has ref but no git source`
          );
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

  // Ensure scoped names (starting with @) are quoted
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
  
  const content = serializePackageYml(migratedConfig);
  await writeTextFile(packageYmlPath, content);
}

