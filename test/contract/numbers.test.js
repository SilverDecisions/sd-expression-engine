// Contract of the number helpers: Fraction conversion, exact arithmetic,
// comparison with ±Infinity, rounding, statistics, format/print and the small
// predicates used by validators. Expected values are exact rational results
// (or, for the statistics of JS numbers, the closed-form values given below).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {ExpressionEngine} = require('./load');
const {assertFraction, knownBug} = require('./helpers');

const N = ExpressionEngine.toNumber;

test('toNumber: Fractions from numbers, fraction / decimal strings and Fractions; ±Infinity stays a number', () => {
    assertFraction(N(5), '5');
    assertFraction(N(0), '0');
    assertFraction(N(-0.75), '-3/4');
    assertFraction(N(0.1), '1/10');
    assertFraction(N(1 / 3), '1/3', 'simplest fraction within the precision of fraction.js');
    assertFraction(N('1/3'), '1/3');
    assertFraction(N('-2/4'), '-1/2');
    assertFraction(N('0.125'), '1/8');
    assertFraction(N('1 1/2'), '3/2', 'mixed number (the format of serialize)');
    assertFraction(N('-16 1/2'), '-33/2');
    assertFraction(N(N('2/3')), '2/3');
    assertFraction(N(true), '1');
    assertFraction(N(null), '0');
    assert.equal(N(Infinity), Infinity);
    assert.equal(N(-Infinity), -Infinity);
    assert.equal(N('Infinity'), Infinity);
    assert.equal(N('-Infinity'), -Infinity);
    assert.equal(N('1e400'), Infinity);
});

test('toNumber: invalid input throws', () => {
    for (const v of ['', 'abc', '2+2', ' 5 ', '1,5', '#', '3.5e2', NaN, undefined]) {
        assert.throws(() => N(v), Error, JSON.stringify(v) + ' (' + typeof v + ')');
    }
});

test('toFloat: JS numbers from Fractions, numbers and decimal strings', () => {
    assert.equal(ExpressionEngine.toFloat(N('1/3')), 1 / 3);
    assert.equal(ExpressionEngine.toFloat(N('-7/2')), -3.5);
    assert.equal(ExpressionEngine.toFloat(5), 5);
    assert.equal(ExpressionEngine.toFloat('0.25'), 0.25);
    assert.equal(ExpressionEngine.toFloat(Infinity), Infinity);
    assert.equal(ExpressionEngine.toFloat(true), 1);
    assert.equal(ExpressionEngine.toFloat(null), 0);
    assert.deepEqual(ExpressionEngine.toFloat([N('1/2'), N('1/4')]), [0.5, 0.25]);
    assert.throws(() => ExpressionEngine.toFloat('1/4'), SyntaxError, 'fraction strings are not numbers');
    assert.throws(() => ExpressionEngine.toFloat(undefined), TypeError);
});

test('add, subtract, multiply, divide: exact on Fractions, arguments converted with toNumber', () => {
    assertFraction(ExpressionEngine.add('1/3', '1/6'), '1/2');
    assertFraction(ExpressionEngine.add(0.1, 0.2), '3/10', 'each argument converted first');
    assertFraction(ExpressionEngine.add(N('1/3'), 2), '7/3');
    assertFraction(ExpressionEngine.subtract('1/2', '1/3'), '1/6');
    assertFraction(ExpressionEngine.subtract(1, N('1/3')), '2/3');
    assertFraction(ExpressionEngine.multiply('2/3', '3/4'), '1/2');
    assertFraction(ExpressionEngine.divide(1, 3), '1/3');
    assertFraction(ExpressionEngine.divide(N('1/2'), 4), '1/8');
    // the hash probability of sd-computations: (1 - sum) / count
    assertFraction(ExpressionEngine.divide(ExpressionEngine.subtract(1, ExpressionEngine.add('1/3', '1/4')), 2), '5/24');
    // accumulation does not drift: 10 * 1/10 is exactly 1
    let sum = N(0);
    for (let i = 0; i < 10; i++) {
        sum = ExpressionEngine.add(sum, '0.1');
    }
    assertFraction(sum, '1');
    assert.throws(() => ExpressionEngine.divide(1, 0), 'division by zero');
    assert.throws(() => ExpressionEngine.add('1/3', 'x'));
});

test('arithmetic with Infinity [current behaviour]: only ±Infinity together are numbers, Infinity with a Fraction throws', () => {
    assert.ok(Number.isNaN(ExpressionEngine.add(Infinity, -Infinity)));
    assert.equal(ExpressionEngine.add(Infinity, Infinity), Infinity);
    assert.throws(() => ExpressionEngine.add(Infinity, 1), /Cannot implicitly convert a number to a Fraction/);
    assert.throws(() => ExpressionEngine.divide(1, Infinity), /Cannot implicitly convert a number to a Fraction/);
});

test('compare: -1/0/1 for Fractions, ±Infinity handled before Math.js', () => {
    const c = (a, b) => Number(ExpressionEngine.compare(a, b));
    assert.equal(c(1, 5), -1);
    assert.equal(c(5, 1), 1);
    assert.equal(c(5, 5), 0);
    assert.equal(c('1/2', 0.5), 0);
    assert.equal(c(N('1/3'), '2/6'), 0);
    assert.equal(c('1/3', '0.3333'), 1);
    assert.equal(c(0, -0), 0);
    assert.equal(c(null, 0), 0);
    assert.equal(c(-Infinity, 5), -1);
    assert.equal(c(Infinity, 5), 1);
    assert.equal(c(2, Infinity), -1);
    assert.equal(c(2, -Infinity), 1);
    assert.equal(c(Infinity, -Infinity), 1);
    assert.equal(c(-Infinity, Infinity), -1);
    assert.equal(c(Infinity, Infinity), 0);
    assert.equal(c(-Infinity, '-Infinity'), 0);
    assert.equal(c(Infinity, '1e400'), 0);
    // the result is a Fraction for finite values and a number otherwise
    assertFraction(ExpressionEngine.compare(1, 5), '-1');
    assert.equal(ExpressionEngine.compare(Infinity, 5), 1);
});

test('round: Fraction rounded half up (away from zero for .5 of positive values) to the given places', () => {
    assertFraction(ExpressionEngine.round(2.5555, 2), '64/25'); // 2.56
    assertFraction(ExpressionEngine.round('1/3', 3), '333/1000');
    assertFraction(ExpressionEngine.round(0.125, 2), '13/100', '0.125 is exact, rounds up');
    assertFraction(ExpressionEngine.round(2.5), '3');
    assertFraction(ExpressionEngine.round(-2.5), '-2', 'fraction.js rounds half towards +Infinity');
    assertFraction(ExpressionEngine.round('7/3', 0), '2');
    assert.throws(() => ExpressionEngine.round(Infinity, 2), TypeError, '[current behaviour] Infinity has no round()');
});

test('max, min, mean, median, std, mad', () => {
    // Fractions (max/min/mean of Fractions are exact)
    assertFraction(ExpressionEngine.max(2, N('7/2'), 3), '7/2');
    assertFraction(ExpressionEngine.max(N('1/3'), N('1/2')), '1/2');
    assertFraction(ExpressionEngine.min([N('1/3'), N('1/4')]), '1/4');
    assertFraction(ExpressionEngine.mean([N('1/3'), N('2/3')]), '1/2');
    // numbers
    assert.equal(ExpressionEngine.max([1, 5, 3]), 5);
    assert.equal(ExpressionEngine.min(2, 3), 2);
    assert.equal(ExpressionEngine.mean(10, 20, 30), 20);
    assert.equal(ExpressionEngine.median(10, 20, 30, 40), 25);
    assert.equal(ExpressionEngine.median([3, 1, 2]), 2);
    // std is the sample standard deviation (n - 1): for 2, 4, 6 the squared
    // deviations sum to 8, 8 / 2 = 4, sqrt(4) = 2
    assert.equal(ExpressionEngine.std(2, 4, 6), 2);
    // 1..4: sum of squared deviations 5, 5 / 3, sqrt(5/3)
    assert.ok(Math.abs(ExpressionEngine.std([1, 2, 3, 4]) - Math.sqrt(5 / 3)) < 1e-15);
    // mad: median of |x - median| (median 2 -> deviations 1,1,0,0,2,4,7 -> 1)
    assert.equal(ExpressionEngine.mad([1, 1, 2, 2, 4, 6, 9]), 1);
    assert.equal(ExpressionEngine.mad(10, 20, 30), 10);
    assert.throws(() => ExpressionEngine.mean([]), /empty array/);
    assert.throws(() => ExpressionEngine.max(), TypeError);
});

test('median and std of Fractions [current behaviour]: not supported by Math.js 9 with the number config', () => {
    // sd-computations calls them with JS numbers (the payoffs of the probabilistic analysis)
    assert.throws(() => ExpressionEngine.median([N(1), N(2), N(4), N(5)]), TypeError);
    assert.throws(() => ExpressionEngine.std([N(2), N(4), N(6)]), TypeError);
});

test('format: Math.js format, static and instance', () => {
    const e = new ExpressionEngine();
    assert.equal(ExpressionEngine.format(N('1/3')), '1/3');
    assert.equal(ExpressionEngine.format(N('10/5')), '2/1', 'a whole Fraction keeps the denominator');
    assert.equal(e.format(N('2/4')), '1/2');
    assert.equal(ExpressionEngine.format(N('1/3'), {fraction: 'decimal'}), '0.(3)');
    assert.equal(ExpressionEngine.format(1 / 3, 3), '0.333', 'precision');
    assert.equal(ExpressionEngine.format(1234.5678, {notation: 'fixed', precision: 2}), '1234.57');
    assert.equal(e.format(1234.5678, {notation: 'fixed', precision: 1}), '1234.6');
    assert.equal(ExpressionEngine.format(0.1 + 0.2), '0.30000000000000004');
    assert.equal(ExpressionEngine.format(Infinity), 'Infinity');
    assert.equal(ExpressionEngine.format(-Infinity), '-Infinity');
    assert.equal(ExpressionEngine.format('abc'), '"abc"');
    assert.equal(ExpressionEngine.format([1, N('1/2')]), '[1, 1/2]');
});

test('print: Math.js print templates, static and instance', () => {
    const e = new ExpressionEngine();
    assert.equal(ExpressionEngine.print('Hello $name, p=$p', {name: 'node', p: N('1/3')}), 'Hello node, p=1/3');
    assert.equal(ExpressionEngine.print('$a.b', {a: {b: 2}}), '2');
    assert.equal(ExpressionEngine.print('v=$v', {v: 1 / 3}, 3), 'v=0.333');
    assert.equal(e.print('$x', {x: 1234.5678}, {notation: 'fixed', precision: 1}), '1234.6');
    assert.equal(e.print('$missing', {}), '$missing', 'unknown keys are kept');
});

test('isHash: a lone "#" (surrounding whitespace allowed)', () => {
    for (const v of ['#', ' # ', '# ', '\t#\n']) {
        assert.equal(ExpressionEngine.isHash(v), true, JSON.stringify(v));
    }
    for (const v of ['##', '#1', 'a + 5', '', null, undefined, 5]) {
        assert.ok(!ExpressionEngine.isHash(v), JSON.stringify(v));
    }
});

test('hasAssignmentExpression [current behaviour]: any string containing "="', () => {
    for (const v of ['a = 5', 'f(x) = x^2', 'a == 5', 'a <= 5', 'a >= 5', 'a != 5', '"="', '1 # = in a comment']) {
        assert.equal(ExpressionEngine.hasAssignmentExpression(v), true, v);
    }
    for (const v of ['a + 5', '#', 5, null, undefined]) {
        assert.equal(ExpressionEngine.hasAssignmentExpression(v), false, String(v));
    }
});

// The intended contract is "the expression assigns a variable or function".
// Comparisons in payoffs (e.g. `x >= 5 ? 1 : 0`) are therefore not evaluated by
// sd-computations (evalPayoff returns null) and are rejected by the payoff /
// probability inputs of SilverDecisions. A change of the accepted expressions
// is a product decision; documented here, not fixed.
knownBug('hasAssignmentExpression treats comparison operators as assignments', () => {
    for (const v of ['a == 5', 'a <= 5', 'a >= 5', 'a != 5', 'x >= 5 ? 1 : 0']) {
        assert.equal(ExpressionEngine.hasAssignmentExpression(v), false, v);
    }
});

test('randomMenuList: the sd-random menu, a copy', () => {
    assert.deepEqual(ExpressionEngine.randomMenuList, ['Uniform(0.0,1.0)', 'Exponential(1.0)', 'Normal(0.0,1.0)',
        'Pareto(1.0,1.0)', 'Weibull(1.0,1.0)', 'Triangular(0.0,1.0,0.5)', 'Trapezoidal(0.0,1.0,0.25,0.75)',
        'LogNormal(0.0,1.0)', 'Gamma(1.0,1.0)', 'Loglogistic(1.0,0.5)', 'Erlang(4,0.5)', 'Bernoulli(0.5)',
        'Binomial(2,0.5)', 'Geometric(0.5)', 'Poisson(2.0)']);
    for (const item of ExpressionEngine.randomMenuList) {
        assert.equal(ExpressionEngine.validate(item), true, item);
    }
});

test('sd-computations ComputationsUtils.sequence: evenly spaced values from exact steps', () => {
    // the sensitivity analysis ranges (sd-computations 0.6.1 src/computations-utils.js)
    function sequence(min, max, length) {
        const extent = ExpressionEngine.subtract(max, min);
        const result = [min];
        if (!(length - 1)) {
            return result;
        }
        const step = ExpressionEngine.divide(extent, length - 1);
        let curr = min;
        for (let i = 0; i < length - 2; i++) {
            curr = ExpressionEngine.add(curr, step);
            result.push(ExpressionEngine.toFloat(curr));
        }
        result.push(max);
        return result;
    }
    assert.deepEqual(sequence(0, 1, 4), [0, 1 / 3, 2 / 3, 1]);
    assert.deepEqual(sequence(10, 20, 6), [10, 12, 14, 16, 18, 20]);
    assert.deepEqual(sequence(0.1, 0.3, 3), [0.1, 0.2, 0.3], 'no floating point drift: 0.1 + 0.1 is 1/5');
});
