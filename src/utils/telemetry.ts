import { HttpClient } from './http-client.js';
import { logger } from './logger.js';
import { getVersion } from './package.js';

/**
 * Single install event
 */
export interface InstallEvent {
  packageName: string;
  version: string;
  resourcePath?: string;
  resourceType?: string;
  resourceName?: string;
  marketplaceName?: string;
  pluginName?: string;
}

/**
 * Telemetry metadata
 */
interface TelemetryMetadata {
  cliVersion: string;
  timestamp: string;
  installCommand?: string;
}

/**
 * Batch telemetry request
 */
interface BatchTelemetryRequest {
  installs: InstallEvent[];
  metadata: TelemetryMetadata;
}

/**
 * Check if telemetry is disabled via environment variable
 */
export function isTelemetryEnabled(): boolean {
  return process.env.OPKG_TELEMETRY_DISABLED !== 'true';
}

/**
 * Check if telemetry debug mode is enabled
 */
export function isTelemetryDebugEnabled(): boolean {
  return process.env.OPKG_TELEMETRY_DEBUG === 'true';
}

/**
 * Collector for install telemetry events
 * Accumulates events during installation and sends in batch
 */
export class TelemetryCollector {
  private events: InstallEvent[] = [];
  private command?: string;

  constructor(command?: string) {
    this.command = command;
  }

  /**
   * Record an install event
   */
  recordInstall(event: InstallEvent): void {
    if (!isTelemetryEnabled()) {
      return;
    }

    // Basic validation
    if (!event.packageName || !event.version) {
      logger.debug('Skipping invalid telemetry event (missing package name or version)');
      return;
    }

    this.events.push(event);

    if (isTelemetryDebugEnabled()) {
      logger.debug(`[Telemetry] Recorded install: ${event.packageName}@${event.version}`, {
        resourcePath: event.resourcePath,
        resourceType: event.resourceType,
        resourceName: event.resourceName,
      });
    }
  }

  /**
   * Get the number of recorded events
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Deduplicate events (same package + version + resource)
   */
  private deduplicateEvents(): InstallEvent[] {
    const seen = new Set<string>();
    const deduplicated: InstallEvent[] = [];

    for (const event of this.events) {
      const key = `${event.packageName}@${event.version}:${event.resourcePath || 'main'}`;
      if (!seen.has(key)) {
        seen.add(key);
        deduplicated.push(event);
      }
    }

    if (deduplicated.length < this.events.length) {
      logger.debug(
        `Deduplicated ${this.events.length - deduplicated.length} duplicate install events`
      );
    }

    return deduplicated;
  }

  /**
   * Flush all collected events to the backend
   * Fire-and-forget with timeout
   */
  async flush(httpClient: HttpClient): Promise<void> {
    if (!isTelemetryEnabled()) {
      return;
    }

    if (this.events.length === 0) {
      logger.debug('[Telemetry] No events to flush');
      return;
    }

    // Deduplicate events
    const uniqueEvents = this.deduplicateEvents();

    if (uniqueEvents.length === 0) {
      logger.debug('[Telemetry] All events were duplicates, nothing to send');
      return;
    }

    if (isTelemetryDebugEnabled()) {
      logger.debug(`[Telemetry] Flushing ${uniqueEvents.length} events`, {
        events: uniqueEvents,
      });
      // In debug mode, don't actually send
      return;
    }

    const payload: BatchTelemetryRequest = {
      installs: uniqueEvents,
      metadata: {
        cliVersion: getVersion(),
        timestamp: new Date().toISOString(),
        installCommand: this.command,
      },
    };

    try {
      logger.debug(`[Telemetry] Sending ${uniqueEvents.length} install events to backend`);

      // Fire-and-forget with 5 second timeout
      await reportBatchInstalls(httpClient, payload);

      logger.debug('[Telemetry] Successfully sent install events');
    } catch (error) {
      // Silent failure - log to debug only
      logger.debug('[Telemetry] Failed to send install events', { error });
    }
  }
}

/**
 * Send batch telemetry to backend
 * Fire-and-forget with timeout
 */
async function reportBatchInstalls(
  httpClient: HttpClient,
  payload: BatchTelemetryRequest
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

  try {
    await httpClient.post('/telemetry/installs', payload, {
      signal: controller.signal,
      skipAuth: false, // Include auth if available
    });
  } catch (error) {
    // Check if it's a timeout
    if (error instanceof Error && error.name === 'AbortError') {
      logger.debug('[Telemetry] Request timed out after 5 seconds');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Create a new telemetry collector
 * Returns null if telemetry is disabled
 */
export function createTelemetryCollector(command?: string): TelemetryCollector | null {
  if (!isTelemetryEnabled()) {
    return null;
  }

  return new TelemetryCollector(command);
}
