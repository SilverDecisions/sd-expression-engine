// Contract of eval and validate: return types for asNumber=true/false, scopes
// (assignments, functions defined in expressions, the cloned and prototype
// scopes of sd-computations), errors and their effects.
// Expected values follow from exact rational arithmetic of the expressions.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {ExpressionEngine, sdUtils} = require('./load');
const {assertFraction, knownBug} = require('./helpers');

const {Utils} = sdUtils;

test('eval with asNumber (default true) returns an exact Fraction', () => {
    const e = new ExpressionEngine();
    for (const [expr, expected] of [
        ['2+2', '4'], ['2*5', '10'], ['10/2', '5'], ['1/3 + 1/6', '1/2'], ['1/3*3', '1'], ['3 mod 2', '1'],
        ['5!', '120'], ['-7/2', '-7/2'], ['  4 / 6  ', '2/3'], ['2^10', '1024'], ['true', '1']
    ]) {
        assertFraction(ExpressionEngine.eval(expr), expected, 'static ' + expr);
        assertFraction(e.eval(expr), expected, 'instance ' + expr);
        assertFraction(ExpressionEngine.eval(expr, true, {}), expected, 'with scope ' + expr);
    }
    // numbers and numeric strings: converted directly (no Math.js parsing)
    assertFraction(ExpressionEngine.eval(5), '5');
    assertFraction(ExpressionEngine.eval('0.25'), '1/4');
    assertFraction(ExpressionEngine.eval('1/3'), '1/3');
    assertFraction(ExpressionEngine.eval(null), '0', 'null -> 0');
});

test('eval with asNumber: expressions are evaluated with JS numbers, the result is converted to a Fraction', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in binary floating point; the conversion
    // to a Fraction (fraction.js) finds the simplest fraction within its precision
    assert.equal(ExpressionEngine.eval('0.1 + 0.2', false), 0.1 + 0.2);
    assertFraction(ExpressionEngine.eval('0.1 + 0.2'), '3/10');
    // irrational results are approximated: |f - sqrt(2)| is far below the
    // double precision of the JS result (2.2e-16 relative); 1e-12 leaves room
    // for the continued-fraction approximation of fraction.js
    const r = ExpressionEngine.eval('2^0.5');
    assert.equal(r.isFraction, true);
    assert.ok(Math.abs(ExpressionEngine.toFloat(r) - Math.SQRT2) < 1e-12);
});

test('eval with asNumber=false returns the Math.js value', () => {
    assert.equal(ExpressionEngine.eval('2+2', false), 4);
    assert.equal(ExpressionEngine.eval('1/3 + 1/6', false), 1 / 3 + 1 / 6);
    assert.equal(ExpressionEngine.eval('"text"', false), 'text');
    assert.equal(ExpressionEngine.eval('true', false), true);
    assert.equal(ExpressionEngine.eval('', false), undefined);
    assert.equal(ExpressionEngine.eval('1/0', false), Infinity);
    assert.ok(Number.isNaN(ExpressionEngine.eval('0/0', false)));
    const complex = ExpressionEngine.eval('sqrt(-4)', false);
    assert.equal(complex.isComplex, true);
    assert.deepEqual([complex.re, complex.im], [0, 2]);
    const matrix = ExpressionEngine.eval('[1, 2]', false);
    assert.equal(matrix.isMatrix, true);
    assert.deepEqual(matrix.toArray(), [1, 2]);
    // several statements: a ResultSet of the values of the statements not ended by ";"
    const set = ExpressionEngine.eval('a = 1; b = 2\nc = a + b', false);
    assert.equal(set.isResultSet, true);
    assert.deepEqual(set.entries, [2, 3]);
});

test('eval with asNumber: Infinity and invalid results', () => {
    assert.equal(ExpressionEngine.eval('1/0'), Infinity);
    assert.equal(ExpressionEngine.eval('-1/0'), -Infinity);
    assert.equal(ExpressionEngine.eval('Infinity'), Infinity);
    assert.equal(ExpressionEngine.eval('-Infinity'), -Infinity);
    assert.equal(ExpressionEngine.eval('1e400'), Infinity);
    assert.throws(() => ExpressionEngine.eval('0/0'), /NaN cannot be represented as a fraction/);
    assert.throws(() => ExpressionEngine.eval('"text"'));
    assert.throws(() => ExpressionEngine.eval('sqrt(-1)'), TypeError, 'complex result');
    assert.throws(() => ExpressionEngine.eval(''), TypeError, 'no value');
    assert.throws(() => ExpressionEngine.eval(undefined));
    // several statements cannot be converted: code is evaluated with asNumber=false
    assert.throws(() => ExpressionEngine.eval('a = 1; a + 1'), TypeError);
});

test('eval errors: syntax errors and undefined symbols are thrown', () => {
    assert.throws(() => ExpressionEngine.eval('2 +'), SyntaxError);
    assert.throws(() => ExpressionEngine.eval('2 +', false), SyntaxError);
    assert.throws(() => ExpressionEngine.eval('x + 1'), /Undefined symbol x/);
    assert.throws(() => ExpressionEngine.eval('x + 1', false, {}), /Undefined symbol x/);
    assert.throws(() => ExpressionEngine.eval('nope(1)', false), /Undefined function nope/);
});

test('eval assigns into the given scope; without a scope nothing is kept', () => {
    const scope = {};
    assert.equal(ExpressionEngine.eval('x = 5', false, scope), 5);
    assertFraction(ExpressionEngine.eval('y = x / 2', true, scope), '5/2');
    assert.deepEqual(scope, {x: 5, y: 2.5});
    ExpressionEngine.eval('x = x + 1', false, scope);
    assert.equal(scope.x, 6);

    // each call without a scope uses a new one
    ExpressionEngine.eval('unscoped = 1', false);
    assert.throws(() => ExpressionEngine.eval('unscoped', false), /Undefined symbol unscoped/);
    const e = new ExpressionEngine();
    e.eval('unscoped2 = 1', false);
    assert.throws(() => e.eval('unscoped2', false), /Undefined symbol unscoped2/);
    // separate scopes do not share values
    const a = {};
    const b = {};
    ExpressionEngine.eval('v = 1', false, a);
    ExpressionEngine.eval('v = 2', false, b);
    assert.deepEqual([a.v, b.v], [1, 2]);
    // scope variables shadow Math.js constants and functions only in that scope
    const shadow = {};
    ExpressionEngine.eval('pi = 3; sqrt = 5', false, shadow);
    assert.deepEqual([ExpressionEngine.eval('pi', false, shadow), ExpressionEngine.eval('sqrt', false, shadow)], [3, 5]);
    assert.equal(ExpressionEngine.eval('pi', false, {}), Math.PI);
    assert.equal(ExpressionEngine.eval('sqrt(4)', false, {}), 2);
});

test('scope values: Fractions and other types from the scope', () => {
    assertFraction(ExpressionEngine.eval('v * 3', true, {v: ExpressionEngine.toNumber('1/3')}), '1');
    // Fraction + number literal: the number is converted to a Fraction
    assertFraction(ExpressionEngine.eval('v + 0.5', false, {v: ExpressionEngine.toNumber('1/3')}), '5/6');
    assert.equal(ExpressionEngine.eval('s', false, {s: 'abc'}), 'abc');
    // values that are not referenced may be of any type (text interpolation scopes hold nodes and arrays)
    class Node {}
    assertFraction(ExpressionEngine.eval('a + 1', true, {a: 2, node: new Node(), roots: [new Node()]}), '3');
});

test('functions defined in expressions: kept in the scope, evaluated in the scope they were defined in', () => {
    const global = {a: 1};
    ExpressionEngine.eval('f(x) = x + a', false, global);
    assert.equal(typeof global.f, 'function');
    assertFraction(ExpressionEngine.eval('f(2)', true, global), '3');
    // the function reads the defining scope at call time, not the caller's scope
    const caller = Object.assign({}, global, {a: 10});
    assert.equal(ExpressionEngine.eval('f(0)', false, caller), 1);
    global.a = 100;
    assert.equal(ExpressionEngine.eval('f(0)', false, caller), 100);
    // parameters shadow scope variables without changing them
    const s = {x: 7};
    ExpressionEngine.eval('h(x) = x * 2', false, s);
    assert.equal(ExpressionEngine.eval('h(3)', false, s), 6);
    assert.equal(s.x, 7);
    // a function of the global code survives Utils.cloneDeep (node scopes of sd-computations)
    const diagramScope = {};
    ExpressionEngine.eval('rate = 1/4\ndiscount(v) = v * (1 - rate)', false, diagramScope);
    const nodeScope = Utils.cloneDeep(diagramScope);
    assert.equal(nodeScope.discount, diagramScope.discount, 'functions are copied by reference');
    assertFraction(ExpressionEngine.eval('discount(100)', true, nodeScope), '75');
});

test('cloned scopes of sd-computations: node code overrides a copy, the parent scope is unchanged', () => {
    // ExpressionsEvaluator: global code into data.expressionScope, then
    // node.expressionScope = Utils.cloneDeep(parent scope) and the node code into it
    const diagram = {};
    ExpressionEngine.eval('p = 0.3\ncost = 100', false, diagram);
    const node = Utils.cloneDeep(diagram);
    ExpressionEngine.eval('cost = cost * 2\nextra = 5', false, node);
    const child = Utils.cloneDeep(node);
    assertFraction(ExpressionEngine.eval('cost + extra', true, child), '205');
    assertFraction(ExpressionEngine.eval('p', true, child), '3/10');
    assert.deepEqual(diagram, {p: 0.3, cost: 100});
    assert.deepEqual(node, {p: 0.3, cost: 200, extra: 5});
});

test('prototype scopes: inherited variables are read, assignments create own properties', () => {
    const parent = {p: 2, q: 3};
    const child = Object.create(parent);
    assert.equal(ExpressionEngine.eval('p * q', false, child), 6);
    ExpressionEngine.eval('p = 5', false, child);
    assert.equal(child.p, 5);
    assert.equal(parent.p, 2);
    assert.deepEqual(Object.keys(child), ['p']);
    // a later change of the parent is visible through the prototype
    parent.q = 4;
    assert.equal(ExpressionEngine.eval('p * q', false, child), 20);
});

test('scope objects [current behaviour]: a scope without Object.prototype or a class instance is rejected', () => {
    assert.throws(() => ExpressionEngine.eval('1 + 1', false, Object.create(null)), TypeError);
    class Scope {
        constructor() {
            this.v = 1;
        }
    }
    assert.throws(() => ExpressionEngine.eval('v', false, new Scope()), TypeError);
});

test('errors: statements before the failing one keep their effects, later calls work', () => {
    const scope = {};
    assert.throws(() => ExpressionEngine.eval('a = 1; b = nope; c = 3', false, scope), /Undefined symbol nope/);
    assert.deepEqual(scope, {a: 1});
    assert.throws(() => ExpressionEngine.eval('a =', false, scope), SyntaxError);
    assert.equal(ExpressionEngine.eval('a = 2', false, scope), 2);
    assertFraction(ExpressionEngine.eval('a + 1', true, scope), '3');
});

test('validate: compileOnly (default) checks the syntax only and has no side effects', () => {
    const e = new ExpressionEngine();
    const scope = {};
    for (const expr of ['5', '1/0', '"s"', 'x = 5', 'f(x) = x', 'undefinedSymbol + 1', '#', '', ' ', 5, 0]) {
        assert.equal(ExpressionEngine.validate(expr, scope), true, JSON.stringify(expr));
        assert.equal(e.validate(expr), true, JSON.stringify(expr));
    }
    assert.deepEqual(scope, {}, 'nothing evaluated');
    for (const expr of ['5 /', 'x =', '(1', null, undefined]) {
        assert.equal(ExpressionEngine.validate(expr, scope), false, JSON.stringify(expr));
        assert.equal(e.validate(expr), false, JSON.stringify(expr));
    }
});

test('validate with compileOnly=false: evaluates in the scope and requires a finite number', () => {
    const e = new ExpressionEngine();
    assert.equal(e.validate('5 + d', {}, false), false);
    assert.equal(e.validate('5 + d', {d: 1}, false), true);
    assert.equal(e.validate('5 + d', undefined, false), false, 'instance: missing scope -> {}');
    for (const expr of ['1/3', '2^0.5', '-4', 5, 0]) {
        assert.equal(ExpressionEngine.validate(expr, {}, false), true, String(expr));
    }
    for (const expr of ['1/0', '0/0', '"s"', '[1]', 'true', 'sqrt(-1)', '#', '', ' ', '5 /']) {
        assert.equal(ExpressionEngine.validate(expr, {}, false), false, String(expr));
    }
    // side effects: assignments are made in the given scope
    const scope = {};
    assert.equal(ExpressionEngine.validate('x = 5', scope, false), true);
    assert.deepEqual(scope, {x: 5});
});

test('Math.js security restrictions stay in place', () => {
    assert.throws(() => ExpressionEngine.eval('constructor', false, {}), /No access to property "constructor"/);
    assert.throws(() => ExpressionEngine.eval('cos.constructor', false, {}), /No access to property "constructor"/);
    assert.throws(() => ExpressionEngine.eval('import({a: 1})', false, {}), /Undefined function import/);
});

test('Math.js state [current behaviour]: createUnit in an expression changes the shared instance for later evaluations', () => {
    // documented, not a contract to extend: the Math.js instance is shared by all
    // engines of a bundle; createUnit (and evaluate/parse) are available in expressions
    const name = 'sdtestunit' + process.pid;
    assert.throws(() => ExpressionEngine.eval('2 ' + name, false, {}));
    ExpressionEngine.eval('createUnit("' + name + '")', false, {});
    assert.equal(ExpressionEngine.eval('2 ' + name, false, {}).toString(), '2 ' + name);
    assert.equal(ExpressionEngine.eval('evaluate("2 + 3")', false, {}), 5);
});

test('eval with asNumber [current behaviour]: an expression starting with Infinity or an overflowing literal returns Infinity unevaluated', () => {
    // eval tries ExpressionEngine.toNumber(expr) first, which uses parseFloat:
    // parseFloat('Infinity * 0') === Infinity, so the rest of the expression is ignored
    assert.equal(ExpressionEngine.eval('Infinity * 0'), Infinity);
    assert.equal(ExpressionEngine.eval('Infinity - Infinity'), Infinity);
    assert.equal(ExpressionEngine.eval('1e400 * 0'), Infinity);
    assert.equal(ExpressionEngine.eval('Infinity > 3 ? 1 : 2'), Infinity);
    // with asNumber=false Math.js evaluates the whole expression
    assert.ok(Number.isNaN(ExpressionEngine.eval('Infinity * 0', false)));
    assert.equal(ExpressionEngine.eval('Infinity > 3 ? 1 : 2', false), 1);
});

knownBug('eval with asNumber evaluates expressions that start with Infinity', () => {
    assertFraction(ExpressionEngine.eval('Infinity > 3 ? 1 : 2'), '1');
});
