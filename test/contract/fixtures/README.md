# Contract test fixtures

Diagram files saved by released SilverDecisions versions, copied unchanged. Each
file contains the values the saving release computed (`computed.payoff`,
`computed.probability` of every edge); the tests evaluate the expressions of the
file again and compare with those values (`helpers.js` `evaluateDiagram`).

| File | Saved by | Source | Contents |
|---|---|---|---|
| `variables_pass.json` | SilverDecisions 0.5.2 | SilverDecisions `2f7735166d427fca4411a76da2e5f07d0cc46d8d` `test/trees/variables_pass.json` | model at the top level (pre-0.6 format), global code `p = random()`, node code overriding variables, payoffs with `#` comments |
| `rockefellerWithParams.json` | SilverDecisions 0.7.0 | sd-computations `5bcba47b588b62e541e1f4a932d8a98b5990686e` `test/trees/rockefellerWithParams.json` | global code with `random(0.1, 0.9)`, node code, computed values as mixed numbers with large denominators (`575 878291371642703/3279115770832143`) |
| `treatments.json` | SilverDecisions 0.9.0 | sd-computations `5bcba47…` `test/trees/treatments.json` | two payoffs per edge (multiple criteria), decimal payoffs (`2.75`) |
| `payofftransform_pass.json` | SilverDecisions 1.2.0 | sd-computations `5bcba47…` `test/trees/payofftransform_pass.json` | a function defined in node code (`transformPayoff(p) = p^2/2`), two payoffs |

Normalization: global code that calls `random()` cannot be repeated, so for such
files the saved `expressionScope` (the result of that code when the file was
saved) is used as the diagram scope instead of evaluating the code again. No
other value is changed or recomputed from the current implementation.

`tofloat_cases.json` (not a diagram): Fractions and the correctly rounded double
of each (ties to even, subnormals, overflow, random large Fractions), generated
with Python's `fractions.Fraction` by `tofloat_cases.py`; regenerate with
`python3 -I test/contract/fixtures/tofloat_cases.py > test/contract/fixtures/tofloat_cases.json`.
