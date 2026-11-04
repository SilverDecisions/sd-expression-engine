// JavaScript build (`npm run build`). Each bundle is written as a plain file with
// an inline source map and as a minified file with an external .map, like the
// previous gulp/browserify build:
//   dist/sd-expression-engine(.min).js             defines a global `require` that
//       returns the exports of index.js for require('sd-expression-engine');
//       sd-utils and sd-random are external and come from the global `require` of
//       their dist bundles (format of browserify's `require` option); Math.js and
//       its dependencies are bundled
//   dist/standalone/sd-expression-engine(.min).js  UMD of standalone.index.js with
//       everything bundled: module.exports, AMD module or
//       SilverDecisions.ExpressionEngine
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import commonjs from '@rollup/plugin-commonjs';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import {browserifyTransform} from './scripts/browserify-transform.mjs';
import {requireBundle} from './scripts/require-bundle.mjs';

const NAME = 'sd-expression-engine';
const root = path.dirname(fileURLToPath(import.meta.url));

// Compilation target: ES5. index.js, standalone.index.js and src/ are compiled
// with the Babel options of the `browserify.transform` field in package.json,
// sd-utils and sd-random with those of their own package.json, exactly as
// browserify + babelify compile them for consumers (scripts/browserify-transform.mjs):
// @babel/preset-env without targets (and no browserslist config) compiles to
// ES5 and CommonJS, class fields become assignments (Babel 6
// transform-class-properties), Object.assign is inlined, Error subclasses keep
// their prototype. Math.js (lib/cjs, compiled to ES5 by Math.js itself, resolved
// through its `require` export condition as browserify resolves `main`) and its
// dependencies are bundled as published.
const plugins = () => [
    // browser: the `browser` fields as browserify reads them (decimal.js,
    // seedrandom without Node's crypto)
    nodeResolve({browser: true, preferBuiltins: false}),
    browserifyTransform({root}),
    // strictRequires: every CommonJS module runs when it is first required, as
    // in the browserify bundle
    commonjs({strictRequires: true})
];

// Math.js lib/cjs has a few `/* #__PURE__ */` comments Rollup cannot place
// (INVALID_ANNOTATION, the comment is dropped, the code is unchanged); every
// other warning is reported.
function onwarn(warning, warn) {
    if (warning.code === 'INVALID_ANNOTATION' && /[\\/]node_modules[\\/]mathjs[\\/]/.test(warning.id || '')) {
        return;
    }
    warn(warning);
}

function outputs(file, output) {
    const common = Object.assign({exports: 'auto'}, output);
    return [
        Object.assign({file: file + '.js', sourcemap: 'inline'}, common),
        // toplevel: false, as for the other formats: @rollup/plugin-terser turns it on for cjs,
        // which moves the variables of the require wrapper into the global scope
        Object.assign({file: file + '.min.js', sourcemap: true, plugins: [terser({toplevel: false})]}, common)
    ];
}

export default [
    {
        input: 'index.js',
        external: ['sd-utils', 'sd-random'],
        onwarn,
        plugins: plugins().concat([requireBundle(NAME)]),
        output: outputs('dist/' + NAME, {format: 'cjs'})
    },
    {
        input: 'standalone.index.js',
        onwarn,
        plugins: plugins(),
        output: outputs('dist/standalone/' + NAME, {format: 'umd', name: 'SilverDecisions.ExpressionEngine', extend: true})
    }
];
