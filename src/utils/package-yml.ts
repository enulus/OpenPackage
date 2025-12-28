import * as yaml from 'js-yaml';
import { PackageDependency, PackageYml } from '../types/index.js';
import { readTextFile, writeTextFile } from './fs.js';
import { isScopedName } from '../core/scoping/package-scoping.js';

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
  return result.length > 0 ? result : undefined;
}

/**
 * Parse package.yml file with validation
 */
export async function parsePackageYml(packageYmlPath: string): Promise<PackageYml> {
  try {
    const content = await readTextFile(packageYmlPath);
    const parsed = yaml.load(content) as PackageYml;
    const isPartial = (parsed as any).partial === true;
    const validateDependencies = (deps: PackageDependency[] | undefined, section: 'packages' | 'dev-packages'): void => {
      if (!deps) return;
      for (const dep of deps) {
        const sources = [dep.version, dep.path, dep.git].filter(Boolean);
        if (sources.length === 0) {
          throw new Error(
            `package.yml ${section}: dependency '${dep.name}' must specify exactly one source: version, path, or git`
          );
        }
        if (sources.length > 1) {
          throw new Error(
            `package.yml ${section}: dependency '${dep.name}' has multiple sources; choose exactly one of version, path, or git`
          );
        }
        if (dep.ref && !dep.git) {
          throw new Error(
            `package.yml ${section}: dependency '${dep.name}' has ref but no git source`
          );
        }
      }
    };
    
    // Validate required fields
    if (!parsed.name) {
      throw new Error('package.yml must contain a name field');
    }

    const includeFilters = normalizeStringArray(parsed.include);
    const excludeFilters = normalizeStringArray(parsed.exclude);
    if (includeFilters) {
      parsed.include = includeFilters;
    } else {
      delete (parsed as any).include;
    }
    if (excludeFilters) {
      parsed.exclude = excludeFilters;
    } else {
      delete (parsed as any).exclude;
    }

    if (isPartial) {
      (parsed as any).partial = true;
    } else {
      delete (parsed as any).partial;
    }

    validateDependencies(parsed.packages, 'packages');
    validateDependencies(parsed['dev-packages'], 'dev-packages');
    
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse package.yml: ${error}`);
  }
}

/**
 * Write package.yml file with consistent formatting
 */
export function serializePackageYml(config: PackageYml): string {
  // First generate YAML with default block style
  let content = yaml.dump(config, {
    indent: 2,
    noArrayIndent: true,
    sortKeys: false,
    quotingType: '"', // Prefer double quotes for consistency
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
  const content = serializePackageYml(config);
  await writeTextFile(packageYmlPath, content);
}

