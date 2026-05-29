# AGENTS.md

## Project Overview
- purpose: local browser-only comparator for BC Hydro residential rate options using hourly MyHydro CSV exports.
- primary stack: static HTML and CSS with TypeScript-authored browser logic compiled to `app.js`; no backend and no runtime data transmission.
- current phase: hardening against the requirements in `bchydro-rate-comparator-goal.txt`.
- key constraints: preserve customer privacy, avoid committed real customer data, keep tariff assumptions editable, and do not add generation or net-metering rate schedules.

## Directory Map
- `bchydro-rate-comparator/`: static website (`index.html`, `styles.css`, generated `app.js`, `README.txt`).
- `bchydro-rate-comparator/src/`: TypeScript source for browser parsing, validation, and rate calculations.
- `bchydro-rate-comparator/tests/`: synthetic and smoke validation harnesses.
- `examples/`: user-supplied BC Hydro CSV examples for local validation only; do not hard-code their names or values.
- `bchydro-rate-comparator-goal.txt`: source-of-truth requirements.
- `bchydro-rate-comparator.zip`: original supplied app archive.

## Working Conventions
- coding style: TypeScript source compiled to plain browser JavaScript; keep calculation and validation helpers small and testable.
- generated files: edit `bchydro-rate-comparator/src/app.ts`, then run `npm run build`; do not hand-edit generated `app.js`.
- branching or change discipline: `main` tracks `origin/main` at `VicLuZY/BCHydroResidentialRateComparator`; avoid destructive file operations.
- documentation expectations: update README or this guide only for materially useful workflow changes.
- refactor policy: keep changes scoped; prefer extracting calculation and validation helpers only when it improves testability.
- risk-sensitive areas: tariff constants, daylight saving validation, duplicate interval handling, exported CSV content, and any handling of account or address data.

## Validation
- fast checks: run `npm test` from `bchydro-rate-comparator/`; it builds TypeScript first.
- full checks: run `npm test`, `npm run test:examples`, and `npm run test:browser` from `bchydro-rate-comparator/`.
- pages checks: run `npm run build:pages` and `npm run test:browser`; the browser smoke test audits the built page for console warnings and errors.
- deployment checks: GitHub Actions deploys `bchydro-rate-comparator/dist/` to Pages on pushes to `main`.
- when to run which: use fast checks after every logic patch; use full checks before handing off.
- release-critical validations: DST gap/duplicate behavior, 365-day complete-window detection, duplicate conflict blocking, rider application, and CSV export.

## Delegation Rules
- when to parallelize: independent file reads, test inspection, or separate UI and calculation reviews.
- when to avoid parallelization: edits to shared app files and tariff logic changes.
- preferred recurring roles: `implementer`, `tester`, `reviewer`, `docs-maintainer`.
- recursion limits or cautions: keep subagent roles lightweight unless substantial independent workstreams recur.

## Agent Registry

### Active
- `implementer`
  - purpose: make scoped app, calculation, and UI changes aligned with the static architecture.
  - triggers: feature work, bug fixes, and requirements hardening.
  - outputs: patches and concise implementation notes.

- `tester`
  - purpose: maintain repeatable validation for parser, merge, DST, rate, and export behavior.
  - triggers: calculation changes, parser changes, and acceptance testing.
  - outputs: synthetic fixtures, test scripts, and validation results.

- `reviewer`
  - purpose: check changes against the goal file and privacy constraints.
  - triggers: before handoff or after broad edits.
  - outputs: gap notes, risk notes, and recommended fixes.

### Dormant
- `docs-maintainer`
  - purpose: keep user-facing instructions and project operating notes current.
  - reactivate_when: workflows, file layout, or validation commands change materially.

### Candidate
- `rate-researcher`
  - purpose: verify future tariff changes against BC Hydro source documents.
  - promote_when: rate updates become recurring.

### Retired
- none

## Current Risks
- risk: example CSVs may contain customer-identifying data.
- mitigation: use them only for local manual validation and generate synthetic fixtures for committed tests.
- risk: daylight saving days can look like gaps or duplicates if counted by naive hours.
- mitigation: validate by Pacific calendar-day rules with 23/24/25 expected interval counts.
- risk: outflow or negative net consumption can accidentally become generation credit.
- mitigation: flag it and cap negative billable consumption at zero for the non-generation comparisons.

## Evolution Notes
- The local app should stay static and privacy-preserving unless the goal file changes.
