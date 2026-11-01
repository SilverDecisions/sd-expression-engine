// Contract of the package entry points and bundle formats: the export consumers
// import (`import {ExpressionEngine} from 'sd-expression-engine'`,
// `require('sd-expression-engine').ExpressionEngine`), the static and instance
// API, the globals of the dist bundles and the package metadata that browserify
// consumers depend on.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const childProcess = require('child_process');
const loaded = require('./load');
const {engine, ExpressionEngine} = loaded;

// Static methods and fields used by sd-computations 0.6.1 and SilverDecisions 1.2.1
// (directly or through `expressionEngine.constructor`), plus mad and print.
const STATIC = ['add', 'compare', 'divide', 'eval', 'format', 'hasAssignmentExpression', 'isExpressionObject', 'isHash',
    'mad', 'max', 'mean', 'median', 'min', 'multiply', 'print', 'randomMenuList', 'round', 'std', 'subtract', 'toFloat',
    'toNumber', 'validate'];
const INSTANCE = ['eval', 'format', 'getJsonReplacer', 'getJsonReviver', 'print', 'serialize', 'validate'];

test('exports: ExpressionEngine only, with the __esModule flag', () => {
    assert.deepEqual(Object.keys(engine), ['ExpressionEngine']);
    assert.equal(engine.__esModule, true);
    assert.equal(typeof ExpressionEngine, 'function');
    assert.ok(new ExpressionEngine() instanceof ExpressionEngine);
});

test('static and instance API', () => {
    const statics = Object.getOwnPropertyNames(ExpressionEngine).filter(n => !['length', 'name', 'prototype'].includes(n));
    assert.deepEqual(statics.sort(), STATIC);
    const instance = Object.getOwnPropertyNames(ExpressionEngine.prototype).filter(n => n !== 'constructor');
    assert.deepEqual(instance.sort(), INSTANCE);
    for (const name of STATIC.filter(n => n !== 'randomMenuList')) {
        assert.equal(typeof ExpressionEngine[name], 'function', name);
    }
    // removed before 0.1.17, not to be restored
    const e = new ExpressionEngine();
    for (const name of ['parser', 'staticParser', 'setScope']) {
        assert.equal(name in e, false, name);
        assert.equal(name in ExpressionEngine, false, name);
    }
});

test('package.json keeps the entry points, the runtime dependencies and the browserify transform of the consumers', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(loaded.root, 'package.json'), 'utf8'));
    assert.equal(pkg.name, 'sd-expression-engine');
    assert.equal(pkg.main, 'index.js');
    assert.equal(pkg.exports, undefined);
    assert.equal(pkg.type, undefined);
    assert.deepEqual(pkg.browserify, {
        transform: [['babelify', {
            presets: ['@babel/preset-env'],
            plugins: ['transform-class-properties', 'transform-object-assign',
                ['babel-plugin-transform-builtin-extend', {globals: ['Error']}]]
        }]]
    });
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['mathjs', 'sd-random', 'sd-utils']);
    assert.equal(pkg.dependencies.mathjs, '9.5.0', 'Math.js is pinned exactly');
    // sources consumers bundle (index.js -> src/) and the standalone entry
    for (const file of ['index.js', 'standalone.index.js', 'src/index.js', 'src/expression-engine.js', 'src/mathjs.js']) {
        assert.ok(fs.existsSync(path.join(loaded.root, file)), file);
    }
});

function bundleFile() {
    return loaded.isModuleBundle ? loaded.moduleBundleFile(loaded.isMin) : loaded.standaloneFile(loaded.isMin);
}

// Globals a bundle defined besides the given ones. regenerator-runtime 0.13
// (required by the Babel runtime helpers of Math.js 9) assigns a global
// `regeneratorRuntime` [current behaviour of 0.1.17]; it is tolerated, nothing
// else is.
function extraGlobals(sandbox, before) {
    return Object.keys(sandbox).filter(k => !before.includes(k) && k !== 'regeneratorRuntime').sort();
}

// Minimal AMD loader: the module value is the factory's return value or the
// injected `exports` object (browserify UMD: define([], f); Rollup: define(f)
// or define(['exports'], f)). No other dependencies are expected.
function amdDefine(onDefine) {
    const define = (deps, factory) => {
        if (typeof deps === 'function') {
            factory = deps;
            assert.equal(factory.length, 0, 'define(factory) without the require/exports/module form');
            deps = [];
        }
        const exports = {};
        const result = factory.apply(null, deps.map(dep => {
            assert.equal(dep, 'exports', 'no other AMD dependencies');
            return exports;
        }));
        onDefine(deps.includes('exports') ? exports : result);
    };
    define.amd = {};
    return define;
}

test('standalone bundle: UMD global SilverDecisions.ExpressionEngine, AMD, no other globals', {skip: !loaded.isStandalone && 'standalone targets only'}, () => {
    const file = bundleFile();
    const code = fs.readFileSync(file, 'utf8');

    // script tag: an existing SilverDecisions namespace is extended
    const sandbox = {SilverDecisions: {Other: 1}};
    sandbox.window = sandbox;
    const before = Object.keys(sandbox);
    vm.runInNewContext(code, sandbox, {filename: file});
    assert.equal(sandbox.SilverDecisions.Other, 1);
    assert.deepEqual(Object.keys(sandbox.SilverDecisions).sort(), ['ExpressionEngine', 'Other']);
    assert.deepEqual(extraGlobals(sandbox, before), [], 'no globals besides SilverDecisions (math, lodash, loglevel stay private)');
    const ns = sandbox.SilverDecisions.ExpressionEngine;
    assert.deepEqual(Object.keys(ns), ['ExpressionEngine']);
    assert.equal(ns.ExpressionEngine.eval('1/3 + 1/6').toFraction(), '1/2');

    // no SilverDecisions yet: it is created
    const empty = {};
    empty.window = empty;
    vm.runInNewContext(code, empty, {filename: file});
    assert.deepEqual(extraGlobals(empty, ['window']), ['SilverDecisions']);
    assert.deepEqual(Object.keys(empty.SilverDecisions), ['ExpressionEngine']);

    // AMD
    let defined;
    vm.runInNewContext(code, {define: amdDefine(v => (defined = v))}, {filename: file});
    assert.equal(typeof defined.ExpressionEngine, 'function');
    assert.equal(defined.ExpressionEngine.eval('2*5').toFraction(), '10');
});

test('module bundle: global require exposing sd-expression-engine, cached; sd-utils and sd-random external, Math.js bundled', {skip: !loaded.isModuleBundle && 'module targets only'}, () => {
    const req = loaded.globalRequire;
    assert.equal(req('sd-expression-engine'), engine, 'evaluated once, cached');
    // sd-random functions imported into Math.js are the ones of the sd-random bundle
    const sdRandom = req('sd-random');
    for (const name of sdRandom.functionNameList) {
        assert.equal(ExpressionEngine.eval(name, false), sdRandom[name], name);
    }
    // the log of the sd-utils bundle is used
    const {log} = req('sd-utils');
    const trace = log.trace;
    const traced = [];
    log.trace = (msg) => traced.push(msg);
    try {
        ExpressionEngine.eval('1+1');
    } finally {
        log.trace = trace;
    }
    assert.deepEqual(traced, ['eval: 1+1']);
    assert.throws(() => req('no-such-module'), e => e.code === 'MODULE_NOT_FOUND');
    assert.throws(() => req('mathjs'), e => e.code === 'MODULE_NOT_FOUND', 'Math.js is not exposed');
    for (const name of ['math', 'mathjs', '_', 'lodash', 'log', 'loglevel', 'ExpressionEngine']) {
        assert.equal(Object.prototype.hasOwnProperty.call(globalThis, name), false, 'no global ' + name);
    }

    const code = fs.readFileSync(bundleFile(), 'utf8');
    assert.doesNotMatch(code, /Trapezoidal\(0\.0,1\.0,0\.25,0\.75\)/, 'sd-random not bundled');
    assert.doesNotMatch(code, /lodash\.com|__lodash_hash_undefined__/, 'sd-utils / lodash not bundled');
    assert.equal(ExpressionEngine.eval('version', false), '9.5.0', 'Math.js 9.5.0 inside the bundle');
});

// Real browserify `require` bundle loaded after the engine, exposing a module
// that requires sd-expression-engine (as sd-computations / sd-model bundles do).
function laterBundle() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-ee-later-'));
    try {
        const entry = path.join(dir, 'later.js');
        fs.writeFileSync(entry, "module.exports = function (expr) { return require('sd-expression-engine').ExpressionEngine.eval(expr); };\n");
        const script = "require('browserify')().require(process.argv[1], {expose: 'later-module'})" +
            ".external('sd-expression-engine').bundle(function (e, b) { if (e) { console.error(e); process.exit(1); } process.stdout.write(b); });";
        const code = childProcess.execFileSync(process.execPath, ['-e', script, entry], {cwd: loaded.root, encoding: 'utf8'});
        const file = path.join(dir, 'later-bundle.js');
        fs.writeFileSync(file, code);
        return {file, dir};
    } catch (e) {
        fs.rmSync(dir, {recursive: true, force: true});
        throw e;
    }
}

test('module bundle: lazy evaluation, dependencies loaded before or after the engine, later require bundles, jumped lookups', {skip: !loaded.isModuleBundle && 'module targets only'}, () => {
    const file = bundleFile();
    const utils = loaded.sdUtilsBundle();
    const random = loaded.sdRandomBundle();

    // engine first: nothing is evaluated until required, dependencies come later
    loaded.withGlobalRequire([file, utils, random], (req) => {
        assert.equal(req('sd-expression-engine').ExpressionEngine.eval('2+2').toFraction(), '4');
    });

    // a later browserify bundle requires the engine through the chain, and the
    // engine still resolves its externals while it is not the latest require
    const later = laterBundle();
    try {
        loaded.withGlobalRequire([utils, random, file, later.file], (req) => {
            assert.equal(req('later-module')('1/3 + 1/6').toFraction(), '1/2');
            assert.equal(req('sd-expression-engine').ExpressionEngine.toNumber('3/4').toFraction(), '3/4');
        });
        // the engine bundle's own require, called after a later bundle was defined
        let engineRequire;
        loaded.withGlobalRequire([utils, random, file], (req) => {
            engineRequire = req;
            vm.runInThisContext(fs.readFileSync(later.file, 'utf8'), {filename: later.file});
            assert.notEqual(globalThis.require, engineRequire);
            assert.equal(typeof engineRequire('sd-utils').Utils.isString, 'function', 'not jumped: through the current global require');
            assert.equal(typeof engineRequire('later-module'), 'function', 'modules of later bundles are reachable');
            assert.equal(typeof engineRequire('sd-random', true).Uniform, 'function', 'jumped: previous bundles only');
            assert.throws(() => engineRequire('later-module', true), e => e.code === 'MODULE_NOT_FOUND', 'jumped: later bundles are not asked');
        });
    } finally {
        fs.rmSync(later.dir, {recursive: true, force: true});
    }
});

test('module bundle [current behaviour]: requiring the engine without sd-utils fails with MODULE_NOT_FOUND and leaves an empty cached module', {skip: !loaded.isModuleBundle && 'module targets only'}, () => {
    // browserify caches the module object before running its factory, so a
    // failed first require returns the partially initialised (empty) exports later
    loaded.withGlobalRequire([bundleFile()], (req) => {
        assert.throws(() => req('sd-expression-engine'), e => e.code === 'MODULE_NOT_FOUND' && /sd-utils/.test(e.message));
        assert.deepEqual(Object.keys(req('sd-expression-engine')), []);
    });
});
