import { request } from 'node:http';

function connectHost(host) {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

function requestJson(endpoint, requestOptions = {}) {
  const {
    body = null,
    method = 'GET',
    path,
    timeoutMs = 1500,
    username,
    password
  } = requestOptions;
  const headers = {};
  if (body !== null) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    headers['content-length'] = Buffer.byteLength(body);
  }
  if (username && password) {
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  return new Promise((resolve, reject) => {
    const clientRequest = request({
      host: connectHost(endpoint.host),
      port: endpoint.port,
      path,
      method,
      headers
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const source = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Whistle API returned HTTP ${response.statusCode}`));
          return;
        }
        try {
          resolve(source ? JSON.parse(source) : {});
        } catch {
          reject(new Error('Whistle API returned invalid JSON'));
        }
      });
    });
    clientRequest.setTimeout(timeoutMs, () => clientRequest.destroy(new Error('Whistle API request timed out')));
    clientRequest.once('error', reject);
    clientRequest.end(body || undefined);
  });
}

async function isWhistleRunning(endpoint, storageName, requester = requestJson) {
  try {
    const status = await requester(endpoint, {
      path: '/cgi-bin/status',
      timeoutMs: 500,
      username: endpoint.username,
      password: endpoint.password
    });
    return status.name === 'whistle' && status.storage === storageName;
  } catch {
    return false;
  }
}

async function updateWhistleRules(endpoint, rules, credentials = {}, requester = requestJson) {
  const body = new URLSearchParams({
    name: 'LAN hosts',
    rules,
    groupName: 'LAN development'
  }).toString();
  const response = await requester(endpoint, {
    body,
    method: 'POST',
    path: '/cgi-bin/rules/project',
    username: credentials.username,
    password: credentials.password
  });
  return response.ec === 0;
}

export { isWhistleRunning, requestJson, updateWhistleRules };
