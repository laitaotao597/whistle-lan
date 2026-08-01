import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRules, normalizeUpstreamRule, parseSystemHosts } from '../src/rules.mjs';
import { normalizeMitmTarget, parseStartOptions } from '../src/options.mjs';
import { createDefaultConfig, validateHostname, validateTarget } from '../src/validation.mjs';

test('builds host, WeChat Pay bypass and upstream rules', () => {
  const rules = buildRules(
    createDefaultConfig(),
    { hosts: { 'app.example.test': '203.0.113.8:443' } }
  );
  assert.match(rules, /app\.example\.test host:\/\/203\.0\.113\.8:443/);
  for (const hostname of [
    'api.mch.weixin.qq.com',
    'api2.mch.weixin.qq.com',
    'wx.tenpay.com',
    'open.weixin.qq.com'
  ]) {
    assert.match(rules, new RegExp(`${hostname.replaceAll('.', '\\.')} direct:\\/\\/`));
  }
  assert.match(rules, /\* proxy:\/\/127\.0\.0\.1:7890/);
});

test('builds HTTPS capture rules for an HTTP target', () => {
  const rules = buildRules(
    createDefaultConfig(),
    { hosts: { 'app.example.test': 'http://127.0.0.1:8888' } }
  );
  assert.match(rules, /app\.example\.test http:\/\/127\.0\.0\.1:8888/);
  assert.match(rules, /app\.example\.test enable:\/\/capture/);
  assert.match(rules, /app\.example\.test direct:\/\//);
});

test('imports valid system hosts and formats IPv6 targets', () => {
  const source = '127.0.0.1 localhost aliases\n::1 ip6-localhost\ninvalid bad.example';
  assert.deepEqual(parseSystemHosts(source), {
    localhost: '127.0.0.1',
    aliases: '127.0.0.1',
    'ip6-localhost': '::1'
  });
  const config = { ...createDefaultConfig(), importSystemHosts: true };
  assert.match(buildRules(config, { hosts: {} }, source), /ip6-localhost host:\/\/\[::1\]/);
});

test('normalizes supported upstream proxy protocols and credentials', () => {
  assert.equal(normalizeUpstreamRule('http://127.0.0.1:7890'), 'proxy://127.0.0.1:7890');
  const source = ['https://test-user:test-password', 'proxy.example.test:443'].join('@');
  const expected = ['https-proxy://test-user:test-password', 'proxy.example.test'].join('@');
  assert.equal(normalizeUpstreamRule(source), expected);
  assert.equal(normalizeUpstreamRule('socks://127.0.0.1:1080'), 'socks://127.0.0.1:1080');
});

test('validates hostnames and targets', () => {
  assert.equal(validateHostname('app.example.test'), true);
  assert.equal(validateHostname('bad host'), false);
  assert.equal(validateTarget('127.0.0.1:443'), true);
  assert.equal(validateTarget('127.0.0.1:0'), false);
  assert.equal(validateTarget('127.0.0.1:not-port'), false);
  assert.equal(validateTarget('http://127.0.0.1:8888'), true);
  assert.equal(validateTarget('ftp://127.0.0.1:8888'), false);
});

test('parses safe LAN and temporary MITM options', () => {
  const options = parseStartOptions([
    '--lan',
    '--port=8898',
    '--no-system-proxy',
    '--no-upstream',
    '--mitm=app.example.test',
    '127.0.0.1:8888'
  ]);
  assert.equal(options.lan, true);
  assert.equal(options.port, 8898);
  assert.equal(options.importSystemHosts, undefined);
  assert.equal(options.systemProxy, false);
  assert.equal(options.upstreamProxy, null);
  assert.deepEqual(options.mitm, [{ hostname: 'app.example.test', target: 'http://127.0.0.1:8888' }]);
});

test('temporarily disables the default system hosts import and upstream proxy', () => {
  const options = parseStartOptions(['--system-proxy', '--no-system-hosts', '--no-upstream']);
  assert.equal(options.systemProxy, true);
  assert.equal(options.importSystemHosts, false);
  assert.equal(options.upstreamProxy, null);
});

test('uses HTTPS for domain MITM targets and HTTP for local targets', () => {
  assert.equal(normalizeMitmTarget('upstream.example.test'), 'https://upstream.example.test');
  assert.equal(normalizeMitmTarget('127.0.0.1:8888'), 'http://127.0.0.1:8888');
  assert.equal(
    normalizeMitmTarget('https://upstream.example.test'),
    'https://upstream.example.test'
  );
});

test('rejects missing option values and conflicting host selectors', () => {
  assert.throws(() => parseStartOptions(['--username']), /Missing value/);
  assert.throws(() => parseStartOptions(['--username=test-user']), /must be provided together/);
  assert.throws(() => parseStartOptions(['--lan', '--host=127.0.0.1']), /only one/);
  assert.throws(() => parseStartOptions(['--upstream=ftp://proxy.example.test']), /Invalid upstream/);
  assert.throws(() => parseStartOptions(['--host=0.0.0.0']), /not allowed/);
  assert.throws(() => parseStartOptions(['--host=203.0.113.10']), /not allowed/);
  assert.throws(() => parseStartOptions(['--host=proxy.example.test']), /not allowed/);
});
