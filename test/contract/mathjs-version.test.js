// Contract points that depend on the Math.js version (0.1.17 / Math.js 9.5.0 and
// the current Math.js of package.json): bounded Fractions in the arithmetic
// helpers, numbers of large Fractions, Units and the JSON form of 0.1.17, and
// the documented behaviour changes of Math.js 10-15 for user expressions.
// Version differences are asserted explicitly for both versions (no skip);
// mathjsMajor is the major version the tested artifact must contain (load.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {ExpressionEngine, mathjsMajor} = require('./load');
const {assertFraction} = require('./helpers');

const N = ExpressionEngine.toNumber;
const legacy = mathjsMajor < 14; // Math.js 9.5.0 of 0.1.17

// exact rational arithmetic with bigint, independent of Math.js / fraction.js
function rational(f) {
    const m = /^(-?)(\d+)(?:\/(\d+))?$/.exec(f.toFraction(false));
    return {n: BigInt(m[1] + m[2]), d: BigInt(m[3] || 1)};
}
function addRational(a, b) {
    return {n: a.n * b.d + b.n * a.d, d: a.d * b.d};
}
function rationalToFloat(r) {
    // enough digits for a double: scale to 30 significant digits
    const scale = BigInt(10) ** BigInt(30);
    return Number((r.n * scale) / r.d) / 1e30;
}

test('arithmetic helpers keep Fractions bounded: the mean of many evaluated payoffs (probabilistic sensitivity analysis)', () => {
    // sd-computations 0.6.1 prob-calculate-step: expectedValue = add(expectedValue, divide(payoff, numberOfRuns))
    let seed = 42;
    const draw = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const runs = 500;
    let mean = N(0);
    let exact = {n: BigInt(0), d: BigInt(1)};
    for (let i = 0; i < runs; i++) {
        const payoff = ExpressionEngine.eval('2500 * pr - 250 * (1 - pr)', true, {pr: 0.1 + 0.8 * draw()});
        const share = ExpressionEngine.divide(payoff, runs);
        mean = ExpressionEngine.add(mean, share);
        const p = rational(payoff);
        exact = addRational(exact, {n: p.n, d: p.d * BigInt(runs)});
    }
    // Math.js 9.5.0 keeps numerator and denominator as JS numbers; the current
    // engine rounds results with a denominator above 2^53 - 1 to the closest
    // fraction with a smaller denominator. Either way 16 digits at most.
    assert.ok(String(mean.d).length <= 16, 'denominator ' + String(mean.d));
    const value = ExpressionEngine.toFloat(mean);
    const reference = rationalToFloat(exact);
    assert.ok(Number.isFinite(value), String(value));
    // each of the 2 * 500 rounded operations is off by at most about 2^-52 of the
    // value, which stays below 500 * 2.2e-16 * 2 = 2.2e-13 relative; 1e-12 leaves
    // room for the conversions of the payoffs
    assert.ok(Math.abs(value - reference) / Math.abs(reference) < 1e-12, value + ' vs ' + reference);
});

test('arithmetic helpers: small results stay exact', () => {
    assertFraction(ExpressionEngine.add('1/3', '1/6'), '1/2');
    assertFraction(ExpressionEngine.divide(ExpressionEngine.subtract(1, '1/7'), 3), '2/7');
    assertFraction(ExpressionEngine.multiply('2/3', '3/4'), '1/2');
    // denominator 2^53 - 1 is kept as it is
    const limit = String(Number.MAX_SAFE_INTEGER);
    assertFraction(ExpressionEngine.add('1/' + limit, 0), '1/' + limit);
});

test('toFloat of a Fraction beyond the double range of numerator and denominator', {skip: legacy && 'Math.js 9.5.0: fraction.js 4 holds no bigint Fractions'}, () => {
    // built through the reviver (toNumber of such a string would stop at its parseFloat Infinity check)
    const reviver = new ExpressionEngine().getJsonReviver();
    const fraction = (n, d) => JSON.parse(JSON.stringify({mathjs: 'Fraction', n, d}), reviver);
    const zeros = '0'.repeat(400);
    assert.equal(ExpressionEngine.toFloat(fraction('1' + zeros, '3' + zeros)), 1 / 3);
    assert.equal(ExpressionEngine.toFloat(fraction('-2' + zeros, '3' + zeros)), -2 / 3);
    assert.equal(ExpressionEngine.toFloat(fraction('1' + zeros, '3')), Infinity);
});

test('the JSON form written by 0.1.17 (numbers) is revived exactly', () => {
    const reviver = new ExpressionEngine().getJsonReviver();
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

// Behaviour changes of Math.js for user expressions (Math.js HISTORY.md), asserted
// for both versions. Changing the meaning of accepted expressions is a decision of
// the product owner; the upgrade PR lists them.
test('[version difference] implicit multiplication after a division with a negative constant numerator (Math.js 11)', () => {
    assertFraction(ExpressionEngine.eval('-1 / 2 x', true, {x: 2}), legacy ? '-1/4' : '-1');
    // unchanged
    assertFraction(ExpressionEngine.eval('1 / 2 x', true, {x: 2}), '1');
    assertFraction(ExpressionEngine.eval('-1 / (2 x)', true, {x: 2}), '-1/4');
});

test('[version difference] element-wise sqrt, exp, sin of matrices (removed in Math.js 11)', () => {
    if (legacy) {
        assert.deepEqual(ExpressionEngine.eval('sqrt([4, 9])', false).toArray(), [2, 3]);
    } else {
        assert.throws(() => ExpressionEngine.eval('sqrt([4, 9])', false));
    }
    assert.deepEqual(ExpressionEngine.eval('map([4, 9], sqrt)', false).toArray(), [2, 3]);
});

test('[version difference] mod with a negative divisor, empty true branch of ?:, size(), new operators', () => {
    if (legacy) {
        assert.throws(() => ExpressionEngine.eval('10 mod -3', false), /negative divisor/);
        assert.equal(ExpressionEngine.eval('1 ? : 2', false), 1);
        assert.equal(ExpressionEngine.eval('size([1, 2, 3])', false).isMatrix, true);
        assert.equal(ExpressionEngine.validate('a ?? 1'), false);
    } else {
        assert.equal(ExpressionEngine.eval('10 mod -3', false), -2);
        assert.throws(() => ExpressionEngine.eval('1 ? : 2', false), SyntaxError);
        assert.deepEqual(ExpressionEngine.eval('size([1, 2, 3])', false), [3]);
        assert.equal(ExpressionEngine.eval('a ?? 1', false, {a: null}), 1);
    }
});

test('[version difference] integers beyond 2^53 in numeric strings', () => {
    // toNumber reads the string itself: fraction.js 5 (bigint) keeps every digit
    assertFraction(ExpressionEngine.eval('9007199254740993'), legacy ? '9007199254740992' : '9007199254740993');
    // expressions are still evaluated with JS numbers
    assert.equal(ExpressionEngine.eval('2^53 + 1', false), 9007199254740992);
});
