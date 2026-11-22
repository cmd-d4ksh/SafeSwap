// Zero-dependency static file server for the frontend (Node >= 18).
// Usage: node server.js            -> http://localhost:5173
//        PORT=3000 node server.js
// The page talks to the Spring Boot API (default http://localhost:8085); override with ?api=http://host:port
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT) || file.endsWith('server.js')) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Frontend on http://localhost:${PORT}  (API expected at http://localhost:8085)`));
