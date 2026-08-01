import assert from 'node:assert/strict';
import test from 'node:test';
import { isWhistleRunning, updateWhistleRules } from '../src/whistle-client.mjs';

test('checks Whistle identity before synchronizing rules', async () => {
  const endpoint = { host: '127.0.0.1', port: 10098 };
  const statusRequester = async () => ({ name: 'whistle', storage: 'whistle-lan' });
  assert.equal(await isWhistleRunning(endpoint, 'whistle-lan', statusRequester), true);
  assert.equal(await isWhistleRunning(endpoint, 'other-storage', statusRequester), false);

  let receivedRules = null;
  const rulesRequester = async (_endpoint, options) => {
    receivedRules = new URLSearchParams(options.body).get('rules');
    return { ec: 0 };
  };
  assert.equal(
    await updateWhistleRules(endpoint, 'app.example.test direct://', {}, rulesRequester),
    true
  );
  assert.equal(receivedRules, 'app.example.test direct://');
});

test('reports an unreachable endpoint as stopped', async () => {
  assert.equal(await isWhistleRunning({ host: '127.0.0.1', port: 1 }, 'whistle-lan'), false);
});
