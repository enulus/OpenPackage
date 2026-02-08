/**
 * Manual test for --list resource discovery
 * 
 * Run with: npm run build && node dist/tests/manual-test-list.js
 */

import { join } from 'path';
import { discoverResources } from '../src/core/install/resource-discoverer.js';

async function main() {
  const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'resource-discovery');
  
  console.log('Testing resource discovery...');
  console.log('Fixture directory:', fixtureDir);
  console.log('');
  
  try {
    const result = await discoverResources(fixtureDir, fixtureDir);
    
    console.log('Discovery Results:');
    console.log('------------------');
    console.log('Total resources:', result.total);
    console.log('');
    
    if (result.total > 0) {
      console.log('Resources by type:');
      for (const [type, resources] of result.byType.entries()) {
        console.log(`\n${type.toUpperCase()} (${resources.length}):`);
        for (const resource of resources) {
          console.log(`  - ${resource.displayName}`);
          if (resource.description) {
            console.log(`    Description: ${resource.description}`);
          }
          if (resource.version) {
            console.log(`    Version: ${resource.version}`);
          }
          console.log(`    Path: ${resource.resourcePath}`);
        }
      }
    } else {
      console.log('No resources found.');
    }
    
    console.log('');
    console.log('✓ Test completed successfully');
    
  } catch (error) {
    console.error('✗ Test failed:', error);
    process.exit(1);
  }
}

main();
