import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await mkdir("test-results", { recursive: true });
try {
  await page.goto("http://127.0.0.1:4173", {waitUntil: 'domcontentloaded'});
  await page.getByRole("heading", { name: "饮食计划生成实验" }).waitFor();
  await page.screenshot({
    path: "test-results/desktop-input.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "确认参数并匹配模板" }).click();
  await page
    .getByRole("heading", { name: "匹配结果 · 中式三餐模板" })
    .waitFor();
  await page.getByRole("button", { name: "下一步：候选食物" }).click();
  await page.getByRole("button", { name: "载入示例测试算法" }).click();
  await page.locator("table tbody tr").first().waitFor();
  assert.ok((await page.locator("table tbody tr").count()) > 25);
  await page.screenshot({
    path: "test-results/desktop-candidates.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "下一步：七天搭配" }).click();
  await page.getByRole("button", { name: "生成搭配", exact: true }).click();
  await page.locator(".day-tabs button").first().waitFor();
  assert.equal(await page.locator(".day-tabs button").count(), 7);
  await page.getByRole("button", { name: "下一步：份量与校验" }).click();
  await page
    .getByRole("button", { name: "计算份量并校验", exact: true })
    .click();
  await page.locator(".result-banner, .error-box").waitFor({ timeout: 50000 });
  if (await page.locator(".error-box").count()) {
    console.log("Error:", await page.locator(".error-box").innerText());
    await page.screenshot({
      path: "test-results/browser-error.png",
      fullPage: true,
    });
  }
  console.log("Result:", await page.locator(".result-banner").innerText());
  assert.ok(
    (await page.locator(".result-banner").innerText()).includes("7 / 7 天通过"),
  );
  await page.screenshot({
    path: "test-results/desktop-result.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "导出完整实验", exact: true }).click();
  await page.getByRole("button", { name: "配置模型", exact: true }).click();
  await page.getByLabel("服务商").selectOption("doubao");
  assert.equal(
    await page.getByLabel("Base URL", { exact: true }).inputValue(),
    "https://ark.cn-beijing.volces.com/api/v3",
  );
  await page.getByLabel("API Key", { exact: true }).fill("test-ephemeral-key");
  const stored = await page.evaluate(() =>
    localStorage.getItem("otter-meal-workbench-v1"),
  );
  assert.ok(!stored.includes("test-ephemeral-key"));
  await page.screenshot({
    path: "test-results/desktop-api.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "完成配置" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/mobile-result.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.locator(".mobile-steps button").first().click();
  await page.screenshot({
    path: "test-results/mobile-input.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.reload();
  await page.getByRole("button", { name: "配置模型", exact: true }).click();
  assert.equal(
    await page.getByLabel("API Key", { exact: true }).inputValue(),
    "",
  );
  console.log("Browser errors:", errors);
  assert.deepEqual(errors, []);
  console.log(
    "Desktop/mobile workflow, API presets, secret persistence and export checks passed.",
  );
} finally {
  await browser.close();
}
