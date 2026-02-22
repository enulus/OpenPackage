import { basename, dirname, extname, join, relative as pathRelative } from 'path';

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

type ConflictDecision = 'keep-existing' | 'overwrite';

/**
 * Resolve the target path for a registry path.
 * Registry paths are package-root-relative (universal subdirs already at root)
 */
function resolveTargetPath(packageContext: Pick<PackageContext, 'packageRootDir'>, registryPath: string): string {
  return join(packageContext.packageRootDir, registryPath);
}

function transformMarkdownWithFlowMap(
  raw: string,
  entry: SourceEntry,
  workspaceRoot: string
): { transformed: boolean; output: string } {
  const flow = entry.flow;
  if (!flow?.map || flow.map.length === 0) {
    return { transformed: false, output: raw };
  }

  // Only transform markdown for now (the reported regression is agent markdown frontmatter)
  if (!['.md', '.mdc'].includes(extname(entry.sourcePath).toLowerCase())) {
    return { transformed: false, output: raw };
  }

  // Parse markdown frontmatter leniently: if frontmatter is invalid, treat as plain markdown
  const parsed = parseMarkdownDocument(raw, { lenient: true });
  if (!parsed.frontmatter) {
    return { transformed: false, output: raw };
  }

  // Apply flow.map to frontmatter, same as flow executor does for markdown
  const mapContext = createMapContext({
    filename: basename(entry.sourcePath, extname(entry.sourcePath)),
    dirname: basename(dirname(entry.sourcePath)),
    path: pathRelative(workspaceRoot, entry.sourcePath).replace(/\\/g, '/'),
    ext: extname(entry.sourcePath),
  });

  // Split schema vs pipe ops (match flow-executor semantics)
  const { schemaOps, pipeOps } = splitMapPipeline(flow.map);

  let nextFrontmatter = parsed.frontmatter;
  if (schemaOps.length > 0) {
    nextFrontmatter = applyMapPipeline(nextFrontmatter, schemaOps as any, mapContext, defaultTransformRegistry);
  }
  if (pipeOps.length > 0) {
    nextFrontmatter = applyMapPipeline(nextFrontmatter, pipeOps as any, mapContext, defaultTransformRegistry);
  }

  const output = serializeMarkdownDocument({ frontmatter: nextFrontmatter, body: parsed.body });
  return { transformed: true, output };
}

export interface CopyFilesWithConflictResolutionOptions {
  force?: boolean;
  execContext?: { interactionPolicy?: { canPrompt(tier: PromptTier): boolean } };
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

    const sourceContent = await readTextFile(entry.sourcePath);
    const transformed = transformMarkdownWithFlowMap(sourceContent, entry, process.cwd());
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
        decision = await promptConflictDecision(name, entry.registryPath, options.prompt);
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

