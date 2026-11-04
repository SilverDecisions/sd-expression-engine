// Prints a browserify bundle of index.js (CommonJS `module.exports` = the
// package exports) to stdout. Like SilverDecisions, it relies on the
// browserify.transform fields of sd-expression-engine, sd-utils and sd-random to
// compile their ES2015+ sources with Babel; Math.js is taken from its published
// CommonJS build (lib/cjs, `main`), as browserify resolves it.
// Used by test/contract/load.js for SD_EXPRESSION_ENGINE_TARGET=source.
'use strict';

const path = require('path');
const browserify = require('browserify');

const root = path.resolve(__dirname, '..', '..');

browserify(path.join(root, 'index.js'), {basedir: root, standalone: 'SdExpressionEngineSourceBundle'})
    .bundle((err, buf) => {
        if (err) {
            console.error(err.stack || String(err));
            process.exit(1);
        }
        process.stdout.write(buf);
    });
