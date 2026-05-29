"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test, expect } = require("playwright/test");

function appUrl() {
  if (process.env.APP_URL) return process.env.APP_URL;
  const distIndex = path.resolve(__dirname, "..", "dist", "index.html");
  const sourceIndex = path.resolve(__dirname, "..", "index.html");
  return pathToFileURL(fs.existsSync(distIndex) ? distIndex : sourceIndex).href;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateFromKey(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateToKey(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function addDaysKey(dateKey, days) {
  const date = dateFromKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToKey(date);
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return 1 + offset + (nth - 1) * 7;
}

function expectedTimestampsForDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const springForward = month === 3 && day === nthWeekdayOfMonth(year, 3, 0, 2);
  const fallBack = month === 11 && day === nthWeekdayOfMonth(year, 11, 0, 1);
  const timestamps = [];
  for (let hour = 0; hour < 24; hour += 1) {
    if (springForward && hour === 2) continue;
    timestamps.push(`${dateKey} ${pad2(hour)}:00`);
    if (fallBack && hour === 1) timestamps.push(`${dateKey} ${pad2(hour)}:00`);
  }
  return timestamps;
}

function syntheticCsv(start = "2024-01-01", days = 365) {
  const headers = [
    "Account Holder",
    "Account Number",
    "Meter Number",
    "Interval Start Date/Time",
    "Time of Day Period",
    "Inflow (kWh)",
    "Outflow (kWh)",
    "Net Consumption (kWh)",
    "Demand (kW)",
    "Power Factor (%)",
    "Estimated Usage",
    "Service Address",
    "City"
  ];
  const rows = [];
  for (let offset = 0; offset < days; offset += 1) {
    const dateKey = addDaysKey(start, offset);
    for (const timestamp of expectedTimestampsForDate(dateKey)) {
      rows.push([
        "Synthetic Account",
        "'000000000001",
        "SYNTH-METER-1",
        timestamp,
        "N/A",
        "1.000",
        "0.000",
        "1.000",
        "N/A",
        "N/A",
        "",
        "",
        ""
      ]);
    }
  }
  return [headers, ...rows].map(row => row.map(csvEscape).join(",")).join("\n");
}

async function withConsoleAudit(page, callback) {
  const messages = [];
  const onConsole = message => {
    if (["warning", "error"].includes(message.type())) {
      messages.push(`${message.type()}: ${message.text()}`);
    }
  };
  const onPageError = error => messages.push(`pageerror: ${error.message}`);

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  try {
    await callback();
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }

  expect(messages).toEqual([]);
}

async function assertUploadedFilesRender(page, filePayloads) {
  await page.goto(appUrl());
  await page.waitForLoadState("networkidle");
  await page.setInputFiles("#fileInput", filePayloads);
  await page.waitForSelector("#resultsPanel:not(.hidden)", { timeout: 10000 });

  const optionCount = await page.locator("#meterSelect option").count();
  expect(optionCount).toBeGreaterThan(0);

  for (let index = 0; index < optionCount; index += 1) {
    const value = await page.locator("#meterSelect option").nth(index).getAttribute("value");
    await page.selectOption("#meterSelect", value);
    await page.waitForSelector("#resultsPanel:not(.hidden)", { timeout: 10000 });
    await expect(page.locator("#resultsTable tbody tr")).toHaveCount(4);
  }

  await expect(page.locator("#exportButton")).toBeEnabled();
}

test("built page uploads a synthetic CSV without console warnings", async ({ page }) => {
  await withConsoleAudit(page, async () => {
    await assertUploadedFilesRender(page, [{
      name: "synthetic-consumption.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(syntheticCsv(), "utf8")
    }]);
  });
});

test("uploads local example CSV files without console warnings when present", async ({ page }) => {
  const examplesDir = path.resolve(__dirname, "..", "..", "examples");
  const csvFiles = fs.existsSync(examplesDir)
    ? fs.readdirSync(examplesDir)
      .filter(fileName => fileName.toLowerCase().endsWith(".csv"))
      .map(fileName => path.join(examplesDir, fileName))
    : [];

  test.skip(!csvFiles.length, "No example CSV files found.");

  await withConsoleAudit(page, async () => {
    await assertUploadedFilesRender(page, csvFiles);
  });
});
