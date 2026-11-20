/*
 * Build the static demo in dist/:
 *
 *   dist/            <- public/            (the dashboard)
 *   dist/libs/       <- public_libs_static/ + public_libs/ (see scripts/vendor.js)
 *   dist/data/       <- every answer of the Node server, gzipped (see public/static-service.js)
 *
 * The answers are produced by the original server code (app.js, routes/), started in this process on a free
 * port: the static demo shows exactly what the server computed. On a cold checkout the server first builds its
 * caches (data/*.cache.json) from the raw traces, which takes a few minutes.
 *
 * Options:
 *   --skip-data   copy the pages only, keep dist/data/ as it is (to iterate on the front end)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const skipData = process.argv.includes('--skip-data');

// Same mounts as app.js, except public_xp/ (/xp/): the user study ran in 2016 and is closed
const mounts = [
	['public', ''],
	['public_libs_static', 'libs'],
	['public_libs', 'libs'],
];

// Categories of /service/details (routes/details.js)
const CATEGORIES = ['tg', 'sy', 'ds', 'lb', 'dl', 'rs', 'io'];

// Cloudflare Workers static assets: 25 MiB per file
const MAX_FILE = 25 * 1024 * 1024;

async function main() {
	require('./vendor.js');

	// Pages
	for (const entry of fs.existsSync(dist) ? fs.readdirSync(dist) : []) {
		if (entry !== 'data' || !skipData) fs.rmSync(path.join(dist, entry), { recursive: true, force: true });
	}
	for (const [from, to] of mounts) {
		if (!fs.existsSync(path.join(root, from))) throw new Error(`${from}/ is missing (run npm install)`);
		fs.cpSync(path.join(root, from), path.join(dist, to), { recursive: true });
	}
	// The admin pages need the live server (cache reload, study results)
	fs.rmSync(path.join(dist, 'admin'), { recursive: true, force: true });
	enableStaticMode(path.join(dist, 'index.html'));
	for (const file of ['_headers', '_redirects']) fs.copyFileSync(path.join(root, 'deploy', file), path.join(dist, file));
	console.log('build: pages copied');

	if (!skipData) await exportData();
	checkSizes(dist);
	console.log('build: done');
}

/**
 * Switch a page to static mode (public/static-service.js) and drop the admin controller.
 */
function enableStaticMode(file) {
	let html = fs.readFileSync(file, 'utf8');
	const script = '\t<script src="/static-service.js" type="text/javascript"></script>';
	if (!html.includes(script)) throw new Error(`${file}: static-service.js is not loaded`);
	html = html.replace(script, '\t<script>window.MANYCORE_STATIC = { base: \'/data/\' };</script>\n' + script);
	html = html.replace(/\t<script src="\/admin\/admin\.controller\.js"[^>]*><\/script>\n/, '');
	fs.writeFileSync(file, html);
}

/**
 * Ask the original server for every answer the front end can request, one profile at a time.
 */
async function exportData() {
	process.chdir(root); // routes/common/profiles.common.js reads data/ relative to the working directory
	process.env.NODE_ENV = 'production';
	const app = require('../app');
	const server = await new Promise((resolve) => {
		const s = app.listen(0, '127.0.0.1', () => resolve(s));
	});
	const origin = `http://127.0.0.1:${server.address().port}`;

	const target = path.join(dist, 'data');
	fs.rmSync(target, { recursive: true, force: true });

	let files = 0, raw = 0, packed = 0;
	const missing = [];
	async function save(service, file) {
		const response = await fetch(`${origin}/service/${service}`);
		if (response.status !== 200) {
			// The server has no data for this view of this profile; the front end gets a 500 as before
			missing.push(`${service} (${response.status})`);
			return;
		}
		const body = Buffer.from(await response.arrayBuffer());
		JSON.parse(body); // an "Illegal identifier" answer would be text with a 200 status
		const gz = zlib.gzipSync(body, { level: 9 });
		const out = path.join(target, file + '.gz');
		fs.mkdirSync(path.dirname(out), { recursive: true });
		fs.writeFileSync(out, gz);
		files++;
		raw += body.length;
		packed += gz.length;
	}

	try {
		await save('profiles', 'profiles.json');
		const profiles = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(target, 'profiles.json.gz'))));

		// Warm the caches first. When a cache is missing, the server answers its first request from the data it
		// has just computed, then every later request from the cache file, where JSON turned NaN into null: the
		// answers differ (null counts as 0). Export what a running server answered, i.e. the cached state.
		for (const profile of profiles) {
			await fetch(`${origin}/service/dash/${profile.id}`).then((response) => response.arrayBuffer());
		}
		console.log('build: caches ready');

		for (const [index, profile] of profiles.entries()) {
			const id = profile.id;
			const started = Date.now();
			await save(`dash/${id}`, `dash/${id}.json`);
			await save(`raw/${id}`, `raw/${id}.json`);
			for (const cat of CATEGORIES) await save(`details/${cat}/${id}`, `details/${cat}/${id}.json`);
			console.log(`build: [${index + 1}/${profiles.length}] profile ${id} ${profile.disabled ? '(disabled) ' : ''}in ${Date.now() - started} ms`);
		}
	} finally {
		server.close();
	}

	const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
	console.log(`build: ${files} answers, ${mb(raw)} of JSON, ${mb(packed)} gzipped`);
	if (missing.length) console.log(`build: ${missing.length} answers not available: ${missing.join(', ')}`);
}

function checkSizes(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (!entry.isFile()) continue;
		const file = path.join(entry.parentPath || entry.path, entry.name);
		if (fs.statSync(file).size > MAX_FILE) throw new Error(`${path.relative(root, file)} is over 25 MiB`);
	}
}

main().then(() => process.exit(0), (error) => {
	console.error(error);
	process.exit(1);
});
