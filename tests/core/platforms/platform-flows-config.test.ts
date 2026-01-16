/**
 * Tests for Platform Flows Configuration
 * 
 * Tests the updated platform loader with export/import flow-based configurations,
 * including validation, merging, and backward compatibility.
 */

import assert from 'node:assert/strict'

let validatePlatformsConfig, mergePlatformsConfig;

try {
  const module = await import(new URL('../../../src/core/platforms.js', import.meta.url).href);
  validatePlatformsConfig = module.validatePlatformsConfig;
  mergePlatformsConfig = module.mergePlatformsConfig;
} catch (error) {
  console.error('Failed to import platforms module:', error);
  process.exit(1);
}

console.log('platform-flows-config tests starting')

// Test 1: Validate flow-based platform configuration with export/import
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          from: 'rules/*.md',
          to: '.test/rules/*.md'
        }
      ],
      import: [
        {
          from: '.test/rules/*.md',
          to: 'rules/*.md'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'flow-based platform should be valid')
}

// Test 2: Reject platform missing required from field in flow
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          to: '.test/rules/{name}.md'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.ok(errors.length > 0, 'should have validation errors')
  assert.ok(
    errors.some(e => e.includes("Missing 'from' field")),
    'should reject missing from field'
  )
}

// Test 3: Reject platform missing required to field in flow
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          from: 'rules/{name}.md'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.ok(errors.length > 0, 'should have validation errors')
  assert.ok(
    errors.some(e => e.includes("Missing 'to' field")),
    'should reject missing to field'
  )
}

// Test 4: Reject invalid merge strategy
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          from: 'rules/{name}.md',
          to: '.test/rules/{name}.md',
          merge: 'invalid-strategy'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.ok(errors.length > 0, 'should have validation errors')
  assert.ok(
    errors.some(e => e.includes('Invalid merge strategy')),
    'should reject invalid merge strategy'
  )
}

// Test 5: Validate global flows configuration
{
  const config = {
    global: {
      export: [
        {
          from: 'AGENTS.md',
          to: 'AGENTS.md'
        }
      ],
      import: [
        {
          from: 'AGENTS.md',
          to: 'AGENTS.md'
        }
      ]
    },
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      rootFile: 'TEST.md',  // Need at least rootFile since flows is empty
      export: []
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'global flows config should be valid')
}

// Test 6: Reject platform with neither export/import flows nor rootFile
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test'
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.ok(errors.length > 0, 'should have validation errors')
  assert.ok(
    errors.some(e => e.includes("Must define at least one of 'export', 'import', 'detection', or 'rootFile'")),
    'should reject platform without export/import/detection/rootFile'
  )
}

// Test 7: Accept platform with only export flows
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          from: 'rules/*.md',
          to: '.test/rules/*.md'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'export-only platform should be valid')
}

// Test 8: Accept platform with only import flows
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      import: [
        {
          from: '.test/rules/*.md',
          to: 'rules/*.md'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'import-only platform should be valid')
}

// Test 9: Accept platform with only rootFile (like Warp)
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      rootFile: 'TEST.md'
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'rootFile-only platform should be valid')
}

// Test 10: Accept platform with both export and import flows
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          from: 'commands/*.md',
          to: '.test/commands/*.md'
        }
      ],
      import: [
        {
          from: '.test/commands/*.md',
          to: 'commands/*.md'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'platform with both export and import should be valid')
}

// Test 11: Validate pipe transforms array in export
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          from: 'config.yaml',
          to: '.test/config.json',
          pipe: ['filter-empty', 'filter-null']
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'pipe transforms in export should be valid')
}

// Test 12: Reject invalid pipe transforms
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          from: 'config.yaml',
          to: '.test/config.json',
          pipe: 'not-an-array'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.ok(errors.length > 0, 'should have validation errors')
  assert.ok(
    errors.some(e => e.includes("'pipe' must be array")),
    'should reject invalid pipe'
  )
}

// Test 13: Validate complex flow with all fields
{
  const config = {
    'complex-platform': {
      name: 'Complex Platform',
      rootDir: '.complex',
      rootFile: 'COMPLEX.md',
      aliases: ['comp', 'complex'],
      enabled: true,
      description: 'A complex test platform',
      variables: {
        namespace: 'complex',
        priority: 5
      },
      export: [
        {
          from: 'agents/*.md',
          to: {
            workspace: '.complex/agents/*.md',
            alt: '.complex/alt-agents/*.md'
          },
          extract: '$.frontmatter',
          pick: ['name', 'description', 'categories'],
          omit: ['deprecated'],
          map: [
            { $rename: { name: 'agent.name' } },
            { $rename: { categories: 'agent.categories' } }
          ],
          pipe: ['filter-empty', 'filter-null'],
          embed: 'agent',
          merge: 'deep',
          when: {
            platform: 'complex'
          }
        }
      ],
      import: [
        {
          from: '.complex/agents/*.md',
          to: 'agents/*.md'
        }
      ]
    }
  }

  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'complex platform config should be valid')
}

// Test 14: Merge flows arrays by replacement
{
  const base = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          from: 'old.md',
          to: '.test/old.md'
        }
      ]
    }
  }

  const override = {
    'test-platform': {
      name: 'Test Platform Updated',
      rootDir: '.test',
      export: [
        {
          from: 'new.md',
          to: '.test/new.md'
        }
      ]
    }
  }

  const merged = mergePlatformsConfig(base, override)
  
  assert.equal(merged['test-platform'].export.length, 1, 'should have 1 export flow')
  assert.equal(merged['test-platform'].export[0].from, 'new.md', 'should use override flow')
  assert.equal(merged['test-platform'].name, 'Test Platform Updated', 'should update name')
}

// Test 15: Add new platforms from override
{
  const base = {
    'platform1': {
      name: 'Platform 1',
      rootDir: '.p1',
      export: []
    }
  }

  const override = {
    'platform2': {
      name: 'Platform 2',
      rootDir: '.p2',
      export: []
    }
  }

  const merged = mergePlatformsConfig(base, override)
  
  assert.ok('platform1' in merged, 'should contain base platform')
  assert.ok('platform2' in merged, 'should contain override platform')
}

// Test 16: Merge global flows
{
  const base = {
    global: {
      export: [
        {
          from: 'AGENTS.md',
          to: 'AGENTS.md'
        }
      ]
    },
    'test-platform': {
      name: 'Test',
      rootDir: '.test',
      rootFile: 'TEST.md'
    }
  }

  const override = {
    global: {
      export: [
        {
          from: 'README.md',
          to: 'README.md'
        }
      ]
    }
  }

  const merged = mergePlatformsConfig(base, override)
  
  assert.ok('global' in merged, 'should have global config')
  assert.equal(merged.global.export.length, 1, 'should have 1 global export flow')
  assert.equal(merged.global.export[0].from, 'README.md', 'should use override global flow')
}

// Test 17: Allow disabling platform in override
{
  const base = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      enabled: true,
      rootFile: 'TEST.md'
    }
  }

  const override = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      enabled: false,
      rootFile: 'TEST.md'
    }
  }

  const merged = mergePlatformsConfig(base, override)
  
  assert.equal(merged['test-platform'].enabled, false, 'should disable platform')
}

// Test 18: Validate array patterns in export flows
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      export: [
        {
          from: ['mcp.jsonc', 'mcp.json'],
          to: '.test/mcp.json'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'array patterns in export should be valid')
}

// Test 19: Validate array patterns in import flows
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      import: [
        {
          from: ['.test/mcp.json', '.test/mcp.jsonc'],
          to: 'mcp.jsonc'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'array patterns in import should be valid')
}

console.log('✅ All platform-flows-config tests passed!')
