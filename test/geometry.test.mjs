// Prüft alle Grundformen und Vorlagen: wasserdicht, auf dem Bett, erwartete Teilezahl
import Module from '../node_modules/manifold-3d/manifold.js';
import * as G from '../src/renderer/js/geometry.js';
import { TEMPLATES } from '../src/renderer/js/templates.js';
await G.initGeometry(Module);
const ctx = { assets: {}, seg: 64, textToPolygons: () => [[[0, 0], [5, 0], [5, 5], [0, 5]]] };
let fail = 0, n = 0;
function check(name, node, parts) {
  n++; const r = G.evaluate(node, ctx); let zmin = Infinity;
  for (let i = 2; i < r.vert.length; i += 3) zmin = Math.min(zmin, r.vert[i]);
  const ok = r.ok && Math.abs(zmin) < 1e-3 && (parts == null || r.parts === parts);
  if (!ok) fail++;
  console.log(`${ok ? '✔' : '✘'} ${name.padEnd(40)} Teile ${r.parts}  Z-min ${zmin.toFixed(3)}  ${r.error || ''}`);
}
for (const t of Object.keys(G.PRIMITIVES)) check('Grundform ' + t, { type: t, params: {} }, 1);
const expectParts = { 'Alle Teile': 3, 'Beide': 2 };
for (const [id, T] of Object.entries(TEMPLATES)) {
  const part = T.params.find(p => p.key === 'part');
  for (const opt of part ? part.options : [null]) for (const v of id === 'halo' ? ['A', 'B'] : [null]) {
    const params = {}; if (opt) params.part = opt; if (v) params.variant = v;
    check(`Vorlage ${id} ${opt || ''} ${v || ''}`, { type: 'template', template: id, params }, id === 'spacer' ? 4 : (expectParts[opt] ?? 1));
  }
}
check('Differenz Quader − Zylinder', { type: 'difference', params: {}, children: [{ type: 'box', params: {} }, { type: 'cylinder', params: { d: 10, h: 30 }, pos: [0, 0, -5] }] }, 1);
const box = (w = 20, x = 0) => ({ type: 'box', params: { w, d: 20, h: 20 }, pos: [x, 0, 0] });
check('Hülle zweier Kugeln', { type: 'hull', params: {}, children: [{ type: 'sphere', params: {} }, { type: 'sphere', params: {}, pos: [30, 0, 0] }] }, 1);
for (const open of ['Geschlossen', 'Oben offen', 'Unten offen']) {
  const node = { type: 'shell', params: { t: 2, open }, children: [box()] }; check('Aushöhlen Quader ' + open, node, 1);
  const r = G.evaluate(node, ctx); const exp = open === 'Geschlossen' ? 8000 - 16 ** 3 : 8000 - 16 * 16 * 18;
  if (Math.abs(r.volume - exp) > 1) { fail++; console.log('✘ Volumen Aushöhlen', open, r.volume.toFixed(1), 'erwartet', exp); }
}
check('Aushöhlen Zylinder', { type: 'shell', params: { t: 1.6 }, children: [{ type: 'cylinder', params: {} }] }, 1);
check('Aushöhlen Kugel', { type: 'shell', params: { t: 1.5 }, children: [{ type: 'sphere', params: {} }] }, 1);
check('Abschneiden Z 50 % unten', { type: 'cut', params: {}, children: [box()] }, 1);
for (const mode of ['Reihe X', 'Reihe Y', 'Raster XY', 'Kreis']) check('Muster ' + mode, { type: 'pattern', params: { mode }, children: [box(10)] }, mode === 'Raster XY' ? 12 : 4);
console.log(`\n${n - fail}/${n} bestanden`); process.exit(fail ? 1 : 0);
