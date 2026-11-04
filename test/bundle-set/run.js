#!/usr/bin/env node
// Runs test/bundle-set/bundle-set.test.js on chosen dist directories
// (`npm run test:bundle-set`).
//
//   node test/bundle-set/run.js [--sd-utils=<src>] [--sd-random=<src>]
//                               [--sd-model=<src>] [--sd-expression-engine=<src>]
//                               [other arguments of node --test, e.g. --test-reporter=tap]
//
// <src> is a dist directory, a package tarball (.tgz, its package/dist is used)
// or `published[@version]` (npm pack from the registry). Defaults: this
// package's dist/, the dist/ of the installed sd-utils and sd-random, and the
// published sd-model (not a dependency of this package).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const NAMES = ['sd-utils', 'sd-random', 'sd-model', 'sd-expression-engine'];
const option = name => (args.find(a => a.startsWith('--' + name + '=')) || '').slice(name.length + 3) || null;
const testArgs = args.filter(a => !NAMES.some(n => a.startsWith('--' + n + '=')));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-bundle-set-'));

function npm(npmArgs, cwd) {
    // npm is npm.cmd on Windows; run it through the shell there
    return childProcess.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, {
        cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32'
    });
}

function extract(tgz, name) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir);
    childProcess.execFileSync('tar', ['-xzf', path.resolve(tgz), '-C', dir]);
    return path.join(dir, 'package', 'dist');
}

function resolve(name, fallback) {
    const src = option(name) || fallback;
    if (/^published(@.+)?$/.test(src)) {
        const spec = name + (src.includes('@') ? src.slice(src.indexOf('@')) : '');
        const tgz = npm(['pack', spec, '--silent', '--pack-destination', tmp], tmp).trim().split(/\r?\n/).pop();
        return {src: spec, dir: extract(path.join(tmp, tgz), name)};
    }
    if (/\.tgz$/.test(src)) {
        return {src, dir: extract(src, name)};
    }
    return {src, dir: path.resolve(src)};
}

const installed = name => path.join(path.dirname(require.resolve(name + '/package.json', {paths: [root]})), 'dist');
const env = Object.assign({}, process.env);
let status = 1;
try {
    for (const [name, fallback] of [['sd-utils', installed('sd-utils')], ['sd-random', installed('sd-random')],
        ['sd-model', 'published'], ['sd-expression-engine', path.join(root, 'dist')]]) {
        const r = resolve(name, fallback);
        console.log(name + ': ' + r.dir + (r.src !== r.dir ? ' (' + r.src + ')' : ''));
        env['SD_SET_' + name.toUpperCase().replace(/-/g, '_')] = r.dir;
    }
    const r = childProcess.spawnSync(process.execPath, ['--test'].concat(testArgs, path.join(__dirname, 'bundle-set.test.js')), {stdio: 'inherit', env});
    status = r.status;
} finally {
    fs.rmSync(tmp, {recursive: true, force: true});
}
process.exit(status);
