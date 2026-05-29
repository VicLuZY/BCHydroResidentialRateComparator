"use strict";

const assert = require("node:assert/strict");
const app = require("../app.js");

const HEADERS = [
  "City",
  "Service Address",
  "Estimated Usage",
  "Power Factor (%)",
  "Demand (kW)",
  "Net Consumption (kWh)",
  "Outflow (kWh)",
  "Inflow (kWh)",
  "Time of Day Period",
  "Interval Start Date/Time",
  "Meter Number",
  "Account Number",
  "Account Holder",
  "Extra Column"
];

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvFromRows(rows, headers = HEADERS) {
  return [
    headers.map(csvEscape).join(","),
    ...rows.map(row => headers.map(header => csvEscape(row[header] ?? "")).join(","))
  ].join("\n");
}

function makeRow(overrides = {}) {
  return {
    "Account Holder": "Synthetic Account",
    "Account Number": "'000000000001",
    "Meter Number": "SYNTH-METER-1",
    "Interval Start Date/Time": "2024-01-01 00:00",
    "Time of Day Period": "N/A",
    "Inflow (kWh)": "1.000",
    "Outflow (kWh)": "0.000",
    "Net Consumption (kWh)": "1.000",
    "Demand (kW)": "N/A",
    "Power Factor (%)": "N/A",
    "Estimated Usage": "",
    "Service Address": "",
    "City": "",
    "Extra Column": "ignored",
    ...overrides
  };
}

function parseRows(rows, fileName = "synthetic.csv") {
  return app.parseBCHydroCsv(csvFromRows(rows), fileName).records;
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

function dateRangeKeys(start, end) {
  const result = [];
  let cursor = start;
  while (cursor <= end) {
    result.push(cursor);
    cursor = addDaysKey(cursor, 1);
  }
  return result;
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

function makeDayRows(dateKey, kwh = 1) {
  return expectedTimestampsForDate(dateKey).map((timestamp, index) => makeRow({
    "Interval Start Date/Time": timestamp,
    "Inflow (kWh)": String(kwh),
    "Outflow (kWh)": "0",
    "Net Consumption (kWh)": String(kwh),
    "Demand (kW)": "N/A",
    "Estimated Usage": index === 0 ? "Y" : ""
  }));
}

function makeDateRangeRows(start, end, kwh = 1) {
  return dateRangeKeys(start, end).flatMap(dateKey => makeDayRows(dateKey, kwh));
}

function approx(actual, expected, tolerance = 0.0001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

function testCsvParsing() {
  const records = parseRows([
    makeRow({
      "Account Holder": "Quoted, Synthetic",
      "Account Number": "'000000000123",
      "Inflow (kWh)": "1.500",
      "Outflow (kWh)": "0.250",
      "Net Consumption (kWh)": ""
    })
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].accountNumber, "'000000000123");
  approx(records[0].kwh, 1.25);
  approx(records[0].billableKwh, 1.25);
  assert.equal(records[0].hasOutflow, true);
}

function testGroupingAndDuplicates() {
  const first = parseRows([makeRow({ "Interval Start Date/Time": "2024-01-01 00:00" })], "part-a.csv");
  const duplicate = parseRows([makeRow({ "Interval Start Date/Time": "2024-01-01 00:00" })], "part-b.csv");
  const group = app.buildGroups([...first, ...duplicate]).values().next().value;

  assert.equal(group.cleanedRows, 1);
  assert.equal(group.resolvedOverlapCount, 1);

  const conflict = app.buildGroups([
    ...parseRows([makeRow({ "Interval Start Date/Time": "2024-01-01 01:00", "Net Consumption (kWh)": "1.000" })], "part-a.csv"),
    ...parseRows([makeRow({ "Interval Start Date/Time": "2024-01-01 01:00", "Net Consumption (kWh)": "2.000" })], "part-b.csv")
  ]).values().next().value;

  assert.equal(conflict.overlapIssues.length, 1);
}

function testGapDetection() {
  const missingHourRows = makeDayRows("2024-01-02")
    .filter(row => row["Interval Start Date/Time"] !== "2024-01-02 03:00");
  const group = app.buildGroups(parseRows(missingHourRows)).values().next().value;

  assert.equal(group.coverage.completeDayCount, 0);
  assert.equal(group.coverage.incompleteDates.length, 1);
  assert.deepEqual(group.coverage.missing, [{ timestampKey: "2024-01-02 03:00", missingCount: 1 }]);
  assert.equal(group.coverage.hasContinuousYear, false);
}

function testDstValidation() {
  const spring = app.buildGroups(parseRows(makeDayRows("2024-03-10"))).values().next().value;
  assert.equal(spring.coverage.completeDayCount, 1);
  assert.equal(spring.coverage.missing.length, 0);
  assert.equal(spring.coverage.unexpected.length, 0);

  const fall = app.buildGroups(parseRows(makeDayRows("2024-11-03"))).values().next().value;
  assert.equal(fall.coverage.completeDayCount, 1);
  assert.equal(fall.coverage.missing.length, 0);
  assert.equal(fall.coverage.unexpected.length, 0);

  const overlappedFall = app.buildGroups([
    ...parseRows(makeDayRows("2024-11-03"), "fall-a.csv"),
    ...parseRows(makeDayRows("2024-11-03"), "fall-b.csv")
  ]).values().next().value;
  assert.equal(overlappedFall.cleanedRows, 25);
  assert.equal(overlappedFall.coverage.completeDayCount, 1);
  assert.equal(overlappedFall.coverage.missing.length, 0);

  const springWithUnexpectedHour = app.buildGroups(parseRows([
    ...makeDayRows("2024-03-10"),
    makeRow({ "Interval Start Date/Time": "2024-03-10 02:00" })
  ])).values().next().value;
  assert.equal(springWithUnexpectedHour.coverage.unexpected.length, 1);
}

function testCompleteWindowDetectionAndRates() {
  const records = parseRows(makeDateRangeRows("2024-01-01", "2024-12-30"));
  const group = app.buildGroups(records).values().next().value;

  assert.equal(group.coverage.hasContinuousYear, true);
  assert.deepEqual(group.coverage.latest365, { start: "2024-01-01", end: "2024-12-30" });

  const rates = { ...app.DEFAULT_RATES };
  const result = app.calculateComparison(group, group.records, "2024-01-01", "2024-12-30", rates);
  const rs1101 = result.options.find(option => option.id === "rs1101");
  const rs1101Tou = result.options.find(option => option.id === "rs1101Tou");
  const rs1151 = result.options.find(option => option.id === "rs1151");

  assert.equal(result.totals.totalKwh, 8760);

  const rs1101Basic = 365 * 0.2344;
  const tier1Kwh = Math.min(8760, 365 * rates.rs1101Step1Daily);
  const tier2Kwh = 8760 - tier1Kwh;
  const rs1101Energy = tier1Kwh * 0.1187 + tier2Kwh * 0.1408;
  const rs1101Riders = (rs1101Basic + rs1101Energy) * -0.015;
  approx(rs1101.annualBase, rs1101Basic);
  approx(rs1101.annualEnergy, rs1101Energy);
  approx(rs1101.annualRiders, rs1101Riders);
  approx(rs1101.annualCost, rs1101Basic + rs1101Energy + rs1101Riders);

  const rs1151Basic = 365 * 0.25;
  const rs1151Energy = 8760 * 0.127;
  approx(rs1151.annualBase, rs1151Basic);
  approx(rs1151.annualEnergy, rs1151Energy);
  approx(rs1151.annualRiders, (rs1151Basic + rs1151Energy) * -0.015);

  const expectedTou = result.totals.overnightKwh * -0.05 + result.totals.onpeakKwh * 0.05;
  approx(rs1101Tou.annualTou, expectedTou);
}

function testNegativeNetAndExport() {
  const records = parseRows([
    makeRow({
      "Interval Start Date/Time": "2024-01-01 00:00",
      "Inflow (kWh)": "0",
      "Outflow (kWh)": "1",
      "Net Consumption (kWh)": "-1"
    })
  ]);
  const group = app.buildGroups(records).values().next().value;
  const result = app.calculateComparison(group, group.records, "2024-01-01", "2024-12-30", { ...app.DEFAULT_RATES });

  assert.equal(group.negativeNetIntervalCount, 1);
  assert.equal(result.totals.totalKwh, 0);
  assert.equal(result.totals.netKwh, -1);

  const summary = app.buildSummaryCsv(result, "rs1151");
  assert.match(summary.split("\n")[0], /Difference From Baseline/);
  assert.match(summary.split("\n")[0], /Effective Cents per kWh/);
  assert.equal(summary.trim().split("\n").length, 5);
}

testCsvParsing();
testGroupingAndDuplicates();
testGapDetection();
testDstValidation();
testCompleteWindowDetectionAndRates();
testNegativeNetAndExport();

console.log("Synthetic rate comparator tests passed.");
