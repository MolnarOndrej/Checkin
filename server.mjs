import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const assets = new Set([
  'index.html', 'styles.css', 'app.js', 'calendar.js', 'measurements.js', 'journal-storage.js',
  'timeline.js', 'timeline-data.js', 'graph.js', 'submit-sound.js', 'mark.svg',
]);
const soundFiles = await readdir(new URL('./submitsounds/', import.meta.url), { withFileTypes: true });
const sounds = new Map(soundFiles
  .filter((file) => file.isFile() && extname(file.name).toLowerCase() === '.mp3')
  .map(({ name }) => {
    const path = `submitsounds/${encodeURIComponent(name)}`;
    return [path, new URL(path, import.meta.url)];
  }));
const soundList = JSON.stringify([...sounds.keys()]);
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  const file = path === '/' ? 'index.html' : path.slice(1);
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const source = sounds.get(file) ?? (assets.has(file) ? new URL(`./dist/${file}`, import.meta.url) : undefined);
  if (!source && file !== 'submitsounds.json') {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const content = source ? await readFile(source) : soundList;
    response.writeHead(200, { 'Content-Type': contentTypes[extname(file).toLowerCase()] });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end('Could not load the application');
  }
});

server.listen(port, host, () => console.log(`Checkin is ready at http://${host}:${server.address().port}`));
