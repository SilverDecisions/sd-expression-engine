#!/usr/bin/env node
// Build check in an isolated copy (`npm run test:build`, used by CI):
//
//  1. copy the files of the working tree (git ls-files) to a temp dir, `npm ci` there
//  2. `npm run build`: exit code 0, no Rollup warnings
//  3. all dist artifacts exist, nothing else is in dist/; the bundles are ES5;
//     their source maps (inline in the plain files, .map files next to the
//     minified ones) are version 3 JSON with sources and sourcesContent, and the
//     position of a known statement of src/expression-engine.js maps back to
//     that file and to the line holding the statement
//  4. the build changed nothing outside dist/
//  5. the contract tests against the four fresh bundles (dist/standalone and
//     dist/sd-expression-engine.js after dist/sd-utils.js and dist/sd-random.js,
//     plain and minified) and the sources bundled with browserify (target
//     `source`), and the Jasmine specs
//  6. `npm pack`: the tarball contains the entry points, sources and dist; it is
//     installed into an empty consumer that bundles require('sd-expression-engine')
//     with browserify + babelify (the package's browserify.transform field, like
//     SilverDecisions); the contract tests run against that bundle and against
//     the installed dist bundles (with the installed sd-utils / sd-random bundles,
//     as the sd-computations tests and job worker load them)
//  7. a syntax error injected into the sources fails `npm run build` with a
//     non-zero exit code and a diagnostic naming the file and line; nothing
//     outside dist/ changes
//
// Usage: node scripts/check-build.js [--keep] [--skip-consumer]
//                                    [--sd-utils=<.tgz>] [--sd-random=<.tgz>]
//   --sd-utils / --sd-random  install these tarballs in the copy and in the
//               consumer instead of the locked / published versions (integration
//               check of unreleased packages); package.json and the lockfile of
//               the working tree are not changed
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {spawnSync, execFileSync} = require('child_process');

const root = path.resolve(__dirname, '..');
const NAME = 'sd-expression-engine';
const ERROR_FILE = 'src/expression-engine.js';
// the syntax error goes into this line (after the imports, outside comments)
const ERROR_LINE = 4;
// a statement of ERROR_FILE whose generated position is looked up in the source maps
const MAPPED = {generated: /(["'])eval: \1/, original: "log.trace('eval: ' + expr);"};
const ARTIFACTS = ['', 'standalone/'].reduce((list, dir) => list.concat(
    ['.js', '.min.js', '.min.js.map'].map(ext => 'dist/' + dir + NAME + ext)), []);
// what consumers bundle: the entry points and the sources they import
const SOURCES = ['index.js', 'standalone.index.js', 'src/index.js', 'src/expression-engine.js', 'src/mathjs.js'];
const PACKED = ['package.json', 'README.md', 'LICENSE'].concat(SOURCES, ARTIFACTS);
// the toolchain SilverDecisions and the sd-* modules compile the package with
const CONSUMER_DEPS = ['browserify@17', 'babelify@10', '@babel/core@7', '@babel/preset-env@7',
    'babel-plugin-transform-class-properties@6', 'babel-plugin-transform-object-assign@6',
    'babel-plugin-transform-builtin-extend@1'];
const TARGETS = ['standalone', 'standalone.min', 'module', 'module.min'];

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => (args.find(a => a.startsWith(name + '=')) || '').slice(name.length + 1) || null;
const overrides = ['sd-utils', 'sd-random'].map(n => option('--' + n) && path.resolve(option('--' + n))).filter(Boolean);
const failures = [];
const fail = msg => {
    failures.push(msg);
    console.error('FAIL ' + msg);
};
const ok = msg => console.log('ok   ' + msg);

// npm as `node npm-cli.js`: on Windows `npm` is a .cmd file that spawnSync cannot
// run without a shell. npm_execpath is set when this runs as an npm script.
const NPM_CLI = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')]
    .find(p => p && /npm-cli\.js$/.test(p) && fs.existsSync(p));

function run(cmd, cmdArgs, opts) {
    const r = spawnSync(cmd, cmdArgs, Object.assign({encoding: 'utf8', maxBuffer: 256 * 1024 * 1024}, opts));
    return {status: r.status, stdout: r.stdout || '', log: (r.stdout || '') + (r.stderr || '')};
}

function npm(npmArgs, opts) {
    if (!NPM_CLI) {
        throw new Error('npm-cli.js not found next to ' + process.execPath);
    }
    return run(process.execPath, [NPM_CLI].concat(npmArgs), opts);
}

function hashTree(dir, skip) {
    const out = {};
    (function walk(rel) {
        for (const e of fs.readdirSync(path.join(dir, rel), {withFileTypes: true})) {
            const r = rel ? rel + '/' + e.name : e.name;
            if (skip.some(s => r === s || r.startsWith(s + '/'))) {
                continue;
            }
            if (e.isDirectory()) {
                walk(r);
            } else {
                out[r] = crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, r))).digest('hex');
            }
        }
    })('');
    return out;
}

function changedOutsideDist(dir, before) {
    const after = hashTree(dir, ['node_modules', 'dist']);
    return [...new Set(Object.keys(before).concat(Object.keys(after)))].filter(f => before[f] !== after[f]);
}

function copyTree(dest) {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {cwd: root, encoding: 'utf8'})
        .split('\0').filter(f => f && fs.existsSync(path.join(root, f)));
    for (const f of files) {
        fs.mkdirSync(path.join(dest, path.dirname(f)), {recursive: true});
        fs.copyFileSync(path.join(root, f), path.join(dest, f));
    }
    return files.length;
}

// acorn from the isolated copy (installed by its `npm ci`)
let toolsDir = root;
function isES5(file) {
    const acorn = require(require.resolve('acorn', {paths: [toolsDir]}));
    try {
        acorn.parse(fs.readFileSync(file, 'utf8'), {ecmaVersion: 5});
        return null;
    } catch (e) {
        return e.message;
    }
}

// Source map v3 "mappings": returns the segments of one generated line as
// [generatedColumn, sourceIndex, originalLine, originalColumn] (all 0-based).
function decodeLine(mappings, line) {
    const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const state = [0, 0, 0, 0];
    const lines = mappings.split(';');
    let result = [];
    for (let l = 0; l <= line && l < lines.length; l++) {
        state[0] = 0;
        const segments = [];
        for (const seg of lines[l].split(',')) {
            if (!seg) {
                continue;
            }
            const values = [];
            let value = 0;
            let shift = 0;
            for (const ch of seg) {
                const digit = B64.indexOf(ch);
                if (digit < 0) {
                    throw new Error('invalid base64 VLQ character ' + ch);
                }
                value += (digit & 31) << shift;
                if (digit & 32) {
                    shift += 5;
                } else {
                    values.push(value & 1 ? -(value >> 1) : value >> 1);
                    value = 0;
                    shift = 0;
                }
            }
            values.forEach((v, i) => (state[i] += v));
            if (values.length >= 4) {
                segments.push(state.slice());
            }
        }
        result = segments;
    }
    return result;
}

// null if the file references a source map (inline data: URL for the plain
// files, a .map file next to the minified ones) that is valid and maps MAPPED
// back to ERROR_FILE
function sourceMapProblem(file, minified, projectDir) {
    const code = fs.readFileSync(file, 'utf8');
    const ref = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(code);
    if (!ref) {
        return 'no sourceMappingURL comment at the end';
    }
    const inline = /^data:application\/json;(?:charset=utf-8;)?base64,/.exec(ref[1]);
    if (minified ? inline || ref[1] !== path.basename(file) + '.map' : !inline) {
        return 'expected ' + (minified ? 'a reference to ' + path.basename(file) + '.map' : 'an inline source map') + ', got ' + ref[1].slice(0, 40);
    }
    let map;
    try {
        map = JSON.parse(inline ? Buffer.from(ref[1].slice(inline[0].length), 'base64').toString('utf8')
            : fs.readFileSync(path.join(path.dirname(file), ref[1]), 'utf8'));
    } catch (e) {
        return 'source map is not readable JSON: ' + e.message;
    }
    if (map.version !== 3 || typeof map.mappings !== 'string' || !/[A-Za-z]/.test(map.mappings)) {
        return 'source map has no version 3 mappings';
    }
    const sources = Array.isArray(map.sources) ? map.sources.map(s => String(s).split('\\').join('/')) : [];
    const sourceIndex = sources.findIndex(s => s.endsWith(ERROR_FILE));
    if (sourceIndex < 0) {
        return 'source map does not list ' + ERROR_FILE;
    }
    if (!Array.isArray(map.sourcesContent) || map.sourcesContent.length !== sources.length ||
        map.sourcesContent.some(c => typeof c !== 'string')) {
        return 'source map has no sourcesContent for every source';
    }
    const ownSource = map.sourcesContent[sourceIndex];
    if (ownSource !== fs.readFileSync(path.join(projectDir, ERROR_FILE), 'utf8')) {
        return 'sourcesContent of ' + ERROR_FILE + ' differs from the file';
    }
    // generated position of MAPPED -> original position
    const lines = code.split('\n');
    const genLine = lines.findIndex(l => MAPPED.generated.test(l));
    if (genLine < 0) {
        return 'generated code has no ' + MAPPED.generated;
    }
    const genColumn = MAPPED.generated.exec(lines[genLine]).index;
    let segments;
    try {
        segments = decodeLine(map.mappings, genLine);
    } catch (e) {
        return 'mappings cannot be decoded: ' + e.message;
    }
    const segment = segments.filter(s => s[0] <= genColumn).pop();
    if (!segment) {
        return 'no mapping for line ' + (genLine + 1) + ' column ' + genColumn;
    }
    if (segment[1] !== sourceIndex) {
        return 'generated ' + MAPPED.generated + ' maps to ' + sources[segment[1]] + ', not ' + ERROR_FILE;
    }
    const originalLine = ownSource.split('\n')[segment[2]] || '';
    if (!originalLine.includes(MAPPED.original)) {
        return 'generated ' + MAPPED.generated + ' maps to ' + ERROR_FILE + ':' + (segment[2] + 1) + ' "' + originalLine.trim() + '"';
    }
    return null;
}

function runTests(dir, target, env) {
    // TAP: the default reporter of Node 24 prints no summary lines to parse
    const files = fs.readdirSync(path.join(dir, 'test', 'contract')).filter(f => f.endsWith('.test.js')).map(f => path.join('test', 'contract', f));
    const r = run(process.execPath, ['--test', '--test-reporter=tap'].concat(files), {
        cwd: dir, env: Object.assign({}, process.env, {SD_EXPRESSION_ENGINE_TARGET: target}, env)
    });
    const count = name => (r.log.match(new RegExp('^# ' + name + ' (\\d+)', 'm')) || [])[1];
    const summary = 'tests ' + count('tests') + ', pass ' + count('pass') + ', fail ' + count('fail') + ', skipped ' + count('skipped');
    const label = path.isAbsolute(target) ? path.basename(target) : target;
    const where = env && env.SD_EXPRESSION_ENGINE_DIST ? ' (installed dist)' : '';
    if (r.status === 0 && count('fail') === '0' && Number(count('pass')) > 0) {
        ok('contract tests on ' + label + where + ': ' + summary);
    } else {
        console.error(r.log.split('\n').filter(l => /^not ok|error:|expected|actual/.test(l)).slice(0, 30).join('\n'));
        fail('contract tests on ' + label + where + ': ' + summary);
    }
}

function runJasmine(dir) {
    const r = run(process.execPath, [path.join(dir, 'node_modules', 'jasmine', 'bin', 'jasmine.js'), '--config=test/jasmine.json'], {cwd: dir});
    const summary = (/^\d+ specs?, \d+ failures?.*$/m.exec(r.log) || ['no summary'])[0];
    r.status === 0 && / 0 failures/.test(summary) ? ok('Jasmine specs (sources): ' + summary) : fail('Jasmine specs: ' + summary + '\n' + r.log.slice(-2000));
}

function main() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), NAME + '-check-'));
    const copy = path.join(tmp, 'copy');
    console.log('isolated copy: ' + copy);
    try {
        // 1
        ok('copied ' + copyTree(copy) + ' files');
        let r = npm(['ci', '--no-audit', '--no-fund'], {cwd: copy});
        if (r.status !== 0) {
            console.error(r.log);
            fail('npm ci exited with ' + r.status);
            return;
        }
        ok('npm ci');
        toolsDir = copy;
        if (overrides.length) {
            r = npm(['install', '--no-save', '--no-audit', '--no-fund'].concat(overrides), {cwd: copy});
            if (r.status !== 0) {
                console.error(r.log);
                fail('installing ' + overrides.join(', ') + ' failed');
                return;
            }
            ok('installed ' + overrides.map(f => path.basename(f)).join(', ') + ' (not saved)');
        }
        const version = name => require(path.join(copy, 'node_modules', name, 'package.json')).version;
        ok('installed mathjs ' + version('mathjs') + ', sd-utils ' + version('sd-utils') + ', sd-random ' + version('sd-random') +
            ', lodash ' + version('lodash') + ', loglevel ' + version('loglevel'));

        // 2
        const before = hashTree(copy, ['node_modules', 'dist']);
        r = npm(['run', 'build'], {cwd: copy});
        if (r.status !== 0) {
            console.error(r.log);
            fail('npm run build exited with ' + r.status);
            return;
        }
        const warnings = r.log.split('\n').filter(l => /^\(!\)|\[!\]/.test(l.replace(/\u001b\[[\d;]*m/g, '')));
        warnings.length ? fail('build warnings:\n' + warnings.join('\n')) : ok('npm run build, no warnings');

        // 3
        for (const a of ARTIFACTS) {
            const f = path.join(copy, a);
            if (!fs.existsSync(f) || !fs.statSync(f).size) {
                fail(a + ' missing or empty');
                continue;
            }
            if (a.endsWith('.js')) {
                const err = isES5(f);
                err ? fail(a + ' is not ES5: ' + err) : null;
                const problem = sourceMapProblem(f, a.endsWith('.min.js'), copy);
                problem ? fail(a + ': ' + problem) : null;
            }
        }
        const extra = fs.readdirSync(path.join(copy, 'dist'), {recursive: true})
            .map(f => 'dist/' + String(f).split(path.sep).join('/'))
            .filter(f => fs.statSync(path.join(copy, f)).isFile() && !ARTIFACTS.includes(f));
        extra.length ? fail('unexpected files in dist/: ' + extra.join(', ')) : null;
        ok(ARTIFACTS.length + ' artifacts checked (ES5, source maps: JSON, sources, sourcesContent, mapping of ' + ERROR_FILE + '); sizes: ' +
            ARTIFACTS.filter(a => fs.existsSync(path.join(copy, a))).map(a => path.basename(path.dirname(a)) + '/' + path.basename(a) + ' ' +
                Math.round(fs.statSync(path.join(copy, a)).size / 1024) + ' KiB').join(', '));

        // 4
        const changed = changedOutsideDist(copy, before);
        changed.length ? fail('build changed files outside dist/: ' + changed.join(', ')) : ok('nothing changed outside dist/');

        // 5
        for (const target of TARGETS.concat('source')) {
            runTests(copy, target);
        }
        runJasmine(copy);

        // 6 (before 7, which breaks the sources of its own copy)
        if (!flag('--skip-consumer')) {
            checkPackage(tmp, copy);
        }

        // 7
        const broken = path.join(tmp, 'broken');
        fs.cpSync(copy, broken, {recursive: true});
        const errorFile = path.join(broken, ERROR_FILE);
        const lines = fs.readFileSync(errorFile, 'utf8').split('\n');
        lines.splice(ERROR_LINE - 1, 0, 'var = ;');
        fs.writeFileSync(errorFile, lines.join('\n'));
        const beforeBroken = hashTree(broken, ['node_modules', 'dist']);
        r = npm(['run', 'build'], {cwd: broken});
        const named = r.log.includes(ERROR_FILE.split('/').pop()) && new RegExp('\\(' + ERROR_LINE + ':\\d+\\)|:' + ERROR_LINE + ':\\d+').test(r.log);
        if (r.status === 0) {
            fail('npm run build with a syntax error in ' + ERROR_FILE + ' exited with 0');
        } else if (!named) {
            console.error(r.log.split('\n').slice(0, 25).join('\n'));
            fail('no diagnostic naming ' + ERROR_FILE + ' line ' + ERROR_LINE);
        } else {
            ok('syntax error in ' + ERROR_FILE + ': exit code ' + r.status + ', diagnostic names line ' + ERROR_LINE);
        }
        const brokenChanged = changedOutsideDist(broken, beforeBroken);
        brokenChanged.length ? fail('failed build changed files outside dist/: ' + brokenChanged.join(', ')) : null;
    } finally {
        if (flag('--keep')) {
            console.log('kept ' + tmp);
        } else {
            fs.rmSync(tmp, {recursive: true, force: true});
        }
    }
}

function checkPackage(tmp, copy) {
    let r = npm(['pack', '--json', '--pack-destination', tmp], {cwd: copy});
    if (r.status !== 0) {
        console.error(r.log);
        fail('npm pack exited with ' + r.status);
        return;
    }
    // stdout only: npm 11 writes warnings (e.g. gitignore-fallback) to stderr
    const info = JSON.parse(r.stdout.slice(r.stdout.indexOf('[')))[0];
    const files = info.files.map(f => f.path);
    const missing = PACKED.filter(f => !files.includes(f));
    missing.length ? fail('tarball misses ' + missing.join(', ')) : ok('tarball ' + info.filename + ': ' + files.length + ' files, '
        + Math.round(info.size / 1024) + ' KiB, contains ' + PACKED.length + ' required files');

    const consumer = path.join(tmp, 'consumer');
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({name: 'consumer', private: true}));
    const packages = [path.join(tmp, info.filename)].concat(overrides, CONSUMER_DEPS);
    r = npm(['install', '--no-audit', '--no-fund', '--no-package-lock'].concat(packages), {cwd: consumer});
    if (r.status !== 0) {
        console.error(r.log);
        fail('installing the tarball into a consumer failed');
        return;
    }
    const modules = path.join(consumer, 'node_modules');
    const installed = name => require(path.join(modules, name, 'package.json')).version;
    ok('installed ' + NAME + '@' + installed(NAME) + ' from the tarball (mathjs ' + installed('mathjs') + ', sd-utils ' + installed('sd-utils') +
        ', sd-random ' + installed('sd-random') + ') with ' + CONSUMER_DEPS.join(' '));

    fs.writeFileSync(path.join(consumer, 'entry.js'), "module.exports = require('" + NAME + "');\n");
    const bundle = path.join(consumer, 'bundle.js');
    r = run(process.execPath, [path.join(modules, 'browserify', 'bin', 'cmd.js'),
        'entry.js', '--standalone', 'Consumer', '-o', bundle], {cwd: consumer});
    if (r.status !== 0) {
        console.error(r.log);
        fail('browserify of the installed package failed');
        return;
    }
    // ES5: the package sources as the consumer compiles them (with sd-utils,
    // sd-random, lodash, loglevel; Math.js left out) must be ES5. The full bundle
    // also holds the Math.js dependencies a fresh install resolves from the
    // ranges of Math.js 9.5.0, which may be newer than in the lockfile of this
    // package or of SilverDecisions; their syntax is reported, not required.
    const ownBundle = path.join(consumer, 'bundle-without-mathjs.js');
    r = run(process.execPath, [path.join(modules, 'browserify', 'bin', 'cmd.js'),
        'entry.js', '--standalone', 'Consumer', '--external', 'mathjs', '-o', ownBundle], {cwd: consumer});
    const ownErr = r.status === 0 ? isES5(ownBundle) : 'browserify failed: ' + r.log.slice(0, 500);
    ownErr ? fail('consumer compile of the package sources is not ES5: ' + ownErr)
        : ok('consumer compile of the package sources (with sd-utils, sd-random, lodash, loglevel) is ES5');
    const err = isES5(bundle);
    if (err) {
        const mathjsDeps = Object.keys(require(path.join(modules, 'mathjs', 'package.json')).dependencies || {});
        const notES5 = mathjsDeps.filter(n => {
            try {
                return isES5(require.resolve(n, {paths: [path.join(modules, 'mathjs')]}));
            } catch (e) {
                return false;
            }
        }).map(n => n + '@' + require(path.join(modules, n, 'package.json')).version);
        console.log('info full consumer bundle is not ES5 (' + err + '): fresh Math.js dependencies ' + (notES5.join(', ') || '?'));
    } else {
        ok('browserify bundle of require(\'' + NAME + '\') is ES5');
    }
    runTests(copy, bundle);
    // the dist bundles of the installed package, the module bundles after the
    // installed sd-utils / sd-random bundles
    const env = {
        SD_EXPRESSION_ENGINE_DIST: path.join(modules, NAME, 'dist'),
        SD_UTILS_BUNDLE: path.join(modules, 'sd-utils', 'dist', 'sd-utils.js'),
        SD_RANDOM_BUNDLE: path.join(modules, 'sd-random', 'dist', 'sd-random.js')
    };
    for (const target of TARGETS) {
        runTests(copy, target, env);
    }
}

main();
if (failures.length) {
    console.error('\n' + failures.length + ' check(s) failed');
    process.exit(1);
}
console.log('\nall build checks passed');
