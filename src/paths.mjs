import { homedir } from 'node:os';
import { join, win32 } from 'node:path';

function getSystemHostsPath({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32') {
    const windowsRoot = env.SystemRoot || env.windir || 'C:\\Windows';
    return win32.join(windowsRoot, 'System32', 'drivers', 'etc', 'hosts');
  }
  return '/etc/hosts';
}

function createPaths({ env = process.env, homeDirectory = homedir(), platform = process.platform } = {}) {
  const appDir = env.WHISTLE_LAN_HOME || join(homeDirectory, '.whistle-lan');
  return {
    appDir,
    configPath: join(appDir, 'config.json'),
    generatedRulesPath: join(appDir, 'generated-rules.cjs'),
    hostsPath: join(appDir, 'hosts.json'),
    runtimePath: join(appDir, 'runtime.json'),
    systemHostsPath: getSystemHostsPath({ platform, env }),
    whistleDataPath: join(appDir, 'whistle-data')
  };
}

export { createPaths, getSystemHostsPath };
