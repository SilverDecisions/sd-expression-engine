# Changelog

## Unreleased

### Dependencies: Math.js 15.2.0 (from 9.5.0)

- **Runtime requirements**: Math.js 13+ requires ES2020 and `BigInt` (Chrome and
  Edge 80+, Firefox 74+, Safari 14+ from the ES2020 features used, not tested in
  those browsers; no Internet Explorer). The bundles contain
  Math.js as published (ES2020 syntax); the package sources still compile to ES5.
- Fractions use fraction.js 5 (`bigint`) and are exact up to any size; long
  sums (the mean of a probabilistic sensitivity analysis) grew to thousands of
  digits, got slow and `toFloat` returned `NaN`. The arithmetic helpers (`add`,
  `subtract`, `multiply`, `divide`) therefore keep a result exact while its
  numerator and denominator have at most 64 bits and otherwise replace it with
  a simpler fraction (continued-fraction convergent) within a relative error of 2^-64 (0.1.17: doubles,
  exact up to 53 bits, relative error up to 2^-52 per operation). Small values
  keep their magnitude. `toFloat` is accurate for Fractions beyond the double
  range.
- `eval(expr, true)` rejects a `Unit` result as before (Math.js 14+ would convert
  the value of the unit).
- The JSON form of a Fraction (`toJSON`, data model DTO of the job repository)
  writes `n` and `d` as strings; the 0.1.17 form with numbers is still read.
  Saved diagrams are unchanged (Fractions are saved as fraction strings).
- Behaviour of Math.js for user expressions (Math.js 10-15 changelogs, checked
  against the expressions of saved diagrams, which give the same values):
  `-1 / 2 x` is `(-1/2) * x` (was `-1 / (2 x)`); element-wise `sqrt`, `exp`,
  `sin` etc. of matrices throw (use `map`); `mod` accepts negative divisors;
  `cond ? : b` is an error; `size()` returns an array; `x[i, :]` returns a
  vector; integers in numeric strings beyond 2^53 keep all digits; new syntax
  `??`, `?.` and new functions (`isFinite`, `num`, `den`, `bernoulli`, ...).
- Security: Math.js 15.2.0 fixes GHSA-jvff-x2qm-6286, GHSA-29qv-4j9f-fjw5
  (CVE-2026-40897) and GHSA-5v89-rwgr-qj6g (CVE-2026-41139), which affect
  13.1.0 - 15.1.x (not 9.5.0).

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
- Runtime dependencies unchanged (Math.js 9.5.0, sd-utils 0.1.15, sd-random
  0.1.4 and the same locked transitive versions); development tooling updated,
  `package-lock.json` in format v3.
- Tests: contract tests (`npm test`, `node:test`) on the bundles and the
  sources, the Jasmine specs run in Node, `npm run test:build` checks a fresh
  build in an isolated copy; GitHub Actions instead of Travis CI.
