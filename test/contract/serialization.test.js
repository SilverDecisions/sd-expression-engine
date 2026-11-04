// Contract of serialize, getJsonReplacer, getJsonReviver and
// isExpressionObject, and of the two chains consumers build on them:
// - saving a diagram (SilverDecisions App.serialize -> sd-model
//   DataModel.getJsonReplacer(..., expressionEngine.getJsonReplacer()) ->
//   sd-utils Utils.stringify): Fractions are written as fraction strings;
// - the data model DTO of the sd-computations job repository (JSON.stringify
//   without the engine replacer, JSON.parse with getJsonReviver()): Fractions
//   are written as Math.js JSON objects and revived.
// Saved diagrams of SilverDecisions 0.5.2 - 1.2.0 (fixtures/) are the
// independent reference: their expressions are evaluated again and must give
// the values those releases computed and saved.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {ExpressionEngine, sdUtils} = require('./load');
const {assertFraction, readFixture, FIXTURES, evaluateDiagram} = require('./helpers');

const {Utils} = sdUtils;
const N = ExpressionEngine.toNumber;
const engine = new ExpressionEngine();

// sd-model 0.2.11 DataModel.getJsonReplacer(filterLocation, filterComputed,
// replacer, filterPrivate) followed by Utils.stringify(data, replacer, []) as in
// DataModel.serialize, and App.serialize (Utils.stringify(obj, replacer, ['$'])).
function saveDiagram(data, filterPrivate = true) {
    const expressionReplacer = engine.getJsonReplacer();
    const replacer = function (k, v) {
        if ((filterPrivate && Utils.startsWith(k, '$')) || k == 'parentNode') {
            return undefined;
        }
        return expressionReplacer(k, v);
    };
    return Utils.stringify(data, replacer, filterPrivate ? ['$'] : []);
}

test('serialize: exact fraction strings, mixed numbers above 1', () => {
    for (const [value, expected] of [
        ['1/3', '1/3'], ['-1/3', '-1/3'], ['3/2', '1 1/2'], ['-3/2', '-1 1/2'], ['-7/2', '-3 1/2'], ['5', '5'],
        ['0', '0'], ['10/5', '2'], [0.1, '1/10'], [2.5, '2 1/2'], [1e20, '100000000000000000000'], [null, '0']
    ]) {
        assert.equal(engine.serialize(value), expected, String(value));
        assert.equal(engine.serialize(N(value)), expected, 'Fraction ' + String(value));
    }
    // the Math.js JSON form of a Fraction is accepted too
    assert.equal(engine.serialize({mathjs: 'Fraction', n: -3, d: 2}), '-1 1/2');
});

test('serialize [current behaviour]: ±Infinity cannot be serialized', () => {
    assert.throws(() => engine.serialize(Infinity), TypeError);
    assert.throws(() => engine.serialize(-Infinity), TypeError);
});

test('serialize -> toNumber restores the exact Fraction; serialize is canonical', () => {
    for (const s of ['1/3', '-1/3', '1 1/2', '-16 1/2', '2 3/4', '1165 891810/1849771', '575 878291371642703/3279115770832143',
        '3404095/6186251', '0', '-250']) {
        const f = N(s);
        assert.equal(engine.serialize(f), s, s);
        assert.equal(engine.serialize(N(engine.serialize(f))), s, 'idempotent ' + s);
    }
    // eval with asNumber reads the mixed numbers of saved files
    assertFraction(ExpressionEngine.eval('1 1/2'), '3/2');
});

test('serialized mixed numbers [current behaviour]: not valid Math.js expressions', () => {
    // toNumber (and eval with asNumber, which tries toNumber first) accepts them,
    // Math.js itself does not; SilverDecisions validates payoff inputs with
    // validate(), so a field holding a serialized value above 1 is shown as invalid
    assert.equal(ExpressionEngine.validate(engine.serialize('3/2')), false);
    assert.throws(() => ExpressionEngine.eval(engine.serialize('3/2'), false), SyntaxError);
    assert.equal(ExpressionEngine.validate(engine.serialize('1/2')), true);
});

test('isExpressionObject: objects with a mathjs field (the JSON form of Math.js values)', () => {
    assert.equal(ExpressionEngine.isExpressionObject({mathjs: 'Fraction', n: 1, d: 3}), true);
    assert.equal(ExpressionEngine.isExpressionObject({mathjs: 'DenseMatrix', data: [], size: [0]}), true);
    assert.equal(ExpressionEngine.isExpressionObject({mathjs: ''}), false);
    for (const v of [{}, [], 5, '1/3', null, undefined, '']) {
        assert.ok(!ExpressionEngine.isExpressionObject(v), JSON.stringify(v));
    }
    // a live Fraction has no own mathjs field: the replacer sees its toJSON() form
    assert.ok(!ExpressionEngine.isExpressionObject(N('1/3')));
    assert.deepEqual(N('-1/3').toJSON(), {mathjs: 'Fraction', n: -1, d: 3});
});

test('getJsonReplacer in JSON.stringify: Fractions as fraction strings, other values unchanged', () => {
    const replacer = engine.getJsonReplacer();
    const value = {
        a: N('3/2'),
        b: [N('1/2'), N('-1/3')],
        c: 5,
        d: 'x',
        e: null,
        f: {nested: N('2/4')},
        matrix: ExpressionEngine.eval('[1, 2]', false),
        complex: ExpressionEngine.eval('sqrt(-4)', false),
        unknown: {mathjs: 'Unknown'},
        incomplete: {mathjs: 'Fraction'}
    };
    assert.deepEqual(JSON.parse(JSON.stringify(value, replacer)), {
        a: '1 1/2',
        b: ['1/2', '-1/3'],
        c: 5,
        d: 'x',
        e: null,
        f: {nested: '1/2'},
        // values that are not Fractions keep their Math.js JSON form
        matrix: {mathjs: 'DenseMatrix', data: [1, 2], size: [2]},
        complex: {mathjs: 'Complex', re: 0, im: 2},
        unknown: {mathjs: 'Unknown'},
        incomplete: {mathjs: 'Fraction'}
    });
    assert.equal(replacer('k', '5'), '5');
    assert.equal(replacer('k', {mathjs: 'Fraction', n: 1, d: 3}), '1/3');
});

test('getJsonReviver: Math.js JSON objects revived, strings stay strings', () => {
    const reviver = engine.getJsonReviver();
    assert.equal(typeof reviver, 'function');
    const parsed = JSON.parse(JSON.stringify({
        f: N('-7/3'),
        list: [N('1/2'), 3],
        m: ExpressionEngine.eval('[1/2, 2]', false),
        c: ExpressionEngine.eval('2 + 3i', false),
        u: ExpressionEngine.eval('2 cm', false),
        b: ExpressionEngine.eval('bignumber("0.1")', false),
        s: '1/3'
    }), reviver);
    assertFraction(parsed.f, '-7/3');
    assertFraction(parsed.list[0], '1/2');
    assert.equal(parsed.list[1], 3);
    assert.equal(parsed.m.isMatrix, true);
    assert.deepEqual(parsed.m.toArray(), [0.5, 2]);
    assert.equal(parsed.c.isComplex, true);
    assert.equal(parsed.u.isUnit, true);
    assert.equal(parsed.u.toString(), '2 cm');
    assert.equal(parsed.b.isBigNumber, true);
    assert.equal(parsed.b.toString(), '0.1');
    assert.equal(parsed.s, '1/3');
});

test('DTO chain (job repository): Fractions survive JSON.stringify + getJsonReviver exactly', () => {
    const values = ['1/3', '-16 1/2', '575 878291371642703/3279115770832143', '0'].map(N);
    const back = JSON.parse(JSON.stringify({values, scope: {p: values[0]}}), engine.getJsonReviver());
    back.values.forEach((v, i) => assert.equal(engine.serialize(v), engine.serialize(values[i])));
    assertFraction(back.scope.p, '1/3');
    // and the same with the engine replacer: fraction strings, read with toNumber
    const saved = JSON.parse(JSON.stringify({values}, engine.getJsonReplacer()), engine.getJsonReviver());
    assert.deepEqual(saved.values, ['1/3', '-16 1/2', '575 878291371642703/3279115770832143', '0']);
});

for (const name of FIXTURES) {
    test('saved diagram ' + name + ': expressions give the values saved by the release that wrote it', () => {
        const file = readFixture(name, engine.getJsonReviver());
        const results = evaluateDiagram(file.data || file, ExpressionEngine, Utils);
        assert.ok(results.length >= 8, 'enough values compared');
        for (const r of results) {
            assert.notEqual(r.saved, undefined, r.path + ' ' + r.kind + ' has a saved value');
            // the saved strings are the canonical serialize() form ...
            assert.equal(engine.serialize(N(r.saved)), String(r.saved), r.path + ' ' + r.kind + ' canonical');
            // ... and equal to the value computed now
            assert.equal(engine.serialize(r.value), String(r.saved), r.path + ' ' + r.kind + ' = ' + r.expression);
        }
    });

    test('saved diagram ' + name + ': save -> open -> save is stable after the first save, values equal', () => {
        const reviver = engine.getJsonReviver();
        const file = readFixture(name, reviver);
        // put the values computed now into the data, as sd-computations does
        const data = file.data || file; // 0.5.2 files hold the model at the top level
        const results = evaluateDiagram(data, ExpressionEngine, Utils);
        const byPath = new Map(results.map(r => [r.path + ' ' + r.kind, r.value]));
        const walk = (node, nodePath) => {
            (node.childEdges || []).forEach((edge, i) => {
                const p = nodePath + '/' + i;
                edge.computed = edge.computed || {};
                const payoffs = Array.isArray(edge.payoff) ? edge.payoff : [edge.payoff];
                const computedPayoffs = payoffs.map((x, j) => byPath.get(p + ' payoff[' + j + ']'));
                edge.computed.payoff = Array.isArray(edge.payoff) ? computedPayoffs : computedPayoffs[0];
                if (byPath.has(p + ' probability')) {
                    edge.computed.probability = byPath.get(p + ' probability');
                }
                walk(edge.childNode, p);
            });
        };
        data.trees.forEach((root, i) => walk(root, 'trees/' + i));
        data.$private = 'not saved';

        const first = saveDiagram(data);
        assert.doesNotMatch(first, /"mathjs"|not saved/, 'Fractions as strings, $-fields filtered');
        const reopened = JSON.parse(first, reviver);
        const second = saveDiagram(reopened);
        assert.equal(second, first, 'canonical after the first save');
        // semantic equality: every saved computed value reads back as the computed Fraction
        const again = evaluateDiagram(reopened, ExpressionEngine, Utils);
        assert.equal(again.length, results.length);
        again.forEach((r, i) => {
            assert.equal(Number(ExpressionEngine.compare(N(r.saved), results[i].value)), 0, r.path + ' ' + r.kind);
        });
    });
}
