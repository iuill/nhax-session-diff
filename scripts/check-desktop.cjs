// Run on Windows against the actual Wails/WebView2 executable, using synthetic data only.
const { chromium, expect } = require('@playwright/test');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nhax-desktop-test-'));
  const config = path.join(process.env.APPDATA, 'nhax-session-diff');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'preferences.json'), JSON.stringify({ history_dir: dir }));
  const app = spawn(path.resolve('desktop/build/bin/nhax-desktop.exe'), [], { env: {
    ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222',
    WEBVIEW2_USER_DATA_FOLDER: path.join(dir, 'webview'),
  } });
  let browser;
  try {
    let endpoint;
    for (let i = 0; i < 100; i++) {
      if (app.exitCode !== null) throw new Error(`GUI exited with ${app.exitCode}`);
      try { endpoint = await (await fetch('http://127.0.0.1:9222/json/version')).json(); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 300)); }
    }
    if (!endpoint) throw new Error('WebView2 did not start');
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    const context = browser.contexts()[0];
    let page = context.pages()[0];
    if (!page) page = await context.waitForEvent('page');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('#engine-status')).toContainText('このPC内', { timeout: 30000 });
    const bytes = execFileSync('python', ['tests/browser/synthetic.py', '0', '--arrays']);
    await page.locator('#file-input').setInputFiles({ name: 'synthetic.nhax', mimeType: 'application/octet-stream', buffer: bytes });
    await expect(page.locator('#import-status')).toContainText('2ユーザー');
    await page.locator('#compare').click();
    await expect(page.locator('#diff-body tr')).toHaveCount(6);
    await page.locator('#journal-kind').selectOption('intent');
    await page.locator('#journal-text').fill('Synthetic adjustment intention');
    await page.locator('#journal-save').click();
    await expect(page.locator('#journal-list')).toContainText('Synthetic adjustment intention');
    const files = fs.readdirSync(path.join(dir, 'journal'));
    if (files.length !== 1) throw new Error('Expected one persisted entry');
    const entry = JSON.parse(fs.readFileSync(path.join(dir, 'journal', files[0]), 'utf8'));
    expect(entry.kind).toBe('intent'); expect(entry.snapshots).toHaveLength(2);
    await page.reload();
    await expect(page.locator('#journal-list')).toContainText('Synthetic adjustment intention');
    await page.locator('#journal-kind').selectOption('observation');
    await page.locator('#journal-text').fill('Synthetic observation after use');
    await page.locator('#journal-save').click();
    await expect(page.locator('.journal-entry')).toHaveCount(2);
    await page.locator('#journal-title').scrollIntoViewIfNeeded();
    fs.mkdirSync('dist/desktop-test', { recursive: true });
    await page.screenshot({ path: 'dist/desktop-test/journal.png' });
    expect(errors).toEqual([]);
    console.log('Native Windows GUI: Go comparison and journal persistence passed');
  } finally {
    if (browser) await browser.close();
    if (app.exitCode === null) app.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
