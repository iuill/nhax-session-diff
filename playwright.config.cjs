const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/browser',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5173', headless: true },
  webServer: {
    command: 'python3 -m http.server 5173 --bind 127.0.0.1 --directory dist/browser',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
