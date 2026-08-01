import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createDefaultConfig, normalizeConfig, normalizeHostsConfig } from './validation.mjs';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error.message}`);
  }
}

function createStorage(paths) {
  function ensureFiles() {
    mkdirSync(paths.appDir, { recursive: true, mode: 0o700 });
    if (!existsSync(paths.configPath)) writeJson(paths.configPath, createDefaultConfig());
    if (!existsSync(paths.hostsPath)) writeJson(paths.hostsPath, { hosts: {} });
  }

  function readConfig() {
    ensureFiles();
    return normalizeConfig(readJson(paths.configPath, 'config.json'));
  }

  function writeConfig(config) {
    ensureFiles();
    const normalizedConfig = normalizeConfig(config);
    writeJson(paths.configPath, normalizedConfig);
    return normalizedConfig;
  }

  function readHosts() {
    ensureFiles();
    return normalizeHostsConfig(readJson(paths.hostsPath, 'hosts.json'));
  }

  function writeHosts(hostsConfig) {
    ensureFiles();
    const normalizedHosts = normalizeHostsConfig(hostsConfig);
    writeJson(paths.hostsPath, normalizedHosts);
    return normalizedHosts;
  }

  function readRuntime() {
    if (!existsSync(paths.runtimePath)) return null;
    const runtime = readJson(paths.runtimePath, 'runtime.json');
    if (!runtime || typeof runtime.host !== 'string' || !Number.isInteger(runtime.port)) return null;
    return {
      host: runtime.host,
      port: runtime.port,
      startedAt: runtime.startedAt,
      username: typeof runtime.username === 'string' ? runtime.username : null,
      password: typeof runtime.password === 'string' ? runtime.password : null,
      systemProxyEnabled: runtime.systemProxyEnabled === true
    };
  }

  function writeRuntime(runtime) {
    ensureFiles();
    writeJson(paths.runtimePath, runtime);
  }

  function clearRuntime() {
    rmSync(paths.runtimePath, { force: true });
  }

  function writeGeneratedRules(source) {
    ensureFiles();
    writeFileSync(paths.generatedRulesPath, source, { mode: 0o600 });
  }

  return {
    clearRuntime,
    ensureFiles,
    readConfig,
    readHosts,
    readRuntime,
    writeConfig,
    writeGeneratedRules,
    writeHosts,
    writeRuntime
  };
}

export { createStorage };
