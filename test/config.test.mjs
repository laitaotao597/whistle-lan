import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import test from 'node:test';
import { createPaths, getSystemHostsPath } from '../src/paths.mjs';
import { createStorage } from '../src/storage.mjs';
import { createDefaultConfig, normalizeConfig, validateBindHost } from '../src/validation.mjs';

test('uses the documented defaults', () => {
  assert.deepEqual(createDefaultConfig(), {
    schemaVersion: 1,
    host: '127.0.0.1',
    interfaceName: null,
    port: 10098,
    uiUsername: 'uiAdmin',
    uiPassword: null,
    systemProxy: true,
    importSystemHosts: true,
    upstreamProxy: 'http://127.0.0.1:7890',
    bypass: [
      'api.mch.weixin.qq.com',
      'api2.mch.weixin.qq.com',
      'wx.tenpay.com',
      'open.weixin.qq.com'
    ]
  });
});

test('validates configuration fields and credentials', () => {
  assert.throws(() => normalizeConfig({ unknown: true }), /Unknown config field/);
  assert.equal(normalizeConfig({ uiUsername: 'dev' }).uiPassword, null);
  assert.throws(() => normalizeConfig({ uiUsername: null, uiPassword: 'secret' }), /requires/);
  assert.throws(() => normalizeConfig({ uiUsername: '' }), /non-empty/);
  assert.throws(() => normalizeConfig({ bypass: ['bad host'] }), /valid hostnames/);
  assert.throws(() => normalizeConfig({ systemProxy: 'true' }), /systemProxy must be a boolean/);
  assert.throws(() => normalizeConfig({ upstreamProxy: 'ftp://proxy.example.test' }), /Invalid upstreamProxy/);
  assert.equal(normalizeConfig({ port: 8898 }).port, 8898);
});

test('allows local bind addresses and rejects public exposure', () => {
  for (const host of [
    'localhost',
    '127.0.0.1',
    '10.23.45.67',
    '172.20.30.40',
    '192.168.50.25',
    '169.254.20.30',
    '::1',
    'fd00::1234',
    'fe80::1234',
    'auto'
  ]) {
    assert.equal(validateBindHost(host), true, `expected ${host} to be allowed`);
  }

  for (const host of ['0.0.0.0', '::', '8.8.8.8', '203.0.113.10', 'proxy.example.test']) {
    assert.equal(validateBindHost(host), false, `expected ${host} to be rejected`);
    assert.throws(() => normalizeConfig({ host }), /Invalid config host/);
  }
});

test('resolves platform-specific system hosts paths', () => {
  assert.equal(getSystemHostsPath({ platform: 'linux', env: {} }), '/etc/hosts');
  assert.equal(
    getSystemHostsPath({ platform: 'win32', env: { SystemRoot: 'D:\\Windows' } }),
    'D:\\Windows\\System32\\drivers\\etc\\hosts'
  );
});

test('uses the renamed default config directory and environment override', () => {
  assert.equal(
    createPaths({ env: {}, homeDirectory: '/home/developer' }).appDir,
    join('/home/developer', '.whistle-lan')
  );
  assert.equal(
    createPaths({ env: { WHISTLE_LAN_HOME: '/custom/config' } }).appDir,
    '/custom/config'
  );
});

test('creates, validates and persists config files', t => {
  const appDir = mkdtempSync(join(tmpdir(), 'whistle-lan-storage-'));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));
  const paths = createPaths({ env: { WHISTLE_LAN_HOME: appDir } });
  const storage = createStorage(paths);

  storage.ensureFiles();
  assert.equal(storage.readConfig().host, '127.0.0.1');
  assert.equal(storage.readConfig().port, 10098);
  assert.deepEqual(storage.readHosts(), { hosts: {} });

  storage.writeConfig({ ...storage.readConfig(), port: 8898 });
  storage.writeConfig({
    ...storage.readConfig(),
    systemProxy: false,
    importSystemHosts: false,
    upstreamProxy: null
  });
  storage.writeHosts({ hosts: { 'app.example.test': '127.0.0.1:3000' } });
  assert.equal(storage.readConfig().port, 8898);
  assert.equal(storage.readConfig().systemProxy, false);
  assert.equal(storage.readConfig().importSystemHosts, false);
  assert.equal(storage.readConfig().upstreamProxy, null);
  assert.equal(storage.readHosts().hosts['app.example.test'], '127.0.0.1:3000');
  assert.match(readFileSync(paths.configPath, 'utf8'), /"schemaVersion": 1/);
});
