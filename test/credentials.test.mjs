import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { formatWarning, startProxy, stopProxy } from '../src/cli.mjs';
import { createPaths } from '../src/paths.mjs';
import { createStorage } from '../src/storage.mjs';
import { createDefaultConfig } from '../src/validation.mjs';
import {
  createStartArgs,
  generateStrongPassword,
  resolveRuntimeCredentials
} from '../src/whistle.mjs';

test('generates unique 192-bit base64url passwords', () => {
  const passwords = Array.from({ length: 20 }, () => generateStrongPassword());

  assert.equal(new Set(passwords).size, passwords.length);
  for (const password of passwords) assert.match(password, /^[A-Za-z0-9_-]{32}$/);
});

test('uses uiAdmin with a generated password unless credentials are overridden', () => {
  const config = createDefaultConfig();
  const generatedCredentials = resolveRuntimeCredentials(config, {}, () => 'generated-password');
  assert.deepEqual(generatedCredentials, {
    username: 'uiAdmin',
    password: 'generated-password'
  });

  const configuredCredentials = resolveRuntimeCredentials(
    { ...config, uiUsername: 'configured-user', uiPassword: 'configured-password' },
    {},
    () => 'unused-password'
  );
  assert.deepEqual(configuredCredentials, {
    username: 'configured-user',
    password: 'configured-password'
  });

  const runtimeCredentials = resolveRuntimeCredentials(config, {
    username: 'runtime-user',
    password: 'runtime-password'
  });
  assert.deepEqual(runtimeCredentials, {
    username: 'runtime-user',
    password: 'runtime-password'
  });
});

test('passes generated credentials to Whistle without requiring console output', () => {
  const config = createDefaultConfig();
  const credentials = resolveRuntimeCredentials(config, {}, () => 'generated-password');

  const args = createStartArgs('start', config, {}, '127.0.0.1', credentials);
  assert.deepEqual(args.slice(-4), ['--username', 'uiAdmin', '--password', 'generated-password']);
});

test('formats interactive warnings in yellow', () => {
  assert.equal(
    formatWarning('trusted LAN only', true),
    '\u001B[33mWarning: trusted LAN only\u001B[39m'
  );
  assert.equal(formatWarning('trusted LAN only', false), 'Warning: trusted LAN only');
});

test('generates and stores a new password on each start', async t => {
  const appDir = mkdtempSync(join(tmpdir(), 'whistle-lan-credentials-'));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));
  const paths = createPaths({ env: { WHISTLE_LAN_HOME: appDir } });
  const storage = createStorage(paths);
  const generatedPasswords = ['first-generated-password', 'second-generated-password'];
  let passwordIndex = 0;
  let capturedEndpoints = [];
  const dependencies = {
    passwordGenerator: () => generatedPasswords[passwordIndex++],
    runWhistleFn: () => true,
    configureSystemProxyFn: () => true,
    syncRulesFn: async (_paths, _storage, _runtimeOptions, endpoint) => {
      capturedEndpoints = [...capturedEndpoints, endpoint];
      return true;
    }
  };

  assert.equal(await startProxy('start', paths, storage, {}, dependencies), true);
  assert.equal(await startProxy('restart', paths, storage, {}, dependencies), true);

  assert.deepEqual(capturedEndpoints.map(endpoint => endpoint.password), generatedPasswords);
  assert.equal(storage.readRuntime().password, 'second-generated-password');
});

test('automatically enables and disables the system proxy while tracking ownership', async t => {
  const appDir = mkdtempSync(join(tmpdir(), 'whistle-lan-system-proxy-'));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));
  const paths = createPaths({ env: { WHISTLE_LAN_HOME: appDir } });
  const storage = createStorage(paths);
  let systemProxyActions = [];
  const dependencies = {
    passwordGenerator: () => 'generated-password',
    runWhistleFn: () => true,
    syncRulesFn: async () => true,
    configureSystemProxyFn: (_paths, endpoint, enabled) => {
      systemProxyActions = [...systemProxyActions, {
        enabled,
        endpoint: `${endpoint.host}:${endpoint.port}`
      }];
      return true;
    }
  };

  assert.equal(await startProxy('start', paths, storage, {}, dependencies), true);
  assert.equal(storage.readRuntime().systemProxyEnabled, true);
  assert.deepEqual(systemProxyActions, [{ enabled: true, endpoint: '127.0.0.1:10098' }]);

  assert.equal(await startProxy('restart', paths, storage, { systemProxy: false }, dependencies), true);
  assert.equal(storage.readRuntime().systemProxyEnabled, false);
  assert.deepEqual(systemProxyActions.at(-1), { enabled: false, endpoint: '127.0.0.1:10098' });

  assert.equal(await startProxy('restart', paths, storage, {}, dependencies), true);
  assert.equal(stopProxy(paths, storage, dependencies), true);
  assert.deepEqual(systemProxyActions.at(-1), { enabled: false, endpoint: '127.0.0.1:10098' });
  assert.equal(storage.readRuntime(), null);
});

test('stops Whistle when startup fails after the process launches', async t => {
  const appDir = mkdtempSync(join(tmpdir(), 'whistle-lan-startup-rollback-'));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));
  const paths = createPaths({ env: { WHISTLE_LAN_HOME: appDir } });
  const storage = createStorage(paths);
  const whistleActions = [];
  const dependencies = {
    passwordGenerator: () => 'generated-password',
    runWhistleFn: args => {
      whistleActions.push(args[0]);
      return true;
    },
    syncRulesFn: async () => { throw new Error('sync failed'); },
    configureSystemProxyFn: () => true
  };

  await assert.rejects(startProxy('start', paths, storage, {}, dependencies), /sync failed/);
  assert.deepEqual(whistleActions, ['start', 'stop']);
  assert.equal(storage.readRuntime(), null);
});

test('disables a partially configured system proxy when startup fails', async t => {
  const appDir = mkdtempSync(join(tmpdir(), 'whistle-lan-proxy-rollback-'));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));
  const paths = createPaths({ env: { WHISTLE_LAN_HOME: appDir } });
  const storage = createStorage(paths);
  const systemProxyActions = [];
  const dependencies = {
    passwordGenerator: () => 'generated-password',
    runWhistleFn: () => true,
    syncRulesFn: async () => true,
    configureSystemProxyFn: (_paths, _endpoint, enabled) => {
      systemProxyActions.push(enabled);
      return enabled === false;
    }
  };

  assert.equal(await startProxy('start', paths, storage, {}, dependencies), false);
  assert.deepEqual(systemProxyActions, [true, false]);
  assert.equal(storage.readRuntime(), null);
});
