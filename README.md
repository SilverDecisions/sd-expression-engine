# sd-expression-engine
SilverDecisions expression engine module: evaluation of the expressions of
SilverDecisions diagrams with [Math.js](https://mathjs.org/) 9.5.0, exact
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

## Development

Node 24 (`.nvmrc`); CI runs Node 22 and 24 on Linux and a build smoke test on
Windows. Math.js is pinned to exactly 9.5.0.

```bash
npm ci
npm run build        # dist/ with Rollup (rollup.config.mjs), ~2 min (terser on the large bundles)
npm test             # contract tests on dist/ and the sources, Jasmine specs in Node
npm run test:build   # isolated build check, see scripts/check-build.js
```

`npm run build` rewrites the committed `dist/`; build in a copy (or use
`npm run test:build`) unless you are preparing a release.

Build: Rollup bundles CommonJS modules; the sources of this package, sd-utils
and sd-random are compiled first by `scripts/browserify-transform.mjs` with the
Babel 7 options of their own `browserify.transform` field and CommonJS modules,
exactly as babelify compiles them for consumers, so the module interop
(`src/mathjs.js` sets `module.exports`, `import * as math`) is Babel's.
Compilation target: ES5 syntax (`@babel/preset-env` without targets, no
browserslist config); class fields are assignments (Babel 6
`transform-class-properties`). Math.js (`lib/cjs`, through its `require`
export condition, as browserify resolves `main`) and its dependencies are
bundled as published, not compiled; the `browser` fields are honoured
(decimal.js, seedrandom without Node's `crypto`). The Babel 6 plugins are kept:
the `browserify.transform` field of sd-utils 0.1.15 names them, and the build,
the specs and the consumers compile sd-utils with it. A migration of these
fields (and Babel 8) is a separate task.

The bundled versions come from `package-lock.json`. A fresh install of the
package resolves the Math.js dependencies from the ranges of Math.js 9.5.0 and
can get newer ones (complex.js 2.4 is not ES5); `npm run test:build` reports
their syntax for its consumer install.

`npm run test:build` (`scripts/check-build.js`): copy of the working tree,
`npm ci`, build without warnings, the six artifacts exist and the bundles are
ES5, source maps are valid JSON with `sources`/`sourcesContent` and map a known
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

For the `module` targets `test/contract/bundle-isolation.test.js` loads the module bundle as a script into a fresh
global scope and checks that it adds only `require`, keeps its exports and
cache when another `require` bundle is loaded after it, passes other names
along the `require` chain (`MODULE_NOT_FOUND` for unknown ones) and evaluates
the module on the first `require`.
`npm run test:bundle-set` (`test/bundle-set`) loads the module bundles of
sd-utils, sd-random, sd-model and this package, plain and minified, into one
global scope in all load orders and uses each library; `--sd-utils=`,
`--sd-random=`, `--sd-model=`, `--sd-expression-engine=` take a `dist/`
directory, a tarball or `published[@version]` (defaults: the installed
sd-utils / sd-random, the published sd-model, `./dist`). `npm run test:build`
runs it on the fresh build (`--sd-model=<.tgz>` for an unreleased sd-model).

```bash
npm test                                   # all five targets on ./dist and the sources, then Jasmine
SD_EXPRESSION_ENGINE_TARGET=module node --test test/contract/   # one target
node test/contract/run.js --targets=module,source
node test/contract/run.js --dist=<dir>     # another dist/ directory
npm run test:published                     # the bundles of sd-expression-engine@0.1.17 from npm
npm run test:bundle-set                    # the four module bundles in one global scope
npx jasmine --config=test/jasmine.json     # the Jasmine specs (test/specs) in Node
```

The committed `dist/` is the 0.1.17 release build (gulp/browserify): `npm test`
on a fresh checkout tests it (CI does so as well), `npm run test:build` tests a
fresh build. The Jasmine specs compile the sources with `@babel/register`
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
