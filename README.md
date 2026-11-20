# ManyCore Dashboard

A new way to profile parallel applications: performance issues are sorted into categories (task granularity,
synchronisation, data sharing, load balancing, data locality, resource sharing) and browsed visually, from a
dashboard down to detailed timelines of threads, cores, locks and caches.

**Live demo: <https://manycore.baxyz.dev>**

Built in 2015-2016 by Bérenger Arnaud in the [ManyCore research group](https://www.scss.tcd.ie/ManyCore/) of
Trinity College Dublin, as part of research conducted at Lero, the Irish Software Engineering Research Centre,
funded by Science Foundation Ireland. The profiles were collected with
[Harvester](https://github.com/manycore/harvester) by Roman Atachiants, on benchmarks such as
[matmul](https://github.com/manycore/matmul).

This repository is a fork of [manycore/manycore-dashboard](https://github.com/manycore/manycore-dashboard), kept to
run the demo. The original repository is left untouched.

## What is in the demo

- `/` — the dashboard: pick one or two profiles, read the gauges, then drill down into a category
- `/xp/` — the online user study run with the dashboard in 2016 (consent, training, tasks, questionnaire). The study
  is closed: the pages still work, but nothing is recorded.

## How the static demo works

The dashboard was an AngularJS 1.5 front end (`public/`, `public_xp/`) talking to an Express server (`app.js`,
`routes/`) that computed every answer from about 1 GB of raw traces (`data/`). Those answers only depend on the
profile ids, so the demo is static:

1. `npm run build` starts the original server, asks it once for every answer the front end can request (9 per
   profile) and stores them gzipped in `dist/data/`: 530 answers, 139 MB of JSON, 8 MB gzipped. Each stored answer
   is byte for byte what the server sends.
2. `public/static-service.js` decorates AngularJS's `$httpBackend`: the application code still calls
   `/service/...` and receives the stored answers, merged when it compares two profiles, inflated in the browser
   with `DecompressionStream`. Gzipping keeps every file far below the 25 MiB limit of Cloudflare static assets
   (the largest answer is 36 MB of JSON, 1.3 MB gzipped).
3. `dist/` is served by a Cloudflare Worker with static assets only (`wrangler.jsonc`).

The front-end libraries are pinned to the versions of summer 2016 (AngularJS 1.5.8, D3 3.5.17, UI-Router 0.3.1,
Bootstrap 3.3.7 with the Yeti theme…): bower asked for "latest", which no longer resolves to compatible versions.
`scripts/vendor.js` copies them from `node_modules/` to the paths bower used.

Changes to the original front end are limited to:

- loading `static-service.js` (inactive unless the page sets `window.MANYCORE_STATIC`, which only the build does);
- the drawing of lock dependencies (`public/details/widgets/widgets.directive.js`): the profile "Program B" (221)
  holds over a million lock events, and drawing one SVG element per event froze the browser, with the original
  server too. Marks piling up on the same spot are now drawn a few times only and contiguous holding periods are
  merged: the other profiles render the same pixels, and 221 opens in about ten seconds.

## Development

Node.js 20 or later.

```bash
npm install
npm start          # the original server on http://localhost:3000 (builds data/*.cache.json on first use)
npm run build      # the static demo in dist/ (--skip-data: pages only, keeps dist/data/)
npm run preview    # serves dist/ with the Workers runtime on http://localhost:8787
```

## Deployment

Cloudflare Workers Builds deploys `main` to <https://manycore.baxyz.dev>: build command `npm run build`, deploy
command `npx wrangler deploy`. GitHub Actions only checks that the build passes.
