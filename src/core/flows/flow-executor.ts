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
import * as TOML from 'smol-toml';
import { parse as parseJsonc } from 'jsonc-parser';
import { JSONPath } from 'jsonpath-plus';
import { minimatch } from 'minimatch';
import * as fsUtils from '../../utils/fs.js';
import { mergePackageContentIntoRootFile } from '../../utils/root-file-merger.js';
import { resolveRecursiveGlobTargetRelativePath } from '../../utils/glob-target-mapping.js';
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
  SwitchExpression,
} from '../../types/flows.js';
import { logger } from '../../utils/logger.js';
import { 
  defaultTransformRegistry, 
  TransformRegistry,
} from './flow-transforms.js';
import { mergeInlinePlatformOverride } from '../../utils/platform-yaml-merge.js';
import { 
  getNestedValue,
  setNestedValue,
  deleteNestedValue
} from './flow-key-mapper.js';
import { extractAllKeys } from './flow-key-extractor.js';
import { applyMapPipeline, createMapContext, validateMapPipeline, splitMapPipeline } from './map-pipeline/index.js';
import { SourcePatternResolver } from './source-resolver.js';
import { resolveSwitchExpression, validateSwitchExpression } from './switch-resolver.js';
import { smartEquals, smartNotEquals } from '../../utils/path-comparison.js';
import { stripPlatformSuffixFromFilename } from './platform-suffix-handler.js';
import { parseMarkdownDocument, serializeMarkdownDocument } from './markdown.js';

/**
 * Default flow executor implementation
 */
export class DefaultFlowExecutor implements FlowExecutor {
  private transformRegistry: TransformRegistry;
  private sourceResolver: SourcePatternResolver;

  constructor(transformRegistry?: TransformRegistry) {
    this.transformRegistry = transformRegistry || defaultTransformRegistry;
    this.sourceResolver = new SourcePatternResolver();
  }

  /**
   * Execute a single flow (now supports glob patterns and switch expressions)
   */
  async executeFlow(flow: Flow, context: FlowContext): Promise<FlowResult> {
    const startTime = Date.now();

    try {
      // Resolve switch expressions in 'from' field
      let resolvedFrom = flow.from;
      if (this.isSwitchExpression(flow.from)) {
        try {
          resolvedFrom = resolveSwitchExpression(flow.from as any as SwitchExpression, context);
        } catch (error) {
          return {
            source: '<switch expression>',
            target: this.normalizeToPattern(flow.to),
            success: false,
            transformed: false,
            error: error instanceof Error ? error : new Error(String(error)),
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Resolve switch expressions in 'to' field
      let resolvedTo = flow.to;
      if (this.isSwitchExpression(flow.to)) {
        try {
          resolvedTo = resolveSwitchExpression(flow.to as SwitchExpression, context);
        } catch (error) {
          return {
            source: this.normalizeFromPattern(resolvedFrom),
            target: '<switch expression>',
            success: false,
            transformed: false,
            error: error instanceof Error ? error : new Error(String(error)),
            executionTime: Date.now() - startTime,
          };
        }
      }

      // Check if this is a multi-target flow
      if (typeof resolvedTo !== 'string') {
        const results = await this.executeMultiTarget({ ...flow, from: resolvedFrom, to: resolvedTo }, context);
        // Aggregate results
        return this.aggregateResults(results, startTime);
      }

      // Validate flow (with resolved 'from' and 'to')
      const validation = this.validateFlow({ ...flow, from: resolvedFrom, to: resolvedTo });
      if (!validation.valid) {
        return {
          source: this.normalizeFromPattern(resolvedFrom),
          target: resolvedTo as string,
          success: false,
          transformed: false,
          error: new Error(`Invalid flow: ${validation.errors.map(e => e.message).join(', ')}`),
          executionTime: Date.now() - startTime,
        };
      }

      // Evaluate conditions
      if (flow.when && !this.evaluateCondition(flow.when, context)) {
        const normalized = this.normalizeFromPattern(resolvedFrom);
        logger.debug(`Flow skipped due to condition: ${normalized} -> ${resolvedTo}`);
        return {
          source: normalized,
          target: resolvedTo as string,
          success: true,
          transformed: false,
          warnings: ['Flow skipped due to condition'],
          executionTime: Date.now() - startTime,
        };
      }

      // Resolve source paths (may return multiple files for glob patterns)
      const resolution = await this.resolveSourcePattern(resolvedFrom, context);
      const sourcePaths = resolution.paths;
      const resolutionWarnings = resolution.warnings;

      // If no files matched, return success with no files processed
      if (sourcePaths.length === 0) {
        return {
          source: this.normalizeFromPattern(resolvedFrom),
          target: resolvedTo as string,
          success: true,
          transformed: false,
          warnings: resolutionWarnings.length > 0 ? resolutionWarnings : ['No files matched pattern'],
          executionTime: Date.now() - startTime,
        };
      }

      // Execute pipeline for each matched file
      const results: FlowResult[] = [];
      const firstFromPattern = this.getFirstPattern(resolvedFrom);
      
      for (const sourcePath of sourcePaths) {
        const targetPath = this.resolveTargetFromGlob(sourcePath, firstFromPattern, resolvedTo as string, context);
        const result = await this.executePipeline(flow, sourcePath, targetPath, context);
        results.push({
          ...result,
          executionTime: Date.now() - startTime,
        });
      }
      
      // Add resolution warnings to first result if any
      if (resolutionWarnings.length > 0 && results.length > 0) {
        results[0].warnings = [
          ...(results[0].warnings || []),
          ...resolutionWarnings,
        ];
      }

      // If single file, return single result
      if (results.length === 1) {
        return results[0];
      }

      // Aggregate multiple results
      return this.aggregateResults(results, startTime);
    } catch (error) {
      return {
        source: this.isSwitchExpression(flow.from) ? '<switch>' : this.normalizeFromPattern(flow.from),
        target: this.normalizeToPattern(flow.to),
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
    const normalizedFrom = this.normalizeFromPattern(flow.from);
    
    // Resolve source paths (may be multiple files with glob)
    const resolution = await this.resolveSourcePattern(flow.from, context);
    const sourcePaths = resolution.paths;

    // If no files matched
    if (sourcePaths.length === 0) {
      return Object.keys(multiTarget).map(target => ({
        source: normalizedFrom,
        target,
        success: true,
        transformed: false,
        warnings: resolution.warnings.length > 0 ? resolution.warnings : ['No files matched pattern'],
      }));
    }

    // Execute each source file
    const allResults: FlowResult[] = [];
    const firstFromPattern = this.getFirstPattern(flow.from);

    for (const sourcePath of sourcePaths) {
      // Load and parse source once
      const sourceContent = await this.loadSourceFile(sourcePath, context);

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
            logger.debug(`Multi-target flow skipped due to condition: ${normalizedFrom} -> ${targetPath}`);
            allResults.push({
              source: normalizedFrom,
              target: targetPath,
              success: true,
              transformed: false,
              warnings: ['Flow skipped due to condition'],
              executionTime: Date.now() - startTime,
            });
            continue;
          }

          const resolvedTargetPath = this.resolveTargetFromGlob(sourcePath, firstFromPattern, targetPath, context);

          // Execute pipeline with pre-loaded content
          const result = await this.executePipelineWithContent(
            mergedFlow,
            sourceContent,
            sourcePath,
            resolvedTargetPath,
            context
          );

          allResults.push({
            ...result,
            executionTime: Date.now() - startTime,
          });
        } catch (error) {
          allResults.push({
            source: normalizedFrom,
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

    // Validate switch expression in 'to' field
    if (flow.to && this.isSwitchExpression(flow.to)) {
      const switchValidation = validateSwitchExpression(flow.to as SwitchExpression);
      if (!switchValidation.valid) {
        for (const error of switchValidation.errors) {
          errors.push({
            message: error,
            code: 'INVALID_SWITCH_EXPRESSION',
          });
        }
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

    // Validate map pipeline
    if (flow.map) {
      const mapPipelineValidation = validateMapPipeline(flow.map);
      if (!mapPipelineValidation.valid) {
        for (const error of mapPipelineValidation.errors) {
          errors.push({
            message: error,
            code: 'INVALID_MAP_PIPELINE',
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
   * Check if a value is a switch expression
   */
  private isSwitchExpression(value: any): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      '$switch' in value
    );
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
    const sourceContent = await this.loadSourceFile(sourcePath, context);

    return this.executePipelineWithContent(flow, sourceContent, sourcePath, targetPath, context);
  }

  /**
   * Execute pipeline with pre-loaded content (for multi-target flows)
   */
  private async executePipelineWithContent(
    flow: Flow,
    sourceContent: ParsedContent,
    sourcePath: string,
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

      // Step 4: Apply map pipeline
      // Split into schema operations and pipe operations
      // Schema ops are applied BEFORE merge, pipe ops are applied AFTER merge
      let contributedKeys: string[] | undefined;
      let schemaOps: any[] = [];
      let pipeOps: any[] = [];
      
      if (flow.map) {
        const split = splitMapPipeline(flow.map);
        schemaOps = split.schemaOps;
        pipeOps = split.pipeOps;
        
        // Apply schema operations first (before merge)
        if (schemaOps.length > 0) {
          const mapContext = createMapContext({
            filename: path.basename(sourcePath, path.extname(sourcePath)),
            dirname: path.basename(path.dirname(sourcePath)),
            path: path.relative(context.packageRoot, sourcePath),
            ext: path.extname(sourcePath),
          });
          
          // For markdown files, apply to frontmatter
          if (data && typeof data === 'object' && 'frontmatter' in data) {
            data.frontmatter = applyMapPipeline(
              data.frontmatter, 
              schemaOps, 
              mapContext,
              this.transformRegistry
            );
          } else {
            // Apply to entire document
            data = applyMapPipeline(
              data, 
              schemaOps, 
              mapContext,
              this.transformRegistry
            );
          }
          transformed = true;
        }
      }
      
      // Track keys AFTER schema transforms but BEFORE merge and pipe transforms
      // This represents the structured data this package contributes
      const shouldTrackKeys =
        Boolean(flow.merge) &&
        flow.merge !== 'replace' &&
        flow.merge !== 'composite';
        
      if (shouldTrackKeys && typeof data === 'object' && data !== null) {
        // Extract from frontmatter if it's a markdown file
        const dataToExtract = (data && 'frontmatter' in data) ? data.frontmatter : data;
        if (typeof dataToExtract === 'object' && dataToExtract !== null) {
          contributedKeys = extractAllKeys(dataToExtract);
        }
      }

      const targetExists = await fsUtils.exists(targetPath);

      // Step 6: Embed in target structure
      if (flow.embed) {
        data = this.embedContent(data, flow.embed);
        transformed = true;
      }

      // Step 7: Merge with existing target (if needed)
      if (targetExists) {
        const targetContent = await this.loadSourceFile(targetPath, context);
        
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

      // Step 7.5: Apply pipe operations AFTER merge (format conversions)
      // These operations may convert the data to a string format (e.g., json-to-toml)
      if (pipeOps.length > 0) {
        const mapContext = createMapContext({
          filename: path.basename(sourcePath, path.extname(sourcePath)),
          dirname: path.basename(path.dirname(sourcePath)),
          path: path.relative(context.packageRoot, sourcePath),
          ext: path.extname(sourcePath),
        });
        
        // For markdown files, apply to frontmatter
        if (data && typeof data === 'object' && 'frontmatter' in data) {
          data.frontmatter = applyMapPipeline(
            data.frontmatter, 
            pipeOps, 
            mapContext,
            this.transformRegistry
          );
        } else {
          // Apply to entire document
          data = applyMapPipeline(
            data, 
            pipeOps, 
            mapContext,
            this.transformRegistry
          );
        }
        transformed = true;
      }

      // Step 8: Write to target file
      if (!context.dryRun) {
        await this.writeTargetFile(targetPath, data, sourceContent.format);
      }

      return {
        source: sourcePath,
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
        source: sourcePath,
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
  async loadSourceFile(filePath: string, context?: FlowContext): Promise<ParsedContent> {
    let raw = await fsUtils.readTextFile(filePath);
    const format = this.detectFormat(filePath, raw);
    
    // Apply platform-specific frontmatter overrides for markdown files during install
    if ((format === 'markdown' || format === 'md') && context?.platform && context?.direction === 'install') {
      raw = mergeInlinePlatformOverride(raw, context.platform, context.workspaceRoot);
    }
    
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
    // Handle empty content gracefully for structured formats
    if (!content.trim()) {
      switch (format) {
        case 'json':
        case 'jsonc':
        case 'yaml':
        case 'yml':
        case 'toml':
          return {};
        case 'markdown':
        case 'md':
          return { body: '' };
        case 'text':
        case 'txt':
        default:
          return content;
      }
    }

    try {
      switch (format) {
        case 'json':
        case 'jsonc':
          // Remove comments for JSONC
          const cleaned = content;
          if (format === 'jsonc') {
            const parsed = parseJsonc(cleaned);
            if (parsed === undefined) {
              throw new Error('jsonc-parser returned undefined');
            }
            return parsed;
          }
          return JSON.parse(cleaned);

        case 'yaml':
        case 'yml':
          return yaml.load(content);

        case 'toml':
          try {
            return TOML.parse(content);
          } catch (error) {
            throw new Error(`TOML parse error: ${error instanceof Error ? error.message : String(error)}`);
          }

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
          return yaml.dump(content, { indent: 2, flowLevel: -1, lineWidth: -1 });

        case 'toml':
          // If a pipeline already produced TOML text (e.g. via domain transforms),
          // don't stringify again.
          if (typeof content === 'string') {
            return content;
          }
          try {
            // Serialize to TOML
            let toml = TOML.stringify(content);
            
            // Apply inline table formatting for Codex MCP configs
            if (content && typeof content === 'object' && content.mcp_servers) {
              toml = this.applyCodexTomlFormatting(toml);
            }
            
            return toml;
          } catch (error) {
            throw new Error(`TOML stringify error: ${error instanceof Error ? error.message : String(error)}`);
          }

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

    if (condition.$eq) {
      const [left, right] = condition.$eq;
      const leftVal = this.resolveValue(left, context);
      const rightVal = this.resolveValue(right, context);
      return smartEquals(leftVal, rightVal);
    }

    if (condition.$ne) {
      const [left, right] = condition.$ne;
      const leftVal = this.resolveValue(left, context);
      const rightVal = this.resolveValue(right, context);
      return smartNotEquals(leftVal, rightVal);
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
   * Resolve a value, handling $$variable references
   */
  private resolveValue(value: string, context: FlowContext): any {
    if (value.startsWith('$$')) {
      const varName = value.slice(2);
      return context.variables[varName];
    }
    return value;
  }



  /**
   * Resolve pattern with glob support and priority-based array matching
   * Returns resolved file paths (glob patterns return multiple files)
   */
  private async resolveSourcePattern(
    pattern: string | string[] | SwitchExpression,
    context: FlowContext
  ): Promise<{ paths: string[]; warnings: string[] }> {
    if (this.isSwitchExpression(pattern)) {
      throw new Error('Cannot resolve SwitchExpression - expression must be resolved first');
    }
    // Type narrowing: pattern is now string | string[]
    const narrowedPattern = pattern as string | string[];
    const result = await this.sourceResolver.resolve(narrowedPattern, {
      baseDir: context.packageRoot,
      logWarnings: true,
    });

    return {
      paths: result.paths,
      warnings: result.warnings,
    };
  }

  /**
   * Resolve target path from source path and patterns
   * Handles single-level (*) and recursive (**) globs
   * Strips platform suffixes from filenames (e.g. read-specs.claude.md -> read-specs.md)
   */
  private resolveTargetFromGlob(sourcePath: string, fromPattern: string, toPattern: string, context: FlowContext): string {
    // Get relative path from package root
    const relativePath = path.relative(context.packageRoot, sourcePath);
    
    // If 'to' pattern has glob, map the structure
    if (toPattern.includes('*')) {
      // Handle ** recursive patterns
      if (toPattern.includes('**')) {
        const targetRel = resolveRecursiveGlobTargetRelativePath(
          relativePath,
          fromPattern,
          toPattern
        );
        return path.join(context.workspaceRoot, targetRel);
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
      
      // Strip platform suffix from the final target filename
      const strippedTargetFileName = stripPlatformSuffixFromFilename(targetFileName);
      
      const resolvedTo = toPrefix + strippedTargetFileName;
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
    if (flow.embed) pipeline.push('embed');
    if (flow.merge) pipeline.push(`merge:${flow.merge}`);

    pipeline.push('write');

    return pipeline;
  }

  /**
   * Normalize from pattern for display in results
   * Converts array to comma-separated string
   */
  private normalizeFromPattern(pattern: string | string[] | SwitchExpression): string {
    if (this.isSwitchExpression(pattern)) {
      return '<switch>';
    }
    // Type narrowing: pattern is now string | string[]
    const narrowedPattern = pattern as string | string[];
    return Array.isArray(narrowedPattern) ? narrowedPattern.join(', ') : narrowedPattern;
  }

  /**
   * Normalize to pattern for display in results
   * Handles string, multi-target, and switch expressions
   */
  private normalizeToPattern(pattern: string | MultiTargetFlows | SwitchExpression): string {
    if (typeof pattern === 'string') {
      return pattern;
    }
    if (this.isSwitchExpression(pattern)) {
      return '<switch>';
    }
    return Object.keys(pattern as MultiTargetFlows).join(', ');
  }

  /**
   * Get the first pattern from a pattern or array of patterns
   * Used for path resolution when multiple sources are specified
   */
  private getFirstPattern(pattern: string | string[] | SwitchExpression): string {
    if (this.isSwitchExpression(pattern)) {
      throw new Error('Cannot get first pattern from SwitchExpression - expression must be resolved first');
    }
    // Type narrowing: pattern is now string | string[]
    const narrowedPattern = pattern as string | string[];
    return Array.isArray(narrowedPattern) ? narrowedPattern[0] : narrowedPattern;
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
    return parseMarkdownDocument(content);
  }

  /**
   * Serialize markdown with frontmatter
   */
  private serializeMarkdown(content: any): string {
    return serializeMarkdownDocument(content);
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

  /**
   * Apply Codex-specific TOML formatting
   * Converts nested table sections to inline format for http_headers and env_http_headers
   */
  private applyCodexTomlFormatting(toml: string): string {
    const inlineKeys = ['http_headers', 'env_http_headers'];
    let result = toml;

    for (const key of inlineKeys) {
      // Pattern to match nested table sections for the key
      const pattern = new RegExp(
        `\\[([\\w-]+(?:\\.[\\w-]+|\\."[^"]+")*)?\\.${key}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|\\n*$)`,
        'g'
      );

      result = result.replace(pattern, (match, parentPath, content) => {
        const pairs: string[] = [];
        const lines = content.trim().split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;

          const kvMatch = trimmed.match(/^([\w-]+)\s*=\s*(.+)$/);
          if (kvMatch) {
            const [, k, v] = kvMatch;
            pairs.push(`"${k}" = ${v}`);
          }
        }

        if (pairs.length === 0) return match;

        const inlineTable = `{ ${pairs.join(', ')} }`;
        return `${key} = ${inlineTable}`;
      });
    }

    return result;
  }
}

/**
 * Create a flow executor instance
 */
export function createFlowExecutor(): FlowExecutor {
  return new DefaultFlowExecutor();
}
