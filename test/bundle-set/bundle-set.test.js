// The module bundles of sd-utils, sd-random, sd-model and sd-expression-engine
// (dist/<name>.js and dist/<name>.min.js) loaded as classic scripts into one
// global scope, as <script> tags or importScripts() in the sd-computations job
// worker load them. Run with `npm run test:bundle-set` (test/bundle-set/run.js
// chooses the dist directories).
//
// Every load order of the four minified files, and every plain/minified mix in
// two orders: after each file the libraries whose dependencies are loaded are
// required and used; at the end every library resolves to the same exports
// through the latest `require` and through the `require` each file defined, the
// earlier exports still work, names go to the `require` defined before the
// bundles and to a `require` bundle loaded after them, unknown names throw
// MODULE_NOT_FOUND, and the global scope gained only `require` (and
// regeneratorRuntime once the engine is used, see AFTER_USE).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const LIBS = [
    {
        name: 'sd-utils',
        deps: [],
        use: 'return JSON.stringify([exports.Utils.isString("a"), exports.Utils.isValidVersionString("1.2.0"), typeof exports.log.getLevel()]);',
        expected: '[true,true,"number"]'
    },
    {
        name: 'sd-random',
        deps: [],
        use: 'return JSON.stringify([exports.Uniform(2, 4)]);',
        expected: '[3]'
    },
    {
        // serialize() uses Utils of sd-utils
        name: 'sd-model',
        deps: ['sd-utils'],
        use: 'var d = exports.domain, m = new exports.DataModel(); m.addNode(new d.DecisionNode(new d.Point(0, 0))); ' +
            'return JSON.stringify([JSON.parse(m.serialize(true)).trees.length, m.getRoots().length]);',
        expected: '[1,1]'
    },
    {
        // Uniform from sd-random, hasAssignmentExpression uses Utils of sd-utils
        name: 'sd-expression-engine',
        deps: ['sd-utils', 'sd-random'],
        use: 'var E = exports.ExpressionEngine; return JSON.stringify([E.eval("1/4 + 1/2", false, {}), ' +
            'E.eval("Uniform(2, 4)", false, {}), E.hasAssignmentExpression("p = 1")]);',
        expected: '[0.75,3,true]'
    }
];
// globals besides `require`: Math.js 9.5.0 loads @babel/runtime/regenerator,
// which sets regeneratorRuntime (sd-expression-engine 0.1.17 does too)
const AFTER_USE = {'sd-expression-engine': ['regeneratorRuntime']};

const dirs = {};
for (const lib of LIBS) {
    const dir = process.env['SD_SET_' + lib.name.toUpperCase().replace(/-/g, '_')];
    if (dir) {
        dirs[lib.name] = path.resolve(dir);
    }
}
const missing = LIBS.filter(lib => !dirs[lib.name]).map(lib => lib.name);
const skip = missing.length ? 'no dist directory for ' + missing.join(', ') + ' (use test/bundle-set/run.js)' : false;

const scripts = new Map();
function script(name, min) {
    const file = path.join(dirs[name], name + (min ? '.min' : '') + '.js');
    if (!scripts.has(file)) {
        scripts.set(file, new vm.Script(fs.readFileSync(file, 'utf8'), {filename: file}));
    }
    return scripts.get(file);
}

// a `require` defined before the bundles, as browserify defines it
const BEFORE = `require = function (id, jumped) {
    __t.calls.push([id, jumped]);
    if (id === 'iso-before') { return __t.before; }
    var error = new Error("Cannot find module '" + id + "'");
    error.code = 'MODULE_NOT_FOUND';
    throw error;
};`;
// a `require` bundle loaded after them
const AFTER = `require = (function (previous) {
    function newRequire(id, jumped) {
        if (id === 'iso-after') { return __t.after; }
        var current = typeof require === 'function' && require;
        if (!jumped && current && current !== newRequire) { return current(id, true); }
        if (previous) { return previous(id, true); }
        var error = new Error("Cannot find module '" + id + "'");
        error.code = 'MODULE_NOT_FOUND';
        throw error;
    }
    return newRequire;
})(typeof require === 'function' && require);`;

const use = (lib, ref) => '(function (exports) {' + lib.use + '})(' + ref + ')';

// Loads the libraries in `order` (minified where min[name]); returns what was observed.
function scenario(order, min) {
    const ctx = vm.createContext({});
    const run = (src) => vm.runInContext(src, ctx);
    run('Math.random = function () { return 0.5; }; var __t = {calls: [], before: {}, after: {}, got: {}, requireAt: {}};');
    const names = () => Object.getOwnPropertyNames(run('this'));
    const initial = names();
    const added = () => names().filter(n => !initial.includes(n)).sort();
    run(BEFORE);
    const problems = [];
    const allowed = ['require'];
    const loaded = [];
    const used = [];
    for (const name of order) {
        script(name, min[name]).runInContext(ctx);
        loaded.push(name);
        run('__t.requireAt[' + JSON.stringify(name) + '] = require;');
        for (const lib of LIBS) {
            if (!used.includes(lib.name) && loaded.includes(lib.name) && lib.deps.every(d => loaded.includes(d))) {
                let result;
                try {
                    result = run('__t.got[' + JSON.stringify(lib.name) + '] = require(' + JSON.stringify(lib.name) + '); ' +
                        use(lib, '__t.got[' + JSON.stringify(lib.name) + ']'));
                } catch (e) {
                    result = 'error: ' + e.message;
                }
                if (result !== lib.expected) {
                    problems.push('after loading ' + name + ': ' + lib.name + ' gave ' + result);
                }
                used.push(lib.name);
                allowed.push(...(AFTER_USE[lib.name] || []));
            }
        }
        const extra = added().filter(n => !allowed.includes(n));
        if (extra.length) {
            problems.push('after loading ' + name + ': ' + extra.length + ' unexpected global(s)');
        }
    }
    const check = (what, src) => {
        let ok;
        try {
            ok = run(src);
        } catch (e) {
            ok = 'error: ' + e.message;
        }
        if (ok !== true) {
            problems.push(what + (ok === false ? '' : ' (' + ok + ')'));
        }
    };
    const requires = ['require'].concat(order.map(n => '__t.requireAt[' + JSON.stringify(n) + ']'));
    for (const lib of LIBS) {
        const got = '__t.got[' + JSON.stringify(lib.name) + ']';
        check(lib.name + ' resolves to the first exports through every require',
            requires.map(r => r + '(' + JSON.stringify(lib.name) + ') === ' + got).join(' && '));
        check(lib.name + ' still works', use(lib, got) + ' === ' + JSON.stringify(lib.expected));
    }
    check('iso-before through every require', requires.map(r => r + '("iso-before") === __t.before').join(' && '));
    check('the require defined before is called with jumped', '__t.calls.every(function (c) { return c[1] === true; }) && __t.calls.length > 0');
    run(AFTER);
    check('iso-after through every require of the bundles', requires.slice(1).map(r => r + '("iso-after") === __t.after').join(' && '));
    for (const lib of LIBS) {
        check(lib.name + ' through the later require', 'require(' + JSON.stringify(lib.name) + ') === __t.got[' + JSON.stringify(lib.name) + ']');
    }
    check('MODULE_NOT_FOUND through every require', requires.map(r => '(function () { try { ' + r + '("iso-missing"); return false; } ' +
        'catch (e) { return e.code === "MODULE_NOT_FOUND" && e.message === "Cannot find module \'iso-missing\'"; } })()').join(' && '));
    const expectedGlobals = ['require'].concat(AFTER_USE['sd-expression-engine']).sort();
    if (JSON.stringify(added()) !== JSON.stringify(expectedGlobals)) {
        problems.push('globals at the end: ' + added().length + ' instead of ' + expectedGlobals.join(', '));
    }
    return problems;
}

function permutations(list) {
    if (list.length <= 1) {
        return [list];
    }
    return list.flatMap((x, i) => permutations(list.slice(0, i).concat(list.slice(i + 1))).map(p => [x].concat(p)));
}

const NAMES = LIBS.map(lib => lib.name);
const label = (order, min) => order.map(n => n + (min[n] ? '.min' : '')).join(' ');

test('loading all four files adds only `require` to the global scope', {skip}, () => {
    for (const minified of [false, true]) {
        const ctx = vm.createContext({});
        const before = Object.getOwnPropertyNames(vm.runInContext('this', ctx));
        for (const name of NAMES) {
            script(name, minified).runInContext(ctx);
        }
        const added = Object.getOwnPropertyNames(vm.runInContext('this', ctx)).filter(n => !before.includes(n));
        assert.deepEqual(added, ['require'], minified ? 'minified' : 'plain');
    }
});

test('the 24 load orders of the minified files', {skip}, () => {
    const all = Object.fromEntries(NAMES.map(n => [n, true]));
    const failures = permutations(NAMES).map(order => [label(order, all), scenario(order, all)]).filter(([, p]) => p.length);
    assert.deepEqual(failures, []);
});

test('the 16 plain/minified mixes, in the dependency order and reversed', {skip}, () => {
    const failures = [];
    for (let mask = 0; mask < 16; mask++) {
        const min = Object.fromEntries(NAMES.map((n, i) => [n, Boolean(mask & (1 << i))]));
        for (const order of [NAMES, NAMES.slice().reverse()]) {
            const problems = scenario(order, min);
            if (problems.length) {
                failures.push([label(order, min), problems]);
            }
        }
    }
    assert.deepEqual(failures, []);
});
