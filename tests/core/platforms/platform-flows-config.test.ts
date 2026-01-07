/**
 * Tests for Platform Flows Configuration
 * 
 * Tests the updated platform loader with flow-based configurations,
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

// Test 1: Validate flow-based platform configuration
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      flows: [
        {
          from: 'rules/*.md',
          to: '.test/rules/*.md'
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
      flows: [
        {
          to: '.test/rules/{name}.md'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.ok(errors.length > 0, 'should have validation errors')
  assert.ok(
    errors.some(e => e.includes("Missing or invalid 'from' field")),
    'should reject missing from field'
  )
}

// Test 3: Reject platform missing required to field in flow
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      flows: [
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
      flows: [
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
      flows: [
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
      flows: []
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'global flows config should be valid')
}

// Test 6: Reject platform with neither subdirs nor flows (and no rootFile)
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
    errors.some(e => e.includes("Must define either 'flows' or 'rootFile'")),
    'should reject platform without flows/rootFile'
  )
}

// Test 7: Reject platform with only subdirs (subdirs support removed)
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      subdirs: [
        {
          universalDir: 'rules',
          platformDir: 'rules'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.ok(errors.length > 0, 'subdirs without flows/rootFile should be rejected')
  assert.ok(
    errors.some(e => e.includes("Must define either 'flows' or 'rootFile'")),
    'should require flows or rootFile even with subdirs'
  )
}

// Test 8: Accept platform with only flows
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      flows: [
        {
          from: 'rules/*.md',
          to: '.test/rules/*.md'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'flow-only platform should be valid')
}

// Test 9: Accept platform with only rootFile (like Warp)
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      rootFile: 'TEST.md',
      subdirs: []
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'rootFile-only platform should be valid')
}

// Test 10: Accept platform with both subdirs and flows
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      subdirs: [
        {
          universalDir: 'rules',
          platformDir: 'rules'
        }
      ],
      flows: [
        {
          from: 'commands/*.md',
          to: '.test/commands/*.md'
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'platform with both subdirs and flows should be valid')
}

// Test 11: Validate pipe transforms array
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      flows: [
        {
          from: 'config.yaml',
          to: '.test/config.json',
          pipe: ['filter-empty', 'filter-null']
        }
      ]
    }
  }
  
  const errors = validatePlatformsConfig(config)
  assert.equal(errors.length, 0, 'pipe transforms should be valid')
}

// Test 12: Reject invalid pipe transforms
{
  const config = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      flows: [
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
      flows: [
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
      flows: [
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
      flows: [
        {
          from: 'new.md',
          to: '.test/new.md'
        }
      ]
    }
  }

  const merged = mergePlatformsConfig(base, override)
  
  assert.equal(merged['test-platform'].flows.length, 1, 'should have 1 flow')
  assert.equal(merged['test-platform'].flows[0].from, 'new.md', 'should use override flow')
  assert.equal(merged['test-platform'].name, 'Test Platform Updated', 'should update name')
}

// Test 15: Add new platforms from override
{
  const base = {
    'platform1': {
      name: 'Platform 1',
      rootDir: '.p1',
      flows: []
    }
  }

  const override = {
    'platform2': {
      name: 'Platform 2',
      rootDir: '.p2',
      flows: []
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
      flows: [
        {
          from: 'AGENTS.md',
          to: 'AGENTS.md'
        }
      ]
    },
    'test-platform': {
      name: 'Test',
      rootDir: '.test',
      rootFile: 'TEST.md',  // Need at least rootFile since flows is empty
      flows: []
    }
  }

  const override = {
    global: {
      flows: [
        {
          from: 'README.md',
          to: 'README.md'
        }
      ]
    }
  }

  const merged = mergePlatformsConfig(base, override)
  
  assert.ok('global' in merged, 'should have global config')
  assert.equal(merged.global.flows.length, 1, 'should have 1 global flow')
  assert.equal(merged.global.flows[0].from, 'README.md', 'should use override global flow')
}

// Test 17: Allow disabling platform in override
{
  const base = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      enabled: true,
      rootFile: 'TEST.md',  // Need at least rootFile since flows is empty
      flows: []
    }
  }

  const override = {
    'test-platform': {
      name: 'Test Platform',
      rootDir: '.test',
      enabled: false,
      rootFile: 'TEST.md',
      flows: []
    }
  }

  const merged = mergePlatformsConfig(base, override)
  
  assert.equal(merged['test-platform'].enabled, false, 'should disable platform')
}

console.log('✅ All platform-flows-config tests passed!')
