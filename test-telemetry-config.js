import { configManager } from './dist/core/config.js';
import { createTelemetryCollector } from './dist/utils/telemetry.js';

async function test() {
  console.log('Testing telemetry config loading from ~/.openpackage/config.jsonc');
  console.log('');
  
  // Test 1: Load config and check telemetry.disabled
  console.log('Test 1: Loading global config');
  const config = await configManager.load();
  console.log('Config loaded:', JSON.stringify(config, null, 2));
  
  const telemetryDisabled = await configManager.getTelemetryDisabled();
  console.log('telemetry.disabled:', telemetryDisabled);
  console.log('Expected: true');
  console.log('');
  
  // Test 2: Create telemetry collector (should return null)
  console.log('Test 2: Creating telemetry collector (should be null when disabled)');
  const collector = await createTelemetryCollector('test');
  console.log('Collector:', collector);
  console.log('Expected: null');
  console.log('✅ PASS:', collector === null ? 'Telemetry correctly disabled' : 'FAIL');
  console.log('');
  
  // Test 3: Test with env var override to disable
  console.log('Test 3: Testing env var override (OPKG_TELEMETRY_DISABLED=true)');
  process.env.OPKG_TELEMETRY_DISABLED = 'true';
  const collector2 = await createTelemetryCollector('test');
  console.log('Collector:', collector2);
  console.log('Expected: null');
  console.log('✅ PASS:', collector2 === null ? 'Env var correctly disables' : 'FAIL');
  console.log('');
  
  console.log('All tests completed!');
}

test().catch(console.error);
