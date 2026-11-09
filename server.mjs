import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const assets = new Set(['index.html', 'styles.css', 'app.js', 'calendar.js', 'celebration.js', 'pinned-goals.js', 'backup.js', 'trail.svg', 'mark.svg']);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (!assets.has(file)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const content = await readFile(new URL(`./dist/${file}`, import.meta.url));
    response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end('Could not load the application');
  }
});

server.listen(port, host, () => console.log(`Checkin is ready at http://${host}:${server.address().port}`));
