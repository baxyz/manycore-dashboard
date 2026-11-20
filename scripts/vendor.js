/*
 * Copy the front-end libraries from node_modules to public_libs/, with the layout bower used to give them
 * (the HTML pages load /libs/<bower name>/...). The versions are pinned in package.json to the releases that
 * were current when the dashboard was last worked on (summer 2016): bower.json asked for "latest", which today
 * would resolve to incompatible major versions (AngularJS 1.8, D3 7...).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const modules = path.join(root, 'node_modules');
const target = path.join(root, 'public_libs');

// [source in node_modules, destination in public_libs]
const files = [
	['angular/angular.min.js', 'angular/angular.min.js'],
	['angular-sanitize/angular-sanitize.min.js', 'angular-sanitize/angular-sanitize.min.js'],
	['angular-ui-router/release/angular-ui-router.min.js', 'ui-route/release/angular-ui-router.min.js'],
	['awesome-bootstrap-checkbox/awesome-bootstrap-checkbox.css', 'awesome-bootstrap-checkbox/awesome-bootstrap-checkbox.css'],
	['bootswatch/yeti/bootstrap.min.css', 'bootswatch-dist/css/bootstrap.min.css'],
	['bootstrap/dist/fonts', 'bootswatch-dist/fonts'],
	['d3/d3.min.js', 'd3/d3.min.js'],
	['font-awesome/css', 'font-awesome/css'],
	['font-awesome/fonts', 'font-awesome/fonts'],
	['jssha/src/sha256.js', 'jssha/src/sha256.js'],
	['ui-select/dist/select.min.css', 'angular-ui-select/dist/select.min.css'],
	['ui-select/dist/select.min.js', 'angular-ui-select/dist/select.min.js'],
];

// The front-end libraries are dev dependencies: a production install of the server alone has none of them.
if (!fs.existsSync(path.join(modules, 'angular'))) {
	console.log('vendor: front-end libraries not installed, nothing to copy');
	process.exit(0);
}

fs.rmSync(target, { recursive: true, force: true });
for (const [from, to] of files) {
	fs.cpSync(path.join(modules, from), path.join(target, to), { recursive: true });
}
console.log(`vendor: ${files.length} entries copied to public_libs/`);
