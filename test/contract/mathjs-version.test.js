// Contract points that depend on the Math.js version (0.1.17 / Math.js 9.5.0 and
// the current Math.js of package.json): precision of the arithmetic helpers
// against exact rational arithmetic, numbers of large Fractions, Units and the JSON form of 0.1.17, and
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
const B = v => BigInt(v);
const babs = v => (v < B(0) ? -v : v);
function rational(f) {
    const m = /^(-?)(\d+)(?:\/(\d+))?$/.exec(f.toFraction(false));
    return {n: B(m[1] + m[2]), d: B(m[3] || 1)};
}
function addRational(a, b) {
    return {n: a.n * b.d + b.n * a.d, d: a.d * b.d};
}
// correctly rounded double of n/d: 25 significant decimal digits, parsed by Number()
function rationalToFloat(r) {
    if (r.n === B(0)) {
        return 0;
    }
    const sign = (r.n < B(0)) !== (r.d < B(0)) ? '-' : '';
    const n = babs(r.n), d = babs(r.d);
    let k = 25 - (n.toString().length - d.toString().length);
    const q = k >= 0 ? (n * B(10) ** B(k)) / d : n / (d * B(10) ** B(-k));
    return Number(sign + q.toString() + 'e' + (-k));
}
function relativeError(value, reference) {
    return reference === 0 ? Math.abs(value) : Math.abs(value - reference) / Math.abs(reference);
}
// deterministic generator of bigints with up to `bits` bits
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

test('arithmetic helpers keep small values (regressions of a denominator bound)', () => {
    // 0.1.17 gives these exactly; an absolute bound of the denominator turned them into 0
    assert.equal(ExpressionEngine.toFloat(ExpressionEngine.divide(1, 1e20)), 1e-20);
    assert.equal(ExpressionEngine.toFloat(ExpressionEngine.add('1/100000000000000000000', 0)), 1e-20);
    assertFraction(ExpressionEngine.multiply(ExpressionEngine.divide(1, 1e20), 1e20), '1');
    assertFraction(ExpressionEngine.divide(1, 1e20), '1/100000000000000000000');
    // [version difference] fraction.js 4 stores 10^20 + 1 as the double 10^20, so 0.1.17 gives 0
    assertFraction(ExpressionEngine.subtract('1/100000000000000000000', '1/100000000000000000001'),
        legacy ? '0' : '1/10000000000000000000100000000000000000000');
});

test('arithmetic helpers: the mean of many evaluated payoffs (probabilistic sensitivity analysis) stays bounded and accurate', () => {
    // sd-computations 0.6.1 prob-calculate-step: expectedValue = add(expectedValue, divide(payoff, numberOfRuns))
    let seed = 42;
    const draw = () => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
    };
    const runs = 500;
    let mean = N(0);
    let exact = {n: B(0), d: B(1)};
    for (let i = 0; i < runs; i++) {
        const payoff = ExpressionEngine.eval('2500 * pr - 250 * (1 - pr)', true, {pr: 0.1 + 0.8 * draw()});
        mean = ExpressionEngine.add(mean, ExpressionEngine.divide(payoff, runs));
        const p = rational(payoff);
        exact = addRational(exact, {n: p.n, d: p.d * B(runs)});
    }
    const value = ExpressionEngine.toFloat(mean);
    const reference = rationalToFloat(exact);
    if (legacy) {
        // fraction.js 4: doubles, each of the 1000 operations off by up to 2^-52
        assert.ok(String(mean.d).length <= 16, 'denominator ' + String(mean.d));
        assert.ok(relativeError(value, reference) < 1e-12, value + ' vs ' + reference);
    } else {
        // exact while numerator and denominator have <= 64 bits, otherwise rounded with a
        // relative error below 2^-64: 1000 * 5.4e-20 = 5.4e-17, plus 1 ulp (2.2e-16) of toFloat
        assert.ok(String(mean.d).length <= 20, 'denominator ' + String(mean.d));
        assert.ok(relativeError(value, reference) <= 4.5e-16, value + ' vs ' + reference);
    }
});

test('arithmetic helpers: random operands of 1e-30 to 1e30 against exact rational arithmetic', {skip: legacy && 'Math.js 9.5.0: the operands (up to 160-bit integers) are not representable in fraction.js 4'}, () => {
    const g = generator(7);
    const ops = {
        add: (a, b) => ({n: a.n * b.d + b.n * a.d, d: a.d * b.d}),
        subtract: (a, b) => ({n: a.n * b.d - b.n * a.d, d: a.d * b.d}),
        multiply: (a, b) => ({n: a.n * b.n, d: a.d * b.d}),
        divide: (a, b) => ({n: a.n * b.d, d: a.d * b.n})
    };
    const operand = () => {
        // p/q * 10^k with 1-80 bit p and q
        const k = g.int(61) - 30;
        let n = g.big(1 + g.int(80)), d = g.big(1 + g.int(80));
        if (k >= 0) {
            n *= B(10) ** B(k);
        } else {
            d *= B(10) ** B(-k);
        }
        if (g.int(2)) {
            n = -n;
        }
        return {n, d};
    };
    let worst = 0;
    for (let i = 0; i < 2000; i++) {
        const a = operand(), b = operand();
        for (const [name, op] of Object.entries(ops)) {
            const r = ExpressionEngine[name](fraction(a.n, a.d), fraction(b.n, b.d));
            const e = op(a, b);
            // relative error of the Fraction itself, computed exactly: |r - e| / |e|
            const x = rational(r);
            const errN = babs(x.n * e.d - e.n * x.d);
            const errD = babs(x.d * e.n);
            if (errN !== B(0)) {
                // <= 2^-64 (with the sign of e.n accounted for by babs)
                assert.ok((errN << B(64)) <= errD, name + ' relative error above 2^-64');
                worst = Math.max(worst, rationalToFloat({n: errN, d: errD}));
            }
            assert.notEqual(x.n === B(0), e.n !== B(0) ? true : false, name + ' kept a non-zero result non-zero');
        }
    }
    assert.ok(worst <= Math.pow(2, -64));
});

test('arithmetic helpers: a positive sum of 300 terms between 1e-25 and 1e25', {skip: legacy && 'Math.js 9.5.0: see the previous test'}, () => {
    const g = generator(11);
    let sum = N(0);
    let exact = {n: B(0), d: B(1)};
    for (let i = 0; i < 300; i++) {
        const k = g.int(51) - 25;
        let n = g.big(30), d = g.big(30);
        if (k >= 0) {
            n *= B(10) ** B(k);
        } else {
            d *= B(10) ** B(-k);
        }
        sum = ExpressionEngine.add(sum, fraction(n, d));
        exact = addRational(exact, {n, d});
    }
    // 300 roundings of at most 2^-64 each (no cancellation), plus 1 ulp of toFloat
    assert.ok(relativeError(ExpressionEngine.toFloat(sum), rationalToFloat(exact)) <= 4.5e-16);
});

test('arithmetic helpers: small results stay exact', () => {
    assertFraction(ExpressionEngine.add('1/3', '1/6'), '1/2');
    assertFraction(ExpressionEngine.divide(ExpressionEngine.subtract(1, '1/7'), 3), '2/7');
    assertFraction(ExpressionEngine.multiply('2/3', '3/4'), '1/2');
    const limit = String(Number.MAX_SAFE_INTEGER);
    assertFraction(ExpressionEngine.add('1/' + limit, 0), '1/' + limit);
});

test('toFloat of Fractions beyond the double range of numerator or denominator', {skip: legacy && 'Math.js 9.5.0: fraction.js 4 holds no bigint Fractions'}, () => {
    const ten = B(10), two = B(2);
    // not reducible: the quotient is in the double range, numerator or denominator is not
    const cases = [
        [ten ** B(310) + B(1), B(1009)],                       // 9.9108e306
        [two ** B(1200) + B(1), two ** B(2200) + B(1)],        // 9.3326e-302
        [-(ten ** B(400) + B(7)), B(3) * ten ** B(400) + B(1)], // -1/3
        [ten ** B(400) + B(1), B(3)],                          // Infinity
        [B(1), ten ** B(400) + B(3)],                          // 0 (below the double range)
        [B(7), two ** B(1074) + B(1)]                          // subnormal
    ];
    for (const [n, d] of cases) {
        const value = ExpressionEngine.toFloat(fraction(n, d));
        const reference = rationalToFloat({n, d});
        assert.ok(value === reference || relativeError(value, reference) <= Math.pow(2, -52) ||
            Math.abs(value - reference) <= Number.MIN_VALUE, n.toString().slice(0, 12) + '... / ' + d.toString().slice(0, 12) + '...: ' + value + ' vs ' + reference);
    }
    // random non-reducing pairs with up to 2000 bits, quotients across the double range
    const g = generator(3);
    for (let i = 0; i < 500; i++) {
        const n = g.big(1 + g.int(2000)), d = g.big(1 + g.int(2000));
        const value = ExpressionEngine.toFloat(fraction(n, d));
        const reference = rationalToFloat({n, d});
        assert.ok(value === reference || relativeError(value, reference) <= Math.pow(2, -52) ||
            Math.abs(value - reference) <= Number.MIN_VALUE, value + ' vs ' + reference);
    }
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
