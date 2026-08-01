import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { DEFAULT_UI_USERNAME } from './validation.mjs';

const require = createRequire(import.meta.url);
const GENERATED_PASSWORD_BYTES = 24;
const STORAGE_NAME = 'whistle-lan';

function generateStrongPassword(randomSource = randomBytes) {
  return randomSource(GENERATED_PASSWORD_BYTES).toString('base64url');
}

function resolveRuntimeCredentials(config, runtimeOptions, passwordGenerator = generateStrongPassword) {
  const username = runtimeOptions.username ?? config.uiUsername ?? DEFAULT_UI_USERNAME;
  const configuredPassword = runtimeOptions.password ?? config.uiPassword;
  if (configuredPassword) {
    return { username, password: configuredPassword };
  }
  return { username, password: passwordGenerator() };
}

function resolveWhistleBin() {
  try {
    return require.resolve('whistle/bin/whistle.js');
  } catch {
    throw new Error('Whistle is not installed. Run pnpm install first.');
  }
}

function getWhistleVersion() {
  try {
    return require('whistle/package.json').version;
  } catch {
    return null;
  }
}

function runWhistle(args, paths, { appendBaseDir = true } = {}) {
  const whistleArgs = appendBaseDir ? [...args, '--baseDir', paths.appDir] : args;
  const result = spawnSync(process.execPath, [resolveWhistleBin(), ...whistleArgs], {
    stdio: 'inherit',
    env: { ...process.env, WHISTLE_PATH: paths.whistleDataPath }
  });
  if (result.error) throw result.error;
  return result.status === 0;
}

function createStartArgs(command, config, runtimeOptions, host, credentials) {
  const port = runtimeOptions.port ?? config.port;
  const args = [command, '--host', host, '--port', String(port), '-S', STORAGE_NAME];
  const { username, password } = credentials ?? resolveRuntimeCredentials(config, runtimeOptions);
  if (username && password) args.push('--username', username, '--password', password);
  return args;
}

export {
  GENERATED_PASSWORD_BYTES,
  STORAGE_NAME,
  createStartArgs,
  generateStrongPassword,
  getWhistleVersion,
  resolveRuntimeCredentials,
  resolveWhistleBin,
  runWhistle
};
