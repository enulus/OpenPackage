// Quick test of pattern matching
import { promises as fs } from 'fs';
import { join, dirname, basename, relative } from 'path';
import { tmpdir } from 'os';

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function matchPattern(pattern: string, baseDir: string): Promise<string[]> {
  const matches: string[] = [];
  
  // Extract directory path and file pattern
  const patternDir = dirname(pattern);
  const filePattern = basename(pattern);
  
  const searchDir = join(baseDir, patternDir);
  
  console.log('Pattern:', pattern);
  console.log('Base dir:', baseDir);
  console.log('Pattern dir:', patternDir);
  console.log('File pattern:', filePattern);
  console.log('Search dir:', searchDir);
  
  // Check if directory exists
  if (!(await exists(searchDir))) {
    console.log('Search dir does not exist');
    return matches;
  }
  
  // Handle simple patterns (no wildcards or placeholders)
  if (!filePattern.includes('*') && !filePattern.includes('{')) {
    // Exact file match
    const exactPath = join(searchDir, filePattern);
    if (await exists(exactPath)) {
      matches.push(relative(baseDir, exactPath));
    }
    return matches;
  }
  
  // Handle patterns with wildcards or placeholders
  const files = await fs.readdir(searchDir);
  console.log('Files in search dir:', files);
  
  // Convert pattern to regex
  // Replace {name} with capture group, * with .*
  let regexPattern = filePattern
    .replace(/\{name\}/g, '([^/]+)')
    .replace(/\*/g, '.*');
  
  console.log('Regex pattern:', regexPattern);
  
  const regex = new RegExp('^' + regexPattern + '$');
  
  for (const file of files) {
    console.log(`Testing file "${file}" against regex`);
    if (regex.test(file)) {
      console.log(`  ✓ Match!`);
      const fullPath = join(searchDir, file);
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        matches.push(relative(baseDir, fullPath));
      }
    } else {
      console.log(`  ✗ No match`);
    }
  }
  
  return matches;
}

async function main() {
  // Create test directory
  const testRoot = join(tmpdir(), `opkg-pattern-test-${Date.now()}`);
  await fs.mkdir(join(testRoot, 'rules'), { recursive: true });
  await fs.writeFile(join(testRoot, 'rules', 'typescript.md'), '# TypeScript Rules');
  
  console.log('Test root:', testRoot);
  console.log('');
  
  // Test pattern matching
  const matches = await matchPattern('rules/{name}.md', testRoot);
  
  console.log('');
  console.log('Matches:', matches);
  
  // Cleanup
  await fs.rm(testRoot, { recursive: true, force: true });
}

main().catch(console.error);
