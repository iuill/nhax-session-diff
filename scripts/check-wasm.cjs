// Check the browser adapter against CLI JSON using a local export.
// Usage: node scripts/check-wasm.cjs FILE BEFORE AFTER EXPECTED_JSON
const fs = require('node:fs');
const assert = require('node:assert/strict');
require('../dist/browser/wasm_exec.js');

(async () => {
  const [file, before, after, expectedFile] = process.argv.slice(2);
  if (!expectedFile) throw new Error('Expected FILE BEFORE AFTER EXPECTED_JSON');
  const go = new Go();
  const { instance } = await WebAssembly.instantiate(fs.readFileSync('dist/browser/nhax.wasm'), go.importObject);
  go.run(instance);
  const bytes = new Uint8Array(fs.readFileSync(file));
  const listed = JSON.parse(globalThis.nhaxParse(bytes));
  assert.ok(listed.result?.patients?.length > 0, listed.error);
  const compared = JSON.parse(globalThis.nhaxCompare(bytes, before, bytes, after));
  assert.equal(compared.error, undefined);
  const expected = JSON.parse(fs.readFileSync(expectedFile, 'utf8'));
  assert.deepEqual(compared.result, expected.differences);
  console.log(`WebAssembly and CLI match: ${compared.result.length} XML differences`);
  process.exit(0);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
