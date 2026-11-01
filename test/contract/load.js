// Loads sd-expression-engine the way consumers get it and returns
// {target, engine, ExpressionEngine, globalRequire, rng, ...}.
//
// SD_EXPRESSION_ENGINE_TARGET selects what is tested (default: standalone):
//   standalone      dist/standalone/sd-expression-engine.js, UMD (CommonJS branch);
//                   sd-utils, sd-random and Math.js bundled
//   module          dist/sd-expression-engine.js, the bundle that defines a global
//                   `require` exposing 'sd-expression-engine' and takes 'sd-utils'
//                   and 'sd-random' from the `require` of their own dist bundles
//                   (Math.js is bundled); loaded after dist/sd-utils.js and
//                   dist/sd-random.js as in the sd-computations tests and job worker
//   standalone.min, module.min   the minified files of the same bundles
//   source          index.js bundled with browserify and the package's own
//                   browserify.transform, as SilverDecisions bundles the package
//   <file>          a CommonJS file exporting the module namespace
// SD_EXPRESSION_ENGINE_DIST points at another dist/ directory (default: ./dist),
// e.g. the dist/ of the published package extracted from `npm pack`.
// SD_UTILS_BUNDLE / SD_RANDOM_BUNDLE are the `require` bundles loaded before the
// module bundle (default: dist/sd-utils.js / dist/sd-random.js of the installed
// packages).
//
// Math.random: sd-random keeps a reference to Math.random taken when its module
// is evaluated (`export const random = Math.random`, used by Gamma), so a mock
// installed later would not reach it. This loader therefore replaces Math.random
// with a dispatcher before any bundle is evaluated; the dispatcher calls the
// original function unless a test installs a source with rng.withSequence() /
// rng.withSeed(), which always restore it (also when the callback throws).
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const target = process.env.SD_EXPRESSION_ENGINE_TARGET || 'standalone';
const dist = path.resolve(root, process.env.SD_EXPRESSION_ENGINE_DIST || 'dist');

const rng = (function () {
    const original = Math.random;
    let source = null;
    function dispatcher() {
        return source ? source() : original.call(Math);
    }
    Math.random = dispatcher;

    function use(next, fn) {
        if (source) {
            throw new Error('a Math.random source is already installed');
        }
        source = next;
        try {
            return fn();
        } finally {
            source = null;
        }
    }

    // Values returned in order; drawing more than given is an error, so a test
    // states exactly how many draws an expression makes.
    function withSequence(values, fn) {
        let i = 0;
        const result = {draws: 0};
        result.value = use(() => {
            if (i >= values.length) {
                throw new Error('Math.random called more than ' + values.length + ' times');
            }
            result.draws = i + 1;
            return values[i++];
        }, fn);
        return result;
    }

    // mulberry32, a small seeded generator with values in [0, 1)
    function withSeed(seed, fn) {
        let a = seed >>> 0;
        return use(() => {
            a = (a + 0x6D2B79F5) >>> 0;
            let t = a;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        }, fn);
    }

    return {
        dispatcher,
        original,
        withSequence,
        withSeed,
        get active() {
            return source !== null;
        }
    };
})();

function installed(name, file) {
    return path.join(path.dirname(require.resolve(name + '/package.json', {paths: [root]})), 'dist', file);
}

function sdUtilsBundle() {
    return process.env.SD_UTILS_BUNDLE ? path.resolve(process.env.SD_UTILS_BUNDLE) : installed('sd-utils', 'sd-utils.js');
}

function sdRandomBundle() {
    return process.env.SD_RANDOM_BUNDLE ? path.resolve(process.env.SD_RANDOM_BUNDLE) : installed('sd-random', 'sd-random.js');
}

// Runs the files in this realm with a fresh global `require` (the browserify
// `require` bundles chain to it) and restores the previous global afterwards.
function withGlobalRequire(files, fn) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'require');
    delete globalThis.require;
    try {
        for (const file of files) {
            vm.runInThisContext(fs.readFileSync(file, 'utf8'), {filename: file});
        }
        return fn(globalThis.require);
    } finally {
        if (previous) {
            Object.defineProperty(globalThis, 'require', previous);
        } else {
            delete globalThis.require;
        }
    }
}

function moduleBundleFile(min) {
    return path.join(dist, 'sd-expression-engine' + (min ? '.min' : '') + '.js');
}

function standaloneFile(min) {
    return path.join(dist, 'standalone', 'sd-expression-engine' + (min ? '.min' : '') + '.js');
}

function loadSource() {
    const code = childProcess.execFileSync(process.execPath, [path.join(__dirname, 'bundle-source.js')], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024
    });
    const module = {exports: {}};
    vm.runInThisContext('(function (module, exports) {' + code + '\n})', {filename: 'sd-expression-engine-source-bundle.js'})(module, module.exports);
    return module.exports;
}

function load() {
    const bundle = /^(standalone|module)(\.min)?$/.exec(target);
    if (bundle && bundle[1] === 'standalone') {
        return {engine: require(standaloneFile(bundle[2])), globalRequire: null};
    }
    if (bundle) {
        return withGlobalRequire([sdUtilsBundle(), sdRandomBundle(), moduleBundleFile(bundle[2])], (globalRequire) => ({
            engine: globalRequire('sd-expression-engine'),
            globalRequire
        }));
    }
    if (target === 'source') {
        return {engine: loadSource(), globalRequire: null};
    }
    return {engine: require(path.resolve(target)), globalRequire: null};
}

// Utils of sd-utils (lodash cloneDeep etc.) as consumers use it, from the
// sd-utils `require` bundle; only for test helpers that emulate consumers.
function loadSdUtils() {
    return withGlobalRequire([sdUtilsBundle()], (globalRequire) => globalRequire('sd-utils'));
}

const loaded = load();
loaded.target = target;
loaded.ExpressionEngine = loaded.engine.ExpressionEngine;
loaded.isModuleBundle = /^module(\.min)?$/.test(target);
loaded.isStandalone = /^standalone(\.min)?$/.test(target);
loaded.isMin = /\.min$/.test(target);
loaded.rng = rng;
loaded.root = root;
loaded.dist = dist;
loaded.sdUtilsBundle = sdUtilsBundle;
loaded.sdRandomBundle = sdRandomBundle;
loaded.moduleBundleFile = moduleBundleFile;
loaded.standaloneFile = standaloneFile;
loaded.withGlobalRequire = withGlobalRequire;
loaded.sdUtils = loadSdUtils();
module.exports = loaded;
