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
import { minimatch } from 'minimatch';
import * as fsUtils from '../../utils/fs.js';
import { mergePackageContentIntoRootFile } from '../../utils/root-file-merger.js';
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
import { extractAllKeys } from './flow-key-extractor.js';

/**
 * Default flow executor implementation
 */
export class DefaultFlowExecutor implements FlowExecutor {
  private transformRegistry: TransformRegistry;

  constructor(transformRegistry?: TransformRegistry) {
    this.transformRegistry = transformRegistry || defaultTransformRegistry;
  }

  /**
   * Execute a single flow (now supports glob patterns)
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

      // Resolve source paths (may return multiple files for glob patterns)
      const sourcePaths = await this.resolveSourcePattern(flow.from, context);

      // If no files matched, return success with no files processed
      if (sourcePaths.length === 0) {
        return {
          source: flow.from,
          target: flow.to as string,
          success: true,
          transformed: false,
          warnings: ['No files matched pattern'],
          executionTime: Date.now() - startTime,
        };
      }

      // Execute pipeline for each matched file
      const results: FlowResult[] = [];
      for (const sourcePath of sourcePaths) {
        const targetPath = this.resolveTargetFromGlob(sourcePath, flow.from, flow.to as string, context);
        const result = await this.executePipeline(flow, sourcePath, targetPath, context);
        results.push({
          ...result,
          executionTime: Date.now() - startTime,
        });
      }

      // If single file, return single result
      if (results.length === 1) {
        return results[0];
      }

      // Aggregate multiple results
      return this.aggregateResults(results, startTime);
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
    
    // Resolve source paths (may be multiple files with glob)
    const sourcePaths = await this.resolveSourcePattern(flow.from, context);

    // If no files matched
    if (sourcePaths.length === 0) {
      return Object.keys(multiTarget).map(target => ({
        source: flow.from,
        target,
        success: true,
        transformed: false,
        warnings: ['No files matched pattern'],
      }));
    }

    // Execute each source file
    const allResults: FlowResult[] = [];

    for (const sourcePath of sourcePaths) {
      // Load and parse source once
      const sourceContent = await this.loadSourceFile(sourcePath);

      // Execute each target
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
            allResults.push({
              source: flow.from,
              target: targetPath,
              success: true,
              transformed: false,
              warnings: ['Flow skipped due to condition'],
              executionTime: Date.now() - startTime,
            });
            continue;
          }

          const resolvedTargetPath = this.resolveTargetFromGlob(sourcePath, flow.from, targetPath, context);

          // Execute pipeline with pre-loaded content
          const result = await this.executePipelineWithContent(
            mergedFlow,
            sourceContent,
            resolvedTargetPath,
            context
          );

          allResults.push({
            ...result,
            executionTime: Date.now() - startTime,
          });
        } catch (error) {
          allResults.push({
            source: flow.from,
            target: targetPath,
            success: false,
            transformed: false,
            error: error instanceof Error ? error : new Error(String(error)),
            executionTime: Date.now() - startTime,
          });
        }
      }
    }

    return allResults;
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
    if (flow.merge && !['deep', 'shallow', 'replace', 'composite'].includes(flow.merge)) {
      errors.push({
        message: `Invalid merge strategy: ${flow.merge}. Must be one of: deep, shallow, replace, composite`,
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
        
        // Special handling for composite merge - works with raw text
        if (flow.merge === 'composite') {
          // Use raw content for composite merge
          const sourceRaw = sourceContent.raw;
          const targetRaw = targetContent.raw;
          data = mergePackageContentIntoRootFile(targetRaw, context.packageName, sourceRaw);
          transformed = true;
        } else {
          // Normal merge for other strategies
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
      }

      // Step 8: Write to target file
      if (!context.dryRun) {
        await this.writeTargetFile(targetPath, data, sourceContent.format);
      }

      // Track keys for merged files (for precise uninstall)
      let contributedKeys: string[] | undefined;
      if (flow.merge && flow.merge !== 'replace' && flow.merge !== 'composite') {
        contributedKeys = extractAllKeys(data);
      }

      return {
        source: flow.from,
        target: targetPath,
        success: true,
        transformed,
        keys: contributedKeys,
        merge: flow.merge,
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

      case 'composite':
        // Composite merge is handled earlier in the pipeline (Step 7)
        // This case should not be reached
        merged = source;
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
  /**
   * Composite merge using comment delimiters to preserve multiple package contributions
   * Each package's content is wrapped in HTML comment markers with package name
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
   * Resolve pattern with glob support
   * Returns resolved file paths (glob patterns return multiple files)
   */
  private async resolveSourcePattern(pattern: string, context: FlowContext): Promise<string[]> {
    // Check if pattern contains glob wildcard
    if (pattern.includes('*')) {
      return this.resolveGlobPattern(pattern, context.packageRoot);
    }
    
    // No glob - return single file path
    const resolved = path.join(context.packageRoot, pattern);
    return [resolved];
  }

  /**
   * Resolve glob pattern to matching files
   */
  private async resolveGlobPattern(pattern: string, baseDir: string): Promise<string[]> {
    const matches: string[] = [];
    
    // Extract directory and file pattern
    const parts = pattern.split('/');
    const globPart = parts.findIndex(p => p.includes('*'));
    
    if (globPart === -1) {
      return [path.join(baseDir, pattern)];
    }
    
    // Build directory path up to first glob
    const dirPath = path.join(baseDir, ...parts.slice(0, globPart));
    const filePattern = parts.slice(globPart).join('/');
    
    // Check if directory exists
    if (!await fsUtils.exists(dirPath)) {
      return [];
    }
    
    // Recursively find matching files
    await this.findMatchingFiles(dirPath, filePattern, baseDir, matches);
    
    return matches;
  }

  /**
   * Recursively find files matching glob pattern
   * Supports ** for recursive directory matching
   */
  private async findMatchingFiles(
    dir: string,
    pattern: string,
    baseDir: string,
    matches: string[]
  ): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(baseDir, fullPath);
        
        if (entry.isDirectory()) {
          // Always recurse for ** patterns
          if (pattern.startsWith('**') || pattern.includes('/**/')) {
            await this.findMatchingFiles(fullPath, pattern, baseDir, matches);
          } else if (pattern.includes('/')) {
            // For patterns with subdirs, continue searching
            await this.findMatchingFiles(fullPath, pattern, baseDir, matches);
          }
        } else if (entry.isFile()) {
          // Test file against pattern
          if (minimatch(relativePath, pattern, { dot: false })) {
            matches.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Ignore errors (directory not accessible, etc.)
    }
  }

  /**
   * Resolve target path from source path and patterns
   * Handles single-level (*) and recursive (**) globs
   */
  private resolveTargetFromGlob(sourcePath: string, fromPattern: string, toPattern: string, context: FlowContext): string {
    // Get relative path from package root
    const relativePath = path.relative(context.packageRoot, sourcePath);
    
    // If 'to' pattern has glob, map the structure
    if (toPattern.includes('*')) {
      // Handle ** recursive patterns
      if (fromPattern.includes('**') && toPattern.includes('**')) {
        // Extract the base directories before **
        const fromParts = fromPattern.split('**');
        const toParts = toPattern.split('**');
        const fromBase = fromParts[0].replace(/\/$/, '');
        const toBase = toParts[0].replace(/\/$/, '');
        
        // Get the file pattern after **
        const fromSuffix = fromParts[1] || '';
        const toSuffix = toParts[1] || '';
        
        // Extract the relative path after the base directory
        let relativeSubpath = relativePath;
        if (fromBase) {
          relativeSubpath = relativePath.startsWith(fromBase + '/') 
            ? relativePath.slice(fromBase.length + 1)
            : relativePath;
        }
        
        // Handle extension mapping if suffixes specify extensions
        // e.g., /**/*.md -> /**/*.mdc
        if (fromSuffix && toSuffix) {
          const fromExt = fromSuffix.replace(/^\/?\*+/, '');
          const toExt = toSuffix.replace(/^\/?\*+/, '');
          if (fromExt && toExt && fromExt !== toExt) {
            relativeSubpath = relativeSubpath.replace(new RegExp(fromExt.replace('.', '\\.') + '$'), toExt);
          }
        }
        
        // Build target path
        const targetPath = toBase ? path.join(toBase, relativeSubpath) : relativeSubpath;
        return path.join(context.workspaceRoot, targetPath);
      }
      
      // Handle single-level * patterns
      const sourceFileName = path.basename(sourcePath);
      const sourceExt = path.extname(sourcePath);
      const sourceBase = path.basename(sourcePath, sourceExt);
      
      const toParts = toPattern.split('*');
      const toPrefix = toParts[0];
      const toSuffix = toParts[1] || '';
      
      const targetExt = toSuffix.startsWith('.') ? toSuffix : (sourceExt + toSuffix);
      const targetFileName = sourceBase + targetExt;
      
      const resolvedTo = toPrefix + targetFileName;
      return path.join(context.workspaceRoot, resolvedTo);
    }
    
    // No glob in target - use as-is
    return path.join(context.workspaceRoot, toPattern);
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
