/* Zero-dependency static server.
 *
 * Deliberately written as old-school CommonJS with no modern syntax so it
 * starts on basically any Node ever shipped on a Mac (v8 and up). The GAME
 * is modern ES modules, but those are parsed by your browser, not by Node --
 * Node's only job here is to hand the files over via http://, because
 * browsers refuse to load ES modules from file:// .
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var url = require('url');

var ROOT = process.cwd();
var PORT = Number(process.env.PORT || 8080);

var TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function send(res, code, type, body) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-cache' });
  res.end(body);
}

http.createServer(function (req, res) {
  var pathname;
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname);
  } catch (e) {
    return send(res, 400, 'text/plain', 'bad request');
  }
  if (pathname.charAt(pathname.length - 1) === '/') pathname += 'index.html';

  var file = path.join(ROOT, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (file.indexOf(ROOT) !== 0) return send(res, 403, 'text/plain', 'forbidden');

  fs.stat(file, function (err, info) {
    if (err || !info.isFile()) return send(res, 404, 'text/plain', '404 ' + pathname);
    fs.readFile(file, function (err2, body) {
      if (err2) return send(res, 500, 'text/plain', 'read error');
      send(res, 200, TYPES[path.extname(file)] || 'application/octet-stream', body);
    });
  });
}).listen(PORT, function () {
  var major = Number(process.versions.node.split('.')[0]);
  console.log('');
  console.log('  BE KIND, REWIND  ->  http://localhost:' + PORT);
  console.log('  serving ' + ROOT);
  console.log('  node ' + process.versions.node);
  if (major < 14) {
    console.log('');
    console.log('  (Old Node, but that is fine -- this server does not need a new one.');
    console.log('   The game itself runs in your browser. If it will not load, your');
    console.log('   browser is the thing to update, not Node.)');
  }
  console.log('');
});
