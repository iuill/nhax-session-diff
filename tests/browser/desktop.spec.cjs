const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');

test.beforeEach(async ({ page }) => {
  const data = execFileSync('python3', ['tests/browser/synthetic.py', '0', '--arrays']).toString('base64');
  await page.addInitScript(({ data }) => {
    // Emulate Wails IPC; use the existing WASM core as an independent test backend.
    let worker, sequence = 0;
    const pending = new Map();
    function request(payload) {
      worker ||= new Worker('worker.js');
      worker.onmessage = ({ data }) => {
        const cb = pending.get(data.id);
        if (!cb) return;
        pending.delete(data.id);
        data.error ? cb.reject(data.error) : cb.resolve(data.result);
      };
      return new Promise((resolve, reject) => {
        const id = ++sequence; pending.set(id, { resolve, reject }); worker.postMessage({ ...payload, id });
      });
    }
    const bytes = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
    const journal = () => JSON.parse(localStorage.getItem('test-journal') || '{"folder":"","entries":[]}');
    window.go = { main: { App: {
      Parse: encoded => request({ kind: 'parse', bytes: bytes(encoded) }),
      Compare: (before, beforeSelector, after, afterSelector) => request({ kind: 'compare', beforeBytes: bytes(before), beforeSelector, afterBytes: bytes(after), afterSelector }),
      OpenFiles: async () => [{ name: 'synthetic.nhax', data }],
      SaveReport: async report => { window.savedReport = JSON.parse(report); return true; },
      GetJournal: async () => journal(),
      ChooseHistoryFolder: async () => {
        const value = { ...journal(), folder: 'synthetic-private-history' };
        localStorage.setItem('test-journal', JSON.stringify(value)); return value;
      },
      SaveEntry: async draft => {
        if (window.failSave) throw new Error('保存に失敗しました');
        const value = journal();
        const entry = { ...draft, id: String(value.entries.length), created_at: new Date().toISOString() };
        value.entries.unshift(entry); localStorage.setItem('test-journal', JSON.stringify(value)); return entry;
      },
    } } };
    window.runtime = { BrowserOpenURL: () => {} };
  }, { data });
});

test('desktop native picker, comparison, JSON save and linked journal persist across reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#engine-status')).toContainText('このPC内');
  await page.locator('#dropzone').click();
  await expect(page.locator('#import-status')).toContainText('2ユーザー');
  await page.locator('#compare').click();
  await expect(page.locator('#diff-body tr')).toHaveCount(6);
  await page.locator('#download').click();
  await expect.poll(() => page.evaluate(() => window.savedReport?.comparisons.length)).toBe(2);
  await page.locator('#journal-folder').click();
  await page.locator('#journal-kind').selectOption('intent');
  await page.locator('#journal-text').fill('会話の聞き取りを改善したい');
  await page.locator('#journal-save').click();
  await expect(page.locator('#journal-list')).toContainText('会話の聞き取りを改善したい');
  const entry = await page.evaluate(() => JSON.parse(localStorage.getItem('test-journal')).entries[0]);
  expect(entry.snapshots).toHaveLength(2);
  expect(entry.snapshots[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(entry.snapshots[0].selectors).toEqual(['p0/s0/a0', 'p0/s0/a1']);
  await page.reload();
  await expect(page.locator('#journal-list')).toContainText('会話の聞き取りを改善したい');
  await page.locator('#journal-kind').selectOption('observation');
  await page.locator('#journal-text').fill('<script>駅のアナウンスが聞き取りづらい</script>');
  await page.locator('#journal-save').click();
  await expect(page.locator('.journal-entry')).toHaveCount(2);
  expect(await page.locator('#journal-list script').count()).toBe(0);
  const notes = await page.evaluate(() => JSON.parse(localStorage.getItem('test-journal')).entries);
  expect(notes[0].snapshots).toEqual([]);
  expect(notes[0].kind).toBe('observation');
  expect(errors).toEqual([]);
  await page.locator('#journal-title').scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath('journal.png') });
});

test('desktop journal retains text on a failed save', async ({ page }) => {
  await page.goto('/');
  await page.locator('#journal-folder').click();
  await page.locator('#journal-text').fill('消えてはいけない気づき');
  await page.evaluate(() => { window.failSave = true; });
  await page.locator('#journal-save').click();
  await expect(page.locator('#journal-status')).toContainText('保存に失敗');
  await expect(page.locator('#journal-text')).toHaveValue('消えてはいけない気づき');
  await page.evaluate(() => { window.failSave = false; });
  await page.locator('#journal-save').click();
  await expect(page.locator('.journal-entry')).toHaveCount(1);
});
