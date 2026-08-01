#!/usr/bin/env node

import { main } from '../src/cli.mjs';

main().catch(error => {
  console.error(`w2-lan: ${error.message}`);
  process.exitCode = 1;
});
