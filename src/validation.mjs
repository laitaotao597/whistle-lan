import { isIP } from 'node:net';

const DEFAULT_UI_USERNAME = 'uiAdmin';
const DEFAULT_BYPASS_HOSTS = Object.freeze([
  'api.mch.weixin.qq.com',
  'api2.mch.weixin.qq.com',
  'wx.tenpay.com',
  'open.weixin.qq.com'
]);
const CONFIG_KEYS = Object.freeze([
  'schemaVersion',
  'host',
  'interfaceName',
  'port',
  'uiUsername',
  'uiPassword',
  'systemProxy',
  'importSystemHosts',
  'upstreamProxy',
  'bypass'
]);

function createDefaultConfig() {
  return {
    schemaVersion: 1,
    host: '127.0.0.1',
    interfaceName: null,
    port: 10098,
    uiUsername: DEFAULT_UI_USERNAME,
    uiPassword: null,
    systemProxy: true,
    importSystemHosts: true,
    upstreamProxy: 'http://127.0.0.1:7890',
    bypass: [...DEFAULT_BYPASS_HOSTS]
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateHostname(value) {
  return typeof value === 'string'
    && value.length <= 253
    && /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)*[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(value);
}

function isPrivateIpv4(address) {
  if (isIP(address) !== 4) return false;
  const octets = address.split('.').map(Number);
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isLinkLocalIpv4(address) {
  if (isIP(address) !== 4) return false;
  const octets = address.split('.').map(Number);
  return octets[0] === 169 && octets[1] === 254;
}

function isPrivateIpv6(address) {
  if (isIP(address) !== 6) return false;
  const normalizedAddress = address.toLowerCase();
  return /^(?:fc|fd)/.test(normalizedAddress)
    || /^fe[89ab]/.test(normalizedAddress);
}

function validateBindHost(value) {
  if (value === 'auto' || value === 'localhost') return true;
  if (isIP(value) === 4) {
    return value.startsWith('127.')
      || isPrivateIpv4(value)
      || isLinkLocalIpv4(value);
  }
  if (isIP(value) === 6) return value === '::1' || isPrivateIpv6(value);
  return false;
}

function validatePort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function validateTarget(value) {
  if (typeof value !== 'string' || !value || /\s/.test(value)) return false;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) return false;

  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
    const port = parsed.port ? Number(parsed.port) : null;
    return ['http:', 'https:'].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && (port === null || validatePort(port));
  } catch {
    return false;
  }
}

function validateUpstreamProxy(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || /\s/.test(value)) return false;

  try {
    const parsed = new URL(value);
    const port = parsed.port ? Number(parsed.port) : null;
    return ['http:', 'https:', 'socks:'].includes(parsed.protocol)
      && Boolean(parsed.hostname)
      && (port === null || validatePort(port))
      && (parsed.pathname === '/' || parsed.pathname === '')
      && !parsed.search
      && !parsed.hash;
  } catch {
    return false;
  }
}

function normalizeConfig(value) {
  if (!isPlainObject(value)) throw new Error('config.json must contain a JSON object');

  const unknownKeys = Object.keys(value).filter(key => !CONFIG_KEYS.includes(key));
  if (unknownKeys.length) throw new Error(`Unknown config field: ${unknownKeys.join(', ')}`);

  const config = { ...createDefaultConfig(), ...value };
  if (config.schemaVersion !== 1) throw new Error('Unsupported config schemaVersion');
  if (!validateBindHost(config.host)) throw new Error(`Invalid config host: ${config.host}`);
  if (config.interfaceName !== null && (typeof config.interfaceName !== 'string' || !config.interfaceName.trim())) {
    throw new Error('interfaceName must be null or a non-empty string');
  }
  if (!validatePort(config.port)) throw new Error('Config port must be an integer from 1 to 65535');

  const hasUsername = typeof config.uiUsername === 'string' && config.uiUsername.length > 0;
  const hasPassword = typeof config.uiPassword === 'string' && config.uiPassword.length > 0;
  const usernameIsNull = config.uiUsername === null;
  const passwordIsNull = config.uiPassword === null;
  if (!usernameIsNull && !hasUsername) {
    throw new Error('uiUsername must be a non-empty string or null');
  }
  if (!passwordIsNull && !hasPassword) {
    throw new Error('uiPassword must be a non-empty string or null');
  }
  if (hasPassword && !hasUsername) {
    throw new Error('uiPassword requires a non-empty uiUsername');
  }
  if (typeof config.systemProxy !== 'boolean') throw new Error('systemProxy must be a boolean');
  if (typeof config.importSystemHosts !== 'boolean') throw new Error('importSystemHosts must be a boolean');
  if (!validateUpstreamProxy(config.upstreamProxy)) throw new Error(`Invalid upstreamProxy: ${config.upstreamProxy}`);
  if (!Array.isArray(config.bypass) || config.bypass.some(hostname => !validateHostname(hostname))) {
    throw new Error('bypass must be an array of valid hostnames');
  }

  return {
    ...config,
    interfaceName: config.interfaceName?.trim() || null,
    bypass: [...config.bypass]
  };
}

function normalizeHostsConfig(value) {
  if (!isPlainObject(value) || !isPlainObject(value.hosts)) {
    throw new Error('hosts.json must contain an object with a hosts object');
  }

  for (const [hostname, target] of Object.entries(value.hosts)) {
    if (!validateHostname(hostname)) throw new Error(`Invalid hostname in hosts.json: ${hostname}`);
    if (!validateTarget(target)) throw new Error(`Invalid target for ${hostname}: ${target}`);
  }

  return { hosts: { ...value.hosts } };
}

function parseConfigValue(source) {
  try {
    return JSON.parse(source);
  } catch {
    return source;
  }
}

export {
  CONFIG_KEYS,
  DEFAULT_BYPASS_HOSTS,
  DEFAULT_UI_USERNAME,
  createDefaultConfig,
  isPrivateIpv4,
  normalizeConfig,
  normalizeHostsConfig,
  parseConfigValue,
  validateBindHost,
  validateHostname,
  validatePort,
  validateTarget,
  validateUpstreamProxy
};
