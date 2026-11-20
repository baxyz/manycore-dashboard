/*
 * Run the original server on a free local port for scripts/build.js, in a process of its own: the server computes
 * synchronously (seconds for the largest profiles) and the build parses and gzips answers of tens of MB, so
 * sharing one event loop made each side stall the other. Reports the port to the parent process.
 */
'use strict';
const path = require('path');

process.chdir(path.join(__dirname, '..')); // routes/common/profiles.common.js reads data/ relative to the working directory
process.env.NODE_ENV = 'production';
const app = require('../app');
const server = app.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
process.on('disconnect', () => process.exit(0));
