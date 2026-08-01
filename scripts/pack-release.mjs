import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const outputDirectory = new URL('../dist/', import.meta.url);
const outputPath = fileURLToPath(outputDirectory);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

await mkdir(outputDirectory, { recursive: true });

const packProcess = spawn(
  pnpmCommand,
  ['pack', '--pack-destination', outputPath],
  { stdio: 'inherit' },
);

packProcess.once('error', (error) => {
  console.error(`Failed to start pnpm pack: ${error.message}`);
  process.exitCode = 1;
});

packProcess.once('exit', (exitCode) => {
  if (exitCode !== 0) {
    process.exitCode = exitCode ?? 1;
  }
});
