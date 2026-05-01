const { test, expect } = require("@playwright/test");

test("browser alpha launcher and diagnostics smoke", async ({ page }) => {
  await page.goto("http://127.0.0.1:7860/");

  await expect(page).toHaveTitle(/Token Saving Replay Agent/);
  await expect(page.getByRole("heading", { name: /Token Saving Replay Agent/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Launcher" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chat" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();

  await page.getByRole("button", { name: "Diagnostics" }).click();
  const diagnostics = page.locator("#diagnosticsPanel");
  await expect(diagnostics).toBeVisible();
  await expect(diagnostics).toContainText('"app_version": "0.1.0-alpha"');
  await expect(diagnostics).not.toContainText("api_key");
  await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
});

test("chat warns when Model A is offline", async ({ page }) => {
  await page.goto("http://127.0.0.1:7860/");

  await page.getByRole("button", { name: "Chat" }).click();
  await expect(page.locator("#chatBanner")).toContainText("Main Model (A) is not running");
  await expect(page.locator("#chatSend")).toBeDisabled();
});

test("profile auto-detect can be previewed and applied", async ({ page }) => {
  await page.route("**/api/environment/detect", async route => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        app_version: "0.1.0-alpha",
        os: { name: "Windows", platform: "Windows-11", release: "11", distro: "" },
        shell: { guess: "powershell" },
        tools: {
          python: { found: true, version: "3.12.4" },
          uv: { found: true, version: "0.5.1" },
          pip: { found: true, version: "24.3.1" },
          node: { found: true, version: "22.1.0" },
          npm: { found: true, version: "10.8.1" },
          pnpm: { found: false, version: "" },
          yarn: { found: false, version: "" },
          java: { found: false, version: "" },
          javac: { found: false, version: "" },
          git: { found: true, version: "2.45.0" },
          docker: { found: false, version: "" },
          go: { found: false, version: "" },
          rustc: { found: false, version: "" },
          cargo: { found: false, version: "" },
          dotnet: { found: false, version: "" },
        },
      }),
    });
  });

  await page.goto("http://127.0.0.1:7860/");
  await page.getByRole("button", { name: "Profile" }).click();
  await page.locator("#prof-rules").fill("always use venv");
  await page.getByRole("button", { name: "Auto-detect" }).click();

  const panel = page.locator("#profileDetectPanel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('"node"');
  await page.getByRole("button", { name: "Apply to Profile" }).click();

  await expect(page.locator("#prof-os")).toHaveValue("Windows");
  await expect(page.locator("#prof-shell")).toHaveValue("powershell");
  await expect(page.locator("#prof-python")).toHaveValue("3.12.4");
  await expect(page.locator("#prof-pkg")).toHaveValue("uv");
  await expect(page.locator("#prof-rules")).toHaveValue(/always use venv/);
  await expect(page.locator("#prof-rules")).toHaveValue(/Detected tools:/);

  const savedProfile = await page.evaluate(() => JSON.parse(localStorage.getItem("envProfile") || "{}"));
  expect(savedProfile.detected_summary).toContain("Node: 22.1.0");
  expect(savedProfile.detected_summary).toContain("Java: not found");
});
