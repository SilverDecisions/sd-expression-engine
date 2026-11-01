# sd-expression-engine
SilverDecisions expression engine module

[![Build Status](https://travis-ci.org/SilverDecisions/sd-expression-engine.svg?branch=master)](https://travis-ci.org/SilverDecisions/sd-expression-engine)
[![codecov](https://codecov.io/gh/SilverDecisions/sd-expression-engine/branch/master/graph/badge.svg)](https://codecov.io/gh/SilverDecisions/sd-expression-engine)

## Tests

Contract tests (`test/contract/*.test.js`, `node:test`) cover the API used by
sd-computations and SilverDecisions: evaluation and scopes, validation, number
helpers, serialization of saved diagrams, the sd-random functions in
expressions and the formats of the dist bundles. They run against a built
artifact, chosen with `SD_EXPRESSION_ENGINE_TARGET`:

| Target | Tested file |
|---|---|
| `standalone` (default), `standalone.min` | `dist/standalone/sd-expression-engine(.min).js`, UMD `SilverDecisions.ExpressionEngine` |
| `module`, `module.min` | `dist/sd-expression-engine(.min).js`, global `require('sd-expression-engine')`, loaded after `dist/sd-utils.js` and `dist/sd-random.js` of the installed packages (`SD_UTILS_BUNDLE`, `SD_RANDOM_BUNDLE` override them) |
| `source` | `index.js` bundled with browserify and the package's `browserify.transform`, as SilverDecisions bundles it |
| a file path | a CommonJS module exporting the package namespace |

`SD_EXPRESSION_ENGINE_DIST=<dir>` tests the bundles of another `dist/` directory.

```bash
npm test                                   # all five targets on ./dist and the sources
SD_EXPRESSION_ENGINE_TARGET=module node --test test/contract/   # one target
node test/contract/run.js --targets=module,source
npm run test:published                     # the bundles of sd-expression-engine@0.1.17 from npm
npx gulp test                              # the Jasmine specs (test/specs) in Karma
```

Randomness: sd-random keeps a reference to `Math.random` taken when it is
loaded, so `test/contract/load.js` installs a `Math.random` dispatcher before any
bundle is evaluated; tests choose the draws with `rng.withSequence()` /
`rng.withSeed()`, which always restore the original source.

Fixtures: diagrams saved by SilverDecisions 0.5.2 - 1.2.0 with the values those
releases computed (`test/contract/fixtures/README.md`).

### Baseline behaviour recorded by the tests

Tests named `[current behaviour]` record behaviour of 0.1.17 that is not an
intended contract; `[known bug, expected]` tests assert the intended behaviour,
pass while the defect is present and fail once it is fixed.

- `hasAssignmentExpression` is true for any string containing `=`, also for
  comparisons (`a == 5`, `x >= 5 ? 1 : 0`): such payoffs are not evaluated by
  sd-computations and rejected by the SilverDecisions inputs (known bug; changing
  the accepted expressions is a product decision).
- `eval(expr, true)` first tries `toNumber(expr)`, which uses `parseFloat`: an
  expression starting with `Infinity` or an overflowing literal (`Infinity * 0`,
  `Infinity > 3 ? 1 : 2`, `1e400 * 0`) returns `Infinity` without being
  evaluated (known bug).
- `serialize` writes values above 1 as mixed numbers (`1 1/2`), also in saved
  files; `toNumber` and `eval(expr, true)` read them, `validate` and
  `eval(expr, false)` reject them.
- `serialize(±Infinity)` and `round(±Infinity)` throw; `add` / `divide` of
  `Infinity` and a finite value throw (implicit conversion to Fraction).
- `median` and `std` do not accept Fractions (Math.js 9, `number` config).
- `isExpressionObject` is false for a live Fraction; the replacer works inside
  `JSON.stringify`, which calls `toJSON()` first.
- The Math.js instance is shared: `createUnit` in an expression changes it for
  all later evaluations; `evaluate` and `parse` are available in expressions.
- Math.js `random()`, `randomInt()`, `pickRandom()` use their own generator, not
  `Math.random`.
- Scopes must be plain objects (or inherit from one); `Object.create(null)` and
  class instances are rejected. Functions defined in an expression read the
  scope they were defined in.
- The bundles define a global `regeneratorRuntime` (regenerator-runtime 0.13 of
  the Babel runtime of Math.js).
- Module bundle: a first `require('sd-expression-engine')` that fails (sd-utils
  not loaded) leaves an empty cached module, as browserify does.
- The published 0.1.17 tarball and the committed `dist/` differ only in line
  endings: the published plain bundles contain the CRLF line endings of the
  bundled decimal.js, git stores them as LF (`.gitattributes`).
