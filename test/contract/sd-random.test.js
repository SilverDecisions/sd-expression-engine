// Contract of the sd-random integration: the sampling functions of sd-random
// (functionNameList) are imported into Math.js and callable in expressions,
// arguments are passed through, Math.js functions keep their meaning.
// Draws are controlled through the Math.random dispatcher of load.js; the
// expected values follow from the formulas of sd-random 0.1.4 (A. Law,
// "Simulation Modelling and Analysis", 5e) for the given uniform draws.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {ExpressionEngine, rng} = require('./load');
const {assertFraction} = require('./helpers');

const NAMES = ['Uniform', 'Exponential', 'Normal', 'Pareto', 'Weibull', 'Triangular', 'Trapezoidal', 'LogNormal',
    'Gamma', 'Loglogistic', 'Erlang', 'Bernoulli', 'Binomial', 'Geometric', 'Poisson'];

function draw(expr, values, scope) {
    return rng.withSequence(values, () => ExpressionEngine.eval(expr, false, scope || {}));
}

test('all sd-random functions are available in expressions', () => {
    for (const name of NAMES) {
        assert.equal(typeof ExpressionEngine.eval(name, false), 'function', name);
    }
    // every menu entry evaluates to a number with real draws
    for (const item of ExpressionEngine.randomMenuList) {
        const v = rng.withSeed(1234, () => ExpressionEngine.eval(item, false));
        assert.equal(typeof v, 'number', item);
    }
});

test('deterministic samples for given uniform draws', () => {
    // a + (b - a) u
    assert.deepEqual(draw('Uniform(2, 6)', [0.25]), {draws: 1, value: 3});
    // inverse CDF of the triangular distribution, c = (m - a) / (b - a) = 1/4
    assert.deepEqual(draw('Triangular(0, 4, 1)', [0.25]), {draws: 1, value: 1});
    assert.deepEqual(draw('Triangular(0, 4, 1)', [0.75]), {draws: 1, value: 4 - Math.sqrt(3)});
    // 1 if u <= p
    assert.deepEqual(draw('Bernoulli(0.3)', [0.3]), {draws: 1, value: 1});
    assert.deepEqual(draw('Bernoulli(0.3)', [0.31]), {draws: 1, value: 0});
    // sum of n Bernoulli draws
    assert.deepEqual(draw('Binomial(3, 0.5)', [0.1, 0.9, 0.5]), {draws: 3, value: 2});
    // product of draws until it falls below exp(-lambda) = 0.135...: 0.5, 0.25, 0.125
    assert.deepEqual(draw('Poisson(2)', [0.5, 0.5, 0.5]), {draws: 3, value: 2});
    // floor(ln u / ln(1 - p)) = floor(2.32...)
    assert.deepEqual(draw('Geometric(0.5)', [0.2]), {draws: 1, value: 2});
    // -beta ln u
    assert.deepEqual(draw('Exponential(2)', [0.5]), {draws: 1, value: 2 * Math.LN2});
    // Gamma(1, beta) = -beta ln u; uses the Math.random reference sd-random took at load time
    assert.deepEqual(draw('Gamma(1, 2)', [0.5]), {draws: 1, value: 2 * Math.LN2});
    // Box-Muller: sqrt(-2 ln u1) cos(2 pi u2) std + mean = 2 * (-1) * 3 + 10; the
    // rounding of exp/log/sqrt/cos stays within a few ulps of 4
    const normal = draw('Normal(10, 3)', [Math.exp(-2), 0.5]);
    assert.equal(normal.draws, 2);
    assert.ok(Math.abs(normal.value - 4) < 1e-12, String(normal.value));
});

test('arguments: scope variables, Fractions and results with asNumber', () => {
    assert.equal(draw('Uniform(lo, hi)', [0.5], {lo: 2, hi: 6}).value, 4);
    const lo = ExpressionEngine.toNumber(2);
    const hi = ExpressionEngine.toNumber(6);
    assert.equal(draw('Uniform(lo, hi)', [0.5], {lo, hi}).value, 4, 'Fractions are used as numbers');
    const r = rng.withSequence([0.25], () => ExpressionEngine.eval('Uniform(2, 6)'));
    assertFraction(r.value, '3', 'asNumber: a Fraction');
    // in code: the sample is assigned to the scope
    const scope = {};
    rng.withSequence([0.75], () => ExpressionEngine.eval('x = Uniform(0, 4)\ny = 2 * x', false, scope));
    assert.deepEqual(scope, {x: 3, y: 6});
});

test('no collisions: Math.js functions keep their meaning, names are case-sensitive', () => {
    assert.equal(ExpressionEngine.eval('gamma(5)', false), 24, 'Math.js gamma function, not the Gamma distribution');
    assert.equal(ExpressionEngine.eval('exp(0)', false), 1);
    assert.equal(ExpressionEngine.eval('normal', false, {normal: 7}), 7);
    assert.throws(() => ExpressionEngine.eval('uniform(0, 1)', false), /Undefined function uniform/);
});

test('Math.js random functions [current behaviour]: not driven by Math.random', () => {
    // Math.js 9 uses its own seedrandom generator: no draw from Math.random
    const r = rng.withSequence([], () => ExpressionEngine.eval('[random(), randomInt(1, 10), pickRandom([1, 2, 3])]', false).toArray());
    assert.equal(r.draws, 0);
    assert.ok(r.value[0] >= 0 && r.value[0] < 1);
    assert.ok(Number.isInteger(r.value[1]) && r.value[1] >= 1 && r.value[1] < 10);
    assert.ok([1, 2, 3].includes(r.value[2]));
});

test('harness: the Math.random source is restored after errors and exhausted sequences', () => {
    assert.throws(() => draw('Binomial(3, 0.5)', [0.1]), /called more than 1 times/);
    assert.equal(rng.active, false);
    assert.throws(() => rng.withSequence([0.5], () => {
        throw new Error('boom');
    }), /boom/);
    assert.equal(rng.active, false);
    assert.equal(Math.random, rng.dispatcher);
    const v = Math.random();
    assert.ok(v >= 0 && v < 1);
    // seeded runs repeat
    const a = rng.withSeed(7, () => ExpressionEngine.eval('[Uniform(0, 1), Normal(0, 1)]', false).toArray());
    const b = rng.withSeed(7, () => ExpressionEngine.eval('[Uniform(0, 1), Normal(0, 1)]', false).toArray());
    assert.deepEqual(a, b);
});
