// Baut die Oberfläche nach dist/renderer
import * as esbuild from 'esbuild';
import fs from 'node:fs';
const out = 'dist/renderer';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: ['src/renderer/js/app.js'], bundle: true, format: 'esm', platform: 'browser', target: 'chrome130',
  outfile: `${out}/app.js`, loader: { '.json': 'json' }, external: ['node:*', 'module'], minify: process.argv.includes('--min'),
  sourcemap: !process.argv.includes('--min'), logLevel: 'info',
});
for (const f of ['index.html', 'styles.css']) fs.copyFileSync(`src/renderer/${f}`, `${out}/${f}`);
fs.copyFileSync('node_modules/manifold-3d/manifold.wasm', `${out}/manifold.wasm`);
console.log('Renderer gebaut →', out);
