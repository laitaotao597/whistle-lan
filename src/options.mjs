import { validateBindHost, validateHostname, validatePort, validateTarget, validateUpstreamProxy } from './validation.mjs';

function requireValue(args, index, optionName) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing value after ${optionName}`);
  return value;
}

function normalizeMitmTarget(target) {
  if (!target) throw new Error('Missing target after --mitm');
  if (/^https?:\/\//i.test(target)) return target;
  return validateHostname(target) ? `https://${target}` : `http://${target}`;
}

function parseStartOptions(args) {
  const result = { mitm: [] };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--lan') result.lan = true;
    else if (argument === '--system-proxy') result.systemProxy = true;
    else if (argument === '--no-system-proxy') result.systemProxy = false;
    else if (argument === '--system-hosts') result.importSystemHosts = true;
    else if (argument === '--no-system-hosts') result.importSystemHosts = false;
    else if (argument === '--no-upstream') result.upstreamProxy = null;
    else if (argument.startsWith('--host=')) result.host = argument.slice(7);
    else if (argument === '--host') result.host = requireValue(args, index++, '--host');
    else if (argument.startsWith('--interface=')) result.interfaceName = argument.slice(12);
    else if (argument === '--interface') result.interfaceName = requireValue(args, index++, '--interface');
    else if (argument.startsWith('--username=')) result.username = argument.slice(11);
    else if (argument === '--username') result.username = requireValue(args, index++, '--username');
    else if (argument.startsWith('--password=')) result.password = argument.slice(11);
    else if (argument === '--password') result.password = requireValue(args, index++, '--password');
    else if (argument.startsWith('--port=')) result.port = Number(argument.slice(7));
    else if (argument === '--port') result.port = Number(requireValue(args, index++, '--port'));
    else if (argument.startsWith('--upstream=')) result.upstreamProxy = argument.slice(11);
    else if (argument === '--upstream') result.upstreamProxy = requireValue(args, index++, '--upstream');
    else if (argument.startsWith('--mitm=')) {
      const target = requireValue(args, index, '--mitm');
      result.mitm.push({ hostname: argument.slice(7), target: normalizeMitmTarget(target) });
      index += 1;
    } else if (argument === '--mitm') {
      const hostname = requireValue(args, index, '--mitm');
      const target = requireValue(args, index + 1, '--mitm hostname');
      result.mitm.push({ hostname, target: normalizeMitmTarget(target) });
      index += 2;
    } else throw new Error(`Unknown option: ${argument}`);
  }

  const hostSelectors = [Boolean(result.host), Boolean(result.interfaceName), Boolean(result.lan)].filter(Boolean);
  if (hostSelectors.length > 1) throw new Error('Use only one of --host, --interface, or --lan');
  if (result.host !== undefined && !validateBindHost(result.host)) {
    throw new Error(`Public, wildcard and hostname bind targets are not allowed: ${result.host}`);
  }
  if (result.interfaceName !== undefined && !result.interfaceName.trim()) throw new Error('--interface cannot be empty');
  if ((result.username === undefined) !== (result.password === undefined)) {
    throw new Error('--username and --password must be provided together');
  }
  if (result.username !== undefined && (!result.username || !result.password)) {
    throw new Error('--username and --password cannot be empty');
  }
  if (result.port !== undefined && !validatePort(result.port)) {
    throw new Error('--port must be an integer from 1 to 65535');
  }
  if (result.upstreamProxy !== undefined && !validateUpstreamProxy(result.upstreamProxy)) {
    throw new Error(`Invalid upstream proxy: ${result.upstreamProxy}`);
  }
  for (const mapping of result.mitm) {
    if (!validateHostname(mapping.hostname)) throw new Error(`Invalid hostname: ${mapping.hostname}`);
    if (!validateTarget(mapping.target)) throw new Error(`Invalid target: ${mapping.target}`);
  }
  return result;
}

export { normalizeMitmTarget, parseStartOptions };
