# sd-expression-engine
SilverDecisions expression engine module: evaluation of the expressions of
SilverDecisions diagrams with [Math.js](https://mathjs.org/) 15.2.0, exact
Fraction arithmetic and the sd-random distributions.

[![CI](https://github.com/SilverDecisions/sd-expression-engine/actions/workflows/ci.yml/badge.svg)](https://github.com/SilverDecisions/sd-expression-engine/actions/workflows/ci.yml)

## Usage

```js
import {ExpressionEngine} from 'sd-expression-engine';   // index.js -> src/ (ES2015 sources)

const engine = new ExpressionEngine();
const scope = {};
engine.eval('p = 1/3', false, scope);          // code: Math.js value, assigned into scope
ExpressionEngine.eval('p * 3', true, scope);   // payoff / probability: Fraction 1
```

Consumers that bundle the package (SilverDecisions, sd-computations) compile
`index.js` and `src/` with the `browserify.transform` field of `package.json`
(babelify, `@babel/preset-env`, Babel 6 `transform-class-properties` etc.).

Built files (`dist/`, committed, rebuilt by the release):

| File | Format |
|---|---|
| `dist/sd-expression-engine.js`, `.min.js` (+ `.map`) | defines a global `require` exposing `require('sd-expression-engine')`; `sd-utils` and `sd-random` come from the global `require` of their own `dist/` bundles (loaded before or after it, e.g. in the sd-computations job worker), Math.js is bundled |
| `dist/standalone/sd-expression-engine.js`, `.min.js` (+ `.map`) | UMD: CommonJS, AMD or the global `SilverDecisions.ExpressionEngine` (an existing `SilverDecisions` object is extended); everything bundled |

The plain files carry an inline source map, the minified ones a `.map` file.

Runtime requirements: Math.js 13+ requires ES2020 and `BigInt` (Chrome and Edge 80+,
Firefox 74+, Safari 14+ from the ES2020 features used, not tested in those
browsers; no Internet Explorer). The package sources compile to
ES5; the bundles and consumer bundles contain Math.js as published (ES2020).
Releases up to 0.1.17 (Math.js 9.5.0) ran on ES5 engines.

## Development

Node 24 (`.nvmrc`); CI runs Node 22 and 24 on Linux and a build smoke test on
Windows. Math.js is pinned to an exact version (15.2.0).

```bash
npm ci
npm run build        # dist/ with Rollup (rollup.config.mjs), ~2 min (terser on the large bundles)
npm test             # contract tests on the sources (browserify + transform), Jasmine specs in Node
npm run test:dist    # contract tests on the four bundles in dist/ (after npm run build)
npm run test:baseline  # the committed dist/ (0.1.17 build) against the 0.1.17 contract
npm run test:build   # isolated build check, see scripts/check-build.js
```

`npm run build` rewrites the committed `dist/`; build in a copy (or use
`npm run test:build`) unless you are preparing a release.

Build: Rollup bundles CommonJS modules; the sources of this package, sd-utils
and sd-random are compiled first by `scripts/browserify-transform.mjs` with the
Babel 7 options of their own `browserify.transform` field and CommonJS modules,
exactly as babelify compiles them for consumers, so the module interop
(`src/mathjs.js` sets `module.exports`, `import * as math`) is Babel's.
Compilation target of the package sources: ES5 syntax (`@babel/preset-env`
without targets, no browserslist config); class fields are assignments (Babel 6
`transform-class-properties`). Math.js (`lib/cjs`, through its `require`
export condition, as browserify resolves `main`) and its dependencies are
bundled as published, not compiled; the `browser` fields are honoured
(decimal.js, seedrandom without Node's `crypto`). The Babel 6 plugins are kept
for compatibility with the consumers' transform; a migration of that
configuration (and Babel 8) is a separate task.

`npm run test:build` (`scripts/check-build.js`): copy of the working tree,
`npm ci`, build without warnings, the six artifacts exist and the bundles parse
as ES2020 (the package sources compiled by a consumer as ES5), source maps are valid JSON with `sources`/`sourcesContent` and map a known
statement back to `src/expression-engine.js`, nothing changed outside `dist/`,
contract tests on the four fresh bundles and the sources, Jasmine specs,
`npm pack` installed into an empty browserify 17 + babelify 10 consumer (contract
tests on its bundle of `require('sd-expression-engine')` and on the installed
`dist/` bundles), and a syntax error in the sources fails the build with exit
code 1 and a diagnostic naming the file and line. Options: `--keep`,
`--skip-consumer`, `--sd-utils=<.tgz>`, `--sd-random=<.tgz>` (unreleased
dependencies, installed with `--no-save`).

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
`SD_EXPRESSION_ENGINE_BASELINE=<release>` (`0.1.17`) tests built artifacts of
that release against its contract: the Math.js version it contains (9.5.0) and
the version-dependent expectations; without it the current contract applies
(Math.js of `package.json`) and a bundle with another Math.js version fails.

```bash
npm test                                   # the sources (target source), then Jasmine
node test/contract/run.js                  # all five targets on ./dist and the sources
npm run test:baseline                      # committed dist/ against the 0.1.17 contract
SD_EXPRESSION_ENGINE_TARGET=module node --test test/contract/   # one target
node test/contract/run.js --targets=module,source
node test/contract/run.js --dist=<dir>     # another dist/ directory
npm run test:published                     # the bundles of sd-expression-engine@0.1.17 from npm (0.1.17 contract)
npx jasmine --config=test/jasmine.json     # the Jasmine specs (test/specs) in Node
```

The committed `dist/` is the 0.1.17 release build (gulp/browserify, Math.js
9.5.0) until the next release: `npm run test:baseline` tests it against the
0.1.17 contract (CI does so as well), `npm test` the current sources and
`npm run test:build` a fresh build. Tests whose expectation depends on the Math.js
version (`test/contract/mathjs-version.test.js`, `[version difference]`) assert
both versions explicitly. The Jasmine specs compile the sources with `@babel/register`
(`test/jasmine-babel.js`) and run in Node; the bundles are not run in a real
browser or Web Worker by these tests (see the integration notes of the PRs).

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
- `median` and `std` do not accept Fractions (`number` config).
- An expression can change the shared Math.js configuration for all later
  evaluations (`config({number: "BigNumber"})`).
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
