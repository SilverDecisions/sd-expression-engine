// Shared helpers of the contract tests.
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

// Exact check of a Math.js Fraction against a literal written in the test
// ('n/d', or an integer 'n'); independent of the arithmetic of the engine.
function assertFraction(actual, expected, message) {
    assert.ok(actual !== null && typeof actual === 'object' && actual.isFraction === true,
        (message ? message + ': ' : '') + 'expected a Math.js Fraction, got ' + describe(actual));
    assert.equal(actual.toFraction(false), expected, message);
}

function describe(v) {
    if (v === null || typeof v !== 'object') {
        return typeof v + ' ' + String(v);
    }
    return (v.constructor && v.constructor.name) + ' ' + JSON.stringify(v);
}

// A known defect of the baseline (0.1.17): `fn` asserts the intended contract
// and is expected to fail today. The test passes while the defect is present
// and fails as soon as the defect is fixed, so a fix has to move the
// assertions into a regular test (and drop the matching [current behaviour]
// test) instead of leaving a stale expectation behind.
function knownBug(name, fn) {
    test('[known bug, expected] ' + name, () => {
        let fixed = false;
        try {
            fn();
            fixed = true;
        } catch (e) {
            if (!(e instanceof assert.AssertionError)) {
                throw e;
            }
        }
        assert.ok(!fixed, 'the known bug "' + name + '" no longer reproduces: turn this into a regular test');
    });
}

function readFixture(name, reviver) {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'), reviver);
}

// Saved SilverDecisions files (see fixtures/README.md); files before 0.6 hold the
// model at the top level, later ones under `data`. Each file contains the
// values computed by the release that saved it: `computed.payoff` and
// `computed.probability` of every edge.
const FIXTURES = [
    'variables_pass.json',
    'rockefellerWithParams.json',
    'treatments.json',
    'payofftransform_pass.json'
];

// Evaluates the expressions of a saved diagram the way sd-computations 0.6.1
// does (ExpressionsEvaluator.evalExpressions with evalCode and evalNumeric):
// - global code evaluated with asNumber=false into the diagram scope;
// - the scope of a node is Utils.cloneDeep(scope of its parent node, or the
//   diagram scope for a root), then the code of the node is evaluated into it;
// - payoffs of an edge are evaluated with asNumber=true in the scope of the
//   parent node, unless they contain an assignment;
// - probabilities of the edges of a chance node likewise, '#' edges share
//   (1 - sum of the others) / count.
// Global code calling random() cannot be repeated; for such files the saved
// expressionScope (the result of the global code when the file was saved) is
// used as the diagram scope instead.
// Returns a list of {path, kind, expression, value, saved}.
function evaluateDiagram(data, ExpressionEngine, Utils) {
    const engine = new ExpressionEngine();
    const results = [];
    let scope = {};
    if (/random\s*\(/.test(data.code || '')) {
        scope = Utils.cloneDeep(data.expressionScope);
    } else {
        engine.eval(data.code || '', false, scope);
    }

    function visit(node, parentScope, nodePath) {
        const nodeScope = Utils.cloneDeep(parentScope);
        if (node.code) {
            engine.eval(node.code, false, nodeScope);
        }
        let probabilitySum = ExpressionEngine.toNumber(0);
        const hashEdges = [];
        (node.childEdges || []).forEach((edge, i) => {
            const edgePath = nodePath + '/' + i;
            const payoffs = Array.isArray(edge.payoff) ? edge.payoff : [edge.payoff];
            const computed = edge.computed || {};
            const savedPayoffs = Array.isArray(computed.payoff) ? computed.payoff : [computed.payoff];
            payoffs.forEach((payoff, j) => {
                if (!ExpressionEngine.hasAssignmentExpression(payoff)) {
                    results.push({path: edgePath, kind: 'payoff[' + j + ']', expression: payoff,
                        value: engine.eval(payoff, true, nodeScope), saved: savedPayoffs[j]});
                }
            });
            if (node.type === 'chance') {
                if (ExpressionEngine.isHash(edge.probability)) {
                    hashEdges.push({edge, edgePath});
                } else {
                    const p = engine.eval(edge.probability, true, nodeScope);
                    probabilitySum = ExpressionEngine.add(probabilitySum, p);
                    results.push({path: edgePath, kind: 'probability', expression: edge.probability, value: p, saved: computed.probability});
                }
            }
        });
        if (hashEdges.length) {
            const share = ExpressionEngine.divide(ExpressionEngine.subtract(1, probabilitySum), hashEdges.length);
            hashEdges.forEach(({edge, edgePath}) => {
                results.push({path: edgePath, kind: 'probability', expression: '#', value: share, saved: (edge.computed || {}).probability});
            });
        }
        (node.childEdges || []).forEach((edge, i) => visit(edge.childNode, nodeScope, nodePath + '/' + i));
    }

    data.trees.forEach((root, i) => visit(root, scope, 'trees/' + i));
    return results;
}

module.exports = {
    assertFraction,
    describe,
    knownBug,
    readFixture,
    FIXTURES,
    evaluateDiagram
};
