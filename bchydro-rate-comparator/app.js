"use strict";
const REQUIRED_COLUMNS = [
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
const RATE_OPTIONS = Object.freeze([
    { id: "rs1101", schedule: "RS 1101", name: "Tiered", base: "tiered", useTou: false },
    { id: "rs1101Tou", schedule: "RS 1101 + 2101", name: "Tiered + time-of-day", base: "tiered", useTou: true },
    { id: "rs1151", schedule: "RS 1151", name: "Flat", base: "flat", useTou: false },
    { id: "rs1151Tou", schedule: "RS 1151 + 2101", name: "Flat + time-of-day", base: "flat", useTou: true }
]);
const DEFAULT_RATES = Object.freeze({
    rs1101Basic: 23.44,
    rs1101Step1: 11.87,
    rs1101Step2: 14.08,
    rs1101Step1Daily: 22.1918,
    rs1151Basic: 25.00,
    rs1151Energy: 12.70,
    rs2101Overnight: -5.00,
    rs2101OnPeak: 5.00,
    rs2101OffPeak: 0.00,
    deferralRider: -1.50,
    tradeRider: 0.00,
    includeGst: false,
    gstRate: 5.00
});
const state = {
    groups: new Map(),
    selectedKey: null,
    lastResults: null
};
const els = {};
if (typeof window !== "undefined") {
    window.addEventListener("DOMContentLoaded", () => {
        cacheElements();
        bindEvents();
        resetRateInputs();
        renderInitialState();
    });
}
function cacheElements() {
    [
        "fileInput", "dropZone", "clearButton", "fileSummary", "resetRatesButton", "rs1101Basic",
        "rs1101Step1", "rs1101Step2", "rs1101Step1Daily", "rs1151Basic", "rs1151Energy",
        "rs2101Overnight", "rs2101OnPeak", "rs2101OffPeak", "deferralRider", "tradeRider", "includeGst", "gstRate",
        "meterSelect", "modeSelect", "baselineSelect", "startDate", "endDate", "validationSummary", "resultsPanel",
        "winnerCard", "metricsGrid", "costChart", "resultsTable", "usagePanel", "usageChart",
        "monthlyTable", "gapPanel", "gapReport", "exportButton", "printButton"
    ].forEach(id => { els[id] = document.getElementById(id); });
}
function bindEvents() {
    els.fileInput.addEventListener("change", event => processFiles(Array.from(event.target.files || [])));
    els.clearButton.addEventListener("click", clearAll);
    els.resetRatesButton.addEventListener("click", () => { resetRateInputs(); recalculate(); });
    els.meterSelect.addEventListener("change", () => {
        state.selectedKey = els.meterSelect.value;
        configureWindowControlsForSelectedGroup();
        recalculate();
    });
    els.modeSelect.addEventListener("change", () => {
        configureWindowControlsForSelectedGroup();
        recalculate();
    });
    els.baselineSelect.addEventListener("change", recalculate);
    els.startDate.addEventListener("change", recalculate);
    els.endDate.addEventListener("change", recalculate);
    els.exportButton.addEventListener("click", exportSummaryCsv);
    els.printButton.addEventListener("click", () => window.print());
    rateInputElements().forEach(el => {
        el.addEventListener("input", recalculate);
        el.addEventListener("change", recalculate);
    });
    ["dragenter", "dragover"].forEach(type => {
        els.dropZone.addEventListener(type, event => {
            event.preventDefault();
            els.dropZone.classList.add("dragover");
        });
    });
    ["dragleave", "drop"].forEach(type => {
        els.dropZone.addEventListener(type, event => {
            event.preventDefault();
            els.dropZone.classList.remove("dragover");
        });
    });
    els.dropZone.addEventListener("drop", event => {
        const files = Array.from(event.dataTransfer?.files || []).filter(file => /\.csv$/i.test(file.name) || file.type === "text/csv");
        processFiles(files);
    });
}
function rateInputElements() {
    return [
        els.rs1101Basic, els.rs1101Step1, els.rs1101Step2, els.rs1101Step1Daily,
        els.rs1151Basic, els.rs1151Energy, els.rs2101Overnight, els.rs2101OnPeak,
        els.rs2101OffPeak, els.deferralRider, els.tradeRider, els.includeGst, els.gstRate
    ];
}
function resetRateInputs() {
    els.rs1101Basic.value = DEFAULT_RATES.rs1101Basic.toFixed(4);
    els.rs1101Step1.value = DEFAULT_RATES.rs1101Step1.toFixed(4);
    els.rs1101Step2.value = DEFAULT_RATES.rs1101Step2.toFixed(4);
    els.rs1101Step1Daily.value = DEFAULT_RATES.rs1101Step1Daily.toFixed(4);
    els.rs1151Basic.value = DEFAULT_RATES.rs1151Basic.toFixed(4);
    els.rs1151Energy.value = DEFAULT_RATES.rs1151Energy.toFixed(4);
    els.rs2101Overnight.value = DEFAULT_RATES.rs2101Overnight.toFixed(4);
    els.rs2101OnPeak.value = DEFAULT_RATES.rs2101OnPeak.toFixed(4);
    els.rs2101OffPeak.value = DEFAULT_RATES.rs2101OffPeak.toFixed(4);
    els.deferralRider.value = DEFAULT_RATES.deferralRider.toFixed(4);
    els.tradeRider.value = DEFAULT_RATES.tradeRider.toFixed(4);
    els.includeGst.checked = DEFAULT_RATES.includeGst;
    els.gstRate.value = DEFAULT_RATES.gstRate.toFixed(4);
}
function renderInitialState() {
    els.meterSelect.disabled = true;
    els.modeSelect.disabled = true;
    els.baselineSelect.disabled = true;
    els.startDate.disabled = true;
    els.endDate.disabled = true;
    els.exportButton.disabled = true;
    els.resultsPanel.classList.add("hidden");
    els.usagePanel.classList.add("hidden");
    els.gapPanel.classList.add("hidden");
}
function clearAll() {
    state.groups.clear();
    state.selectedKey = null;
    state.lastResults = null;
    els.fileInput.value = "";
    els.fileSummary.textContent = "No files loaded.";
    els.validationSummary.textContent = "Upload files to begin validation.";
    els.meterSelect.innerHTML = "";
    renderInitialState();
}
async function processFiles(files) {
    if (!files.length)
        return;
    els.fileSummary.textContent = `Reading ${files.length} file${files.length === 1 ? "" : "s"}...`;
    els.validationSummary.textContent = "Parsing CSV data...";
    const allRecords = [];
    const fileReports = [];
    try {
        for (const file of files) {
            const text = await file.text();
            const report = parseBCHydroCsv(text, file.name);
            fileReports.push(report);
            allRecords.push(...report.records);
        }
    }
    catch (error) {
        showFatalError(error.message || String(error));
        return;
    }
    if (!allRecords.length) {
        showFatalError("No valid interval rows were found in the uploaded CSV files.");
        return;
    }
    state.groups = buildGroups(allRecords);
    state.selectedKey = state.groups.keys().next().value || null;
    populateMeterSelect();
    renderFileSummary(fileReports, allRecords.length);
    configureWindowControlsForSelectedGroup();
    renderGapReport();
    recalculate();
}
function parseBCHydroCsv(text, fileName) {
    const rows = parseCsv(text);
    if (rows.length < 2)
        throw new Error(`${fileName}: the CSV appears to be empty.`);
    const headers = rows[0].map((cell, index) => {
        const text = String(cell || "").trim();
        return index === 0 ? text.replace(/^\uFEFF/, "") : text;
    });
    const indices = new Map(headers.map((header, index) => [header, index]));
    const missing = REQUIRED_COLUMNS.filter(col => !indices.has(col));
    if (missing.length) {
        throw new Error(`${fileName}: missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
    }
    const records = [];
    const rowErrors = [];
    for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i];
        if (!row || row.every(cell => String(cell || "").trim() === ""))
            continue;
        const get = (name) => String(row[indices.get(name)] ?? "").trim();
        const parsedDate = parseIntervalStart(get("Interval Start Date/Time"));
        if (!parsedDate) {
            rowErrors.push(`row ${i + 1}: invalid interval start date/time`);
            continue;
        }
        const net = parseNumber(get("Net Consumption (kWh)"));
        const inflow = parseNumber(get("Inflow (kWh)"));
        const outflow = parseNumber(get("Outflow (kWh)"));
        const kwh = Number.isFinite(net) ? net : ((Number.isFinite(inflow) ? inflow : 0) - (Number.isFinite(outflow) ? outflow : 0));
        if (!Number.isFinite(kwh)) {
            rowErrors.push(`row ${i + 1}: invalid kWh value`);
            continue;
        }
        const account = cleanAccount(get("Account Number"));
        const meter = get("Meter Number");
        const address = get("Service Address");
        const city = get("City");
        const holder = get("Account Holder");
        const estimated = get("Estimated Usage");
        const billableKwh = Math.max(0, kwh);
        records.push({
            fileName,
            rowNumber: i + 1,
            accountHolder: holder,
            accountNumber: account,
            meterNumber: meter,
            address,
            city,
            dateKey: parsedDate.dateKey,
            timestampKey: parsedDate.timestampKey,
            hour: parsedDate.hour,
            minute: parsedDate.minute,
            kwh,
            billableKwh,
            inflow: Number.isFinite(inflow) ? inflow : null,
            outflow: Number.isFinite(outflow) ? outflow : null,
            hasOutflow: Number.isFinite(outflow) && outflow > 0,
            hasNegativeNet: kwh < 0,
            estimatedUsage: estimated,
            signature: `${parsedDate.timestampKey}|${kwh.toFixed(6)}|${Number.isFinite(inflow) ? inflow.toFixed(6) : ""}|${Number.isFinite(outflow) ? outflow.toFixed(6) : ""}|${estimated}`
        });
    }
    return { fileName, rowCount: rows.length - 1, validRows: records.length, rowErrors, records };
}
function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const next = text[i + 1];
        if (inQuotes) {
            if (char === '"') {
                if (next === '"') {
                    cell += '"';
                    i += 1;
                }
                else {
                    inQuotes = false;
                }
            }
            else {
                cell += char;
            }
            continue;
        }
        if (char === '"') {
            inQuotes = true;
        }
        else if (char === ",") {
            row.push(cell);
            cell = "";
        }
        else if (char === "\n") {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        }
        else if (char === "\r") {
            if (next === "\n")
                continue;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        }
        else {
            cell += char;
        }
    }
    if (cell.length > 0 || row.length > 0) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
function parseIntervalStart(value) {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match)
        return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || 0);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second !== 0)
        return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day)
        return null;
    const dateKey = `${match[1]}-${match[2]}-${match[3]}`;
    const timestampKey = `${dateKey} ${pad2(hour)}:${pad2(minute)}`;
    return { year, month, day, hour, minute, dateKey, timestampKey };
}
function parseNumber(value) {
    const trimmed = String(value ?? "").replace(/,/g, "").trim();
    if (!trimmed || /^N\/A$/i.test(trimmed))
        return NaN;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : NaN;
}
function cleanAccount(value) {
    return String(value || "").trim();
}
function accountGroupingKey(value) {
    return cleanAccount(value).replace(/^'/, "");
}
function buildGroups(records) {
    const grouped = new Map();
    for (const record of records) {
        const key = `${accountGroupingKey(record.accountNumber)}::${record.meterNumber}`;
        if (!grouped.has(key))
            grouped.set(key, []);
        grouped.get(key).push(record);
    }
    const result = new Map();
    for (const [key, groupRecords] of grouped.entries()) {
        result.set(key, analyseGroup(key, groupRecords));
    }
    return result;
}
function analyseGroup(key, records) {
    const first = records[0];
    const files = Array.from(new Set(records.map(r => r.fileName))).sort();
    const byTimestamp = new Map();
    for (const record of records) {
        if (!byTimestamp.has(record.timestampKey))
            byTimestamp.set(record.timestampKey, []);
        byTimestamp.get(record.timestampKey).push(record);
    }
    const cleanedRecords = [];
    const overlapIssues = [];
    let resolvedOverlapCount = 0;
    for (const [timestampKey, entries] of byTimestamp.entries()) {
        const sample = entries[0];
        const expected = expectedCountForTimestamp(sample.dateKey, sample.hour);
        if (expected === 0) {
            cleanedRecords.push(...entries);
            continue;
        }
        if (entries.length <= expected) {
            cleanedRecords.push(...entries);
            continue;
        }
        const bySignature = new Map();
        for (const entry of entries) {
            if (!bySignature.has(entry.signature))
                bySignature.set(entry.signature, []);
            bySignature.get(entry.signature).push(entry);
        }
        const uniqueEntries = Array.from(bySignature.values()).map(sigEntries => sigEntries[0]);
        if (uniqueEntries.length <= expected) {
            const kept = [...uniqueEntries];
            let remaining = expected - kept.length;
            for (const sigEntries of bySignature.values()) {
                if (remaining <= 0)
                    break;
                const extras = sigEntries.slice(1, 1 + remaining);
                kept.push(...extras);
                remaining -= extras.length;
            }
            cleanedRecords.push(...kept);
            resolvedOverlapCount += entries.length - kept.length;
        }
        else {
            overlapIssues.push({
                timestampKey,
                expected,
                actual: entries.length,
                detail: entries.slice(0, 6).map(r => `${r.fileName} row ${r.rowNumber}: ${r.kwh} kWh`)
            });
            cleanedRecords.push(...entries.slice(0, expected));
        }
    }
    cleanedRecords.sort(compareRecords);
    const coverage = evaluateCoverage(cleanedRecords, overlapIssues);
    const estimatedUsageCount = cleanedRecords.filter(record => String(record.estimatedUsage || "").trim()).length;
    const outflowIntervalCount = cleanedRecords.filter(record => record.hasOutflow).length;
    const negativeNetIntervalCount = cleanedRecords.filter(record => record.hasNegativeNet).length;
    const negativeNetKwhCapped = cleanedRecords.reduce((sum, record) => sum + Math.max(0, -record.kwh), 0);
    return {
        key,
        accountNumber: first.accountNumber,
        accountHolder: first.accountHolder,
        meterNumber: first.meterNumber,
        address: first.address,
        city: first.city,
        files,
        originalRows: records.length,
        cleanedRows: cleanedRecords.length,
        resolvedOverlapCount,
        overlapIssues,
        estimatedUsageCount,
        outflowIntervalCount,
        negativeNetIntervalCount,
        negativeNetKwhCapped,
        records: cleanedRecords,
        coverage
    };
}
function compareRecords(a, b) {
    if (a.timestampKey !== b.timestampKey)
        return a.timestampKey < b.timestampKey ? -1 : 1;
    return a.fileName.localeCompare(b.fileName) || a.rowNumber - b.rowNumber;
}
function evaluateCoverage(records, overlapIssues) {
    if (!records.length)
        return emptyCoverage();
    const minDate = records[0].dateKey;
    const maxDate = records[records.length - 1].dateKey;
    const countByTimestamp = new Map();
    const kwhByDate = new Map();
    const minuteIssues = [];
    for (const record of records) {
        countByTimestamp.set(record.timestampKey, (countByTimestamp.get(record.timestampKey) || 0) + 1);
        kwhByDate.set(record.dateKey, (kwhByDate.get(record.dateKey) || 0) + record.kwh);
        if (record.minute !== 0)
            minuteIssues.push(record.timestampKey);
    }
    const dates = dateRangeKeys(minDate, maxDate);
    const completeDates = new Set();
    const incompleteDates = [];
    const missing = [];
    const unexpected = [];
    for (const dateKey of dates) {
        const expected = expectedTimestampsForDate(dateKey);
        const expectedCounts = new Map();
        expected.forEach(ts => expectedCounts.set(ts, (expectedCounts.get(ts) || 0) + 1));
        let complete = true;
        for (const [timestampKey, expectedCount] of expectedCounts.entries()) {
            const actual = countByTimestamp.get(timestampKey) || 0;
            if (actual !== expectedCount) {
                complete = false;
                if (actual < expectedCount)
                    missing.push({ timestampKey, missingCount: expectedCount - actual });
                if (actual > expectedCount)
                    unexpected.push({ timestampKey, extraCount: actual - expectedCount });
            }
        }
        for (let hour = 0; hour < 24; hour += 1) {
            const timestampKey = `${dateKey} ${pad2(hour)}:00`;
            const expectedCount = expectedCounts.get(timestampKey) || 0;
            const actual = countByTimestamp.get(timestampKey) || 0;
            if (expectedCount === 0 && actual > 0) {
                complete = false;
                unexpected.push({ timestampKey, extraCount: actual });
            }
        }
        if (complete)
            completeDates.add(dateKey);
        else
            incompleteDates.push(dateKey);
    }
    const runs = buildCompleteRuns(dates, completeDates);
    const latestRun = runs.filter(run => run.days >= 365).at(-1) || null;
    const latest365 = latestRun ? { start: addDaysKey(latestRun.end, -364), end: latestRun.end } : null;
    const longestRun = runs.reduce((best, run) => !best || run.days > best.days ? run : best, null);
    return {
        minDate,
        maxDate,
        calendarDays: dates.length,
        completeDayCount: completeDates.size,
        incompleteDates,
        missing,
        unexpected,
        minuteIssues,
        overlapIssues,
        runs,
        longestRun,
        latest365,
        hasContinuousYear: Boolean(latest365),
        isFullyComplete: incompleteDates.length === 0 && overlapIssues.length === 0 && minuteIssues.length === 0
    };
}
function emptyCoverage() {
    return {
        minDate: null,
        maxDate: null,
        calendarDays: 0,
        completeDayCount: 0,
        incompleteDates: [],
        missing: [],
        unexpected: [],
        minuteIssues: [],
        overlapIssues: [],
        runs: [],
        longestRun: null,
        latest365: null,
        hasContinuousYear: false,
        isFullyComplete: false
    };
}
function buildCompleteRuns(dates, completeDates) {
    const runs = [];
    let start = null;
    let previous = null;
    for (const dateKey of dates) {
        if (completeDates.has(dateKey)) {
            if (!start)
                start = dateKey;
            previous = dateKey;
        }
        else if (start) {
            runs.push({ start, end: previous, days: daysBetweenInclusive(start, previous) });
            start = null;
            previous = null;
        }
    }
    if (start)
        runs.push({ start, end: previous, days: daysBetweenInclusive(start, previous) });
    return runs;
}
function expectedTimestampsForDate(dateKey) {
    const result = [];
    const [year, month, day] = dateKey.split("-").map(Number);
    const springForward = isSecondSundayOfMarch(year, month, day);
    const fallBack = isFirstSundayOfNovember(year, month, day);
    for (let hour = 0; hour < 24; hour += 1) {
        if (springForward && hour === 2)
            continue;
        result.push(`${dateKey} ${pad2(hour)}:00`);
        if (fallBack && hour === 1)
            result.push(`${dateKey} ${pad2(hour)}:00`);
    }
    return result;
}
function expectedCountForTimestamp(dateKey, hour) {
    const [year, month, day] = dateKey.split("-").map(Number);
    if (isSecondSundayOfMarch(year, month, day) && hour === 2)
        return 0;
    if (isFirstSundayOfNovember(year, month, day) && hour === 1)
        return 2;
    return 1;
}
function isSecondSundayOfMarch(year, month, day) {
    return month === 3 && day === nthWeekdayOfMonth(year, 3, 0, 2);
}
function isFirstSundayOfNovember(year, month, day) {
    return month === 11 && day === nthWeekdayOfMonth(year, 11, 0, 1);
}
function nthWeekdayOfMonth(year, month, weekday, nth) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const firstWeekday = first.getUTCDay();
    const offset = (weekday - firstWeekday + 7) % 7;
    return 1 + offset + (nth - 1) * 7;
}
function populateMeterSelect() {
    els.meterSelect.innerHTML = "";
    for (const [key, group] of state.groups.entries()) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = `${group.meterNumber} · ${group.address || "No address"} · ${group.city || ""}`.replace(/ · $/, "");
        els.meterSelect.appendChild(option);
    }
    els.meterSelect.value = state.selectedKey;
    els.meterSelect.disabled = state.groups.size === 0;
    els.modeSelect.disabled = state.groups.size === 0;
    els.baselineSelect.disabled = state.groups.size === 0;
}
function configureWindowControlsForSelectedGroup() {
    const group = getSelectedGroup();
    if (!group)
        return;
    const coverage = group.coverage;
    const mode = els.modeSelect.value;
    els.startDate.min = coverage.minDate || "";
    els.startDate.max = coverage.maxDate || "";
    els.endDate.min = coverage.minDate || "";
    els.endDate.max = coverage.maxDate || "";
    if (mode === "latest365") {
        const latest = coverage.latest365;
        els.startDate.value = latest ? latest.start : "";
        els.endDate.value = latest ? latest.end : "";
        els.startDate.disabled = true;
        els.endDate.disabled = true;
    }
    else if (mode === "allAnnualized") {
        const run = coverage.longestRun;
        els.startDate.value = run ? run.start : "";
        els.endDate.value = run ? run.end : "";
        els.startDate.disabled = true;
        els.endDate.disabled = true;
    }
    else {
        if (!els.startDate.value && coverage.latest365)
            els.startDate.value = coverage.latest365.start;
        if (!els.endDate.value && coverage.latest365)
            els.endDate.value = coverage.latest365.end;
        els.startDate.disabled = false;
        els.endDate.disabled = false;
    }
}
function recalculate() {
    const group = getSelectedGroup();
    if (!group)
        return;
    configureExport(false);
    renderValidationSummary(group);
    renderGapReport();
    const start = els.startDate.value;
    const end = els.endDate.value;
    if (!start || !end || start > end) {
        hideResults("Select a valid analysis window.");
        return;
    }
    const selectedDays = dateRangeKeys(start, end);
    const incomplete = selectedDays.filter(dateKey => group.coverage.incompleteDates.includes(dateKey));
    if (incomplete.length || group.coverage.overlapIssues.length || group.coverage.minuteIssues.length) {
        hideResults("The selected analysis window has gaps, unexpected intervals, or unresolved overlaps. Check the data quality report.");
        return;
    }
    const dayCount = daysBetweenInclusive(start, end);
    if (dayCount < 365) {
        hideResults("The selected analysis window is shorter than 365 calendar days.");
        return;
    }
    const records = group.records.filter(record => record.dateKey >= start && record.dateKey <= end);
    if (!records.length) {
        hideResults("No interval records are available in the selected window.");
        return;
    }
    const rates = getRatesFromInputs();
    const result = calculateComparison(group, records, start, end, rates);
    state.lastResults = result;
    renderResults(result);
    renderUsage(result);
    configureExport(true);
}
function hideResults(message) {
    state.lastResults = null;
    els.resultsPanel.classList.add("hidden");
    els.usagePanel.classList.add("hidden");
    if (message) {
        els.validationSummary.innerHTML += `<div class="status-danger"><strong>Calculation paused.</strong> ${escapeHtml(message)}</div>`;
    }
}
function getSelectedGroup() {
    return state.selectedKey ? state.groups.get(state.selectedKey) : null;
}
function getRatesFromInputs() {
    const read = (el, fallback) => {
        const value = Number(el.value);
        return Number.isFinite(value) ? value : fallback;
    };
    return {
        rs1101Basic: read(els.rs1101Basic, DEFAULT_RATES.rs1101Basic),
        rs1101Step1: read(els.rs1101Step1, DEFAULT_RATES.rs1101Step1),
        rs1101Step2: read(els.rs1101Step2, DEFAULT_RATES.rs1101Step2),
        rs1101Step1Daily: read(els.rs1101Step1Daily, DEFAULT_RATES.rs1101Step1Daily),
        rs1151Basic: read(els.rs1151Basic, DEFAULT_RATES.rs1151Basic),
        rs1151Energy: read(els.rs1151Energy, DEFAULT_RATES.rs1151Energy),
        rs2101Overnight: read(els.rs2101Overnight, DEFAULT_RATES.rs2101Overnight),
        rs2101OnPeak: read(els.rs2101OnPeak, DEFAULT_RATES.rs2101OnPeak),
        rs2101OffPeak: read(els.rs2101OffPeak, DEFAULT_RATES.rs2101OffPeak),
        deferralRider: read(els.deferralRider, DEFAULT_RATES.deferralRider),
        tradeRider: read(els.tradeRider, DEFAULT_RATES.tradeRider),
        includeGst: els.includeGst.checked,
        gstRate: read(els.gstRate, DEFAULT_RATES.gstRate)
    };
}
function calculateComparison(group, records, start, end, rates) {
    const days = daysBetweenInclusive(start, end);
    const annualMultiplier = 365 / days;
    const totals = records.reduce((acc, record) => {
        const period = periodForHour(record.hour);
        const billableKwh = Math.max(0, Number.isFinite(record.billableKwh) ? record.billableKwh : record.kwh);
        acc.totalKwh += billableKwh;
        acc.netKwh += record.kwh;
        acc.cappedNegativeKwh += Math.max(0, -record.kwh);
        acc[`${period}Kwh`] += billableKwh;
        return acc;
    }, { totalKwh: 0, netKwh: 0, cappedNegativeKwh: 0, overnightKwh: 0, onpeakKwh: 0, offpeakKwh: 0 });
    const baseOptions = RATE_OPTIONS.map(option => computeOption(option, days, totals, rates));
    const options = baseOptions
        .map(option => ({
        ...option,
        annualCost: option.total * annualMultiplier,
        annualBase: option.basic * annualMultiplier,
        annualEnergy: option.energy * annualMultiplier,
        annualTou: option.touAdjustment * annualMultiplier,
        annualRiders: option.riders * annualMultiplier,
        annualTax: option.tax * annualMultiplier
    }))
        .sort((a, b) => a.annualCost - b.annualCost);
    const monthly = buildMonthlyBreakdown(records, rates);
    return {
        group,
        start,
        end,
        days,
        annualMultiplier,
        totals,
        rates,
        options,
        monthly
    };
}
function computeOption(option, days, totals, rates) {
    let basic;
    let energy;
    let tier1Kwh = 0;
    let tier2Kwh = 0;
    if (option.base === "tiered") {
        basic = days * centsToDollars(rates.rs1101Basic);
        const step1Allowance = days * rates.rs1101Step1Daily;
        tier1Kwh = Math.min(totals.totalKwh, step1Allowance);
        tier2Kwh = Math.max(0, totals.totalKwh - tier1Kwh);
        energy = tier1Kwh * centsToDollars(rates.rs1101Step1) + tier2Kwh * centsToDollars(rates.rs1101Step2);
    }
    else {
        basic = days * centsToDollars(rates.rs1151Basic);
        energy = totals.totalKwh * centsToDollars(rates.rs1151Energy);
    }
    const baseSubtotal = basic + energy;
    const riders = baseSubtotal * ((rates.deferralRider + rates.tradeRider) / 100);
    const touAdjustment = option.useTou
        ? totals.overnightKwh * centsToDollars(rates.rs2101Overnight) + totals.onpeakKwh * centsToDollars(rates.rs2101OnPeak) + totals.offpeakKwh * centsToDollars(rates.rs2101OffPeak)
        : 0;
    const beforeTax = baseSubtotal + riders + touAdjustment;
    const tax = rates.includeGst ? beforeTax * (rates.gstRate / 100) : 0;
    const total = beforeTax + tax;
    return {
        id: option.id,
        schedule: option.schedule,
        name: option.name,
        basic,
        energy,
        riders,
        touAdjustment,
        tax,
        total,
        tier1Kwh,
        tier2Kwh
    };
}
function periodForHour(hour) {
    if (hour >= 23 || hour < 7)
        return "overnight";
    if (hour >= 16 && hour < 21)
        return "onpeak";
    return "offpeak";
}
function buildMonthlyBreakdown(records, rates) {
    const months = new Map();
    for (const record of records) {
        const monthKey = record.dateKey.slice(0, 7);
        if (!months.has(monthKey)) {
            months.set(monthKey, {
                month: monthKey,
                days: new Set(),
                total: 0,
                net: 0,
                overnight: 0,
                onpeak: 0,
                offpeak: 0,
                costs: {}
            });
        }
        const item = months.get(monthKey);
        const period = periodForHour(record.hour);
        const billableKwh = Math.max(0, Number.isFinite(record.billableKwh) ? record.billableKwh : record.kwh);
        item.days.add(record.dateKey);
        item.total += billableKwh;
        item.net += record.kwh;
        item[period] += billableKwh;
    }
    return Array.from(months.values()).map(item => {
        const totals = {
            totalKwh: item.total,
            netKwh: item.net,
            cappedNegativeKwh: Math.max(0, item.total - item.net),
            overnightKwh: item.overnight,
            onpeakKwh: item.onpeak,
            offpeakKwh: item.offpeak
        };
        for (const option of RATE_OPTIONS) {
            item.costs[option.id] = computeOption(option, item.days.size, totals, rates).total;
        }
        return { ...item, days: item.days.size };
    }).sort((a, b) => a.month.localeCompare(b.month));
}
function renderFileSummary(fileReports, totalRecords) {
    const errorCount = fileReports.reduce((sum, report) => sum + report.rowErrors.length, 0);
    const items = fileReports.map(report => {
        const skipped = report.rowErrors.length ? `, ${formatInteger(report.rowErrors.length)} skipped` : "";
        return `<li>${escapeHtml(report.fileName)}: ${formatInteger(report.validRows)} interval rows${skipped}</li>`;
    }).join("");
    const rowErrorItems = fileReports.flatMap(report => report.rowErrors.slice(0, 8).map(error => `<li>${escapeHtml(report.fileName)} ${escapeHtml(error)}</li>`));
    const rowErrorOverflow = errorCount - rowErrorItems.length;
    const rowErrorSummary = errorCount
        ? `<div class="status-warning"><strong>Malformed rows skipped.</strong><ul class="file-list">${rowErrorItems.join("")}${rowErrorOverflow > 0 ? `<li>${formatInteger(rowErrorOverflow)} additional skipped row${rowErrorOverflow === 1 ? "" : "s"} not shown.</li>` : ""}</ul></div>`
        : "";
    els.fileSummary.innerHTML = `Loaded <strong>${fileReports.length}</strong> file${fileReports.length === 1 ? "" : "s"} with <strong>${formatInteger(totalRecords)}</strong> parsed interval rows${errorCount ? ` and <strong>${errorCount}</strong> skipped row${errorCount === 1 ? "" : "s"}` : ""}.<ul class="file-list">${items}</ul>${rowErrorSummary}`;
}
function renderValidationSummary(group) {
    const c = group.coverage;
    const lines = [];
    lines.push(`<div class="status-good"><strong>Meter ${escapeHtml(group.meterNumber)}</strong> ${escapeHtml(group.address || "")}${group.city ? `, ${escapeHtml(group.city)}` : ""}. Source file${group.files.length === 1 ? "" : "s"}: ${group.files.map(escapeHtml).join(", ")}.</div>`);
    if (c.hasContinuousYear) {
        lines.push(`<div class="status-good"><strong>Continuous year found.</strong> Latest complete 365-day window is ${c.latest365.start} to ${c.latest365.end}.</div>`);
    }
    else {
        const longest = c.longestRun ? `${c.longestRun.days} complete day${c.longestRun.days === 1 ? "" : "s"} from ${c.longestRun.start} to ${c.longestRun.end}` : "no complete run found";
        lines.push(`<div class="status-danger"><strong>No continuous 365-day period.</strong> Longest run: ${escapeHtml(longest)}.</div>`);
    }
    if (c.isFullyComplete) {
        lines.push(`<div class="status-good"><strong>No gaps detected.</strong> The merged data covers ${c.minDate} to ${c.maxDate} with expected daylight saving time adjustments.</div>`);
    }
    else {
        const gapText = `${c.incompleteDates.length} incomplete date${c.incompleteDates.length === 1 ? "" : "s"}, ${c.missing.length} missing interval item${c.missing.length === 1 ? "" : "s"}, ${c.unexpected.length} unexpected interval item${c.unexpected.length === 1 ? "" : "s"}`;
        lines.push(`<div class="status-warning"><strong>Data quality items found.</strong> ${escapeHtml(gapText)}. See the gap and overlap report below.</div>`);
    }
    if (group.resolvedOverlapCount) {
        lines.push(`<div class="status-warning"><strong>Overlaps resolved.</strong> ${formatInteger(group.resolvedOverlapCount)} duplicate overlapping interval row${group.resolvedOverlapCount === 1 ? "" : "s"} removed while merging segmented files.</div>`);
    }
    if (group.estimatedUsageCount) {
        lines.push(`<div class="status-warning"><strong>Estimated usage present.</strong> ${formatInteger(group.estimatedUsageCount)} interval row${group.estimatedUsageCount === 1 ? " is" : "s are"} flagged as estimated. These rows are reported but not rejected automatically.</div>`);
    }
    if (group.outflowIntervalCount || group.negativeNetIntervalCount) {
        const capped = group.negativeNetKwhCapped ? ` Negative net intervals are capped at 0 kWh for these non-generation comparisons (${formatKWh(group.negativeNetKwhCapped)} not credited).` : "";
        lines.push(`<div class="status-warning"><strong>Outflow or negative net consumption detected.</strong> Outflow intervals: ${formatInteger(group.outflowIntervalCount)}; negative net intervals: ${formatInteger(group.negativeNetIntervalCount)}. This app does not calculate export credits or generation rates.${escapeHtml(capped)}</div>`);
    }
    els.validationSummary.innerHTML = `<div class="status-list">${lines.join("")}</div>`;
}
function renderResults(result) {
    const best = result.options[0];
    const baseline = getBaselineOption(result);
    const modeLabel = result.days === 365 ? "selected 365-day period" : `${result.days}-day selected period annualized`;
    const taxText = result.rates.includeGst ? `includes ${formatNumber(result.rates.gstRate, 2)}% tax estimate` : "before tax; optional tax estimate is disabled";
    els.resultsPanel.classList.remove("hidden");
    els.winnerCard.innerHTML = `
    <div>
      <p class="eyebrow">Best option</p>
      <h3>${escapeHtml(best.schedule)} · ${escapeHtml(best.name)}</h3>
      <p>Based on ${formatKWh(result.totals.totalKwh)} billable net consumption over ${result.start} to ${result.end}. This is the annual cost for the ${modeLabel}; ${escapeHtml(taxText)}.</p>
    </div>
    <div class="winner-price">${formatCurrency(best.annualCost)}</div>
  `;
    const tiered = result.options.find(o => o.id === "rs1101") || result.options[0];
    els.metricsGrid.innerHTML = [
        metricCard("Billable net consumption", formatKWh(result.totals.totalKwh)),
        metricCard("Overnight", `${formatKWh(result.totals.overnightKwh)} · ${formatPercent(result.totals.overnightKwh / result.totals.totalKwh)}`),
        metricCard("On-peak", `${formatKWh(result.totals.onpeakKwh)} · ${formatPercent(result.totals.onpeakKwh / result.totals.totalKwh)}`),
        metricCard("Off-peak", `${formatKWh(result.totals.offpeakKwh)} · ${formatPercent(result.totals.offpeakKwh / result.totals.totalKwh)}`),
        metricCard("Tier 2 exposure", `${formatKWh(tiered.tier2Kwh)} · ${formatPercent(tiered.tier2Kwh / result.totals.totalKwh)}`),
        metricCard("Tax treatment", taxText)
    ].join("");
    const tbody = els.resultsTable.querySelector("tbody");
    tbody.innerHTML = "";
    result.options.forEach((option, index) => {
        const difference = option.annualCost - best.annualCost;
        const baselineDifference = option.annualCost - baseline.annualCost;
        const row = document.createElement("tr");
        row.innerHTML = `
      <td>${index + 1}</td>
      <td><strong>${escapeHtml(option.schedule)}</strong><br><span class="muted">${escapeHtml(option.name)}</span></td>
      <td>${formatCurrency(option.annualCost)}</td>
      <td>${difference <= 0.005 ? "Best" : `+${formatCurrency(difference)}`}</td>
      <td>${formatSignedCurrency(baselineDifference)}</td>
      <td>${formatCurrency(option.annualBase)}</td>
      <td>${formatCurrency(option.annualEnergy)}</td>
      <td>${formatCurrency(option.annualTou)}</td>
      <td>${formatCurrency(option.annualRiders)}</td>
      <td>${formatCurrency(option.annualTax)}</td>
      <td>${formatCentsPerKwh(option.annualCost, result.totals.totalKwh * result.annualMultiplier)}</td>
    `;
        tbody.appendChild(row);
    });
    renderCostChart(result.options);
}
function getBaselineOption(result) {
    const baselineId = getBaselineId();
    return getBaselineOptionById(result, baselineId);
}
function getBaselineId() {
    return els.baselineSelect && els.baselineSelect.value ? els.baselineSelect.value : "rs1101";
}
function getBaselineOptionById(result, baselineId) {
    return result.options.find(option => option.id === baselineId) || result.options.find(option => option.id === "rs1101") || result.options[0];
}
function metricCard(label, value) {
    return `<div class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}
function renderCostChart(options) {
    const max = Math.max(...options.map(o => o.annualCost));
    els.costChart.innerHTML = options.map(option => {
        const width = max > 0 ? (option.annualCost / max) * 100 : 0;
        return `
      <div class="bar-row">
        <div>${escapeHtml(option.schedule)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${width.toFixed(2)}%"></div></div>
        <div>${formatCurrency(option.annualCost)}</div>
      </div>
    `;
    }).join("");
}
function renderUsage(result) {
    els.usagePanel.classList.remove("hidden");
    const max = Math.max(...result.monthly.map(item => item.total), 1);
    els.usageChart.innerHTML = result.monthly.map(item => {
        const totalWidth = Math.max(0.3, item.total / max * 100);
        const overnightPct = item.total ? item.overnight / item.total * 100 : 0;
        const onpeakPct = item.total ? item.onpeak / item.total * 100 : 0;
        const offpeakPct = item.total ? item.offpeak / item.total * 100 : 0;
        return `
      <div class="month-row">
        <div>${escapeHtml(item.month)}</div>
        <div class="bar-track" title="${formatKWh(item.total)}">
          <div class="stacked-bar" style="width:${totalWidth.toFixed(2)}%">
            <span class="seg-overnight" style="width:${overnightPct.toFixed(2)}%"></span>
            <span class="seg-onpeak" style="width:${onpeakPct.toFixed(2)}%"></span>
            <span class="seg-offpeak" style="width:${offpeakPct.toFixed(2)}%"></span>
          </div>
        </div>
        <div>${formatKWh(item.total)}</div>
      </div>
    `;
    }).join("");
    const tbody = els.monthlyTable.querySelector("tbody");
    tbody.innerHTML = "";
    for (const item of result.monthly) {
        const row = document.createElement("tr");
        row.innerHTML = `
      <td>${escapeHtml(item.month)}</td>
      <td>${formatKWh(item.total)}</td>
      <td>${formatKWh(item.overnight)}</td>
      <td>${formatKWh(item.onpeak)}</td>
      <td>${formatKWh(item.offpeak)}</td>
      <td>${formatCurrency(item.costs.rs1101)}</td>
      <td>${formatCurrency(item.costs.rs1101Tou)}</td>
      <td>${formatCurrency(item.costs.rs1151)}</td>
      <td>${formatCurrency(item.costs.rs1151Tou)}</td>
    `;
        tbody.appendChild(row);
    }
}
function renderGapReport() {
    const group = getSelectedGroup();
    if (!group) {
        els.gapPanel.classList.add("hidden");
        return;
    }
    const c = group.coverage;
    const hasReport = !c.isFullyComplete || group.resolvedOverlapCount > 0;
    els.gapPanel.classList.toggle("hidden", !hasReport);
    if (!hasReport)
        return;
    const items = [];
    if (group.resolvedOverlapCount) {
        items.push(`<div class="gap-item">Resolved overlaps: ${formatInteger(group.resolvedOverlapCount)} duplicate overlapping interval row${group.resolvedOverlapCount === 1 ? "" : "s"} removed.</div>`);
    }
    if (c.overlapIssues.length) {
        items.push(`<h3>Unresolved duplicate or overlap conflicts</h3>`);
        items.push(...c.overlapIssues.slice(0, 30).map(issue => `<div class="gap-item">${escapeHtml(issue.timestampKey)} expected ${issue.expected}, found ${issue.actual}. ${escapeHtml(issue.detail.join("; "))}</div>`));
    }
    if (c.missing.length) {
        items.push(`<h3>Missing intervals</h3>`);
        items.push(...c.missing.slice(0, 80).map(item => `<div class="gap-item">${escapeHtml(item.timestampKey)} · missing ${item.missingCount} interval${item.missingCount === 1 ? "" : "s"}</div>`));
        if (c.missing.length > 80)
            items.push(`<div class="gap-item">${formatInteger(c.missing.length - 80)} additional missing interval item${c.missing.length - 80 === 1 ? "" : "s"} not shown.</div>`);
    }
    if (c.unexpected.length) {
        items.push(`<h3>Unexpected extra intervals</h3>`);
        items.push(...c.unexpected.slice(0, 80).map(item => `<div class="gap-item">${escapeHtml(item.timestampKey)} · extra ${item.extraCount} interval${item.extraCount === 1 ? "" : "s"}</div>`));
        if (c.unexpected.length > 80)
            items.push(`<div class="gap-item">${formatInteger(c.unexpected.length - 80)} additional unexpected interval item${c.unexpected.length - 80 === 1 ? "" : "s"} not shown.</div>`);
    }
    if (c.minuteIssues.length) {
        items.push(`<h3>Non-hourly timestamps</h3>`);
        items.push(...c.minuteIssues.slice(0, 40).map(ts => `<div class="gap-item">${escapeHtml(ts)} is not on an hourly boundary.</div>`));
    }
    if (c.incompleteDates.length) {
        items.push(`<h3>Incomplete dates</h3>`);
        const sample = c.incompleteDates.slice(0, 120).join(", ");
        items.push(`<div class="gap-item">${escapeHtml(sample)}${c.incompleteDates.length > 120 ? `, plus ${formatInteger(c.incompleteDates.length - 120)} more` : ""}</div>`);
    }
    els.gapReport.innerHTML = `<div class="gap-list">${items.join("")}</div>`;
}
function showFatalError(message) {
    els.fileSummary.innerHTML = `<span class="status-danger"><strong>Error.</strong> ${escapeHtml(message)}</span>`;
    els.validationSummary.textContent = "Upload files to begin validation.";
    renderInitialState();
}
function configureExport(enabled) {
    els.exportButton.disabled = !enabled;
}
function exportSummaryCsv() {
    const result = state.lastResults;
    if (!result)
        return;
    const csv = buildSummaryCsv(result, getBaselineId());
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `bc-hydro-rate-comparison-${result.group.meterNumber}-${result.start}-to-${result.end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
function buildSummaryRows(result, baselineId = "rs1101") {
    const rows = [[
            "Meter Number", "Service Address", "Analysis Start", "Analysis End", "Analysis Days",
            "Tax Treatment", "Baseline Option", "Option", "Annual Cost", "Difference From Best", "Difference From Baseline",
            "Basic", "Energy", "TOU Adjustment", "Riders", "Tax", "Effective Cents per kWh",
            "Billable Net kWh", "Raw Net kWh", "Overnight kWh", "On-Peak kWh", "Off-Peak kWh"
        ]];
    const best = result.options[0].annualCost;
    const baseline = getBaselineOptionById(result, baselineId);
    const annualKwh = result.totals.totalKwh * result.annualMultiplier;
    const annualNetKwh = result.totals.netKwh * result.annualMultiplier;
    const taxTreatment = result.rates.includeGst ? `Includes ${formatNumber(result.rates.gstRate, 2)}% tax estimate` : "Before tax";
    for (const option of result.options) {
        rows.push([
            result.group.meterNumber,
            `${result.group.address || ""}${result.group.city ? `, ${result.group.city}` : ""}`,
            result.start,
            result.end,
            String(result.days),
            taxTreatment,
            baseline.schedule,
            option.schedule,
            option.annualCost.toFixed(2),
            (option.annualCost - best).toFixed(2),
            (option.annualCost - baseline.annualCost).toFixed(2),
            option.annualBase.toFixed(2),
            option.annualEnergy.toFixed(2),
            option.annualTou.toFixed(2),
            option.annualRiders.toFixed(2),
            option.annualTax.toFixed(2),
            centsPerKwh(option.annualCost, annualKwh).toFixed(2),
            annualKwh.toFixed(3),
            annualNetKwh.toFixed(3),
            (result.totals.overnightKwh * result.annualMultiplier).toFixed(3),
            (result.totals.onpeakKwh * result.annualMultiplier).toFixed(3),
            (result.totals.offpeakKwh * result.annualMultiplier).toFixed(3)
        ]);
    }
    return rows;
}
function buildSummaryCsv(result, baselineId = "rs1101") {
    return buildSummaryRows(result, baselineId).map(row => row.map(csvEscape).join(",")).join("\n");
}
function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function centsToDollars(cents) { return cents / 100; }
function pad2(num) { return String(num).padStart(2, "0"); }
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
function daysBetweenInclusive(start, end) {
    return Math.round((dateFromKey(end).getTime() - dateFromKey(start).getTime()) / 86400000) + 1;
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
function formatCurrency(value) {
    return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(value || 0);
}
function formatSignedCurrency(value) {
    if (Math.abs(value || 0) <= 0.005)
        return "$0";
    return `${value > 0 ? "+" : "-"}${formatCurrency(Math.abs(value))}`;
}
function formatKWh(value) {
    return `${new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 }).format(value || 0)} kWh`;
}
function formatNumber(value, maximumFractionDigits = 0) {
    return new Intl.NumberFormat("en-CA", { maximumFractionDigits }).format(value || 0);
}
function centsPerKwh(costDollars, kwh) {
    return kwh > 0 ? (costDollars / kwh) * 100 : 0;
}
function formatCentsPerKwh(costDollars, kwh) {
    return `${formatNumber(centsPerKwh(costDollars, kwh), 2)} ¢/kWh`;
}
function formatInteger(value) {
    return new Intl.NumberFormat("en-CA").format(value || 0);
}
function formatPercent(value) {
    if (!Number.isFinite(value))
        return "0%";
    return new Intl.NumberFormat("en-CA", { style: "percent", maximumFractionDigits: 1 }).format(value);
}
function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
if (typeof module !== "undefined") {
    module.exports = {
        REQUIRED_COLUMNS,
        RATE_OPTIONS,
        DEFAULT_RATES,
        parseCsv,
        parseBCHydroCsv,
        parseIntervalStart,
        parseNumber,
        cleanAccount,
        buildGroups,
        analyseGroup,
        evaluateCoverage,
        expectedTimestampsForDate,
        expectedCountForTimestamp,
        periodForHour,
        calculateComparison,
        computeOption,
        buildMonthlyBreakdown,
        buildSummaryRows,
        buildSummaryCsv,
        csvEscape,
        centsPerKwh,
        dateRangeKeys,
        daysBetweenInclusive
    };
}
