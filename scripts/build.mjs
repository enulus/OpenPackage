/**
 * Root Build Script
 *
 * Builds both @opkg/core (tsc) and opkg CLI (esbuild) packages.
 * This script replaces the old monolithic build that compiled from src/.
 */

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

console.log('Building @opkg/core...');
execSync('npm run build', { cwd: join(root, 'packages/core'), stdio: 'inherit' });

console.log('Building opkg CLI...');
execSync('npm run build', { cwd: join(root, 'packages/cli'), stdio: 'inherit' });

console.log('Build complete.');
