# Math.js 9.5.0 → 15.2.0: behaviour changes and old diagrams

Status: proposal for decision. Nothing of the handling of old diagrams below
is implemented; the engine (PR "upgrade Math.js to 15.2.0") only makes the
differences explicit in `test/contract/mathjs-version.test.js` (`DIFFERENCES`,
the complete list of reproduced cases, asserted for both versions).

## Where the differences come from

1. **Math.js itself** (HISTORY.md 10.0 - 15.2, each case reproduced):
   - parser: `%` before a term is modulus and unary percent binds tighter
     (15.0: `100 + 3% + 1` 104 → 100, `x% + 1` 1.02 → 0); `mod` has the
     precedence of `*` and `/` (14.0: `10 / 4 mod 3` 10 → 2.5); implicit
     multiplication after a signed constant division (11.0: `-1 / 2 x` -0.25 →
     -1 for x = 2); empty true branch of `?:` is an error (15.1.1); a delimiter
     after hex/bin/oct literals (15.0);
   - tolerances: comparisons use `relTol` 1e-12 and `absTol` 1e-15 instead of a
     relative 1e-12 and an absolute 2.2e-16 (13.0: `x > 0` for x = 1e-15 true →
     false, `abs(x - 0.3) < 1e-15` for x = 0.1 + 0.2 true → false, `isZero`,
     `isPositive`, `compare`); `isInteger` with tolerance (15.1:
     `isInteger(0.1 * 3 * 10)` false → true); `mod` round-off (11.11.1:
     `0.3 mod 0.1` 0.0999… → -5.6e-17);
   - functions: element-wise `sqrt`/`exp`/`sin`/… of matrices removed (11.0),
     `size` returns an array and subsets keep the shape of the index (15.0),
     `print` uses one-based indices in expressions (11.11.1), `typeOf` of a
     function is `function` (11.0), exact `combinations` (10.2), `mod` with a
     negative divisor (12.1), US liquid units (13.0.3), new functions and
     operators (`??`, `?.`, `isFinite`, `cumsum`, …).
2. **fraction.js 5** (Math.js 14.0): Fractions hold bigint numerators and
   denominators, so they are exact at any size (0.1.17: doubles, exact up to
   2^53); numeric strings keep every digit; the JSON form writes `n` and `d`
   as strings; `valueOf()` overflows for large parts (the engine's `toFloat`
   converts with bigint, correctly rounded); long sums grow without limit (the
   mean of the probabilistic sensitivity analysis, handled in sd-computations).
3. **The engine adapter**: only `toFloat` (bigint conversion) and the rejection
   of Unit results in `toNumber` / `eval(expr, true)` (as in 0.1.17). The
   arithmetic helpers are exact (no rounding policy).

Expressions of the 16 saved diagrams in the test data of SilverDecisions and
sd-computations give the same values in both versions; the differences above
come from constructs those files do not use. Syntax alone does not show all of
them: tolerances, `isInteger`, `mod`, matrix functions depend on the values,
which change with sensitivity analyses and random draws.

## Proposal: old diagrams

### 1. Semantics version of a diagram

- Saved files carry the SilverDecisions version (`"SilverDecisions": "1.2.1"`);
  all releases up to 1.2.x use the engine 0.1.x (Math.js ≤ 9.5). A file without
  the new field below is a **legacy** file.
- New field written on save, e.g. `data.expressionSemantics: "mathjs-15"` (a
  name of the expression semantics, not of the app version, so that a later
  Math.js upgrade can add another one).
- Jobs: sd-computations stores the semantics of the engine in every job
  execution (`expressionSemantics: "mathjs-<major>"`; records without it are
  Math.js 9) and continues a stopped job only under the semantics it was
  started with; otherwise the old job is kept and a new one starts from the
  beginning (sd-computations `fix/job-resume-semantics`).

### 2. Classification on opening a legacy file (before any recomputation)

Every expression (global code, node code, payoffs, probabilities, text
templates with `math(...)`) is parsed with the **legacy parser** (Math.js 9.5
`parse`, a separate bundle loaded only for legacy files) and with the current
parser.

- **S, syntax only** (precedence of `%`/`mod`, unary percent, implicit
  multiplication): migratable. The legacy tree printed with all parentheses
  (`node.toString({parenthesis: 'all', implicit: 'show'})`) is parsed by the
  current parser; the migration is offered only if the two trees are
  structurally equal (node types, operators, names, constants). Expressions that
  parse to equal trees in both versions need no change.
- **F, changed functions** (matrix element-wise functions, `size`, matrix
  indexing, `print`, `typeOf`, `mod`, `isInteger`, `combinations`, units, …):
  found by the names in the tree; not migrated automatically (the result
  depends on the argument values and types).
- **T, tolerance-dependent** (`==`, `!=`, `<`, `<=`, `>`, `>=`, `compare`,
  `equal`, `larger`, `smaller`, `isZero`, `isPositive`, `isNegative`, `sign`):
  value-dependent. Option T1 (engine-wide): keep the 0.1.17 comparisons by
  creating Math.js with `absTol: Number.EPSILON` — reproduced: it restores
  every comparison case of the table (not `isInteger`, `mod`, `floor`/`ceil`).
  Option T2: no change, flag as F.
- Parse errors in one version only (`c ? : b`, `??`, …) are reported.

### 3. Dynamic check (value-dependent differences)

For a legacy file the base case is evaluated with both engines (legacy bundle
and current) and all values are compared: diagram and node scopes, payoffs,
probabilities, the computed values of the current rule, interpolated texts.
This finds differences the syntax cannot show (a comparison at 1e-15, an
`isInteger` of a computed value). It covers the evaluated values only: a
sensitivity analysis or random draws can reach other values, so expressions of
class F/T stay flagged even when the base case is equal.

### 4. Before recomputation

The file is shown with its saved computed values (marked as computed by
SilverDecisions x.y), not recomputed, until the user decides:

- nothing found (no S/F/T findings, equal base case): open normally, mark as
  current semantics on the next save;
- only S: offer the migration (list old and new text of each expression), then
  recompute;
- F/T findings or base-case differences: a report (node, field, expression,
  value with 0.1.x, value now); choices: migrate S and accept the new
  behaviour for the rest, keep the file read-only, or cancel. No silent
  recomputation.

### 5. No repeated warnings

Accepting writes `expressionSemantics` (and e.g. `migratedFrom: "1.2.1"`) into
the diagram; the next save stores it and later openings do not warn. Without a
save the warning appears again (the file is still legacy). Jobs: results of
jobs completed by 0.1.x are data and are shown as they are; a re-run uses the
semantics of the current data model; a job stopped by 0.1.x is not continued
(section 1).

### Costs and open points

- The legacy parser bundle (Math.js 9.5) is loaded only for legacy files; size
  and whether `parse` can be bundled without the rest of Math.js 9 are to be
  measured.
- Templates of texts (`${...}`, lodash templates with `math("...")`) need a
  parser of their own to find the expressions.

## Decisions needed

1. Runtime requirement ES2020 + BigInt (Math.js ≥ 13).
2. Comparisons: T1 (keep the 0.1.17 tolerances with `absTol: Number.EPSILON`)
   or the Math.js 13+ tolerances.
3. Handling of legacy diagrams (sections 1-5) or an alternative, before a
   SilverDecisions release with Math.js 15.
4. JSON form of Fractions with string `n` / `d` in the job repository (read
   back from 0.1.17 records works, the reverse does not).
