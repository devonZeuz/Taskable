const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function getMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return MIME_TYPES[extension] || 'application/octet-stream';
}

function resolveSafePath(distDir, requestPath) {
  const cleanPath = requestPath.split('?')[0].split('#')[0];
  const decodedPath = decodeURIComponent(cleanPath || '/');
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const targetPath = path.resolve(distDir, relativePath);
  if (!targetPath.startsWith(path.resolve(distDir))) {
    return null;
  }
  return targetPath;
}

function startStaticServer({ distDir, host = '127.0.0.1', port = 0 }) {
  const server = http.createServer((req, res) => {
    const requestedPath = req.url || '/';
    const safePath = resolveSafePath(distDir, requestedPath);
    if (!safePath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    const requestedExtension = path.extname(safePath);
    const shouldServeFileDirectly = requestedExtension.length > 0;
    const filePath =
      shouldServeFileDirectly && fs.existsSync(safePath)
        ? safePath
        : path.resolve(distDir, 'index.html');

    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        'Content-Type': getMimeType(filePath),
        'Cache-Control': shouldServeFileDirectly
          ? 'public, max-age=31536000, immutable'
          : 'no-store',
      });
      res.end(content);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal server error');
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine static server address.'));
        return;
      }

      resolve({
        url: `http://${host}:${address.port}`,
        close: () =>
          new Promise((closeResolve) => {
            server.close(() => closeResolve());
          }),
      });
    });
  });
}

module.exports = {
  startStaticServer,
};
