module.exports = {
  testDir: "./tests",
  testMatch: /browser-smoke\.spec\.js/,
  timeout: 30000,
  use: {
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: "python main.py",
    env: {
      LLAMA_NO_BROWSER: "1",
    },
    url: "http://127.0.0.1:7860/api/status",
    reuseExistingServer: false,
    timeout: 30000,
  },
};
