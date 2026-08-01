import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(projectDir, 'bin', 'w2-lan.mjs');
const packageVersion = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')).version;

function runCli(appDir, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, WHISTLE_LAN_HOME: appDir }
  });
}

test('initializes config with the documented defaults and reports the command name', t => {
  const appDir = mkdtempSync(join(tmpdir(), 'whistle-lan-cli-'));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));

  const helpResult = runCli(appDir, ['help']);
  assert.equal(helpResult.status, 0);
  assert.match(helpResult.stdout, /Usage: w2-lan/);

  const versionResult = runCli(appDir, ['version']);
  assert.equal(versionResult.status, 0);
  assert.ok(versionResult.stdout.startsWith(`w2-lan ${packageVersion} (`));

  const initResult = runCli(appDir, ['init']);
  assert.equal(initResult.status, 0);
  const config = JSON.parse(readFileSync(join(appDir, 'config.json'), 'utf8'));
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 10098);
  assert.equal(config.uiUsername, 'uiAdmin');
  assert.equal(config.uiPassword, null);
  assert.equal(config.systemProxy, true);
  assert.equal(config.importSystemHosts, true);
  assert.equal(config.upstreamProxy, 'http://127.0.0.1:7890');
  assert.deepEqual(config.bypass, [
    'api.mch.weixin.qq.com',
    'api2.mch.weixin.qq.com',
    'wx.tenpay.com',
    'open.weixin.qq.com'
  ]);
});

test('shows the active Web UI password only when explicitly requested', t => {
  const appDir = mkdtempSync(join(tmpdir(), 'whistle-lan-cli-'));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));

  const missingPasswordResult = runCli(appDir, ['config', 'get', 'password']);
  assert.equal(missingPasswordResult.status, 1);
  assert.match(missingPasswordResult.stderr, /No active Web UI password/);

  writeFileSync(join(appDir, 'runtime.json'), JSON.stringify({
    host: '127.0.0.1',
    port: 10098,
    username: 'uiAdmin',
    password: 'runtime-password'
  }));
  const passwordResult = runCli(appDir, ['config', 'get', 'password']);
  assert.equal(passwordResult.status, 0);
  assert.equal(passwordResult.stdout, 'runtime-password\n');
});

test('sets validated config and persists host mappings', t => {
  const appDir = mkdtempSync(join(tmpdir(), 'whistle-lan-cli-'));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));

  assert.equal(runCli(appDir, ['config', 'set', 'port', '65535']).status, 0);
  assert.equal(runCli(appDir, ['config', 'set', 'systemProxy', 'false']).status, 0);
  assert.equal(runCli(appDir, ['config', 'set', 'importSystemHosts', 'false']).status, 0);
  assert.equal(runCli(appDir, ['config', 'set', 'upstreamProxy', 'null']).status, 0);
  assert.equal(runCli(appDir, ['host', 'app.example.test', '127.0.0.1:3000']).status, 0);

  const config = JSON.parse(readFileSync(join(appDir, 'config.json'), 'utf8'));
  assert.equal(config.systemProxy, false);
  assert.equal(config.importSystemHosts, false);
  assert.equal(config.upstreamProxy, null);
  const hosts = JSON.parse(readFileSync(join(appDir, 'hosts.json'), 'utf8'));
  assert.equal(hosts.hosts['app.example.test'], '127.0.0.1:3000');
  const rulesResult = runCli(appDir, ['rules']);
  assert.match(rulesResult.stdout, /app\.example\.test host:\/\/127\.0\.0\.1:3000/);
});

test('returns a non-zero exit code for invalid CLI options', t => {
  const appDir = mkdtempSync(join(tmpdir(), 'whistle-lan-cli-'));
  t.after(() => rmSync(appDir, { recursive: true, force: true }));

  const result = runCli(appDir, ['start', '--username']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing value after --username/);
});
