export const desktop = window.go?.main?.App;

function base64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

export function createEngine() {
  if (!desktop) return new Worker('worker.js');
  const engine = {
    onmessage: null,
    async postMessage(data) {
      try {
        const result = data.kind === 'parse'
          ? await desktop.Parse(base64(data.bytes))
          : await desktop.Compare(base64(data.beforeBytes), data.beforeSelector, base64(data.afterBytes), data.afterSelector);
        this.onmessage?.({ data: { id: data.id, result } });
      } catch (error) {
        this.onmessage?.({ data: { id: data.id, error: String(error) } });
      }
    },
  };
  queueMicrotask(() => engine.onmessage?.({ data: { kind: 'ready' } }));
  return engine;
}

export async function selectFiles() {
  const selected = await desktop.OpenFiles();
  return (selected || []).map(file => ({
    name: file.name,
    size: file.data ? atob(file.data).length : 0,
    async arrayBuffer() {
      if (file.error) throw new Error(file.error);
      return Uint8Array.from(atob(file.data), char => char.charCodeAt(0)).buffer;
    },
  }));
}
