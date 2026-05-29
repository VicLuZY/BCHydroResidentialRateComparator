"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const app = require("../app.js");

const examplesDir = path.resolve(__dirname, "..", "..", "examples");

if (!fs.existsSync(examplesDir)) {
  console.log("No examples directory found; skipping example-file smoke test.");
  process.exit(0);
}

const csvFiles = fs.readdirSync(examplesDir)
  .filter(fileName => fileName.toLowerCase().endsWith(".csv"))
  .map(fileName => path.join(examplesDir, fileName));

if (!csvFiles.length) {
  console.log("No example CSV files found; skipping example-file smoke test.");
  process.exit(0);
}

const records = [];
for (const filePath of csvFiles) {
  const text = fs.readFileSync(filePath, "utf8");
  const report = app.parseBCHydroCsv(text, path.basename(filePath));
  assert.ok(report.records.length > 0, "example CSV should contain interval rows");
  assert.equal(report.rowErrors.length, 0, "example CSV should parse without skipped rows");
  records.push(...report.records);
}

const groups = app.buildGroups(records);
assert.ok(groups.size > 0, "examples should produce at least one selectable meter group");

let calculableGroups = 0;
for (const group of groups.values()) {
  assert.equal(group.overlapIssues.length, 0, "example groups should not have unresolved duplicate conflicts");
  if (!group.coverage.hasContinuousYear) continue;

  const result = app.calculateComparison(
    group,
    group.records.filter(record => record.dateKey >= group.coverage.latest365.start && record.dateKey <= group.coverage.latest365.end),
    group.coverage.latest365.start,
    group.coverage.latest365.end,
    { ...app.DEFAULT_RATES }
  );
  assert.equal(result.options.length, 4, "comparison should produce the four supported rate options");
  assert.ok(result.options[0].annualCost > 0, "lowest-cost option should have a positive annual cost");
  calculableGroups += 1;
}

assert.ok(calculableGroups > 0, "at least one example meter should contain a complete continuous year");
console.log(`Example-file smoke test passed for ${csvFiles.length} CSV file(s), ${groups.size} meter group(s), and ${calculableGroups} calculable group(s).`);
