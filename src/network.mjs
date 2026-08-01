import { createConnection, isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { isPrivateIpv4, validateBindHost } from './validation.mjs';

function listLanAddresses(interfaces = networkInterfaces()) {
  return Object.entries(interfaces)
    .flatMap(([name, addresses]) => (addresses || []).map(address => ({ name, ...address })))
    .filter(address => address && (address.family === 'IPv4' || address.family === 4) && !address.internal)
    .filter(address => validateBindHost(address.address))
    .map(address => ({
      address: address.address,
      interfaceName: address.name,
      isPrivate: isPrivateIpv4(address.address)
    }))
    .sort((left, right) => Number(right.isPrivate) - Number(left.isPrivate));
}

function resolveLanHost(interfaceName, interfaces = networkInterfaces()) {
  const addresses = listLanAddresses(interfaces);
  const match = interfaceName
    ? addresses.find(address => address.interfaceName === interfaceName)
    : addresses[0];

  if (match) return match.address;
  if (interfaceName) throw new Error(`No non-loopback IPv4 address found for interface: ${interfaceName}`);
  throw new Error('No LAN IPv4 address found. Connect to a LAN or Wi-Fi network and try again.');
}

function resolveRuntimeHost(config, runtimeOptions = {}, interfaces = networkInterfaces()) {
  let host;
  if (runtimeOptions.host) host = runtimeOptions.host;
  else if (runtimeOptions.interfaceName) host = resolveLanHost(runtimeOptions.interfaceName, interfaces);
  else if (runtimeOptions.lan) host = resolveLanHost(null, interfaces);
  else if (config.interfaceName) host = resolveLanHost(config.interfaceName, interfaces);
  else if (config.host === 'auto') host = resolveLanHost(null, interfaces);
  else host = config.host;

  if (!validateBindHost(host) || host === 'auto') {
    throw new Error(`Refusing to bind to a public or wildcard address: ${host}`);
  }
  return host;
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

function isPortReachable(host, port, timeoutMs = 500) {
  const connectHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
  return new Promise(resolve => {
    const socket = createConnection({ host: connectHost, port });
    const finish = result => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

function getProxyEndpoint(proxyUrl) {
  if (!proxyUrl) return null;
  const parsed = new URL(proxyUrl);
  const defaultPorts = { 'http:': 80, 'https:': 443, 'socks:': 1080 };
  const defaultPort = defaultPorts[parsed.protocol];
  return { host: parsed.hostname, port: Number(parsed.port || defaultPort) };
}

function formatHostPort(host, port) {
  return `${isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

export {
  formatHostPort,
  getProxyEndpoint,
  isLoopbackHost,
  isPortReachable,
  isPrivateIpv4,
  listLanAddresses,
  resolveLanHost,
  resolveRuntimeHost
};
