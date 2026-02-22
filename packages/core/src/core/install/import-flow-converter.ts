/**
 * Import Flow Converter Module
 * 
 * Converts files using import flows from platforms.jsonc.
 * Applies platform-specific → universal format transformations.
 * 
 * Phase 3: Per-File Import Flow Application
 */

import { minimatch } from 'minimatch';
import { logger } from '../../utils/logger.js';
import { getPlatformDefinition } from '../platforms.js';
import { getPatternFromFlow, schemaRegistry } from './schema-registry.js';
import { applyMapPipeline, createMapContext } from '../flows/map-pipeline/index.js';
import { defaultTransformRegistry } from '../flows/flow-transforms.js';
import { splitFrontmatter, dumpYaml } from '../../utils/markdown-frontmatter.js';
import { basename, dirname, extname } from 'path';
import { stripPlatformSuffixFromFilename } from '../flows/platform-suffix-handler.js';
import { scoreAgainstSchema } from './file-format-detector.js';
import type { Flow } from '../../types/flows.js';
import type { 
  PackageFile,
  PlatformId,
  FileFormat,
  FormatGroup
} from './detection-types.js';

/**
 * Conversion result for a single file
 */
export interface FileConversionResult {
  /** Original file */
  original: PackageFile;
  
  /** Converted file (in universal format) */
  converted?: PackageFile;
  
  /** Whether conversion succeeded */
  success: boolean;
  
  /** Error if conversion failed */
  error?: Error;
  
  /** Flow that was applied */
  appliedFlow?: Flow;
  
  /** Whether file needed transformation */
  transformed: boolean;
}

/**
 * Conversion result for a format group
 */
export interface FormatGroupConversionResult {
  /** Platform ID of this group */
  platformId: PlatformId;
  
  /** Converted files (in universal format) */
  convertedFiles: PackageFile[];
  
  /** Per-file conversion results */
  fileResults: FileConversionResult[];
  
  /** Overall success (all files converted) */
  success: boolean;
  
  /** Number of files processed */
  filesProcessed: number;
  
  /** Number of files successfully converted */
  filesConverted: number;
  
  /** Number of files that failed */
  filesFailed: number;
}

/**
 * Convert a format group using import flows
 * 
 * Loads import flows for the platform and applies them to each file in the group.
 * Returns converted files in universal format.
 * 
 * @param group - Format group to convert
 * @param targetDir - Optional target directory for local platform config
 * @returns Conversion result with converted files
 */
export function convertFormatGroup(
  group: FormatGroup,
  targetDir?: string
): FormatGroupConversionResult {
  // Skip conversion for universal format (already in target format)
  if (group.platformId === 'universal') {
    return {
      platformId: group.platformId,
      convertedFiles: group.files,
      fileResults: group.files.map(file => ({
        original: file,
        converted: file,
        success: true,
        transformed: false
      })),
      success: true,
      filesProcessed: group.files.length,
      filesConverted: group.files.length,
      filesFailed: 0
    };
  }
  
  // Skip conversion for unknown format (no flows available)
  if (group.platformId === 'unknown') {
    logger.warn('Group has unknown format, cannot convert');
    return {
      platformId: group.platformId,
      convertedFiles: [],
      fileResults: group.files.map(file => ({
        original: file,
        success: false,
        error: new Error('Unknown format - no conversion flows available'),
        transformed: false
      })),
      success: false,
      filesProcessed: group.files.length,
      filesConverted: 0,
      filesFailed: group.files.length
    };
  }
  
  // Load import flows for platform
  const platform = getPlatformDefinition(group.platformId, targetDir);
  if (!platform) {
    logger.error(`Platform definition not found: ${group.platformId}`);
    return {
      platformId: group.platformId,
      convertedFiles: [],
      fileResults: group.files.map(file => ({
        original: file,
        success: false,
        error: new Error(`Platform definition not found: ${group.platformId}`),
        transformed: false
      })),
      success: false,
      filesProcessed: group.files.length,
      filesConverted: 0,
      filesFailed: group.files.length
    };
  }
  
  const importFlows = platform.import || [];
  if (importFlows.length === 0) {
    logger.warn(`No import flows defined for platform: ${group.platformId}`);
    // Return files unchanged if no flows (treat as already universal)
    return {
      platformId: group.platformId,
      convertedFiles: group.files,
      fileResults: group.files.map(file => ({
        original: file,
        converted: file,
        success: true,
        transformed: false
      })),
      success: true,
      filesProcessed: group.files.length,
      filesConverted: group.files.length,
      filesFailed: 0
    };
  }
  
  // Apply import flows to each file
  const fileResults: FileConversionResult[] = [];
  const convertedFiles: PackageFile[] = [];
  
  for (const file of group.files) {
    const result = convertSingleFile(file, importFlows, group.platformId);
    fileResults.push(result);
    
    if (result.success && result.converted) {
      convertedFiles.push(result.converted);
    }
  }
  
  const filesConverted = fileResults.filter(r => r.success).length;
  const filesFailed = fileResults.filter(r => !r.success).length;
  
  return {
    platformId: group.platformId,
    convertedFiles,
    fileResults,
    success: filesFailed === 0,
    filesProcessed: group.files.length,
    filesConverted,
    filesFailed
  };
}

/**
 * Convert a single file using import flows
 * 
 * Matches file against flows, applies transformations, converts to universal format.
 * 
 * @param file - File to convert
 * @param flows - Import flows to apply
 * @param platformId - Source platform ID
 * @returns Conversion result
 */
export function convertSingleFile(
  file: PackageFile,
  flows: Flow[],
  platformId: PlatformId
): FileConversionResult {
  // Find matching flow for this file
  const matchedFlow = findMatchingFlow(file.path, flows);
  
  if (!matchedFlow) {
    // Fallback: schema-based flow match
    // This handles cases where platform-formatted content exists at a universal path
    // (e.g. Claude-formatted agent in `agents/` rather than `.claude/agents/`).
    const schemaFlow = findBestSchemaMatchingFlow(file, flows, platformId);
    if (schemaFlow) {
      try {
        const converted = applyFlowToFile(file, schemaFlow, platformId);
        return {
          original: file,
          converted,
          success: true,
          appliedFlow: schemaFlow,
          transformed: true
        };
      } catch (error) {
        logger.error(`Failed to convert file (schema fallback): ${file.path}`, error);
        return {
          original: file,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          appliedFlow: schemaFlow,
          transformed: false
        };
      }
    }

    // No flow matched - return file unchanged (assume already universal)
    return {
      original: file,
      converted: file,
      success: true,
      transformed: false
    };
  }
  
  try {
    // Apply flow transformation
    const converted = applyFlowToFile(file, matchedFlow, platformId);
    
    return {
      original: file,
      converted,
      success: true,
      appliedFlow: matchedFlow,
      transformed: true
    };
  } catch (error) {
    logger.error(`Failed to convert file: ${file.path}`, error);
    return {
      original: file,
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
      appliedFlow: matchedFlow,
      transformed: false
    };
  }
}

/**
 * Find matching flow for a file path
 * 
 * Matches file path against flow 'from' patterns using glob matching.
 * Returns first matching flow.
 * 
 * @param filePath - File path to match
 * @param flows - Array of flows to check
 * @returns Matching flow or null
 */
function findMatchingFlow(filePath: string, flows: Flow[]): Flow | null {
  for (const flow of flows) {
    const pattern = getPatternFromFlow(flow, 'from');
    
    if (!pattern) {
      continue;
    }
    
    // Check if file path matches flow pattern
    if (matchGlob(filePath, pattern)) {
      return flow;
    }
  }
  
  return null;
}

/**
 * Fallback: Find the best schema-matching flow for a file.
 *
 * Uses the flow's `from` schema (if present) to score against frontmatter.
 * Only considered when glob/path matching fails.
 */
function findBestSchemaMatchingFlow(
  file: PackageFile,
  flows: Flow[],
  platformId: PlatformId
): Flow | null {
  // Parse frontmatter (if needed)
  let frontmatter = file.frontmatter;
  if (!frontmatter && file.content) {
    const parsed = splitFrontmatter(file.content);
    frontmatter = parsed.frontmatter || {};
  }

  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return null;
  }

  let best: { flow: Flow; score: number } | null = null;

  for (const flow of flows) {
    const schema = schemaRegistry.getSchemaForFlow(flow, 'from');
    if (!schema) continue;

    const match = scoreAgainstSchema(frontmatter, schema, flow, file.path, platformId);

    // Ignore extremely weak matches to reduce accidental conversions
    if (match.score <= 0.2) continue;

    if (!best || match.score > best.score) {
      best = { flow, score: match.score };
    }
  }

  return best?.flow ?? null;
}

/**
 * Match file path against glob pattern
 */
function matchGlob(filePath: string, pattern: string): boolean {
  try {
    return minimatch(filePath, pattern);
  } catch (error) {
    logger.warn(`Invalid glob pattern: ${pattern}`, error);
    return false;
  }
}

/**
 * Apply flow transformation to a file
 * 
 * Transforms file content using flow's map operations.
 * Handles frontmatter transformation and path transformation.
 * 
 * @param file - File to transform
 * @param flow - Flow to apply
 * @param platformId - Source platform ID
 * @returns Transformed file
 */
function applyFlowToFile(
  file: PackageFile,
  flow: Flow,
  platformId: PlatformId
): PackageFile {
  // Parse frontmatter if not already parsed
  let frontmatter = file.frontmatter;
  let body = '';
  
  if (!frontmatter && file.content) {
    const parsed = splitFrontmatter(file.content);
    frontmatter = parsed.frontmatter;
    body = parsed.body;
  }
  
  // Transform frontmatter using map operations
  let transformedFrontmatter = frontmatter;
  
  if (flow.map && flow.map.length > 0 && frontmatter) {
    // Create map context
    const mapContext = createMapContext({
      filename: basename(file.path),
      dirname: dirname(file.path),
      path: file.path,
      ext: extname(file.path)
    });
    
    // Apply map pipeline
    transformedFrontmatter = applyMapPipeline(
      frontmatter,
      flow.map,
      mapContext,
      defaultTransformRegistry
    );
  }
  
  // Transform path using flow patterns
  let transformedPath = transformPath(file.path, flow);
  // Strip platform suffix from output path (e.g. agents/foo.opencode.md -> agents/foo.md)
  const stripped = stripPlatformSuffixFromFilename(transformedPath);
  if (stripped !== transformedPath) {
    transformedPath = stripped;
  }
  
  // Serialize frontmatter back to content
  let transformedContent = file.content;
  if (transformedFrontmatter && body !== undefined) {
    const serialized = dumpYaml(transformedFrontmatter);
    const yamlBlock = serialized.endsWith('\n') ? serialized : `${serialized}\n`;
    transformedContent = `---\n${yamlBlock}---\n${body}`;
  }
  
  return {
    path: transformedPath,
    content: transformedContent,
    frontmatter: transformedFrontmatter
  };
}

/**
 * Transform file path using flow patterns
 * 
 * Converts platform-specific path to universal path.
 * Example: .claude/agents/agent.md → agents/agent.md
 * 
 * @param filePath - Original file path
 * @param flow - Flow with from/to patterns
 * @returns Transformed path
 */
function transformPath(filePath: string, flow: Flow): string {
  const fromPattern = getPatternFromFlow(flow, 'from');
  const toPattern = getPatternFromFlow(flow, 'to');
  
  if (!fromPattern || !toPattern) {
    return filePath;
  }
  
  // Simple pattern transformation: replace glob prefix
  // Example: ".claude/agents/**/*.md" → "agents/**/*.md"
  //          ".claude/agents/foo.md" → "agents/foo.md"
  
  // Extract non-glob prefix from patterns
  const fromPrefix = extractGlobPrefix(fromPattern);
  const toPrefix = extractGlobPrefix(toPattern);
  
  // If file path starts with from prefix, replace with to prefix
  if (filePath.startsWith(fromPrefix)) {
    const relativePath = filePath.substring(fromPrefix.length);
    return toPrefix + relativePath;
  }
  
  return filePath;
}

/**
 * Extract non-glob prefix from a glob pattern
 * 
 * Example: "agents/**\/*.md" → "agents/"
 *          ".claude/agents/**\/*.md" → ".claude/agents/"
 */
function extractGlobPrefix(pattern: string): string {
  const parts = pattern.split('/');
  const prefix: string[] = [];
  
  for (const part of parts) {
    if (part.includes('*') || part.includes('?') || part.includes('[')) {
      break;
    }
    prefix.push(part);
  }
  
  return prefix.length > 0 ? prefix.join('/') + '/' : '';
}

/**
 * Validate that converted file is in universal format
 * 
 * Checks that file has been transformed correctly.
 * 
 * @param file - Converted file to validate
 * @returns Whether file is valid universal format
 */
export function validateUniversalFormat(file: PackageFile): boolean {
  // Parse frontmatter
  let frontmatter = file.frontmatter;
  
  if (!frontmatter && file.content) {
    const parsed = splitFrontmatter(file.content);
    frontmatter = parsed.frontmatter;
  }
  
  if (!frontmatter) {
    // No frontmatter - technically valid (e.g., skills)
    return true;
  }
  
  // Check for universal format indicators
  // Universal format uses:
  // - tools: array format (not string or object)
  // - model: prefixed format (e.g., "anthropic/claude-3-5-sonnet-20241022")
  // - permissions: object format (not permissionMode string)
  
  // Check tools field if present
  if ('tools' in frontmatter) {
    const tools = frontmatter.tools;
    
    // Universal format uses array
    if (!Array.isArray(tools)) {
      return false;
    }
  }
  
  // Check for platform-specific exclusive fields
  // These should not be present in universal format
  const platformExclusiveFields = [
    'permissionMode',  // Claude exclusive
    'hooks',          // Claude exclusive
    'skills',         // Claude exclusive
    'temperature',    // OpenCode exclusive
    'maxSteps',       // OpenCode exclusive
    'disabled'        // OpenCode exclusive
  ];
  
  for (const field of platformExclusiveFields) {
    if (field in frontmatter) {
      return false;
    }
  }
  
  return true;
}

/**
 * Apply import flows to array of files
 * 
 * Convenience function that applies flows to multiple files.
 * 
 * @param files - Files to convert
 * @param flows - Import flows to apply
 * @param platformId - Source platform ID
 * @returns Array of converted files
 */
export function applyImportFlows(
  files: PackageFile[],
  flows: Flow[],
  platformId: PlatformId
): PackageFile[] {
  const convertedFiles: PackageFile[] = [];
  
  for (const file of files) {
    const result = convertSingleFile(file, flows, platformId);
    
    if (result.success && result.converted) {
      convertedFiles.push(result.converted);
    } else {
      logger.warn(`Failed to convert file: ${file.path}`, {
        error: result.error?.message
      });
      // Include original file if conversion failed
      convertedFiles.push(file);
    }
  }
  
  return convertedFiles;
}
