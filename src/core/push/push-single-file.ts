import { resolve, relative } from 'path'
import { DIR_PATTERNS } from '../../constants/index.js'
import { exists, isFile } from '../../utils/fs.js'
import { listAllPackages } from '../directory.js'
import { normalizePathForProcessing } from '../../utils/path-normalization.js'
import { mapPlatformFileToUniversal } from '../../utils/platform-mapper.js'
import { safePrompts } from '../../utils/prompts.js'
import { UserCancellationError } from '../../utils/errors.js'

export const SINGLE_FILE_PACKAGE = 'f'

export type SingleFileContext =
  | { kind: 'ok'; packageName: string; registryPath: string }
  | { kind: 'missing'; registryPath: string }

export async function resolveSingleFileInput(
  cwd: string,
  rawInput: string
): Promise<SingleFileContext | null> {
  const absolutePath = resolve(cwd, rawInput)
  const looksLikePath = rawInput.includes('/') || rawInput.includes('\\') || rawInput.startsWith('.')

  let registryPath: string | null = null

  if (await exists(absolutePath)) {
    if (await isFile(absolutePath)) {
      registryPath = computeRegistryPath(cwd, absolutePath)
    }
  }

  if (!registryPath && looksLikePath) {
    registryPath = normalizePathForProcessing(rawInput)
  }

  if (!registryPath) {
    return null
  }

  const allPackages = await listAllPackages()
  const singleFilePackages = allPackages.filter(
    name => name === SINGLE_FILE_PACKAGE || name.endsWith(`/${SINGLE_FILE_PACKAGE}`)
  )

  if (singleFilePackages.length === 0) {
    console.error("❌ Single-file package 'f' not found in local registry. Run 'opkg save <file>' first.")
    return { kind: 'missing', registryPath }
  }

  let selectedPackage = singleFilePackages[0]

  if (singleFilePackages.length > 1) {
    const response = await safePrompts({
      type: 'select',
      name: 'pkg',
      message: 'Select single-file package to push',
      choices: singleFilePackages.map(pkg => ({ title: pkg, value: pkg })),
      hint: 'Use arrow keys to navigate, Enter to select'
    })
    selectedPackage = (response as any).pkg
  }

  if (!selectedPackage) {
    throw new UserCancellationError('Operation cancelled by user')
  }

  return { kind: 'ok', packageName: selectedPackage, registryPath }
}

function computeRegistryPath(cwd: string, absolutePath: string): string {
  const platformMapping = mapPlatformFileToUniversal(absolutePath)
  if (platformMapping) {
    const { subdir, relPath } = platformMapping
    return normalizePathForProcessing(
      [DIR_PATTERNS.OPENPACKAGE, subdir, relPath].filter(Boolean).join('/')
    )
  }
  const rel = relative(cwd, absolutePath)
  return normalizePathForProcessing(rel)
}


