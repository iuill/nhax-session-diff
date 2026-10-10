importScripts('wasm_exec.js');

const ready = (async () => {
  const go = new Go();
  const response = await fetch('nhax.wasm');
  if (!response.ok) throw new Error('解析エンジンをダウンロードできませんでした。');
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), go.importObject);
  go.run(instance);
  if (typeof self.nhaxParse !== 'function') throw new Error('解析エンジンを起動できませんでした。');
  self.postMessage({ kind: 'ready' });
})();
ready.catch(error => self.postMessage({ kind: 'startup-error', error: error.message }));

self.onmessage = async ({ data }) => {
  try {
    await ready;
    const raw = data.kind === 'parse'
      ? self.nhaxParse(data.bytes)
      : self.nhaxCompare(data.beforeBytes, data.beforeSelector, data.afterBytes, data.afterSelector);
    const response = JSON.parse(raw);
    if (response.error) throw new Error(response.error);
    self.postMessage({ id: data.id, result: response.result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
