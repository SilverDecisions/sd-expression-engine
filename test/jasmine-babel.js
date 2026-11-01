// Compiles the sources for the Jasmine specs in Node (`npm test`) as consumers
// bundle them: this package with the Babel options of its browserify.transform
// field, sd-utils and sd-random (ES module sources as well) with the options of
// their own package.json. Everything else (Math.js lib/cjs) is loaded as is.
'use strict';

const path = require('path');

const root = path.join(__dirname, '..');
const packages = [root].concat(['sd-utils', 'sd-random']
    .map(name => path.dirname(require.resolve(name + '/package.json', {paths: [root]}))));
const inPackage = dir => file => file.startsWith(dir + path.sep) &&
    !path.relative(dir, file).split(path.sep).includes('node_modules');

require('@babel/register')({
    babelrc: false,
    configFile: false,
    only: [file => packages.some(dir => inPackage(dir)(file))],
    overrides: packages.map(dir => Object.assign({test: inPackage(dir)},
        require(path.join(dir, 'package.json')).browserify.transform[0][1]))
});
