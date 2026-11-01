// Contract points that depend on the Math.js version (0.1.17 / Math.js 9.5.0 and
// the current Math.js of package.json): exact Fraction arithmetic, toFloat,
// Units and the JSON form of 0.1.17, and the behaviour changes of Math.js 10-15
// for user expressions. Version differences are asserted explicitly for both
// versions; mathjsMajor is the major version the tested artifact must contain
// (load.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {ExpressionEngine, mathjsMajor} = require('./load');
const {assertFraction} = require('./helpers');

const N = ExpressionEngine.toNumber;
const legacy = mathjsMajor < 14; // Math.js 9.5.0 of 0.1.17
const B = v => BigInt(v);
const babs = v => (v < B(0) ? -v : v);

// exact rational arithmetic with bigint, independent of Math.js / fraction.js
function rational(f) {
    const m = /^(-?)(\d+)(?:\/(\d+))?$/.exec(f.toFraction(false));
    return {n: B(m[1] + m[2]), d: B(m[3] || 1)};
}
function sameRational(a, b) {
    return a.n * b.d === b.n * a.d;
}
// approximate double of n/d from 25 significant decimal digits (relative error
// below 1e-24); NOT correctly rounded, used only with tolerances
function approxFloat(r) {
    if (r.n === B(0)) {
        return 0;
    }
    const sign = (r.n < B(0)) !== (r.d < B(0)) ? '-' : '';
    const n = babs(r.n), d = babs(r.d);
    const k = 25 - (n.toString().length - d.toString().length);
    const q = k >= 0 ? (n * B(10) ** B(k)) / d : n / (d * B(10) ** B(-k));
    return Number(sign + q.toString() + 'e' + (-k));
}
// deterministic generator of positive odd bigints with up to `bits` bits
function generator(seed) {
    let s = seed >>> 0;
    const next = () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = Math.imul(s ^ (s >>> 15), s | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0);
    };
    return {
        int: (max) => next() % max,
        big: (bits) => {
            let v = B(0);
            for (let i = 0; i < bits; i += 32) {
                v = (v << B(32)) | B(next());
            }
            return (v >> B(Math.max(0, Math.ceil(bits / 32) * 32 - bits))) | B(1);
        }
    };
}
const reviver = new ExpressionEngine().getJsonReviver();
const fraction = (n, d) => JSON.parse(JSON.stringify({mathjs: 'Fraction', n: String(n), d: String(d)}), reviver);

test('arithmetic helpers: x + 0 equals x (exact arithmetic, regression of a rounding policy)', () => {
    const x = N('1208925819614629174706176/3'); // 2^80 / 3
    const y = ExpressionEngine.add(x, 0);
    assert.equal(Number(ExpressionEngine.compare(x, y)), 0);
    assertFraction(ExpressionEngine.subtract(y, x), '0');
});

test('arithmetic helpers keep small values', () => {
    assert.equal(ExpressionEngine.toFloat(ExpressionEngine.divide(1, 1e20)), 1e-20);
    assert.equal(ExpressionEngine.toFloat(ExpressionEngine.add('1/100000000000000000000', 0)), 1e-20);
    assertFraction(ExpressionEngine.multiply(ExpressionEngine.divide(1, 1e20), 1e20), '1');
    assertFraction(ExpressionEngine.divide(1, 1e20), '1/100000000000000000000');
    // [version difference] fraction.js 4 stores 10^20 + 1 as the double 10^20, so 0.1.17 gives 0
    assertFraction(ExpressionEngine.subtract('1/100000000000000000000', '1/100000000000000000001'),
        legacy ? '0' : '1/10000000000000000000100000000000000000000');
});

test('arithmetic helpers are exact: random operands of 1e-30 to 1e30 against bigint rational arithmetic', {skip: legacy && 'Math.js 9.5.0: fraction.js 4 keeps numerator and denominator as doubles (not exact beyond 2^53)'}, () => {
    const g = generator(7);
    const ops = {
        add: (a, b) => ({n: a.n * b.d + b.n * a.d, d: a.d * b.d}),
        subtract: (a, b) => ({n: a.n * b.d - b.n * a.d, d: a.d * b.d}),
        multiply: (a, b) => ({n: a.n * b.n, d: a.d * b.d}),
        divide: (a, b) => ({n: a.n * b.d, d: a.d * b.n})
    };
    const operand = () => {
        const k = g.int(61) - 30;
        let n = g.big(1 + g.int(80)), d = g.big(1 + g.int(80));
        if (k >= 0) {
            n *= B(10) ** B(k);
        } else {
            d *= B(10) ** B(-k);
        }
        return {n: g.int(2) ? -n : n, d};
    };
    for (let i = 0; i < 1000; i++) {
        const a = operand(), b = operand();
        for (const [name, op] of Object.entries(ops)) {
            const r = rational(ExpressionEngine[name](fraction(a.n, a.d), fraction(b.n, b.d)));
            assert.ok(sameRational(r, op(a, b)), name + ' is exact');
        }
    }
});

test('arithmetic helpers: the mean of many evaluated payoffs (probabilistic sensitivity analysis)', () => {
    // sd-computations 0.6.1 prob-calculate-step: expectedValue = add(expectedValue, divide(payoff, numberOfRuns))
    let seed = 42;
    const draw = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const runs = 100;
    let mean = N(0);
    let exact = {n: B(0), d: B(1)};
    for (let i = 0; i < runs; i++) {
        const payoff = ExpressionEngine.eval('2500 * pr - 250 * (1 - pr)', true, {pr: 0.1 + 0.8 * draw()});
        mean = ExpressionEngine.add(mean, ExpressionEngine.divide(payoff, runs));
        const p = rational(payoff);
        exact = {n: exact.n * p.d * B(runs) + p.n * exact.d, d: exact.d * p.d * B(runs)};
    }
    if (legacy) {
        // fraction.js 4: doubles, every operation rounds (up to 2^-52 relative)
        assert.ok(String(mean.d).length <= 16, 'denominator ' + String(mean.d));
        assert.ok(Math.abs(ExpressionEngine.toFloat(mean) - approxFloat(exact)) / approxFloat(exact) < 1e-12);
    } else {
        // fraction.js 5: exact; the size grows with the number of runs (hundreds of
        // digits here, thousands for 1000 runs): the aggregation in sd-computations
        // has to bound it
        assert.ok(sameRational(rational(mean), exact));
        assert.ok(String(mean.d).length > 100, 'denominator digits ' + String(mean.d).length);
        assert.ok(Math.abs(ExpressionEngine.toFloat(mean) - approxFloat(exact)) / approxFloat(exact) < 1e-15);
    }
});

// toFloat contract: the double nearest to the Fraction, ties to even (IEEE 754
// round-to-nearest), also for subnormal results and with overflow to
// +-Infinity. Reference: fixtures/tofloat_cases.json, generated with Python's
// fractions.Fraction (fixtures/tofloat_cases.py).
test('toFloat is correctly rounded: ties, both sides of midpoints, subnormals, overflow, random large Fractions', {skip: legacy && 'Math.js 9.5.0: fraction.js 4 holds no bigint Fractions'}, () => {
    const {cases} = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tofloat_cases.json'), 'utf8'));
    const big = h => (h.startsWith('-') ? -BigInt(h.slice(1)) : BigInt(h));
    const double = hex => {
        if (hex === 'Infinity' || hex === '-Infinity') {
            return Number(hex);
        }
        const view = new DataView(new ArrayBuffer(8));
        view.setBigUint64(0, BigInt('0x' + hex));
        return view.getFloat64(0);
    };
    assert.ok(cases.length > 100);
    for (const c of cases) {
        const value = ExpressionEngine.toFloat(fraction(big(c.n), big(c.d)));
        assert.ok(Object.is(value, double(c.expected)), c.note + ': ' + value + ' expected ' + double(c.expected));
    }
});

test('toFloat of small Fractions is the division of their numbers', () => {
    assert.equal(ExpressionEngine.toFloat(N('1/3')), 1 / 3);
    assert.equal(ExpressionEngine.toFloat(N('-7/2')), -3.5);
    assert.equal(ExpressionEngine.toFloat(N('878291371642703/3279115770832143')), 878291371642703 / 3279115770832143);
});

test('the JSON form written by 0.1.17 (numbers) is revived exactly', () => {
    const back = JSON.parse('{"a": {"mathjs": "Fraction", "n": -1, "d": 3}, "b": {"mathjs": "Fraction", "n": 878291371642703, "d": 3279115770832143}}', reviver);
    assertFraction(back.a, '-1/3');
    assertFraction(back.b, '878291371642703/3279115770832143');
});

test('eval with asNumber: a Unit result is rejected', () => {
    for (const expr of ['2 cm + 3 mm', '5 inch to cm', 'unit(5, "m")']) {
        assert.throws(() => ExpressionEngine.eval(expr), TypeError, expr);
        assert.equal(ExpressionEngine.eval(expr, false).isUnit, true, expr);
    }
});

// Behaviour changes of Math.js 10-15 for user expressions (Math.js HISTORY.md,
// each reproduced): [expression, scope, 0.1.17 (Math.js 9.5.0), current], values
// of eval(expr, false), 'error' when it throws. Changing the meaning of accepted
// expressions is a decision of the product owner (docs/MATHJS_UPGRADE.md); these
// tests make every known difference explicit.
const show = v => (v && v.isMatrix ? 'matrix ' + JSON.stringify(v.toArray()) : (Array.isArray(v) ? 'array ' + JSON.stringify(v) : String(v)));
const DIFFERENCES = [
    // 15.0: unary percent decoupled from modulus; `%` followed by a term is modulus
    ['100 + 3% + 1', {}, '104', '100'],
    ['100 * 3% + 1', {}, '4', '0'],
    ['200 * 50% - 1', {}, '99', '0'],
    ['x% + 1', {x: 2}, '1.02', '0'],
    // 14.0: mod has the precedence of * and / (was higher)
    ['10 / 4 mod 3', {}, '10', '2.5'],
    ['10 * 4 mod 3', {}, '10', '1'],
    ['10 / 4 % 3', {}, '10', '2.5'],
    // 11.0: implicit multiplication after a division of constants with a sign
    ['-1 / 2 x', {x: 2}, '-0.25', '-1'],
    ['+1 / 2 x', {x: 2}, '0.25', '1'],
    ['-1 / 2 pi', {}, String(-1 / (2 * Math.PI)), String(-Math.PI / 2)],
    // 13.0: comparisons with absTol 1e-15 and relTol 1e-12 (was epsilon 1e-12 relative, 2.2e-16 absolute)
    ['x > 0', {x: 1e-15}, 'true', 'false'],
    ['x == 0', {x: 5e-16}, 'false', 'true'],
    ['compare(x, 0)', {x: 1e-15}, '1', '0'],
    ['abs(x - 0.3) < 1e-15', {x: 0.1 + 0.2}, 'true', 'false'],
    ['isZero(1e-15)', {}, 'false', 'true'],
    ['isPositive(1e-15)', {}, 'true', 'false'],
    // 15.1: isInteger with tolerance
    ['isInteger(2.00000000000001) ? 100 : 0', {}, '0', '100'],
    ['isInteger(0.1 * 3 * 10)', {}, 'false', 'true'],
    // 11.11.1: mod round-off
    ['0.3 mod 0.1', {}, '0.09999999999999998', '-5.551115123125783e-17'],
    // 12.1: mod with a negative divisor
    ['10 mod -3', {}, 'error', '-2'],
    // 10.2: exact combinations
    ['combinations(60, 30)', {}, '118264581564861420', '118264581564861460'],
    // 11.11.1: print in the parser uses one-based indices
    ['print("$1 $2", [10, 20])', {}, '20 $2', '10 20'],
    // 11.0: typeOf of a function in lower case
    ['typeOf(f)', {f: function () {}}, 'Function', 'function'],
    // 11.0: element-wise functions of matrices removed
    ['sqrt([4, 9])', {}, 'matrix [2,3]', 'error'],
    // 15.1.1: empty true-expression of a conditional
    ['x ? : 1', {x: 2}, '1', 'error'],
    // 15.0: size returns an array, subsets keep the shape of the index
    ['size([1, 2, 3])', {}, 'matrix [3]', 'array [3]'],
    ['[[1, 2], [3, 4]][1, :]', {}, 'matrix [[1,2]]', 'matrix [1,2]'],
    // 13.0.3: US liquid volume units
    ['number(1 gallon, "liter")', {}, '3.785412', '3.785411784'],
    // new syntax (14.8)
    ['a ?? 1', {a: null}, 'error', '1']
];

test('[version difference] Math.js 10-15 behaviour changes of user expressions', () => {
    for (const [expr, scope, before, after] of DIFFERENCES) {
        let actual;
        try {
            actual = show(ExpressionEngine.eval(expr, false, Object.assign({}, scope)));
        } catch (e) {
            actual = 'error';
        }
        assert.equal(actual, legacy ? before : after, expr);
    }
});

test('[version difference] integers beyond 2^53 in numeric strings', () => {
    // toNumber reads the string itself: fraction.js 5 (bigint) keeps every digit
    assertFraction(ExpressionEngine.eval('9007199254740993'), legacy ? '9007199254740992' : '9007199254740993');
    // expressions are still evaluated with JS numbers
    assert.equal(ExpressionEngine.eval('2^53 + 1', false), 9007199254740992);
});

test('unchanged: percent of a single operand, mod alone, implicit multiplication without a sign, rounding', () => {
    for (const [expr, value] of [['100 + 3%', 103], ['3% * 100', 3], ['50% * 2', 1], ['7 % 3', 1], ['1 / 2 x', 1], ['2 x', 4],
        ['0.1 + 0.2 == 0.3', true], ['round(1.005, 2)', 1.01], ['round(-2.5)', -3], ['floor(2.9999999999999996)', 3]]) {
        assert.equal(ExpressionEngine.eval(expr, false, {x: 2}), value, expr);
    }
});
