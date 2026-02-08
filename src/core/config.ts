import { join, extname } from 'path';
import { OpenPackageConfig, OpenPackageDirectories } from '../types/index.js';
import { readJsonOrJsoncFile, writeJsoncFile, writeJsonFile, exists } from '../utils/fs.js';
import { logger } from '../utils/logger.js';
import { ConfigError } from '../utils/errors.js';
import { getOpenPackageDirectories } from './directory.js';

/**
 * Configuration management for the OpenPackage CLI
 * Supports both JSON and JSONC formats
 */

const CONFIG_FILE_NAMES = ['config.jsonc', 'config.json'];
const DEFAULT_CONFIG_FILE = 'config.jsonc'; // Use JSONC by default for new configs

// Default configuration values
const DEFAULT_CONFIG: OpenPackageConfig = {
  defaults: {
    license: 'MIT'
  }
};

class ConfigManager {
  private config: OpenPackageConfig | null = null;
  private configPath: string | null = null;
  private openPackageDirs: OpenPackageDirectories;

  constructor() {
    this.openPackageDirs = getOpenPackageDirectories();
  }

  /**
   * Find the existing config file (supports both .json and .jsonc)
   * Returns the path to the existing config file, or null if none exists
   */
  private async findConfigFile(): Promise<string | null> {
    for (const fileName of CONFIG_FILE_NAMES) {
      const path = join(this.openPackageDirs.config, fileName);
      if (await exists(path)) {
        return path;
      }
    }
    return null;
  }

  /**
   * Get the config path to use for saving
   * If a config file already exists, use that format
   * Otherwise, use the default format (JSONC)
   */
  private async getConfigPath(): Promise<string> {
    if (this.configPath) {
      return this.configPath;
    }

    // Check if a config file already exists
    const existingPath = await this.findConfigFile();
    if (existingPath) {
      this.configPath = existingPath;
      return existingPath;
    }

    // No existing config, use default
    this.configPath = join(this.openPackageDirs.config, DEFAULT_CONFIG_FILE);
    return this.configPath;
  }

  /**
   * Load configuration from file, create default if it doesn't exist
   */
  async load(): Promise<OpenPackageConfig> {
    if (this.config) {
      return this.config;
    }

    try {
      const configPath = await this.findConfigFile();
      
      if (configPath) {
        logger.debug(`Loading config from: ${configPath}`);
        const fileConfig = await readJsonOrJsoncFile<OpenPackageConfig>(configPath);
        this.configPath = configPath;
        this.config = {
          ...DEFAULT_CONFIG,
          ...fileConfig,
          defaults: {
            ...DEFAULT_CONFIG.defaults,
            ...(fileConfig.defaults ?? {})
          }
        };
      } else {
        logger.debug('Config file not found, using defaults');
        this.config = { ...DEFAULT_CONFIG };
        await this.save(); // Create the config file with defaults
      }

      return this.config;
    } catch (error) {
      logger.error('Failed to load configuration', { error });
      throw new ConfigError(`Failed to load configuration: ${error}`);
    }
  }

  /**
   * Save current configuration to file
   * Uses JSONC format for new files, preserves existing format
   */
  async save(): Promise<void> {
    if (!this.config) {
      throw new ConfigError('No configuration loaded to save');
    }

    try {
      const configPath = await this.getConfigPath();
      const ext = extname(configPath);
      
      logger.debug(`Saving config to: ${configPath}`);
      
      // Write in JSONC format if the extension is .jsonc, otherwise use JSON
      if (ext === '.jsonc') {
        await writeJsoncFile(configPath, this.config);
      } else {
        await writeJsonFile(configPath, this.config);
      }
    } catch (error) {
      logger.error('Failed to save configuration', { error, configPath: this.configPath });
      throw new ConfigError(`Failed to save configuration: ${error}`);
    }
  }

  /**
   * Get a configuration value
   */
  async get<K extends keyof OpenPackageConfig>(key: K): Promise<OpenPackageConfig[K]> {
    const config = await this.load();
    return config[key];
  }

  /**
   * Set a configuration value
   */
  async set<K extends keyof OpenPackageConfig>(key: K, value: OpenPackageConfig[K]): Promise<void> {
    const config = await this.load();
    config[key] = value;
    this.config = config;
    await this.save();
    logger.info(`Configuration updated: ${key} = ${value}`);
  }

  /**
   * Get all configuration values
   */
  async getAll(): Promise<OpenPackageConfig> {
    return await this.load();
  }

  /**
   * Reset configuration to defaults
   */
  async reset(): Promise<void> {
    this.config = { ...DEFAULT_CONFIG };
    await this.save();
    logger.info('Configuration reset to defaults');
  }

  /**
   * Validate configuration
   */
  async validate(): Promise<boolean> {
    try {
      const config = await this.load();
      
      // Basic validation - config structure is valid
      if (typeof config !== 'object' || config === null) {
        throw new ConfigError('Invalid configuration structure');
      }

      return true;
    } catch (error) {
      logger.error('Configuration validation failed', { error });
      return false;
    }
  }

  /**
   * Get the configuration file path
   * Returns the path that will be used for the config file
   */
  async getConfigFilePath(): Promise<string> {
    return await this.getConfigPath();
  }

  /**
   * Get OpenPackage directories
   */
  getDirectories(): OpenPackageDirectories {
    return this.openPackageDirs;
  }

  /**
   * Get telemetry disabled setting
   * Returns undefined if not set in config
   */
  async getTelemetryDisabled(): Promise<boolean | undefined> {
    const config = await this.load();
    return config.telemetry?.disabled;
  }

}

// Create and export a singleton instance
export const configManager = new ConfigManager();

// Export the class for testing purposes
export { ConfigManager };
