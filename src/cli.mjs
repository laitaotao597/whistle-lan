import { existsSync, readFileSync } from 'node:fs';
import { createPaths } from './paths.mjs';
import { createStorage } from './storage.mjs';
import { buildRules, createRulesModule } from './rules.mjs';
import { parseStartOptions } from './options.mjs';
import {
  formatHostPort,
  getProxyEndpoint,
  isLoopbackHost,
  isPortReachable,
  listLanAddresses,
  resolveRuntimeHost
} from './network.mjs';
import {
  CONFIG_KEYS,
  DEFAULT_UI_USERNAME,
  normalizeConfig,
  parseConfigValue,
  validateHostname,
  validateTarget
} from './validation.mjs';
import {
  STORAGE_NAME,
  createStartArgs,
  generateStrongPassword,
  getWhistleVersion,
  resolveRuntimeCredentials,
  runWhistle
} from './whistle.mjs';
import {
  isWhistleRunning,
  setGlobalHttpsCapture,
  updateWhistleRules
} from './whistle-client.mjs';

const packageVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version;

function applyRuntimeConfig(config, runtimeOptions) {
  return normalizeConfig({
    ...config,
    ...(runtimeOptions.importSystemHosts !== undefined
      ? { importSystemHosts: runtimeOptions.importSystemHosts }
      : {}),
    ...(runtimeOptions.upstreamProxy !== undefined
      ? { upstreamProxy: runtimeOptions.upstreamProxy }
      : {}),
    ...(runtimeOptions.systemProxy !== undefined
      ? { systemProxy: runtimeOptions.systemProxy }
      : {})
  });
}

function generateRules(paths, storage, runtimeOptions = {}) {
  const config = applyRuntimeConfig(storage.readConfig(), runtimeOptions);
  const hostsConfig = storage.readHosts();
  const temporaryHosts = Object.fromEntries(
    (runtimeOptions.mitm || []).map(mapping => [mapping.hostname, mapping.target])
  );
  const runtimeHosts = { hosts: { ...hostsConfig.hosts, ...temporaryHosts } };
  const systemHostsSource = config.importSystemHosts && existsSync(paths.systemHostsPath)
    ? readFileSync(paths.systemHostsPath, 'utf8')
    : '';
  const rules = buildRules(config, runtimeHosts, systemHostsSource);
  storage.writeGeneratedRules(createRulesModule(rules));
  return { config, rules };
}

async function syncRules(paths, storage, runtimeOptions = {}, endpointOverride = null) {
  const { config, rules } = generateRules(paths, storage, runtimeOptions);
  const endpoint = endpointOverride || storage.readRuntime() || {
    host: resolveRuntimeHost(config, runtimeOptions),
    port: runtimeOptions.port ?? config.port,
    username: runtimeOptions.username ?? config.uiUsername,
    password: runtimeOptions.password ?? config.uiPassword
  };
  if (!await isWhistleRunning(endpoint, STORAGE_NAME)) return false;
  if (!await setGlobalHttpsCapture(endpoint, false, endpoint)) return false;
  return updateWhistleRules(endpoint, rules, endpoint);
}

function colorizeWarning(message, colorEnabled = process.stderr.isTTY && process.env.NO_COLOR === undefined) {
  return colorEnabled ? `\u001B[33m${message}\u001B[39m` : message;
}

function formatWarning(message, colorEnabled) {
  return colorizeWarning(`Warning: ${message}`, colorEnabled);
}

function warnAboutLanExposure(host, credentials, logger = console.warn) {
  if (isLoopbackHost(host)) return;
  logger(formatWarning('the proxy is reachable from the network. Use it only on a trusted LAN.'));
  if (!credentials.username || !credentials.password) {
    logger(formatWarning('the Whistle Web UI has no login credentials.'));
  }
  logger('Note: Web UI credentials do not authenticate proxy traffic.');
}

function configureSystemProxy(paths, endpoint, enabled, runWhistleFn = runWhistle) {
  const target = enabled ? formatHostPort(endpoint.host, endpoint.port) : 'off';
  return runWhistleFn(['proxy', target], paths, { appendBaseDir: false });
}

function writeRuntime(storage, host, port, credentials, systemProxyEnabled = false) {
  storage.writeRuntime({
    host,
    port,
    startedAt: new Date().toISOString(),
    username: credentials.username,
    password: credentials.password,
    systemProxyEnabled
  });
}

async function startProxy(command, paths, storage, runtimeOptions, dependencies = {}) {
  const {
    passwordGenerator = generateStrongPassword,
    runWhistleFn = runWhistle,
    syncRulesFn = syncRules,
    configureSystemProxyFn = configureSystemProxy
  } = dependencies;
  const previousRuntime = storage.readRuntime();
  const { config } = generateRules(paths, storage, runtimeOptions);
  const host = resolveRuntimeHost(config, runtimeOptions);
  const port = runtimeOptions.port ?? config.port;
  const credentials = resolveRuntimeCredentials(config, runtimeOptions, passwordGenerator);
  warnAboutLanExposure(host, credentials);
  if (!runWhistleFn(createStartArgs(command, config, runtimeOptions, host, credentials), paths)) return false;
  const endpoint = {
    host,
    port,
    username: credentials.username,
    password: credentials.password
  };
  let completed = false;
  let cleanupSystemProxy = previousRuntime?.systemProxyEnabled === true;
  try {
    writeRuntime(storage, host, port, credentials, cleanupSystemProxy);
    if (!await syncRulesFn(paths, storage, runtimeOptions, endpoint)) return false;
    const shouldEnableSystemProxy = config.systemProxy;
    const shouldConfigureSystemProxy = shouldEnableSystemProxy || cleanupSystemProxy;
    if (shouldConfigureSystemProxy) {
      cleanupSystemProxy = true;
      if (!configureSystemProxyFn(paths, endpoint, shouldEnableSystemProxy)) return false;
    }
    writeRuntime(storage, host, port, credentials, shouldEnableSystemProxy);
    completed = true;
    return true;
  } finally {
    if (!completed) {
      writeRuntime(storage, host, port, credentials, cleanupSystemProxy);
      stopProxy(paths, storage, { runWhistleFn, configureSystemProxyFn });
    }
  }
}

function stopProxy(paths, storage, dependencies = {}) {
  const {
    runWhistleFn = runWhistle,
    configureSystemProxyFn = configureSystemProxy
  } = dependencies;
  storage.ensureFiles();
  const runtime = storage.readRuntime();
  if (!runWhistleFn(['stop', '-S', STORAGE_NAME], paths)) return false;
  if (runtime?.systemProxyEnabled
    && !configureSystemProxyFn(paths, runtime, false)) return false;
  storage.clearRuntime();
  return true;
}

async function syncIfRunning(paths, storage) {
  const config = storage.readConfig();
  const runtime = storage.readRuntime() || {
    host: resolveRuntimeHost(config),
    port: config.port
  };
  if (!await isWhistleRunning(runtime, STORAGE_NAME)) {
    console.log('Mapping saved. It will be loaded on the next start.');
    return true;
  }
  const synced = await syncRules(paths, storage);
  console.log(synced ? 'Mapping saved and active rules synchronized.' : 'Mapping saved, but active rule synchronization failed.');
  return synced;
}

async function setHostMapping(paths, storage, hostname, target) {
  if (!validateHostname(hostname)) throw new Error(`Invalid hostname: ${hostname}`);
  if (!validateTarget(target)) throw new Error(`Invalid target: ${target}`);
  const current = storage.readHosts();
  storage.writeHosts({ hosts: { ...current.hosts, [hostname]: target } });
  console.log(`Saved: ${hostname} -> ${target}`);
  return syncIfRunning(paths, storage);
}

async function removeHostMapping(paths, storage, hostname) {
  const current = storage.readHosts();
  if (!Object.hasOwn(current.hosts, hostname)) throw new Error(`Host mapping does not exist: ${hostname}`);
  const { [hostname]: removedTarget, ...remainingHosts } = current.hosts;
  void removedTarget;
  storage.writeHosts({ hosts: remainingHosts });
  console.log(`Removed: ${hostname}`);
  return syncIfRunning(paths, storage);
}

function redactConfig(config) {
  let upstreamProxy = config.upstreamProxy;
  if (upstreamProxy) {
    const parsed = new URL(upstreamProxy);
    const credentials = parsed.username
      ? `${parsed.username}${parsed.password ? ':********' : ''}@`
      : '';
    upstreamProxy = `${parsed.protocol}//${credentials}${parsed.host}`;
  }
  return {
    ...config,
    uiPassword: config.uiPassword ? '********' : null,
    upstreamProxy
  };
}

function showConfig(paths, storage) {
  const addresses = listLanAddresses();
  console.log(`Config: ${paths.configPath}`);
  console.log(`Hosts:  ${paths.hostsPath}`);
  console.log(`LAN IPv4: ${addresses.map(item => `${item.interfaceName}=${item.address}`).join(', ') || 'none'}`);
  console.log(JSON.stringify(redactConfig(storage.readConfig()), null, 2));
}

function manageConfig(paths, storage, args) {
  const action = args[0];
  if (!action) {
    showConfig(paths, storage);
    return;
  }
  if (action === 'get') {
    const key = args[1];
    if (key === 'password') {
      const password = storage.readRuntime()?.password;
      if (!password) throw new Error('No active Web UI password. Run w2-lan start first.');
      console.log(password);
      return;
    }
    if (!CONFIG_KEYS.includes(key)) throw new Error(`Unknown config field: ${key}`);
    const config = storage.readConfig();
    const value = redactConfig(config)[key];
    console.log(JSON.stringify(value));
    return;
  }
  if (action === 'set') {
    const [key, source] = args.slice(1);
    if (!CONFIG_KEYS.includes(key) || key === 'schemaVersion') throw new Error(`Config field cannot be set: ${key}`);
    if (source === undefined) throw new Error('Usage: w2-lan config set <key> <json-value>');
    const nextConfig = storage.writeConfig({ ...storage.readConfig(), [key]: parseConfigValue(source) });
    console.log(`Saved ${key}: ${JSON.stringify(redactConfig(nextConfig)[key])}`);
    return;
  }
  throw new Error(`Unknown config action: ${action}`);
}

async function doctor(paths, storage) {
  let hasError = false;
  const pass = message => console.log(`PASS ${message}`);
  const warn = message => console.warn(colorizeWarning(`WARN ${message}`));
  const fail = message => {
    hasError = true;
    console.error(`FAIL ${message}`);
  };

  let config;
  try {
    config = storage.readConfig();
    storage.readHosts();
    pass('Configuration files are valid');
  } catch (error) {
    fail(error.message);
    return false;
  }

  const whistleVersion = getWhistleVersion();
  if (whistleVersion) pass(`Whistle ${whistleVersion} is installed`);
  else fail('Whistle dependency is missing');

  const addresses = listLanAddresses();
  if (addresses.length) pass(`Found ${addresses.length} non-loopback IPv4 address(es)`);
  else warn('No LAN IPv4 address is currently available');

  const host = resolveRuntimeHost(config);
  if (!isLoopbackHost(host)) {
    warn(`Default bind host ${host} is reachable from the network`);
    if (config.uiPassword) pass('Web UI uses configured login credentials');
    else pass(`Web UI will use ${config.uiUsername || DEFAULT_UI_USERNAME} with a generated password`);
  } else pass('Default bind host is loopback-only');

  if (config.importSystemHosts) warn(`System hosts import is enabled: ${paths.systemHostsPath}`);
  else pass('System hosts import is disabled');

  if (config.upstreamProxy) {
    const upstream = getProxyEndpoint(config.upstreamProxy);
    const reachable = await isPortReachable(upstream.host, upstream.port);
    if (reachable) pass(`Upstream proxy is reachable at ${formatHostPort(upstream.host, upstream.port)}`);
    else warn(`Upstream proxy is not reachable at ${formatHostPort(upstream.host, upstream.port)}`);
  } else pass('No upstream proxy is configured');

  const runtime = storage.readRuntime();
  if (runtime && await isWhistleRunning(runtime, STORAGE_NAME)) {
    pass(`Proxy is running at ${formatHostPort(runtime.host, runtime.port)}`);
  } else console.log('INFO Proxy is not currently reachable');
  return !hasError;
}

function getRuntimeEndpoint(storage) {
  const config = storage.readConfig();
  return storage.readRuntime() || { host: resolveRuntimeHost(config), port: config.port };
}

function help() {
  console.log(`Usage: w2-lan <command> [options]\n\nCommands:\n  init                         Create default config files\n  start                        Start Whistle, load rules and enable the system proxy\n  restart                      Restart Whistle and reapply the system proxy\n  status                       Show Whistle status\n  stop                         Disable the system proxy and stop Whistle\n  sync                         Reload generated rules\n  host <name> <target>         Add or update a persistent mapping\n  unhost <name>                Remove a persistent mapping\n  rules                        Print generated Whistle rules\n  config                       Show configuration and LAN interfaces\n  config get <key>             Read a configuration value\n  config get password          Show the active Web UI password\n  config set <key> <value>     Set and validate a configuration value\n  doctor                       Check config, network and proxy health\n  ca                           Install the running proxy's Root CA\n  proxy [host:port|off]        Manually configure or disable the system proxy\n  open                         Print the Web UI URL\n  version                      Print version information\n  help                         Show this help\n\nStart/restart options:\n  --lan                        Bind to the preferred LAN IPv4\n  --interface=<name>           Bind to a specific network interface\n  --host=<private-address>     Bind to a loopback or private LAN IP\n  --port=<number>              Override the configured port\n  --mitm=<hostname> <target>   Add a temporary HTTPS MITM mapping\n  --username=<name>            Override the default Web UI username\n  --password=<value>           Use together with --username instead of a generated password\n  --system-proxy               Temporarily enable automatic system proxy configuration\n  --no-system-proxy            Temporarily disable automatic system proxy configuration\n  --system-hosts               Temporarily import the system hosts file\n  --no-system-hosts            Temporarily disable system hosts import\n  --upstream=<url>             Use an HTTP, HTTPS or SOCKS upstream proxy\n  --no-upstream                Temporarily disable the upstream proxy\n\nExamples:\n  w2-lan start\n  w2-lan start --lan\n  w2-lan config get password\n  w2-lan start --no-system-proxy\n  w2-lan start --lan --no-system-hosts --no-upstream\n  w2-lan host app.example.test http://127.0.0.1:3000\n  w2-lan start --mitm=app.example.test 127.0.0.1:3000`);
}

async function main(argv = process.argv.slice(2), context = {}) {
  const paths = context.paths || createPaths();
  const storage = context.storage || createStorage(paths);
  const command = argv[0] || 'help';
  const args = argv.slice(1);

  switch (command) {
    case 'init': storage.ensureFiles(); showConfig(paths, storage); break;
    case 'start': if (!await startProxy('start', paths, storage, parseStartOptions(args))) process.exitCode = 1; break;
    case 'restart': if (!await startProxy('restart', paths, storage, parseStartOptions(args))) process.exitCode = 1; break;
    case 'sync': if (!await syncRules(paths, storage)) process.exitCode = 1; break;
    case 'status': storage.ensureFiles(); if (!runWhistle(['status', '-S', STORAGE_NAME], paths)) process.exitCode = 1; break;
    case 'stop': {
      if (!stopProxy(paths, storage)) process.exitCode = 1;
      break;
    }
    case 'host': if (!await setHostMapping(paths, storage, args[0], args[1])) process.exitCode = 1; break;
    case 'unhost': if (!await removeHostMapping(paths, storage, args[0])) process.exitCode = 1; break;
    case 'rules': console.log(generateRules(paths, storage).rules); break;
    case 'config': manageConfig(paths, storage, args); break;
    case 'doctor': if (!await doctor(paths, storage)) process.exitCode = 1; break;
    case 'ca': {
      const endpoint = getRuntimeEndpoint(storage);
      if (!runWhistle(['ca', formatHostPort(endpoint.host, endpoint.port)], paths, { appendBaseDir: false })) process.exitCode = 1;
      break;
    }
    case 'proxy': {
      const endpoint = getRuntimeEndpoint(storage);
      const proxyArgs = args.length ? args : [formatHostPort(endpoint.host, endpoint.port)];
      if (!runWhistle(['proxy', ...proxyArgs], paths, { appendBaseDir: false })) {
        process.exitCode = 1;
        break;
      }
      const runtime = storage.readRuntime();
      if (runtime) {
        const systemProxyEnabled = !/^(?:o|0|-{0,2}off)$/i.test(proxyArgs[0]);
        storage.writeRuntime({ ...runtime, systemProxyEnabled });
      }
      break;
    }
    case 'open': {
      const endpoint = getRuntimeEndpoint(storage);
      console.log(`http://${formatHostPort(endpoint.host, endpoint.port)}`);
      break;
    }
    case 'version': case '--version': case '-V': console.log(`w2-lan ${packageVersion} (Whistle ${getWhistleVersion() || 'missing'})`); break;
    case 'help': case '--help': case '-h': help(); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
}

export {
  applyRuntimeConfig,
  doctor,
  formatWarning,
  generateRules,
  main,
  manageConfig,
  removeHostMapping,
  setHostMapping,
  startProxy,
  stopProxy,
  syncRules
};
