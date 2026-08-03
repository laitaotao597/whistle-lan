import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const requireFromWhistle = createRequire(require.resolve('whistle/package.json'));
const AdmZip = requireFromWhistle('adm-zip');

test('adm-zip used by Whistle supports the required APIs', () => {
  const archive = new AdmZip();
  archive.addFile('raw/session.txt', Buffer.from('compatible'));
  const buffer = archive.toBuffer();

  const importedArchive = new AdmZip(buffer);
  const entries = importedArchive.getEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].entryName, 'raw/session.txt');
  assert.equal(importedArchive.readFile(entries[0]).toString(), 'compatible');
});
