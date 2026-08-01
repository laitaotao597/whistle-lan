import assert from 'node:assert/strict';
import test from 'node:test';
import { listLanAddresses, resolveRuntimeHost } from '../src/network.mjs';
import { createDefaultConfig } from '../src/validation.mjs';

const interfaces = {
  vpn0: [{ address: '10.23.45.67', family: 'IPv4', internal: false }],
  en0: [{ address: '172.20.30.40', family: 'IPv4', internal: false }],
  public0: [{ address: '203.0.113.20', family: 'IPv4', internal: false }],
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }]
};

test('lists non-loopback addresses and supports interface selection', () => {
  const addresses = listLanAddresses(interfaces);
  assert.equal(addresses.length, 2);
  assert.equal(addresses[0].address, '10.23.45.67');
  assert.equal(resolveRuntimeHost(createDefaultConfig(), { lan: true }, interfaces), '10.23.45.67');
  assert.equal(resolveRuntimeHost(createDefaultConfig(), { interfaceName: 'en0' }, interfaces), '172.20.30.40');
});

test('uses loopback by default without requiring a LAN', () => {
  assert.equal(resolveRuntimeHost(createDefaultConfig(), {}, {}), '127.0.0.1');
  assert.throws(
    () => resolveRuntimeHost(createDefaultConfig(), { host: '0.0.0.0' }, {}),
    /Refusing to bind/
  );
  assert.throws(
    () => resolveRuntimeHost(createDefaultConfig(), { host: '203.0.113.20' }, {}),
    /Refusing to bind/
  );
});

test('rejects missing requested interfaces', () => {
  assert.throws(
    () => resolveRuntimeHost(createDefaultConfig(), { interfaceName: 'missing0' }, interfaces),
    /No non-loopback IPv4 address/
  );
  assert.throws(
    () => resolveRuntimeHost(createDefaultConfig(), { interfaceName: 'public0' }, interfaces),
    /No non-loopback IPv4 address/
  );
});
