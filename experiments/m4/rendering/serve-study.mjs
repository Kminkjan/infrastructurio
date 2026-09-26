import { createServer } from 'vite';
import { mkdtemp, cp, symlink, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
export const sources = ['scene.mjs', 'pixi-view.mjs', 'three-view.mjs', 'study.mjs',
  'index.html', 'run-study.mjs', 'serve-study.mjs', 'human-session.mjs',
  '../../../src/rendering/map-camera.ts', '../../../package-lock.json'];
export async function startStudyServer() {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const snapshot = await realpath(await mkdtemp(join(tmpdir(), 'm4-rendering-')));
  let server;
  try {
    for (const name of ['src', 'experiments', 'index.html', 'package.json', 'package-lock.json'])
      await cp(join(root, name), join(snapshot, name), { recursive: true });
    await symlink(join(root, 'node_modules'), join(snapshot, 'node_modules'), 'dir');
    const sourceHashes = {};
    for (const name of sources) sourceHashes[name] = createHash('sha256')
      .update(await readFile(resolve(snapshot, 'experiments/m4/rendering', name))).digest('hex');
    const provenance = { method: 'owned-vite-frozen-source-root', sourceHashes };
    server = await createServer({ configFile: false, root: snapshot,
      server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [snapshot, root] } },
      plugins: [{ name: 'study-provenance', configureServer(s) {
        s.middlewares.use('/__m4_provenance', (_req, res) => {
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(provenance));
        });
      } }] });
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    const served = await (await fetch(`${url}/__m4_provenance`)).json();
    if (JSON.stringify(served) !== JSON.stringify(provenance)) throw new Error('Served provenance mismatch');
    return { url, provenance: served, async close() { await server.close(); await rm(snapshot, { recursive: true, force: true }); } };
  } catch (error) { await server?.close(); await rm(snapshot, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startStudyServer();
  console.log(`Human comparison: ${server.url}/experiments/m4/rendering/index.html?mode=2d&human=1`);
  console.log('Keep this terminal open. Ctrl-C stops only this dedicated server.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
}
