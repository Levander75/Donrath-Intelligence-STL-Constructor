// Donrath Intelligence STL Constructor – Geometrie-Kern (Manifold / WASM)
// Koordinaten: Z nach oben, Einheit mm.
import { TEMPLATES } from './templates.js';

let W = null; // Manifold-WASM-Instanz

export async function initGeometry(moduleFactory, opts = {}) {
  W = await moduleFactory(opts);
  W.setup();
  return W;
}
export function wasm() { return W; }

// ---------------------------------------------------------------------------
// Speicherverwaltung: jede Manifold/CrossSection-Instanz wird in einer Arena
// gesammelt und nach der Auswertung freigegeben.
export class Arena {
  constructor() { this.objs = []; }
  k(o) { if (o && typeof o.delete === 'function') this.objs.push(o); return o; }
  free() { for (const o of this.objs) { try { o.delete(); } catch (e) { /* bereits frei */ } } this.objs = []; }
}

// Werkzeugkasten für Primitive und Vorlagen. Alle Rückgaben landen in der Arena.
export function makeKit(A, seg = 64) {
  const { Manifold: M, CrossSection: C } = W;
  const kit = {
    seg,
    M, C,
    rrect(w, h, r) {
      r = Math.max(0.01, Math.min(r, w / 2 - 0.01, h / 2 - 0.01));
      const sq = A.k(C.square([Math.max(w - 2 * r, 0.02), Math.max(h - 2 * r, 0.02)], true));
      return A.k(sq.offset(r, 'Round', 2, seg));
    },
    circle(r, s = seg) { return A.k(C.circle(r, s)); },
    extrude(cs, z0, z1) { return A.k(A.k(cs.extrude(z1 - z0)).translate([0, 0, z0])); },
    rbox(w, h, z0, z1, r, fil = 0) {
      if (fil <= 0) return kit.extrude(kit.rrect(w, h, r), z0, z1);
      const parts = [kit.extrude(kit.rrect(w, h, r), z0, z1 - fil)];
      for (let i = 1; i <= 8; i++) {
        const a = (i / 8) * Math.PI / 2;
        const d = fil * (1 - Math.cos(a));
        const dz = fil * Math.sin(a);
        parts.push(kit.extrude(kit.rrect(w - 2 * d, h - 2 * d, Math.max(r - d, 0.5)), z1 - fil + dz - 0.01, z1 - fil + dz));
      }
      return A.k(M.hull(parts));
    },
    cyl(d, z0, z1, x = 0, y = 0, s = seg) {
      return A.k(A.k(M.cylinder(z1 - z0, d / 2, d / 2, s)).translate([x, y, z0]));
    },
    cone(d0, d1, z0, z1, x = 0, y = 0, s = seg) {
      return A.k(A.k(M.cylinder(z1 - z0, d0 / 2, d1 / 2, s)).translate([x, y, z0]));
    },
    slot(w, h, z0, z1, x = 0, y = 0) {
      return A.k(kit.extrude(kit.rrect(w, h, h / 2 - 0.01), z0, z1).translate([x, y, 0]));
    },
    poly(pts, z0, z1) {
      return kit.extrude(A.k(C.ofPolygons([pts], 'NonZero')), z0, z1);
    },
    union(list) { list = list.filter(Boolean); return list.length === 1 ? list[0] : A.k(M.union(list)); },
    sub(a, ...bs) { let r = a; for (const b of bs.flat()) if (b) r = A.k(r.subtract(b)); return r; },
    add(a, ...bs) { let r = a; for (const b of bs.flat()) if (b) r = A.k(r.add(b)); return r; },
    toBed(m) { const b = m.boundingBox(); return A.k(m.translate([0, 0, -b.min[2]])); },
    flipToBed(m) { const r = A.k(m.rotate([180, 0, 0])); return kit.toBed(r); },
    centerXY(m) { const b = m.boundingBox(); return A.k(m.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, 0])); },
    row(list, gap = 10) { // Teile nebeneinander aufs Bett legen
      let x = 0; const out = [];
      const widths = list.map(m => { const b = m.boundingBox(); return b.max[0] - b.min[0]; });
      const total = widths.reduce((a, b) => a + b, 0) + gap * (list.length - 1);
      x = -total / 2;
      list.forEach((m, i) => {
        const b = m.boundingBox();
        out.push(A.k(m.translate([x - b.min[0], -(b.min[1] + b.max[1]) / 2, -b.min[2]])));
        x += widths[i] + gap;
      });
      return kit.union(out);
    },
  };
  return kit;
}

// ---------------------------------------------------------------------------
// Primitive (lokale Koordinaten, XY-zentriert, Unterkante auf Z = 0)
export const PRIMITIVES = {
  box: {
    label: 'Quader', params: [
      { key: 'w', label: 'Breite X', type: 'num', min: 0.1, step: 0.5, def: 20 },
      { key: 'd', label: 'Tiefe Y', type: 'num', min: 0.1, step: 0.5, def: 20 },
      { key: 'h', label: 'Höhe Z', type: 'num', min: 0.1, step: 0.5, def: 20 },
      { key: 'r', label: 'Eckenradius', type: 'num', min: 0, step: 0.5, def: 0 },
      { key: 'fil', label: 'Oberkante verrunden', type: 'num', min: 0, step: 0.5, def: 0 },
    ],
    build(k, A, p) {
      if (p.r > 0 || p.fil > 0) return k.rbox(p.w, p.d, 0, p.h, Math.max(p.r, 0.01), Math.min(p.fil, p.h * 0.9));
      return A.k(A.k(k.M.cube([p.w, p.d, p.h], true)).translate([0, 0, p.h / 2]));
    },
  },
  cylinder: {
    label: 'Zylinder', params: [
      { key: 'd', label: 'Durchmesser', type: 'num', min: 0.1, step: 0.5, def: 20 },
      { key: 'h', label: 'Höhe', type: 'num', min: 0.1, step: 0.5, def: 20 },
      { key: 'seg', label: 'Segmente', type: 'num', min: 3, max: 256, step: 1, def: 96 },
    ],
    build(k, A, p) { return k.cyl(p.d, 0, p.h, 0, 0, Math.round(p.seg)); },
  },
  tube: {
    label: 'Rohr', params: [
      { key: 'do', label: 'Außen-Ø', type: 'num', min: 0.2, step: 0.5, def: 20 },
      { key: 'di', label: 'Innen-Ø', type: 'num', min: 0.1, step: 0.5, def: 14 },
      { key: 'h', label: 'Höhe', type: 'num', min: 0.1, step: 0.5, def: 20 },
    ],
    build(k, A, p) { return k.sub(k.cyl(p.do, 0, p.h), k.cyl(Math.min(p.di, p.do - 0.2), -1, p.h + 1)); },
  },
  cone: {
    label: 'Kegel', params: [
      { key: 'd0', label: 'Ø unten', type: 'num', min: 0, step: 0.5, def: 20 },
      { key: 'd1', label: 'Ø oben', type: 'num', min: 0, step: 0.5, def: 0 },
      { key: 'h', label: 'Höhe', type: 'num', min: 0.1, step: 0.5, def: 20 },
    ],
    build(k, A, p) { return k.cone(Math.max(p.d0, 0.001), Math.max(p.d1, 0.001), 0, p.h); },
  },
  sphere: {
    label: 'Kugel', params: [
      { key: 'd', label: 'Durchmesser', type: 'num', min: 0.1, step: 0.5, def: 20 },
    ],
    build(k, A, p) { return A.k(A.k(k.M.sphere(p.d / 2, 96)).translate([0, 0, p.d / 2])); },
  },
  torus: {
    label: 'Ring (Torus)', params: [
      { key: 'R', label: 'Ring-Ø', type: 'num', min: 1, step: 0.5, def: 30 },
      { key: 'r', label: 'Profil-Ø', type: 'num', min: 0.2, step: 0.5, def: 8 },
    ],
    build(k, A, p) {
      const R = p.R / 2, r = Math.min(p.r / 2, R - 0.05);
      const prof = A.k(A.k(k.C.circle(r, 48)).translate([R, 0]));
      return A.k(A.k(k.M.revolve(prof, 96)).translate([0, 0, r]));
    },
  },
  prism: {
    label: 'Prisma', params: [
      { key: 'n', label: 'Ecken', type: 'num', min: 3, max: 24, step: 1, def: 6 },
      { key: 'd', label: 'Umkreis-Ø', type: 'num', min: 0.1, step: 0.5, def: 20 },
      { key: 'h', label: 'Höhe', type: 'num', min: 0.1, step: 0.5, def: 10 },
    ],
    build(k, A, p) { return k.cyl(p.d, 0, p.h, 0, 0, Math.round(p.n)); },
  },
  text: {
    label: 'Text', params: [
      { key: 'text', label: 'Text', type: 'text', def: 'TUBIQ' },
      { key: 'size', label: 'Schrifthöhe', type: 'num', min: 1, step: 0.5, def: 10 },
      { key: 'h', label: 'Tiefe', type: 'num', min: 0.1, step: 0.1, def: 2 },
    ],
    build(k, A, p, ctx) {
      const polys = ctx.textToPolygons(p.text || ' ', p.size);
      if (!polys.length) return A.k(k.M.cube([0.01, 0.01, 0.01]));
      const cs = A.k(k.C.ofPolygons(polys, 'EvenOdd'));
      return k.centerXY(k.extrude(cs, 0, p.h));
    },
  },
};

export const BOOLEAN_TYPES = { union: 'Vereinigung', difference: 'Differenz', intersection: 'Schnittmenge', group: 'Gruppe' };

export function typeLabel(t) {
  if (PRIMITIVES[t]) return PRIMITIVES[t].label;
  if (BOOLEAN_TYPES[t]) return BOOLEAN_TYPES[t];
  if (t === 'import') return 'Import';
  if (t === 'template') return 'Vorlage';
  return t;
}

export function paramSchema(node) {
  if (PRIMITIVES[node.type]) return PRIMITIVES[node.type].params;
  if (node.type === 'template' && TEMPLATES[node.template]) return TEMPLATES[node.template].params;
  return [];
}
export function defaultParams(schema) {
  const p = {}; for (const s of schema) p[s.key] = s.def; return p;
}

// ---------------------------------------------------------------------------
// Auswertung eines Knotens zu Netzdaten (lokale Koordinaten des Knotens)
// Rückgabe: { vert: Float32Array (xyz), tri: Uint32Array, ok: bool, error?: string, parts: n }
const cache = new Map();
export function clearCache() { cache.clear(); }

function nodeKey(node, ctx) {
  const strip = (n) => ({ t: n.type, tp: n.template, p: n.params, a: n.asset, v: n.visible !== false, mf: n.mf,
    c: (n.children || []).map(c => ({ ...strip(c), pos: c.pos, rot: c.rot, scale: c.scale })) });
  return JSON.stringify(strip(node)) + '|' + (ctx.seg || 64);
}

export function evaluate(node, ctx) {
  const key = nodeKey(node, ctx);
  if (cache.has(key)) return cache.get(key);
  const A = new Arena();
  let res;
  try {
    const m = buildManifold(node, ctx, A, false);
    if (!m) throw new Error('Leeres Ergebnis');
    const status = m.status();
    const mesh = m.getMesh();
    res = {
      vert: new Float32Array(stripProps(mesh)), tri: new Uint32Array(mesh.triVerts),
      ok: status === 'NoError', error: status === 'NoError' ? null : status,
      volume: m.volume(), area: m.surfaceArea(), genus: m.genus(),
      parts: (() => { try { const d = m.decompose(); const n = d.length; d.forEach(x => x.delete()); return n; } catch (e) { return 1; } })(),
    };
  } catch (e) {
    // Fallback: Importnetz, das nicht wasserdicht ist, wird roh angezeigt
    if (node.type === 'import' && ctx.assets[node.asset]) {
      const a = ctx.assets[node.asset];
      res = { vert: a.vert, tri: a.tri, ok: false, error: 'Netz nicht wasserdicht – Boolesche Operationen nicht möglich', volume: 0, area: 0, parts: 1, raw: true };
    } else {
      res = { vert: new Float32Array(0), tri: new Uint32Array(0), ok: false, error: String(e.message || e), volume: 0, area: 0, parts: 0 };
    }
  } finally { A.free(); }
  if (cache.size > 400) cache.clear();
  cache.set(key, res);
  return res;
}

function stripProps(mesh) {
  if (mesh.numProp === 3) return mesh.vertProperties;
  const n = mesh.vertProperties.length / mesh.numProp; const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = mesh.vertProperties[i * mesh.numProp + j];
  return out;
}

export function manifoldFromData(vert, tri, A) {
  const mesh = new W.Mesh({ numProp: 3, vertProperties: vert, triVerts: tri });
  mesh.merge();
  return A.k(W.Manifold.ofMesh(mesh));
}

function applyTransform(m, node, A) {
  const s = node.scale || [1, 1, 1], r = node.rot || [0, 0, 0], p = node.pos || [0, 0, 0];
  let out = m;
  if (s[0] !== 1 || s[1] !== 1 || s[2] !== 1) out = A.k(out.scale(s));
  if (r[0] || r[1] || r[2]) out = A.k(out.rotate(r));
  if (p[0] || p[1] || p[2]) out = A.k(out.translate(p));
  return out;
}

export function buildManifold(node, ctx, A, withTransform) {
  const kit = makeKit(A, ctx.seg || 64);
  let m;
  if (PRIMITIVES[node.type]) {
    m = PRIMITIVES[node.type].build(kit, A, { ...defaultParams(PRIMITIVES[node.type].params), ...node.params }, ctx);
  } else if (node.type === 'template') {
    const T = TEMPLATES[node.template];
    if (!T) throw new Error('Unbekannte Vorlage ' + node.template);
    m = T.build(kit, A, { ...defaultParams(T.params), ...node.params });
  } else if (node.type === 'import') {
    const a = ctx.assets[node.asset];
    if (!a) throw new Error('Importdaten fehlen');
    m = manifoldFromData(a.vert, a.tri, A);
    if (m.status() !== 'NoError' || m.isEmpty()) throw new Error('Netz nicht wasserdicht');
  } else if (BOOLEAN_TYPES[node.type]) {
    const kids = (node.children || []).filter(c => c.visible !== false || node.type === 'difference');
    const ms = kids.map(c => buildManifold(c, ctx, A, true)).filter(Boolean);
    if (!ms.length) throw new Error('Keine Kinder');
    if (node.type === 'union' || node.type === 'group') m = ms.length === 1 ? ms[0] : A.k(W.Manifold.union(ms));
    else if (node.type === 'difference') m = ms.length === 1 ? ms[0] : A.k(ms[0].subtract(A.k(W.Manifold.union(ms.slice(1)))));
    else m = ms.length === 1 ? ms[0] : A.k(W.Manifold.intersection(ms));
  } else throw new Error('Unbekannter Typ ' + node.type);
  if (node.mf) {
    const b0 = m.boundingBox(); const c = [0, 1, 2].map(i => (b0.min[i] + b0.max[i]) / 2);
    ['x', 'y', 'z'].forEach((ax, i) => {
      if (!node.mf[ax]) return;
      const nrm = [0, 0, 0]; nrm[i] = 1;
      const t = [0, 0, 0]; t[i] = -c[i]; const t2 = [0, 0, 0]; t2[i] = c[i];
      m = A.k(A.k(A.k(m.translate(t)).mirror(nrm)).translate(t2)); // um die eigene Mitte spiegeln
    });
  }
  return withTransform ? applyTransform(m, node, A) : m;
}

// Mehrere Weltknoten zu einem Netz (für Export) zusammenführen
export function exportMesh(nodes, ctx) {
  const A = new Arena();
  try {
    const ms = nodes.map(n => buildManifold(n, ctx, A, true));
    const m = ms.length === 1 ? ms[0] : A.k(W.Manifold.union(ms));
    const mesh = m.getMesh();
    return { vert: new Float32Array(stripProps(mesh)), tri: new Uint32Array(mesh.triVerts), ok: m.status() === 'NoError' };
  } finally { A.free(); }
}

// Schnitt (Z-Ebene) als Konturen – für die Schnittansicht
export function sliceAt(vert, tri, z) {
  const A = new Arena();
  try {
    const m = manifoldFromData(vert, tri, A);
    const cs = A.k(m.slice(z));
    return cs.toPolygons();
  } catch (e) { return []; } finally { A.free(); }
}
