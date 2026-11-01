// Rollup plugin: compiles the files of packages that declare a babelify
// `browserify.transform` in their package.json (this package, sd-utils,
// sd-random) the way browserify + babelify compile them for consumers: Babel 7
// with the options of that field and CommonJS modules (babelify's default).
// Rollup then bundles CommonJS modules only, so the module interop is Babel's,
// as in the browserify build and in SilverDecisions: e.g. src/mathjs.js
// (`import ... from 'mathjs'` + `module.exports = math`) and
// `import * as math from "./mathjs"` (_interopRequireWildcard) keep working.
// Other packages (Math.js lib/cjs and its dependencies) are not compiled.
import fs from 'node:fs';
import path from 'node:path';
import {transformAsync} from '@babel/core';

function babelifyOptions(pkgFile) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    const transform = ((pkg.browserify || {}).transform || [])
        .find(t => (Array.isArray(t) ? t[0] : t) === 'babelify');
    if (!transform) {
        return null;
    }
    return Array.isArray(transform) ? (transform[1] || {}) : {};
}

export function browserifyTransform({root}) {
    const packageOf = new Map();
    // nearest package.json of a file (cached per directory)
    function nearestPackage(dir) {
        if (packageOf.has(dir)) {
            return packageOf.get(dir);
        }
        const file = path.join(dir, 'package.json');
        const parent = path.dirname(dir);
        const result = fs.existsSync(file) ? {file, options: babelifyOptions(file)} : (parent === dir ? null : nearestPackage(parent));
        packageOf.set(dir, result);
        return result;
    }

    return {
        name: 'browserify-transform',
        async transform(code, id) {
            if (id.startsWith('\0') || !/\.js$/.test(id)) {
                return null;
            }
            const pkg = nearestPackage(path.dirname(id));
            if (!pkg || !pkg.options) {
                return null;
            }
            const result = await transformAsync(code, Object.assign({}, pkg.options, {
                filename: id,
                cwd: root,
                babelrc: false,
                configFile: false,
                sourceMaps: true,
                // like babelify: the caller does not support ES modules, so
                // @babel/preset-env compiles them to CommonJS
                caller: {name: 'babelify', supportsStaticESM: false}
            }));
            return {code: result.code, map: result.map};
        }
    };
}
