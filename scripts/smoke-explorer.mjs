#!/usr/bin/env node
// Smoke test for a running explorer: loads every list page, follows the
// first detail link on each, and fails on HTTP errors, the error boundary,
// or uncaught client-side exceptions.
//
// Usage: node scripts/smoke-explorer.mjs [baseUrl]   (default http://localhost:3000)
// Requires Playwright with a Chromium browser (preinstalled in Claude Code cloud sessions).

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const baseUrl = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");

// List page -> detail link prefix to follow from it.
const pages = [
  ["/", null],
  ["/blocks", "/blocks/"],
  ["/transactions", "/transactions/"],
  ["/validators", "/validators/"],
  ["/proposals", "/proposals/"],
  ["/consensus", null],
];

const ERROR_TEXT = "Something went wrong";

const browser = await chromium.launch();
const context = await browser.newContext();
const failures = [];
const detailPaths = new Set();

async function check(path) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle", timeout: 60_000 });
    const status = response?.status() ?? 0;
    if (status >= 400) failures.push(`${path}: HTTP ${status}`);
    if (await page.getByText(ERROR_TEXT).count()) failures.push(`${path}: error boundary rendered`);
    for (const message of pageErrors) failures.push(`${path}: uncaught exception: ${message}`);
    console.log(`${status < 400 && !pageErrors.length ? "ok  " : "FAIL"} ${path} (HTTP ${status})`);
    return page;
  } catch (error) {
    failures.push(`${path}: ${error.message}`);
    console.log(`FAIL ${path}`);
    return page;
  }
}

for (const [path, detailPrefix] of pages) {
  const page = await check(path);
  if (detailPrefix) {
    const href = await page
      .locator(`a[href^="${detailPrefix}"]`)
      .first()
      .getAttribute("href", { timeout: 5_000 })
      .catch(() => null);
    if (href) detailPaths.add(href);
    else failures.push(`${path}: no ${detailPrefix}* link found to follow`);
  }
  await page.close();
}

for (const path of detailPaths) {
  const page = await check(path);
  await page.close();
}

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`\nAll ${pages.length + detailPaths.size} pages passed.`);
