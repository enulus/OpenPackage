import { basename, dirname, extname, join, relative as pathRelative } from 'path';

import yaml from 'js-yaml';
import * as TOML from 'smol-toml';
import { parse as parseJsonc } from 'jsonc-parser';

import type { PackageFile } from '../../types/index.js';
import { ensureDir, exists, readTextFile, writeTextFile } from '../../utils/fs.js';
import { UserCancellationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import type { SourceEntry } from './source-collector.js';
import type { PackageContext } from '../package-context.js';
import { PromptTier } from '../../core/interaction-policy.js';
import type { PromptPort } from '../ports/prompt.js';
import { resolvePrompt, resolveOutput } from '../ports/resolve.js';
import { applyMapPipeline, createMapContext, splitMapPipeline } from '../flows/map-pipeline/index.js';
import { defaultTransformRegistry } from '../flows/flow-transforms.js';
import { parseMarkdownDocument, serializeMarkdownDocument } from '../flows/markdown.js';
import { STRUCTURED_FORMAT_EXTENSIONS, MARKDOWN_EXTENSIONS } from '../../constants/index.js';

type ConflictDecision = 'keep-existing' | 'overwrite';

/**
 * Resolve the target path for a registry path.
 * Registry paths are package-root-relative (universal subdirs already at root)
 */
function resolveTargetPath(packageContext: Pick<PackageContext, 'packageRootDir'>, registryPath: string): string {
  return join(packageContext.packageRootDir, registryPath);
}

/**
 * Build a MapContext from a source entry, used for variable resolution in map operations.
 */
function buildMapContext(entry: SourceEntry, workspaceRoot: string) {
  return createMapContext({
    filename: basename(entry.sourcePath, extname(entry.sourcePath)),
    dirname: basename(dirname(entry.sourcePath)),
    path: pathRelative(workspaceRoot, entry.sourcePath).replace(/\\/g, '/'),
    ext: extname(entry.sourcePath),
  });
}

/**
 * Apply flow.map operations to a parsed data object.
 * Splits into schema ops and pipe ops to match flow-executor semantics.
 */
function applyFlowMap(data: any, entry: SourceEntry, workspaceRoot: string): any {
  const { schemaOps, pipeOps } = splitMapPipeline(entry.flow!.map!);
  const mapContext = buildMapContext(entry, workspaceRoot);

  let result = data;
  if (schemaOps.length > 0) {
    result = applyMapPipeline(result, schemaOps as any, mapContext, defaultTransformRegistry);
  }
  if (pipeOps.length > 0) {
    result = applyMapPipeline(result, pipeOps as any, mapContext, defaultTransformRegistry);
  }
  return result;
}

/**
 * Parse a structured file (JSON, JSONC, YAML) from its raw content.
 * Returns the parsed object, or null if parsing fails.
 */
function parseStructuredContent(raw: string, ext: string): any | null {
  try {
    switch (ext) {
      case '.json':
        return JSON.parse(raw);
      case '.jsonc':
        return parseJsonc(raw) ?? null;
      case '.yaml':
      case '.yml':
        return yaml.load(raw) ?? null;
      case '.toml':
        return TOML.parse(raw);
      default:
        return null;
    }
  } catch (error) {
    logger.debug('Failed to parse structured file', { ext, error: String(error) });
    return null;
  }
}

/**
 * Serialize a data object to the target format based on file extension.
 */
function serializeStructuredContent(data: any, ext: string): string {
  switch (ext) {
    case '.json':
    case '.jsonc':
      return JSON.stringify(data, null, 2) + '\n';
    case '.yaml':
    case '.yml':
      return yaml.dump(data, { indent: 2, flowLevel: -1, lineWidth: -1, noRefs: true });
    case '.toml':
      return TOML.stringify(data);
    case '.md':
    case '.mdc':
    case '.markdown':
      return serializeMarkdownDocument(data);
    default:
      return JSON.stringify(data, null, 2) + '\n';
  }
}

/**
 * Transform a file's content using the flow.map operations from platforms.jsonc.
 *
 * Handles all format types that the flow executor supports:
 * - Markdown (.md, .mdc): applies map to frontmatter only (body untouched)
 * - Structured (.json, .jsonc, .yaml, .yml): parses full document, applies map,
 *   serializes to the target format (derived from registryPath extension)
 * - Other formats: passed through unchanged
 */
function transformFileWithFlowMap(
  raw: string,
  entry: SourceEntry,
  workspaceRoot: string
): { transformed: boolean; output: string } {
  const flow = entry.flow;
  if (!flow?.map || flow.map.length === 0) {
    return { transformed: false, output: raw };
  }

  const sourceExt = extname(entry.sourcePath).toLowerCase();

  // Markdown: apply map to frontmatter only
  if (MARKDOWN_EXTENSIONS.has(sourceExt)) {
    const parsed = parseMarkdownDocument(raw, { lenient: true });
    if (!parsed.frontmatter) {
      return { transformed: false, output: raw };
    }

    const nextFrontmatter = applyFlowMap(parsed.frontmatter, entry, workspaceRoot);
    const output = serializeMarkdownDocument({ frontmatter: nextFrontmatter, body: parsed.body });
    return { transformed: true, output };
  }

  // Structured formats: apply map to full document, serialize to target format
  if (STRUCTURED_FORMAT_EXTENSIONS.has(sourceExt)) {
    const data = parseStructuredContent(raw, sourceExt);
    if (data == null) {
      return { transformed: false, output: raw };
    }

    const transformed = applyFlowMap(data, entry, workspaceRoot);
    const targetExt = extname(entry.registryPath).toLowerCase();
    const output = serializeStructuredContent(transformed, targetExt);
    return { transformed: true, output };
  }

  return { transformed: false, output: raw };
}

export interface CopyFilesWithConflictResolutionOptions {
  force?: boolean;
  execContext?: { interactionPolicy?: { canPrompt(tier: PromptTier): boolean }; prompt?: PromptPort };
  prompt?: PromptPort;
}

export async function copyFilesWithConflictResolution(
  packageContext: Pick<PackageContext, 'name' | 'packageRootDir'>,
  entries: SourceEntry[],
  options: CopyFilesWithConflictResolutionOptions = {}
): Promise<PackageFile[]> {
  const changedFiles: PackageFile[] = [];
  const { name } = packageContext;
  const policy = options.execContext?.interactionPolicy;
  const forceOverwrite = options.force ?? false;

  for (const entry of entries) {
    // Resolve target path based on registry path format
    const destination = resolveTargetPath(packageContext, entry.registryPath);

    const sourceContent = entry.content ?? await readTextFile(entry.sourcePath);
    const transformed = transformFileWithFlowMap(sourceContent, entry, process.cwd());
    const contentToWrite = transformed.output;
    const destExists = await exists(destination);

    if (destExists) {
      const existingContent = await readTextFile(destination).catch(() => '');

      if (existingContent === contentToWrite) {
        logger.debug(`Skipping unchanged file: ${entry.registryPath}`);
        continue;
      }

      let decision: ConflictDecision;
      if (forceOverwrite) {
        decision = 'overwrite';
      } else if (policy?.canPrompt(PromptTier.Confirmation)) {
        const effectivePrompt = options.prompt ?? options.execContext?.prompt;
        decision = await promptConflictDecision(name, entry.registryPath, effectivePrompt);
      } else {
        resolveOutput().warn(`Skipping '${entry.registryPath}' (already exists). Use --force to overwrite.`);
        continue;
      }

      if (decision === 'keep-existing') {
        logger.debug(`Kept existing file for ${entry.registryPath}`);
        continue;
      }
    }

    await ensureDir(dirname(destination));
    await writeTextFile(destination, contentToWrite);

    changedFiles.push({
      path: entry.registryPath,
      content: contentToWrite,
      encoding: 'utf8'
    });
  }

  return changedFiles;
}

async function promptConflictDecision(packageName: string, registryPath: string, prompt?: PromptPort): Promise<ConflictDecision> {
  const p = prompt ?? resolvePrompt();
  const decision = await p.select<ConflictDecision | 'cancel'>(
    `File '${registryPath}' already exists in package '${packageName}'. Choose how to proceed:`,
    [
      { title: 'Keep existing file (skip)', value: 'keep-existing' },
      { title: 'Replace with workspace file', value: 'overwrite' },
      { title: 'Cancel operation', value: 'cancel' }
    ]
  );

  if (decision === 'cancel') {
    throw new UserCancellationError();
  }

  return decision as ConflictDecision;
}

