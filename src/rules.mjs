import { isIP } from 'node:net';
import { validateHostname } from './validation.mjs';

function parseSystemHosts(source = '') {
  const mappings = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [address, ...hostnames] = line.split(/\s+/);
    if (!isIP(address)) continue;
    for (const hostname of hostnames) {
      if (validateHostname(hostname)) mappings[hostname] = address;
    }
  }
  return mappings;
}

function normalizeUpstreamRule(proxyUrl) {
  const parsed = new URL(proxyUrl);
  const protocols = {
    'http:': 'proxy:',
    'https:': 'https-proxy:',
    'socks:': 'socks:'
  };
  const credentials = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
    : '';
  return `${protocols[parsed.protocol]}//${credentials}${parsed.host}`;
}

function normalizeHostRuleTarget(target) {
  return isIP(target) === 6 ? `[${target}]` : target;
}

function buildRules(config, hostsConfig, systemHostsSource = '') {
  const systemHosts = config.importSystemHosts ? parseSystemHosts(systemHostsSource) : {};
  const mappings = { ...systemHosts, ...(hostsConfig.hosts || {}) };
  const lines = [];

  for (const [hostname, target] of Object.entries(mappings)) {
    if (/^https?:\/\//i.test(target)) {
      lines.push(`${hostname} ${target}`);
      lines.push(`${hostname} enable://capture`);
      lines.push(`${hostname} direct://`);
    } else {
      lines.push(`${hostname} host://${normalizeHostRuleTarget(target)}`);
      lines.push(`${hostname} direct://`);
    }
  }
  for (const hostname of config.bypass) lines.push(`${hostname} direct://`);
  if (config.upstreamProxy) lines.push(`* ${normalizeUpstreamRule(config.upstreamProxy)}`);
  return lines.join('\n');
}

function createRulesModule(rules) {
  return [
    "exports.name = 'LAN hosts';",
    "exports.groupName = 'LAN development';",
    `exports.rules = ${JSON.stringify(rules)};`,
    ''
  ].join('\n');
}

export { buildRules, createRulesModule, normalizeUpstreamRule, parseSystemHosts };
