/**
 * Flow Transforms
 * 
 * Transform implementations for the flow execution pipeline.
 * Organized by category: Format Converters, Merge Strategies, Content Filters, 
 * Markdown Processors, Value Transforms, Validation.
 */

import yaml from 'js-yaml';
import * as TOML from 'smol-toml';
import { logger } from '../../utils/logger.js';
import { serializeMarkdownDocument } from './markdown.js';

/**
 * Transform function interface
 */
export interface Transform {
  name: string;
  execute(input: any, options?: any): any;
  validate?(options?: any): boolean;
}

/**
 * Transform registry for managing and executing transforms
 */
export class TransformRegistry {
  private transforms = new Map<string, Transform>();

  /**
   * Register a transform
   */
  register(transform: Transform): void {
    this.transforms.set(transform.name, transform);
  }

  /**
   * Get a transform by name
   */
  get(name: string): Transform | undefined {
    return this.transforms.get(name);
  }

  /**
   * Check if transform exists
   */
  has(name: string): boolean {
    return this.transforms.has(name);
  }

  /**
   * Execute a transform by name
   */
  execute(name: string, input: any, options?: any): any {
    const transform = this.get(name);
    if (!transform) {
      throw new Error(`Transform not found: ${name}`);
    }

    // Validate options if validator exists
    if (transform.validate && !transform.validate(options)) {
      throw new Error(`Invalid options for transform: ${name}`);
    }

    return transform.execute(input, options);
  }

  /**
   * List all registered transform names
   */
  list(): string[] {
    return Array.from(this.transforms.keys());
  }
}

// ============================================================================
// Format Converters
// ============================================================================

/**
 * Parse JSONC (JSON with comments) to object
 */
export const jsoncTransform: Transform = {
  name: 'jsonc',
  execute(input: string): any {
    if (typeof input !== 'string') {
      return input;
    }

    // Strip comments from JSONC
    const stripped = input
      // Remove single-line comments
      .replace(/\/\/.*$/gm, '')
      // Remove multi-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Remove trailing commas
      .replace(/,(\s*[}\]])/g, '$1');

    return JSON.parse(stripped);
  },
};

/**
 * Convert between YAML and object
 */
export const yamlTransform: Transform = {
  name: 'yaml',
  execute(input: any, options?: { direction?: 'parse' | 'stringify' }): any {
    const direction = options?.direction || 'parse';

    if (direction === 'parse') {
      if (typeof input !== 'string') {
        return input;
      }
      return yaml.load(input);
    } else {
      // stringify
      return yaml.dump(input, {
        indent: 2,
        flowLevel: 1,  // Use compact flow style for arrays
        lineWidth: -1, // Disable line wrapping
        noRefs: true,  // Disable anchors/aliases
      });
    }
  },
};

/**
 * Convert between TOML and object
 * 
 * Uses smol-toml for TOML v1.0.0 compliant serialization and parsing.
 */
export const tomlTransform: Transform = {
  name: 'toml',
  execute(input: any, options?: { direction?: 'parse' | 'stringify' }): any {
    const direction = options?.direction || 'parse';

    if (direction === 'parse') {
      if (typeof input !== 'string') {
        return input;
      }
      try {
        return TOML.parse(input);
      } catch (error) {
        throw new Error(`TOML parse error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // stringify
      try {
        return TOML.stringify(input);
      } catch (error) {
        throw new Error(`TOML stringify error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  },
};

/**
 * Convert JSON object to TOML string
 */
export const jsonToTomlTransform: Transform = {
  name: 'json-to-toml',
  execute(input: any): string {
    return tomlTransform.execute(input, { direction: 'stringify' });
  },
};

/**
 * Convert TOML string to JSON object
 */
export const tomlToJsonTransform: Transform = {
  name: 'toml-to-json',
  execute(input: string): any {
    return tomlTransform.execute(input, { direction: 'parse' });
  },
};

// ============================================================================
// Content Filters
// ============================================================================

/**
 * Remove comments from JSONC/YAML strings
 */
export const filterCommentsTransform: Transform = {
  name: 'filter-comments',
  execute(input: any): any {
    if (typeof input !== 'string') {
      return input;
    }

    return input
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*#.*$/gm, '');
  },
};

/**
 * Remove empty strings, arrays, and objects
 */
export const filterEmptyTransform: Transform = {
  name: 'filter-empty',
  execute(input: any, options?: { recursive?: boolean }): any {
    const recursive = options?.recursive ?? true;

    if (Array.isArray(input)) {
      const filtered = input
        .filter(item => {
          if (item === '' || (Array.isArray(item) && item.length === 0)) {
            return false;
          }
          if (typeof item === 'object' && item !== null && Object.keys(item).length === 0) {
            return false;
          }
          return true;
        })
        .map(item => recursive && typeof item === 'object' ? filterEmptyTransform.execute(item, options) : item);

      return filtered;
    }

    if (typeof input === 'object' && input !== null) {
      const filtered: any = {};
      for (const [key, value] of Object.entries(input)) {
        if (value === '' || (Array.isArray(value) && value.length === 0)) {
          continue;
        }
        if (typeof value === 'object' && value !== null && Object.keys(value).length === 0) {
          continue;
        }
        filtered[key] = recursive && typeof value === 'object' ? filterEmptyTransform.execute(value, options) : value;
      }
      return filtered;
    }

    return input;
  },
};

/**
 * Remove null and undefined values
 */
export const filterNullTransform: Transform = {
  name: 'filter-null',
  execute(input: any, options?: { recursive?: boolean }): any {
    const recursive = options?.recursive ?? true;

    if (Array.isArray(input)) {
      return input
        .filter(item => item !== null && item !== undefined)
        .map(item => recursive && typeof item === 'object' ? filterNullTransform.execute(item, options) : item);
    }

    if (typeof input === 'object' && input !== null) {
      const filtered: any = {};
      for (const [key, value] of Object.entries(input)) {
        if (value === null || value === undefined) {
          continue;
        }
        filtered[key] = recursive && typeof value === 'object' ? filterNullTransform.execute(value, options) : value;
      }
      return filtered;
    }

    return input;
  },
};

// ============================================================================
// Markdown Transforms
// ============================================================================

/**
 * Split markdown by section headers
 */
export const sectionsTransform: Transform = {
  name: 'sections',
  execute(input: string, options?: { level?: number }): Record<string, string> {
    if (typeof input !== 'string') {
      return { content: String(input) };
    }

    const level = options?.level || 1;
    const headerRegex = new RegExp(`^#{${level}}\\s+(.+)$`, 'gm');
    const sections: Record<string, string> = {};

    let lastIndex = 0;
    let lastTitle = '_preamble';
    let match;

    while ((match = headerRegex.exec(input)) !== null) {
      // Save previous section
      if (lastIndex < match.index) {
        sections[lastTitle] = input.slice(lastIndex, match.index).trim();
      }

      // Start new section
      lastTitle = match[1].trim();
      lastIndex = match.index + match[0].length;
    }

    // Save final section
    if (lastIndex < input.length) {
      sections[lastTitle] = input.slice(lastIndex).trim();
    }

    return sections;
  },
};

/**
 * Extract YAML frontmatter from markdown
 */
export const frontmatterTransform: Transform = {
  name: 'frontmatter',
  execute(input: string): any {
    if (typeof input !== 'string') {
      return {};
    }

    const match = input.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (!match) {
      return {};
    }

    try {
      return yaml.load(match[1]) || {};
    } catch (error) {
      logger.warn(`Failed to parse frontmatter: ${error}`);
      return {};
    }
  },
};

/**
 * Extract markdown body (without frontmatter)
 */
export const bodyTransform: Transform = {
  name: 'body',
  execute(input: string): string {
    if (typeof input !== 'string') {
      return String(input);
    }

    const match = input.match(/^---\s*\n[\s\S]*?\n---\s*\n([\s\S]*)$/);
    if (match) {
      return match[1].trim();
    }

    return input.trim();
  },
};

// ============================================================================
// Value Transforms
// ============================================================================

/**
 * Type Converters
 */

export const numberTransform: Transform = {
  name: 'number',
  execute(input: any): number {
    const num = Number(input);
    if (isNaN(num)) {
      throw new Error(`Cannot convert to number: ${input}`);
    }
    return num;
  },
};

export const stringTransform: Transform = {
  name: 'string',
  execute(input: any): string {
    return String(input);
  },
};

export const booleanTransform: Transform = {
  name: 'boolean',
  execute(input: any): boolean {
    if (typeof input === 'boolean') return input;
    if (typeof input === 'string') {
      const lower = input.toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'no') return false;
    }
    return Boolean(input);
  },
};

export const jsonTransform: Transform = {
  name: 'json',
  execute(input: any): any {
    if (typeof input === 'string') {
      return JSON.parse(input);
    }
    return input;
  },
};

export const dateTransform: Transform = {
  name: 'date',
  execute(input: any): Date {
    const date = new Date(input);
    if (isNaN(date.getTime())) {
      throw new Error(`Cannot convert to date: ${input}`);
    }
    return date;
  },
};

/**
 * String Transforms
 */

export const uppercaseTransform: Transform = {
  name: 'uppercase',
  execute(input: any): string {
    return String(input).toUpperCase();
  },
};

export const lowercaseTransform: Transform = {
  name: 'lowercase',
  execute(input: any): string {
    return String(input).toLowerCase();
  },
};

export const trimTransform: Transform = {
  name: 'trim',
  execute(input: any): string {
    return String(input).trim();
  },
};

export const titleCaseTransform: Transform = {
  name: 'title-case',
  execute(input: any): string {
    return String(input)
      .toLowerCase()
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  },
};

export const camelCaseTransform: Transform = {
  name: 'camel-case',
  execute(input: any): string {
    return String(input)
      .replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '')
      .replace(/^(.)/, (_, c) => c.toLowerCase());
  },
};

export const kebabCaseTransform: Transform = {
  name: 'kebab-case',
  execute(input: any): string {
    return String(input)
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  },
};

export const snakeCaseTransform: Transform = {
  name: 'snake-case',
  execute(input: any): string {
    return String(input)
      .replace(/([a-z])([A-Z])/g, '$1_$2')
      .replace(/[\s-]+/g, '_')
      .toLowerCase();
  },
};

export const slugifyTransform: Transform = {
  name: 'slugify',
  execute(input: any): string {
    return String(input)
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '');
  },
};

/**
 * Array Transforms
 */

export const arrayAppendTransform: Transform = {
  name: 'array-append',
  execute(input: any, options?: { value: any }): any[] {
    const arr = Array.isArray(input) ? input : [input];
    return [...arr, options?.value];
  },
};

export const arrayUniqueTransform: Transform = {
  name: 'array-unique',
  execute(input: any): any[] {
    if (!Array.isArray(input)) {
      return [input];
    }
    return [...new Set(input)];
  },
};

export const arrayFlattenTransform: Transform = {
  name: 'array-flatten',
  execute(input: any, options?: { depth?: number }): any[] {
    if (!Array.isArray(input)) {
      return [input];
    }
    const depth = options?.depth ?? Infinity;
    return input.flat(depth);
  },
};

/**
 * Object Transforms
 */

export const flattenTransform: Transform = {
  name: 'flatten',
  execute(input: any, options?: { separator?: string }): Record<string, any> {
    if (typeof input !== 'object' || input === null) {
      return { value: input };
    }

    const separator = options?.separator || '.';
    const result: Record<string, any> = {};

    function flatten(obj: any, prefix = '') {
      for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}${separator}${key}` : key;
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          flatten(value, newKey);
        } else {
          result[newKey] = value;
        }
      }
    }

    flatten(input);
    return result;
  },
};

export const unflattenTransform: Transform = {
  name: 'unflatten',
  execute(input: any, options?: { separator?: string }): any {
    if (typeof input !== 'object' || input === null) {
      return input;
    }

    const separator = options?.separator || '.';
    const result: any = {};

    for (const [path, value] of Object.entries(input)) {
      const keys = path.split(separator);
      let current = result;

      for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!(key in current)) {
          current[key] = {};
        }
        current = current[key];
      }

      current[keys[keys.length - 1]] = value;
    }

    return result;
  },
};

export const pickKeysTransform: Transform = {
  name: 'pick-keys',
  execute(input: any, options?: { keys: string[] }): any {
    if (typeof input !== 'object' || input === null) {
      return input;
    }

    const keys = options?.keys || [];
    const result: any = {};

    for (const key of keys) {
      if (key in input) {
        result[key] = input[key];
      }
    }

    return result;
  },
  validate(options?: { keys: string[] }): boolean {
    return Array.isArray(options?.keys);
  },
};

export const omitKeysTransform: Transform = {
  name: 'omit-keys',
  execute(input: any, options?: { keys: string[] }): any {
    if (typeof input !== 'object' || input === null) {
      return input;
    }

    const keys = options?.keys || [];
    const result: any = { ...input };

    for (const key of keys) {
      delete result[key];
    }

    return result;
  },
  validate(options?: { keys: string[] }): boolean {
    return Array.isArray(options?.keys);
  },
};

// ============================================================================
// Validation Transforms
// ============================================================================

export const validateTransform: Transform = {
  name: 'validate',
  execute(input: any, options?: { required?: string[] }): any {
    if (typeof input !== 'object' || input === null) {
      throw new Error('Validation failed: input must be an object');
    }

    const required = options?.required || [];
    const missing = required.filter(key => !(key in input));

    if (missing.length > 0) {
      throw new Error(`Validation failed: missing required keys: ${missing.join(', ')}`);
    }

    return input;
  },
};

// ============================================================================
// Transform Registry Setup
// ============================================================================

/**
 * Create and populate default transform registry
 */
export function createDefaultTransformRegistry(): TransformRegistry {
  const registry = new TransformRegistry();

  // Format converters
  registry.register(jsoncTransform);
  registry.register(yamlTransform);
  registry.register(tomlTransform);
  registry.register(jsonToTomlTransform);
  registry.register(tomlToJsonTransform);

  // Content filters
  registry.register(filterCommentsTransform);
  registry.register(filterEmptyTransform);
  registry.register(filterNullTransform);

  // Markdown transforms
  registry.register(sectionsTransform);
  registry.register(frontmatterTransform);
  registry.register(bodyTransform);

  // Type converters
  registry.register(numberTransform);
  registry.register(stringTransform);
  registry.register(booleanTransform);
  registry.register(jsonTransform);
  registry.register(dateTransform);

  // String transforms
  registry.register(uppercaseTransform);
  registry.register(lowercaseTransform);
  registry.register(trimTransform);
  registry.register(titleCaseTransform);
  registry.register(camelCaseTransform);
  registry.register(kebabCaseTransform);
  registry.register(snakeCaseTransform);
  registry.register(slugifyTransform);

  // Array transforms
  registry.register(arrayAppendTransform);
  registry.register(arrayUniqueTransform);
  registry.register(arrayFlattenTransform);

  // Object transforms
  registry.register(flattenTransform);
  registry.register(unflattenTransform);
  registry.register(pickKeysTransform);
  registry.register(omitKeysTransform);

  // Validation
  registry.register(validateTransform);

  return registry;
}

/**
 * Global transform registry instance
 */
export const defaultTransformRegistry = createDefaultTransformRegistry();
