const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');

const payload = () => ({ name: 'synthetic.nhax', mimeType: 'application/octet-stream', buffer: execFileSync('python3', ['tests/browser/synthetic.py']) });

test('compares both sides without sending uploaded data and exports provenance', async ({ page }) => {
  const network = [];
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => network.push({ method: request.method(), url: request.url() }));
  await page.goto('/');
  await expect(page.locator('#file-input')).toBeEnabled();
  const readyRequests = network.length;
  await page.locator('#file-input').setInputFiles(payload());
  await expect(page.locator('#import-status')).toContainText('2ユーザー');
  await page.locator('#compare').click();
  await expect(page.locator('#visible-count')).toHaveText('2件を表示 / 全4件の差分');
  await expect(page.locator('#diff-body tr')).toHaveCount(2);
  await expect(page.locator('#diff-body')).toContainText('synthetic_gain');
  await page.locator('[data-side="Left"]').click();
  await expect(page.locator('#diff-body tr')).toHaveCount(1);
  await page.locator('#metadata').check();
  await expect(page.locator('#diff-body tr')).toHaveCount(2);
  await page.locator('#search').fill('not-present');
  await expect(page.locator('#empty-result')).toBeVisible();
  await page.locator('#search').clear();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const downloaded = await downloadPromise;
  const fs = require('node:fs');
  const report = JSON.parse(fs.readFileSync(await downloaded.path(), 'utf8'));
  expect(report.before.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(report.comparisons).toHaveLength(2);
  expect(report.comparisons.map(item => item.differences.length)).toEqual([2, 2]);
  expect(network.slice(readyRequests)).toEqual([]);
  expect(errors).toEqual([]);
  await page.locator('#clear').click();
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('#compare')).toBeDisabled();
});

test('handles invalid exports, duplicate files, same-session comparison and mobile layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#file-input')).toBeEnabled();
  await page.locator('#file-input').setInputFiles({ name: 'invalid.nhax', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') });
  await expect(page.locator('#errors')).toBeVisible();
  await expect(page.locator('#compare')).toBeDisabled();
  await page.locator('#file-input').setInputFiles(payload());
  await expect(page.locator('#compare')).toBeEnabled();
  await page.locator('#file-input').setInputFiles(payload());
  await expect(page.locator('#import-status')).toContainText('同一ファイル1件');
  const selected = await page.locator('#before').inputValue();
  await page.locator('#after-patient').selectOption(await page.locator('#before-patient').inputValue());
  await page.locator('#after').selectOption(selected);
  await page.locator('#compare').click();
  await expect(page.locator('#empty-result')).toHaveText('選択したXMLデータに差分はありません。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('compares exports across files', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#file-input')).toBeEnabled();
  await page.locator('#file-input').setInputFiles([
    { ...payload(), name: 'first.nhax' },
    { name: 'second.nhax', mimeType: 'application/octet-stream', buffer: execFileSync('python3', ['tests/browser/synthetic.py', '2']) },
  ]);
  await expect(page.locator('#import-status')).toContainText('2ファイル · 4ユーザー');
  await expect(page.locator('#before-file option')).toHaveCount(2);
  await expect(page.locator('#before-file option').first()).toHaveText('first.nhax');
  for (const label of await page.locator('#before option').allTextContents()) expect(label).not.toContain('.nhax');
  await expect(page.locator('#before-file')).toHaveValue(await page.locator('#before-file option').first().getAttribute('value'));
  await expect(page.locator('#after-file')).toHaveValue(await page.locator('#after-file option').last().getAttribute('value'));
  await page.locator('#compare').click();
  await expect(page.locator('#visible-count')).toContainText('全4件の差分');
  const downloadedPromise = page.waitForEvent('download');
  await page.locator('#download').click();
  const downloaded = await downloadedPromise;
  const report = JSON.parse(require('node:fs').readFileSync(await downloaded.path(), 'utf8'));
  expect(report.before.file).toBe('first.nhax');
  expect(report.after.file).toBe('second.nhax');
  expect(report.before.sha256).not.toBe(report.after.sha256);
  expect(report.comparisons[0].differences.find(item => item.path.includes('synthetic_gain')).after).toBe('3');
});

test('filters histories by data kind, defaults to fitting and resets after clear', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#file-input')).toBeEnabled();
  await page.locator('#file-input').setInputFiles(payload());
  await expect(page.locator('#data-kind')).toHaveValue('FittingData');
  await expect(page.locator('#data-kind option')).toHaveCount(4);
  await expect(page.locator('#before option')).toHaveCount(1);
  await page.locator('#compare').click();
  await expect(page.locator('#results')).toBeVisible();
  for (const kind of ['ClientProfile', 'SelectionData', 'InstrumentLoggingData']) {
    await page.locator('#data-kind').selectOption(kind);
    await expect(page.locator('#results')).toBeHidden();
    await expect(page.locator('#before option')).toHaveCount(1);
    await expect(page.locator('#after option')).toHaveCount(1);
    await page.locator('#compare').click();
    await expect(page.locator('#visible-count')).toHaveText('1件を表示 / 全1件の差分');
  }
  await page.locator('#clear').click();
  await expect(page.locator('#data-kind')).toBeDisabled();
  await page.locator('#file-input').setInputFiles(payload());
  await expect(page.locator('#data-kind')).toHaveValue('FittingData');
});

test('selects file, user and date independently and swaps the complete selection', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#file-input')).toBeEnabled();
  await page.locator('#file-input').setInputFiles({
    name: 'history.nhax', mimeType: 'application/octet-stream',
    buffer: execFileSync('python3', ['tests/browser/synthetic.py', '0', '--history']),
  });
  await expect(page.locator('#before-file-field')).toBeHidden();
  await expect(page.locator('#before-patient option')).toHaveCount(2);
  await expect(page.locator('#before option')).toHaveCount(2);
  for (const label of await page.locator('#before option').allTextContents()) {
    expect(label).not.toContain('Synthetic'); expect(label).not.toContain('.nhax');
  }
  await page.locator('#before-patient').selectOption('1');
  const before = await page.locator('#before').inputValue();
  const after = await page.locator('#after').inputValue();
  expect(before).not.toBe(after);
  await page.locator('#compare').click();
  await expect(page.locator('#visible-count')).toHaveText('2件を表示 / 全4件の差分');
  await page.locator('#swap').click();
  await expect(page.locator('#before')).toHaveValue(after);
  await expect(page.locator('#after')).toHaveValue(before);
  await expect(page.locator('#before-patient')).toHaveValue('1');
  await expect(page.locator('#results')).toBeHidden();
  await page.locator('#after').selectOption(after);
  await expect(page.locator('#selection-status')).toHaveText('同じ履歴を選択しています。');
  await page.locator('#file-input').setInputFiles({ ...payload(), name: 'other.nhax' });
  await expect(page.locator('#before-file-field')).toBeVisible();
  const otherFile = await page.locator('#before-file option').last().getAttribute('value');
  await page.locator('#before-file').selectOption(otherFile);
  await expect(page.locator('#before-patient')).toHaveValue('0');
  await expect(page.locator('#before option')).toHaveCount(1);
  await page.locator('#swap').click();
  await expect(page.locator('#after-file')).toHaveValue(otherFile);
});
