/*
 * Static mode: answer the /service/* requests from pre-computed files instead of the Node server.
 *
 * The dashboard was written against an Express server (routes/) that computes every answer from the raw
 * profiling traces. Those answers only depend on the profile ids, so `npm run build` asks the real server for
 * every profile once and stores each answer, gzipped, under /data/. This module then decorates $httpBackend, so
 * the application code still calls /service/... and receives exactly what the server used to send:
 *
 *   GET  /service/profiles                   -> data/profiles.json.gz
 *   GET  /service/profiles/<ids>             -> data/profiles.json.gz, filtered
 *   GET  /service/dash/<id>                  -> data/dash/<id>.json.gz
 *   GET  /service/raw/<ids>                  -> data/raw/<id>.json.gz, one per id, merged
 *   GET  /service/details/<cat>/<ids>        -> data/details/<cat>/<id>.json.gz, one per id, merged
 *   anything else under /service/            -> 404 (the admin pages and the user study need the server)
 *
 * The files are gzipped by the build (the largest answer is 36 MB of JSON, 1.3 MB gzipped, while Cloudflare
 * serves 25 MiB at most per file) and inflated here with DecompressionStream.
 *
 * Static mode is on only when the page sets window.MANYCORE_STATIC (the build injects it): with `npm start`,
 * requests go to the live server as before.
 */
(function () {
	'use strict';

	var config = window.MANYCORE_STATIC;
	var base = (config && config.base) || '/data/';

	angular.module('manycoreStatic', []).config(['$provide', function ($provide) {
		if (!config) return;

		$provide.decorator('$httpBackend', ['$delegate', '$q', function ($delegate, $q) {
			return function (method, url, post, callback, headers, timeout, withCredentials, responseType) {
				var path = url.split('?')[0];
				if (path.indexOf('/service/') !== 0) {
					return $delegate.apply(this, arguments);
				}

				var parts = path.substr('/service/'.length).split('/');
				var answer;
				try {
					answer = route(method, parts);
				} catch (e) {
					answer = $q.reject(e);
				}

				$q.when(answer).then(function (data) {
					callback(200, data, 'Content-Type: application/json', 'OK');
				}, function (error) {
					var status = (error && error.status) || 500;
					if (status >= 500) console.error('[static]', method, url, error);
					callback(status, (error && error.message) || 'Error', '', status === 404 ? 'Not Found' : 'Error');
				});
			};

			// Same answers as routes/*.js
			function route(method, parts) {
				var service = parts[0];

				if (method !== 'GET') throw httpError(405, 'Method not allowed');

				switch (service) {
					case 'profiles':
						return load('profiles.json').then(function (all) {
							if (!parts[1]) return all;
							// routes/profiles.js: keep the requested order, skip unknown and repeated ids
							var byId = {}, seen = {}, selected = [];
							all.forEach(function (p) { byId[p.id] = p; });
							parts[1].split('-').forEach(function (id) {
								if (byId.hasOwnProperty(id) && !seen[id]) {
									selected.push(byId[id]);
									seen[id] = true;
								}
							});
							return selected;
						});

					case 'dash':
						return load('dash/' + checkId(parts[1]) + '.json');

					case 'raw':
						return merge('raw/', parts[1]);

					case 'details':
						if (['tg', 'sy', 'ds', 'lb', 'dl', 'rs', 'io'].indexOf(parts[1]) < 0) {
							throw httpError(400, 'Illegal category');
						}
						return merge('details/' + parts[1] + '/', parts[2]);

					default:
						throw httpError(404, 'Not available in the static demo');
				}
			}

			// routes/raw.js and routes/details.js: { <id>: answer, ..., c: { timeMin, timeMax, duration } }
			function merge(folder, idList) {
				var ids = (idList || '').split('-');
				if (ids.length === 0 || ids.length > 4) throw httpError(400, 'Illegal number of identifiers');
				ids.forEach(checkId);

				return $q.all(ids.map(function (id) {
					return load(folder + id + '.json');
				})).then(function (answers) {
					var output = { c: {} };
					answers.forEach(function (answer, index) {
						var id = ids[index];
						output[id] = answer[id];
						output.c.timeMin = Math.min(output[id].info.timeMin, output.c.timeMin | 0);
						output.c.timeMax = Math.max(output[id].info.timeMax, output.c.timeMax | 0);
						output.c.duration = Math.max(output[id].info.duration, output.c.duration | 0);
					});
					return output;
				});
			}

			function checkId(id) {
				if (!id || !/^[0-9]+$/.test(id)) throw httpError(400, 'Illegal identifier');
				return id;
			}

			function httpError(status, message) {
				var error = new Error(message);
				error.status = status;
				return error;
			}
		}]);
	}]);

	// Fetch and inflate one pre-computed answer. The text is cached, but every call parses it again: like the
	// server, each request gets its own objects, which the controllers are free to modify.
	var cache = {};
	function load(name) {
		return loadText(name).then(JSON.parse);
	}
	function loadText(name) {
		if (!cache[name]) {
			cache[name] = fetch(base + name + '.gz').then(function (response) {
				if (!response.ok) {
					// The server answered 500 when a profile had no data for a view
					var error = new Error(name + ': ' + response.status);
					error.status = response.status === 404 ? 500 : response.status;
					throw error;
				}
				return response.arrayBuffer();
			}).then(function (buffer) {
				var bytes = new Uint8Array(buffer);
				// gzip magic number; a server or proxy may already have inflated the file
				if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return new Response(buffer).text();
				var stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
				return new Response(stream).text();
			});
			cache[name].catch(function () { delete cache[name]; });
		}
		return cache[name];
	}
})();
