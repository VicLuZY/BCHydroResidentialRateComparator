# BC Hydro Residential Rate Comparator

Static browser-only app for comparing BC Hydro residential rate options from hourly MyHydro consumption CSV exports.

The app lives in `bchydro-rate-comparator/`. It is authored in TypeScript and compiled to a plain static `app.js` for local use and GitHub Pages deployment.

## Local Validation

```sh
cd bchydro-rate-comparator
npm ci
npm run build:pages
npm test
npm run test:browser
```

`npm run test:examples` can be run locally when non-committed example CSV files exist in `examples/`.

## GitHub Pages

Pushes to `main` run `.github/workflows/pages.yml`, build the static artifact in `bchydro-rate-comparator/dist`, run tests, and deploy the artifact with GitHub Pages Actions.
