#!/usr/bin/env node
// Runs the contract tests (test/contract/*.test.js, node:test) once per target.
//
//   node test/contract/run.js                       standalone, standalone.min, module, module.min, source
//   node test/contract/run.js --targets=module,source
//   node test/contract/run.js --dist=<dir>          the bundles of another dist/ directory
//   node test/contract/run.js --published[=0.1.17]  the bundles of the package on the npm registry
//                                                   (npm pack into a temporary directory)
//
// Each target runs in its own `node --test` process (SD_EXPRESSION_ENGINE_TARGET,
// SD_EXPRESSION_ENGINE_DIST, see load.js). Exits with 1 if any target fails.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const option = (name) => {
    const arg = args.find(a => a === '--' + name || a.startsWith('--' + name + '='));
    return arg === undefined ? undefined : (arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : true);
};

const BUNDLES = ['standalone', 'standalone.min', 'module', 'module.min'];
let dist = option('dist');
let tmp = null;
const published = option('published');

function npm(npmArgs, cwd) {
    // npm is npm.cmd on Windows; run it through the shell there
    return childProcess.execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, {
        cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32'
    });
}

if (published) {
    const version = published === true ? require(path.join(root, 'package.json')).version : published;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-ee-published-'));
    const tgz = npm(['pack', 'sd-expression-engine@' + version, '--silent'], tmp).trim().split(/\r?\n/).pop();
    childProcess.execFileSync('tar', ['-xzf', tgz], {cwd: tmp});
    dist = path.join(tmp, 'package', 'dist');
    console.log('published sd-expression-engine@' + version + ': ' + dist);
}

const targetsOption = option('targets');
const targets = targetsOption ? String(targetsOption).split(',') : (dist ? BUNDLES : BUNDLES.concat('source'));
const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(__dirname, f));

const failed = [];
try {
    for (const target of targets) {
        console.log('\n=== contract tests: ' + target + (dist ? ' (' + dist + ')' : ''));
        const env = Object.assign({}, process.env, {SD_EXPRESSION_ENGINE_TARGET: target});
        if (dist) {
            env.SD_EXPRESSION_ENGINE_DIST = path.resolve(dist);
        }
        const result = childProcess.spawnSync(process.execPath, ['--test', '--test-reporter=dot'].concat(files), {
            cwd: root,
            env,
            stdio: 'inherit'
        });
        if (result.status !== 0) {
            failed.push(target);
        }
    }
} finally {
    if (tmp) {
        fs.rmSync(tmp, {recursive: true, force: true});
    }
}

console.log('\ncontract tests: ' + (failed.length ? 'FAILED for ' + failed.join(', ') : 'passed for ' + targets.join(', ')));
process.exit(failed.length ? 1 : 0);
