/**
 * Flow Executor
 * 
 * Executes flows through a multi-stage pipeline:
 * 1. Load source file and parse format
 * 2. Extract JSONPath (if specified)
 * 3. Pick/omit keys
 * 4. Map keys (with transforms)
 * 5. Apply pipe transforms
 * 6. Embed in target structure
 * 7. Merge with existing target (priority-based)
 * 8. Write to target file
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import * as TOML from '@iarna/toml';
import { JSONPath } from 'jsonpath-plus';
import * as fsUtils from '../../utils/fs.js';
import type {
  Flow,
  FlowContext,
  FlowResult,
  FlowExecutor,
  FlowConflict,
  ValidationResult,
  ValidationError,
  ParsedContent,
  FileFormat,
  MultiTargetFlows,
} from '../../types/flows.js';
import { logger } from '../../utils/logger.js';
import { 
  defaultTransformRegistry, 
  TransformRegistry,
  serializeMarkdownWithFrontmatter,
  frontmatterTransform,
  bodyTransform
} from './flow-transforms.js';
import { 
  applyKeyMap,
  getNestedValue,
  setNestedValue,
  deleteNestedValue,
  validateKeyMap
} from './flow-key-mapper.js';

/**
 * Default flow executor implementation
 */
export class DefaultFlowExecutor implements FlowExecutor {
  private transformRegistry: TransformRegistry;

  constructor(transformRegistry?: TransformRegistry) {
    this.transformRegistry = transformRegistry || defaultTransformRegistry;
  }

  /**
   * Execute a single flow
   */
  async executeFlow(flow: Flow, context: FlowContext): Promise<FlowResult> {
    const startTime = Date.now();

    try {
      // Check if this is a multi-target flow
      if (typeof flow.to !== 'string') {
        const results = await this.executeMultiTarget(flow, context);
        // Aggregate results
        return this.aggregateResults(results, startTime);
      }

      // Validate flow
      const validation = this.validateFlow(flow);
      if (!validation.valid) {
        return {
          source: flow.from,
          target: flow.to as string,
          success: false,
          transformed: false,
          error: new Error(`Invalid flow: ${validation.errors.map(e => e.message).join(', ')}`),
          executionTime: Date.now() - startTime,
        };
      }

      // Evaluate conditions
      if (flow.when && !this.evaluateCondition(flow.when, context)) {
        logger.debug(`Flow skipped due to condition: ${flow.from} -> ${flow.to}`);
        return {
          source: flow.from,
          target: flow.to as string,
          success: true,
          transformed: false,
          warnings: ['Flow skipped due to condition'],
          executionTime: Date.now() - startTime,
        };
      }

      // Resolve paths
      const sourcePath = this.resolveSourcePath(flow.from, context);
      const targetPath = this.resolveTargetPath(flow.to as string, context);

      // Check if source exists
      if (!await fsUtils.exists(sourcePath)) {
        return {
          source: flow.from,
          target: flow.to as string,
          success: false,
          transformed: false,
          error: new Error(`Source file not found: ${sourcePath}`),
          executionTime: Date.now() - startTime,
        };
      }

      // Execute pipeline
      const result = await this.executePipeline(flow, sourcePath, targetPath, context);

      return {
        ...result,
        executionTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        source: flow.from,
        target: typeof flow.to === 'string' ? flow.to : Object.keys(flow.to).join(', '),
        success: false,
        transformed: false,
        error: error instanceof Error ? error : new Error(String(error)),
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Execute multiple flows
   */
  async executeFlows(flows: Flow[], context: FlowContext): Promise<FlowResult[]> {
    const results: FlowResult[] = [];

    for (const flow of flows) {
      const result = await this.executeFlow(flow, context);
      results.push(result);
    }

    return results;
  }

  /**
   * Execute a multi-target flow
   */
  async executeMultiTarget(flow: Flow, context: FlowContext): Promise<FlowResult[]> {
    if (typeof flow.to === 'string') {
      throw new Error('Flow is not a multi-target flow');
    }

    const multiTarget = flow.to as MultiTargetFlows;
    const sourcePath = this.resolveSourcePath(flow.from, context);

    // Check if source exists
    if (!await fsUtils.exists(sourcePath)) {
      return Object.keys(multiTarget).map(target => ({
        source: flow.from,
        target,
        success: false,
        transformed: false,
        error: new Error(`Source file not found: ${sourcePath}`),
      }));
    }

    // Load and parse source once
    const sourceContent = await this.loadSourceFile(sourcePath);

    // Execute each target
    const results: FlowResult[] = [];

    for (const [targetPath, targetFlow] of Object.entries(multiTarget)) {
      const startTime = Date.now();

      try {
        // Merge target flow with base flow
        const mergedFlow: Flow = {
          ...flow,
          ...targetFlow,
          from: flow.from,
          to: targetPath,
        };

        // Evaluate conditions
        if (mergedFlow.when && !this.evaluateCondition(mergedFlow.when, context)) {
          logger.debug(`Multi-target flow skipped due to condition: ${flow.from} -> ${targetPath}`);
          results.push({
            source: flow.from,
            target: targetPath,
            success: true,
            transformed: false,
            warnings: ['Flow skipped due to condition'],
            executionTime: Date.now() - startTime,
          });
          continue;
        }

        const resolvedTargetPath = this.resolveTargetPath(targetPath, context);

        // Execute pipeline with pre-loaded content
        const result = await this.executePipelineWithContent(
          mergedFlow,
          sourceContent,
          resolvedTargetPath,
          context
        );

        results.push({
          ...result,
          executionTime: Date.now() - startTime,
        });
      } catch (error) {
        results.push({
          source: flow.from,
          target: targetPath,
          success: false,
          transformed: false,
          error: error instanceof Error ? error : new Error(String(error)),
          executionTime: Date.now() - startTime,
        });
      }
    }

    return results;
  }

  /**
   * Validate a flow configuration
   */
  validateFlow(flow: Flow): ValidationResult {
    const errors: ValidationError[] = [];

    // Check required fields
    if (!flow.from) {
      errors.push({ message: 'Flow missing required field "from"', code: 'MISSING_FROM' });
    }

    if (!flow.to) {
      errors.push({ message: 'Flow missing required field "to"', code: 'MISSING_TO' });
    }

    // Validate pipe transforms
    if (flow.pipe) {
      if (!Array.isArray(flow.pipe)) {
        errors.push({ message: 'Flow "pipe" must be an array', code: 'INVALID_PIPE' });
      }
    }

    // Validate pick/omit
    if (flow.pick && flow.omit) {
      errors.push({ message: 'Flow cannot have both "pick" and "omit"', code: 'CONFLICTING_FILTERS' });
    }

    // Validate merge strategy
    if (flow.merge && !['deep', 'shallow', 'replace', 'append'].includes(flow.merge)) {
      errors.push({
        message: `Invalid merge strategy: ${flow.merge}. Must be one of: deep, shallow, replace, append`,
        code: 'INVALID_MERGE',
      });
    }

    // Validate JSONPath expression
    if (flow.path) {
      try {
        // Try to validate JSONPath syntax
        JSONPath({ path: flow.path, json: {} });
      } catch (error) {
        errors.push({
          message: `Invalid JSONPath expression: ${flow.path}`,
          code: 'INVALID_JSONPATH',
        });
      }
    }

    // Validate key map
    if (flow.map) {
      const keyMapValidation = validateKeyMap(flow.map);
      if (!keyMapValidation.valid) {
        for (const error of keyMapValidation.errors) {
          errors.push({
            message: error,
            code: 'INVALID_KEY_MAP',
          });
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  /**
   * Execute the transformation pipeline
   */
  private async executePipeline(
    flow: Flow,
    sourcePath: string,
    targetPath: string,
    context: FlowContext
  ): Promise<Omit<FlowResult, 'executionTime'>> {
    // Step 1: Load source file
    const sourceContent = await this.loadSourceFile(sourcePath);

    return this.executePipelineWithContent(flow, sourceContent, targetPath, context);
  }

  /**
   * Execute pipeline with pre-loaded content (for multi-target flows)
   */
  private async executePipelineWithContent(
    flow: Flow,
    sourceContent: ParsedContent,
    targetPath: string,
    context: FlowContext
  ): Promise<Omit<FlowResult, 'executionTime'>> {
    const warnings: string[] = [];
    const conflicts: FlowConflict[] = [];

    let data = sourceContent.data;
    let transformed = false;

    try {
      // Step 2: Extract JSONPath (if specified)
      if (flow.path) {
        data = this.extractJSONPath(data, flow.path);
        transformed = true;
      }

      // Step 3: Pick/omit keys
      if (flow.pick) {
        data = this.pickKeys(data, flow.pick);
        transformed = true;
      } else if (flow.omit) {
        data = this.omitKeys(data, flow.omit);
        transformed = true;
      }

      // Step 4: Map keys (with transforms)
      if (flow.map) {
        data = this.mapKeys(data, flow.map, context);
        transformed = true;
      }

      // Step 5: Apply pipe transforms
      if (flow.pipe && flow.pipe.length > 0) {
        data = await this.applyPipeTransforms(data, flow.pipe, context);
        transformed = true;
      }

      // Step 6: Embed in target structure
      if (flow.embed) {
        data = this.embedContent(data, flow.embed);
        transformed = true;
      }

      // Step 7: Merge with existing target (if needed)
      if (await fsUtils.exists(targetPath)) {
        const targetContent = await this.loadSourceFile(targetPath);
        const mergeResult = this.mergeContent(
          data,
          targetContent.data,
          flow.merge || 'replace',
          context
        );
        data = mergeResult.data;
        conflicts.push(...mergeResult.conflicts);
        if (mergeResult.conflicts.length > 0) {
          transformed = true;
        }
      }

      // Step 8: Write to target file
      if (!context.dryRun) {
        await this.writeTargetFile(targetPath, data, sourceContent.format);
      }

      return {
        source: flow.from,
        target: targetPath,
        success: true,
        transformed,
        warnings: warnings.length > 0 ? warnings : undefined,
        conflicts: conflicts.length > 0 ? conflicts : undefined,
        pipeline: this.getPipeline(flow),
      };
    } catch (error) {
      return {
        source: flow.from,
        target: targetPath,
        success: false,
        transformed,
        error: error instanceof Error ? error : new Error(String(error)),
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }
  }

  /**
   * Load and parse source file
   */
  async loadSourceFile(filePath: string): Promise<ParsedContent> {
    const raw = await fsUtils.readTextFile(filePath);
    const format = this.detectFormat(filePath, raw);
    const data = this.parseSourceContent(raw, format);

    return { data, format, raw };
  }

  /**
   * Write transformed content to target file
   */
  async writeTargetFile(filePath: string, content: any, sourceFormat: FileFormat): Promise<void> {
    await fsUtils.ensureDir(path.dirname(filePath));
    // Detect target format from file extension
    const targetFormat = this.detectFormat(filePath, '');
    const serialized = this.serializeTargetContent(content, targetFormat);
    await fsUtils.writeTextFile(filePath, serialized);
  }

  /**
   * Parse source content based on format
   */
  parseSourceContent(content: string, format: FileFormat): any {
    try {
      switch (format) {
        case 'json':
        case 'jsonc':
          // Remove comments for JSONC
          const cleaned = format === 'jsonc' ? this.stripJSONComments(content) : content;
          return JSON.parse(cleaned);

        case 'yaml':
        case 'yml':
          return yaml.load(content);

        case 'toml':
          return TOML.parse(content);

        case 'markdown':
        case 'md':
          return this.parseMarkdown(content);

        case 'text':
        case 'txt':
        default:
          return content;
      }
    } catch (error) {
      throw new Error(`Failed to parse ${format} content: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Serialize content to target format
   */
  serializeTargetContent(content: any, format: FileFormat): string {
    try {
      switch (format) {
        case 'json':
        case 'jsonc':
          return JSON.stringify(content, null, 2);

        case 'yaml':
        case 'yml':
          return yaml.dump(content, { indent: 2, lineWidth: -1 });

        case 'toml':
          return TOML.stringify(content);

        case 'markdown':
        case 'md':
          return this.serializeMarkdown(content);

        case 'text':
        case 'txt':
        default:
          return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      }
    } catch (error) {
      throw new Error(`Failed to serialize ${format} content: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Detect format from file extension or content
   */
  private detectFormat(filePath: string, content: string): FileFormat {
    const ext = path.extname(filePath).toLowerCase();

    const extMap: Record<string, FileFormat> = {
      '.json': 'json',
      '.jsonc': 'jsonc',
      '.yaml': 'yaml',
      '.yml': 'yml',
      '.toml': 'toml',
      '.md': 'markdown',
      '.markdown': 'markdown',
      '.txt': 'text',
    };

    if (extMap[ext]) {
      return extMap[ext];
    }

    // Try to detect from content
    if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
      return content.includes('//') || content.includes('/*') ? 'jsonc' : 'json';
    }

    if (content.includes('---\n') || content.includes('\n---\n')) {
      return 'markdown';
    }

    return 'text';
  }

  /**
   * Extract data using JSONPath
   */
  private extractJSONPath(data: any, jsonPath: string): any {
    try {
      const result = JSONPath({ path: jsonPath, json: data });
      return result.length === 1 ? result[0] : result;
    } catch (error) {
      throw new Error(`JSONPath extraction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Pick specified keys
   */
  private pickKeys(data: any, keys: string[]): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const result: any = Array.isArray(data) ? [] : {};

    for (const key of keys) {
      if (key.includes('.')) {
        // Handle nested keys
        this.setNestedValue(result, key, this.getNestedValue(data, key));
      } else if (key in data) {
        result[key] = data[key];
      }
    }

    return result;
  }

  /**
   * Omit specified keys
   */
  private omitKeys(data: any, keys: string[]): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const result = Array.isArray(data) ? [...data] : { ...data };

    for (const key of keys) {
      if (key.includes('.')) {
        // Handle nested keys
        this.deleteNestedValue(result, key);
      } else {
        delete result[key];
      }
    }

    return result;
  }

  /**
   * Map keys according to configuration
   * Delegates to the dedicated key mapper module
   */
  private mapKeys(data: any, keyMap: any, context: FlowContext): any {
    return applyKeyMap(data, keyMap, context);
  }

  /**
   * Apply pipe transforms
   */
  private async applyPipeTransforms(data: any, transforms: string[], context: FlowContext): Promise<any> {
    let result = data;

    for (const transformSpec of transforms) {
      try {
        // Parse transform specification
        // Format: "transform-name" or "transform-name(option1=value1,option2=value2)"
        const { name, options } = this.parseTransformSpec(transformSpec);

        logger.debug(`Applying transform: ${name}`, options);

        // Execute transform
        result = this.transformRegistry.execute(name, result, options);
      } catch (error) {
        throw new Error(`Transform '${transformSpec}' failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return result;
  }

  /**
   * Parse transform specification
   * Examples: "trim", "number", "pick-keys(keys=[a,b,c])"
   */
  private parseTransformSpec(spec: string): { name: string; options?: any } {
    const match = spec.match(/^([a-z-]+)(?:\((.+)\))?$/);
    if (!match) {
      throw new Error(`Invalid transform specification: ${spec}`);
    }

    const [, name, optionsStr] = match;

    if (!optionsStr) {
      return { name };
    }

    // Parse options (simple key=value format)
    const options: any = {};
    const pairs = optionsStr.split(',').map(s => s.trim());
    
    for (const pair of pairs) {
      const [key, value] = pair.split('=').map(s => s.trim());
      
      // Parse value type
      if (value.startsWith('[') && value.endsWith(']')) {
        // Array
        options[key] = value.slice(1, -1).split(',').map(s => s.trim());
      } else if (value === 'true' || value === 'false') {
        // Boolean
        options[key] = value === 'true';
      } else if (!isNaN(Number(value))) {
        // Number
        options[key] = Number(value);
      } else {
        // String
        options[key] = value;
      }
    }

    return { name, options };
  }

  /**
   * Embed content under a key
   */
  private embedContent(data: any, key: string): any {
    return { [key]: data };
  }

  /**
   * Merge content with priority-based conflict resolution
   */
  private mergeContent(
    source: any,
    target: any,
    strategy: string,
    context: FlowContext
  ): { data: any; conflicts: FlowConflict[] } {
    const conflicts: FlowConflict[] = [];

    let merged: any;

    switch (strategy) {
      case 'replace':
        merged = source;
        break;

      case 'shallow':
        merged = { ...target, ...source };
        break;

      case 'deep':
        merged = this.deepMerge(target, source, conflicts, context);
        break;

      case 'append':
        if (Array.isArray(target) && Array.isArray(source)) {
          merged = [...target, ...source];
        } else {
          merged = this.deepMerge(target, source, conflicts, context);
        }
        break;

      default:
        merged = source;
    }

    return { data: merged, conflicts };
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: any, source: any, conflicts: FlowConflict[], context: FlowContext, keyPath: string = ''): any {
    if (typeof source !== 'object' || source === null) {
      return source;
    }

    if (typeof target !== 'object' || target === null) {
      return source;
    }

    if (Array.isArray(source) && Array.isArray(target)) {
      // Merge arrays
      return [...target, ...source];
    }

    const result = { ...target };

    for (const key of Object.keys(source)) {
      const currentPath = keyPath ? `${keyPath}.${key}` : key;

      if (!(key in target)) {
        result[key] = source[key];
      } else if (typeof source[key] === 'object' && typeof target[key] === 'object') {
        result[key] = this.deepMerge(target[key], source[key], conflicts, context, currentPath);
      } else if (source[key] !== target[key]) {
        // Conflict detected
        conflicts.push({
          path: currentPath,
          winner: context.packageName,
          losers: ['existing'],
          type: 'value',
          resolution: 'last-writer-wins',
        });
        result[key] = source[key];
      }
    }

    return result;
  }

  /**
   * Evaluate condition
   */
  private evaluateCondition(condition: any, context: FlowContext): boolean {
    if (condition.and) {
      return condition.and.every((c: any) => this.evaluateCondition(c, context));
    }

    if (condition.or) {
      return condition.or.some((c: any) => this.evaluateCondition(c, context));
    }

    if (condition.not) {
      return !this.evaluateCondition(condition.not, context);
    }

    if (condition.exists) {
      const testPath = path.join(context.workspaceRoot, condition.exists);
      // Use existsSync for synchronous condition evaluation
      return fsSync.existsSync(testPath);
    }

    if (condition.platform) {
      return context.platform === condition.platform;
    }

    return true;
  }

  /**
   * Resolve source path
   */
  private resolveSourcePath(pattern: string, context: FlowContext): string {
    const resolved = this.resolvePattern(pattern, context);
    return path.join(context.packageRoot, resolved);
  }

  /**
   * Resolve target path
   */
  private resolveTargetPath(pattern: string, context: FlowContext): string {
    const resolved = this.resolvePattern(pattern, context);
    return path.join(context.workspaceRoot, resolved);
  }

  /**
   * Resolve pattern with variables
   */
  private resolvePattern(pattern: string, context: FlowContext): string {
    let resolved = pattern;

    // If capturedName is available, use it for {name} placeholder
    if ('capturedName' in context.variables) {
      resolved = resolved.replace(/\{name\}/g, String(context.variables.capturedName));
    }

    // Replace other variables
    for (const [key, value] of Object.entries(context.variables)) {
      // Skip capturedName and name as they're handled above
      if (key === 'capturedName' || key === 'name') continue;
      
      resolved = resolved.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }

    return resolved;
  }

  /**
   * Get pipeline description
   */
  private getPipeline(flow: Flow): string[] {
    const pipeline: string[] = ['load'];

    if (flow.path) pipeline.push('extract');
    if (flow.pick) pipeline.push('pick');
    if (flow.omit) pipeline.push('omit');
    if (flow.map) pipeline.push('map');
    if (flow.pipe) pipeline.push(...flow.pipe);
    if (flow.embed) pipeline.push('embed');
    if (flow.merge) pipeline.push(`merge:${flow.merge}`);

    pipeline.push('write');

    return pipeline;
  }

  /**
   * Aggregate multi-target results
   */
  private aggregateResults(results: FlowResult[], startTime: number): FlowResult {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    if (failed.length > 0) {
      return {
        source: results[0]?.source || '',
        target: results.map(r => r.target).join(', '),
        success: false,
        transformed: results.some(r => r.transformed),
        error: failed[0]?.error,
        warnings: results.flatMap(r => r.warnings || []),
        executionTime: Date.now() - startTime,
      };
    }

    return {
      source: results[0]?.source || '',
      target: results.flatMap(r => typeof r.target === 'string' ? [r.target] : r.target),
      success: true,
      transformed: results.some(r => r.transformed),
      warnings: results.flatMap(r => r.warnings || []),
      conflicts: results.flatMap(r => r.conflicts || []),
      executionTime: Date.now() - startTime,
    };
  }

  /**
   * Parse markdown with frontmatter
   */
  private parseMarkdown(content: string): any {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontmatterRegex);

    if (match) {
      const frontmatter = yaml.load(match[1]);
      const body = match[2];
      return { frontmatter, body };
    }

    return { body: content };
  }

  /**
   * Serialize markdown with frontmatter
   */
  private serializeMarkdown(content: any): string {
    if (content.frontmatter) {
      const frontmatterStr = yaml.dump(content.frontmatter, { indent: 2 });
      return `---\n${frontmatterStr}---\n${content.body || ''}`;
    }

    return content.body || '';
  }

  /**
   * Strip JSON comments
   */
  private stripJSONComments(content: string): string {
    // Remove single-line comments
    let result = content.replace(/\/\/.*$/gm, '');
    // Remove multi-line comments
    result = result.replace(/\/\*[\s\S]*?\*\//g, '');
    return result;
  }

  /**
   * Get nested value using dot notation (delegates to key mapper)
   */
  private getNestedValue(obj: any, path: string): any {
    return getNestedValue(obj, path);
  }

  /**
   * Set nested value using dot notation (delegates to key mapper)
   */
  private setNestedValue(obj: any, path: string, value: any): void {
    setNestedValue(obj, path, value);
  }

  /**
   * Delete nested value using dot notation (delegates to key mapper)
   */
  private deleteNestedValue(obj: any, path: string): void {
    deleteNestedValue(obj, path);
  }
}

/**
 * Create a flow executor instance
 */
export function createFlowExecutor(): FlowExecutor {
  return new DefaultFlowExecutor();
}
