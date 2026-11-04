# Changelog

## Unreleased

### Build

- The `dist/` bundles are built with Rollup and npm scripts instead of
  gulp/browserify (`npm run build`). Same files, formats and globals:
  `dist/sd-expression-engine(.min).js` defines the global `require` exposing
  `sd-expression-engine` (sd-utils and sd-random external, Math.js bundled),
  `dist/standalone/sd-expression-engine(.min).js` is the UMD
  `SilverDecisions.ExpressionEngine`; ES5 syntax, inline source maps in the plain
  files, `.map` files for the minified ones. The package sources, sd-utils and
  sd-random are compiled with the Babel options of their `browserify.transform`
  fields as before.
- Differences of the bundles: the AMD branch of the UMD calls `define(factory)`
  instead of `define([], factory)` (same module value); the plain files are
  larger (their inline source maps carry `sourcesContent`), the minified files
  smaller (about 930 KiB / 1016 KiB instead of 1150 KiB / 1232 KiB).
- Development tooling updated, `package-lock.json` in format v3.
- Tests: contract tests (`npm test`, `node:test`) on the bundles and the
  sources, the Jasmine specs run in Node, `npm run test:build` checks a fresh
  build in an isolated copy; GitHub Actions instead of Travis CI.

### Dependencies

- `package.json` unchanged: Math.js 9.5.0, sd-utils `^0.1.15`, sd-random
  `^0.1.4`. Locked versions updated within the existing ranges:
  - `@babel/runtime` 7.15.4 -> 7.29.10 (Math.js; its helpers are in both
    bundles, `regenerator-runtime` 0.13.9 is no longer installed; the standalone
    bundle still defines the global `regeneratorRuntime`);
  - lodash 4.17.21 -> 4.18.1 and loglevel 1.7.1 -> 1.9.2 (sd-utils; in the
    standalone bundle);
  - Rollup 4.67.5 and other development packages.
- Unchanged on purpose: the Math.js dependencies that define expression
  results (complex.js 2.0.15, decimal.js 10.3.1, fraction.js 4.1.1,
  typed-function 2.0.0) and the Babel 6 plugins (see README). release-it stays
  at 14.14.3, the last 14.x release.
