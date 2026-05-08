const fs = require("fs");
const path = require("path");

const venvPython = process.platform === "win32"
  ? path.join(__dirname, ".venv", "Scripts", "python.exe")
  : path.join(__dirname, ".venv", "bin", "python");
const pythonCommand = fs.existsSync(venvPython)
  ? venvPython
  : process.platform === "win32"
    ? "python"
    : "python3";

module.exports = {
  testDir: "./tests",
  testMatch: /browser-smoke\.spec\.js/,
  timeout: 30000,
  use: {
    browserName: "chromium",
    headless: true,
  },
  webServer: {
    command: `${JSON.stringify(pythonCommand)} main.py`,
    env: {
      LLAMA_NO_BROWSER: "1",
    },
    url: "http://127.0.0.1:7860/api/status",
    reuseExistingServer: true,
    timeout: 30000,
  },
};
