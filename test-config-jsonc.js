/**
 * Test script to verify JSONC config support
 * This tests the config system's ability to read both JSON and JSONC files
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { configManager } from './dist/core/config.js';

const testConfigDir = join(homedir(), '.openpackage');
const jsonConfigPath = join(testConfigDir, 'config.json');
const jsoncConfigPath = join(testConfigDir, 'config.jsonc');

async function cleanup() {
  try {
    await fs.unlink(jsonConfigPath);
  } catch {}
  try {
    await fs.unlink(jsoncConfigPath);
  } catch {}
}

async function testNewConfig() {
  console.log('\n=== Test 1: Creating new config (should use JSONC by default) ===');
  await cleanup();
  
  // Load config (should create new one)
  const config = await configManager.load();
  console.log('Config loaded:', JSON.stringify(config, null, 2));
  
  // Check which file was created
  const jsonExists = await fs.access(jsonConfigPath).then(() => true).catch(() => false);
  const jsoncExists = await fs.access(jsoncConfigPath).then(() => true).catch(() => false);
  
  console.log(`config.json exists: ${jsonExists}`);
  console.log(`config.jsonc exists: ${jsoncExists}`);
  
  if (jsoncExists) {
    const content = await fs.readFile(jsoncConfigPath, 'utf-8');
    console.log('config.jsonc content:');
    console.log(content);
    console.log('✅ Test 1 passed: New config created as JSONC');
  } else {
    console.log('❌ Test 1 failed: JSONC file not created');
  }
}

async function testReadJSON() {
  console.log('\n=== Test 2: Reading existing JSON config ===');
  await cleanup();
  
  // Create a JSON config manually
  const testConfig = {
    defaults: {
      license: 'Apache-2.0',
      author: 'Test Author'
    }
  };
  await fs.mkdir(testConfigDir, { recursive: true });
  await fs.writeFile(jsonConfigPath, JSON.stringify(testConfig, null, 2));
  console.log('Created test config.json');
  
  // Force reload
  const ConfigManager = (await import('./dist/core/config.js')).ConfigManager;
  const testManager = new ConfigManager();
  
  const config = await testManager.load();
  console.log('Config loaded:', JSON.stringify(config, null, 2));
  
  if (config.defaults?.license === 'Apache-2.0' && config.defaults?.author === 'Test Author') {
    console.log('✅ Test 2 passed: JSON config read successfully');
  } else {
    console.log('❌ Test 2 failed: Config not read correctly');
  }
}

async function testReadJSONC() {
  console.log('\n=== Test 3: Reading JSONC config with comments ===');
  await cleanup();
  
  // Create a JSONC config with comments
  const jsoncContent = `{
  // This is a comment
  "defaults": {
    "license": "MIT", // Default license
    "author": "JSONC Test" /* Block comment */
  }
}`;
  await fs.mkdir(testConfigDir, { recursive: true });
  await fs.writeFile(jsoncConfigPath, jsoncContent);
  console.log('Created test config.jsonc with comments');
  
  // Force reload
  const ConfigManager = (await import('./dist/core/config.js')).ConfigManager;
  const testManager = new ConfigManager();
  
  const config = await testManager.load();
  console.log('Config loaded:', JSON.stringify(config, null, 2));
  
  if (config.defaults?.license === 'MIT' && config.defaults?.author === 'JSONC Test') {
    console.log('✅ Test 3 passed: JSONC config with comments read successfully');
  } else {
    console.log('❌ Test 3 failed: Config not read correctly');
  }
}

async function testSavePreservesFormat() {
  console.log('\n=== Test 4: Saving preserves existing format ===');
  await cleanup();
  
  // Create a JSONC config
  const jsoncContent = `{
  "defaults": {
    "license": "MIT"
  }
}`;
  await fs.mkdir(testConfigDir, { recursive: true });
  await fs.writeFile(jsoncConfigPath, jsoncContent);
  console.log('Created test config.jsonc');
  
  // Force reload and modify
  const ConfigManager = (await import('./dist/core/config.js')).ConfigManager;
  const testManager = new ConfigManager();
  
  await testManager.set('defaults', { license: 'Apache-2.0' });
  
  // Check that JSONC file still exists (not replaced with JSON)
  const jsonExists = await fs.access(jsonConfigPath).then(() => true).catch(() => false);
  const jsoncExists = await fs.access(jsoncConfigPath).then(() => true).catch(() => false);
  
  console.log(`config.json exists: ${jsonExists}`);
  console.log(`config.jsonc exists: ${jsoncExists}`);
  
  if (jsoncExists && !jsonExists) {
    const content = await fs.readFile(jsoncConfigPath, 'utf-8');
    console.log('Updated config.jsonc content:');
    console.log(content);
    console.log('✅ Test 4 passed: Format preserved when saving');
  } else {
    console.log('❌ Test 4 failed: Format not preserved');
  }
}

async function runTests() {
  try {
    await testNewConfig();
    await testReadJSON();
    await testReadJSONC();
    await testSavePreservesFormat();
    
    console.log('\n=== All tests completed ===');
    await cleanup();
    console.log('Cleaned up test files');
  } catch (error) {
    console.error('Test failed with error:', error);
    await cleanup();
  }
}

runTests();
