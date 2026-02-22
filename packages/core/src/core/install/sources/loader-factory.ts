import type { PackageSourceLoader } from './base.js';
import type { PackageSource } from '../unified/context.js';
import { RegistrySourceLoader } from './registry-source.js';
import { PathSourceLoader } from './path-source.js';
import { GitSourceLoader } from './git-source.js';
import { WorkspaceSourceLoader } from './workspace-source.js';

/**
 * Registry of all available source loaders
 */
const loaders: PackageSourceLoader[] = [
  new RegistrySourceLoader(),
  new PathSourceLoader(),
  new GitSourceLoader(),
  new WorkspaceSourceLoader()
];

/**
 * Get appropriate loader for a source
 */
export function getLoaderForSource(source: PackageSource): PackageSourceLoader {
  const loader = loaders.find(l => l.canHandle(source));
  
  if (!loader) {
    throw new Error(`No loader available for source type: ${source.type}`);
  }
  
  return loader;
}
