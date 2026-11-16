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
  hemisphere: {
    label: 'Halbkugel', params: [
      { key: 'd', label: 'Durchmesser', type: 'num', min: 0.2, step: 0.5, def: 20 },
    ],
    build(k, A, p) { return A.k(A.k(k.M.sphere(p.d / 2, 96)).trimByPlane([0, 0, 1], 0)); },
  },
  wedge: {
    label: 'Keil', params: [
      { key: 'w', label: 'Breite X', type: 'num', min: 0.1, step: 0.5, def: 20 },
      { key: 'd', label: 'Tiefe Y', type: 'num', min: 0.1, step: 0.5, def: 20 },
      { key: 'h', label: 'Höhe Z', type: 'num', min: 0.1, step: 0.5, def: 15 },
      { key: 'top', label: 'Oberkante Breite', type: 'num', min: 0, step: 0.5, def: 0 },
    ],
    build(k, A, p) {
      const t = Math.min(p.top, p.w);
      const prof = A.k(k.C.ofPolygons([[[-p.w / 2, 0], [p.w / 2, 0], [-p.w / 2 + Math.max(t, 0.001), p.h], [-p.w / 2, p.h]]], 'NonZero'));
      return A.k(A.k(A.k(prof.extrude(p.d)).rotate([90, 0, 0])).translate([0, p.d / 2, 0]));
    },
  },
  pyramid: {
    label: 'Pyramide', params: [
      { key: 'n', label: 'Ecken', type: 'num', min: 3, max: 24, step: 1, def: 4 },
      { key: 'd', label: 'Umkreis-Ø unten', type: 'num', min: 0.1, step: 0.5, def: 28 },
      { key: 'd1', label: 'Ø oben (0 = Spitze)', type: 'num', min: 0, step: 0.5, def: 0 },
      { key: 'h', label: 'Höhe', type: 'num', min: 0.1, step: 0.5, def: 20 },
    ],
    build(k, A, p) { return A.k(k.cone(p.d, Math.max(p.d1, 0.001), 0, p.h, 0, 0, Math.round(p.n)).rotate([0, 0, 180 / Math.round(p.n)])); },
  },
  slot: {
    label: 'Langloch', params: [
      { key: 'l', label: 'Länge', type: 'num', min: 0.2, step: 0.5, def: 30 },
      { key: 'w', label: 'Breite', type: 'num', min: 0.1, step: 0.5, def: 10 },
      { key: 'h', label: 'Höhe', type: 'num', min: 0.1, step: 0.5, def: 5 },
    ],
    build(k, A, p) { return k.extrude(k.rrect(Math.max(p.l, p.w + 0.05), p.w, p.w / 2 - 0.01), 0, p.h); },
  },
  star: {
    label: 'Stern', params: [
      { key: 'n', label: 'Zacken', type: 'num', min: 3, max: 40, step: 1, def: 5 },
      { key: 'd', label: 'Außen-Ø', type: 'num', min: 1, step: 0.5, def: 30 },
      { key: 'di', label: 'Innen-Ø', type: 'num', min: 0.5, step: 0.5, def: 14 },
      { key: 'h', label: 'Höhe', type: 'num', min: 0.1, step: 0.5, def: 4 },
    ],
    build(k, A, p) {
      const n = Math.round(p.n), pts = [];
      for (let i = 0; i < n * 2; i++) { const r = (i % 2 ? Math.min(p.di, p.d - 0.1) : p.d) / 2, a = Math.PI / 2 + i * Math.PI / n; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
      return k.poly(pts, 0, p.h);
    },
  },
  thread: {
    label: 'Gewindestange', params: [
      { key: 'd', label: 'Außen-Ø', type: 'num', min: 2, step: 0.5, def: 10 },
      { key: 'pitch', label: 'Steigung', type: 'num', min: 0.5, step: 0.25, def: 1.5 },
      { key: 'h', label: 'Länge', type: 'num', min: 1, step: 0.5, def: 20 },
    ],
    build(k, A, p) {
      // Dreiecksprofil, als verdrillte Extrusion (druckbar ab ca. M6)
      const r = p.d / 2, depth = Math.min(p.pitch * 0.6, r * 0.4), n = 64, pts = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; const f = Math.abs(((i / n) % 1) * 2 - 1); pts.push([(r - depth * f) * Math.cos(a), (r - depth * f) * Math.sin(a)]); }
      const cs = A.k(k.C.ofPolygons([pts], 'NonZero'));
      const turns = p.h / p.pitch;
      return A.k(cs.extrude(p.h, Math.max(8, Math.round(turns * 24)), -360 * turns));
    },
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

export const BOOLEAN_TYPES = { union: 'Vereinigung', difference: 'Differenz', intersection: 'Schnittmenge', hull: 'Hülle', group: 'Gruppe' };

// Modifikatoren: genau ein Kind, zerstörungsfrei, mit eigenen Parametern
export const MODIFIERS = {
  shell: {
    label: 'Aushöhlen', params: [
      { key: 't', label: 'Wandstärke', type: 'num', min: 0.2, step: 0.1, def: 2 },
      { key: 'open', label: 'Öffnung', type: 'select', options: ['Geschlossen', 'Oben offen', 'Unten offen'], def: 'Geschlossen' },
    ],
    apply(m, p, A) {
      const inner = offsetInward(m, p.t, A);
      let cut = inner;
      if (p.open !== 'Geschlossen') {
        const dz = (p.open === 'Oben offen' ? 1 : -1) * (p.t * 2 + 0.05);
        cut = A.k(W.Manifold.union([inner, A.k(inner.translate([0, 0, dz]))]));
      }
      return A.k(m.subtract(cut));
    },
  },
  cut: {
    label: 'Abschneiden', params: [
      { key: 'axis', label: 'Achse', type: 'select', options: ['Z', 'X', 'Y'], def: 'Z' },
      { key: 'at', label: 'Schnitt bei (%)', type: 'num', min: 0, max: 100, step: 1, def: 50 },
      { key: 'keep', label: 'Behalten', type: 'select', options: ['Unten / Minus', 'Oben / Plus'], def: 'Unten / Minus' },
    ],
    apply(m, p, A) {
      const i = { X: 0, Y: 1, Z: 2 }[p.axis] ?? 2; const b = m.boundingBox();
      const at = b.min[i] + (b.max[i] - b.min[i]) * Math.min(Math.max(p.at, 0), 100) / 100;
      const n = [0, 0, 0]; const plus = String(p.keep).startsWith('Oben'); n[i] = plus ? 1 : -1;
      const r = A.k(m.trimByPlane(n, plus ? at : -at));
      if (r.isEmpty()) throw new Error('Schnitt ergibt nichts');
      return r;
    },
  },
  pattern: {
    label: 'Muster', params: [
      { key: 'mode', label: 'Art', type: 'select', options: ['Reihe X', 'Reihe Y', 'Raster XY', 'Kreis'], def: 'Reihe X' },
      { key: 'n', label: 'Anzahl', type: 'num', min: 1, max: 200, step: 1, def: 4 },
      { key: 'gap', label: 'Abstand (Mitte zu Mitte)', type: 'num', min: 0, step: 0.5, def: 25 },
      { key: 'n2', label: 'Anzahl Y (Raster)', type: 'num', min: 1, max: 100, step: 1, def: 3 },
      { key: 'gap2', label: 'Abstand Y (Raster)', type: 'num', min: 0, step: 0.5, def: 25 },
      { key: 'r', label: 'Radius (Kreis)', type: 'num', min: 0, step: 0.5, def: 30 },
      { key: 'ang', label: 'Winkel gesamt (Kreis)', type: 'num', min: 1, max: 360, step: 1, def: 360 },
    ],
    apply(m, p, A) {
      const n = Math.max(1, Math.round(p.n)), out = [];
      if (p.mode === 'Kreis') {
        const full = p.ang >= 359.99, step = full ? 360 / n : p.ang / Math.max(n - 1, 1);
        const b = m.boundingBox(); const base = A.k(m.translate([p.r - (b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, 0]));
        for (let i = 0; i < n; i++) out.push(A.k(base.rotate([0, 0, i * step])));
      } else if (p.mode === 'Raster XY') {
        const n2 = Math.max(1, Math.round(p.n2));
        for (let i = 0; i < n; i++) for (let j = 0; j < n2; j++) out.push(A.k(m.translate([i * p.gap, j * p.gap2, 0])));
      } else {
        for (let i = 0; i < n; i++) out.push(A.k(m.translate(p.mode === 'Reihe Y' ? [0, i * p.gap, 0] : [i * p.gap, 0, 0])));
      }
      return out.length === 1 ? out[0] : A.k(W.Manifold.union(out));
    },
  },
};

// Innenfläche um t nach innen versetzen: Jeder Eckpunkt wird so verschoben, dass
// alle angrenzenden Flächenebenen um t wandern (exakt für Quader/Prismen, gut für runde Formen).
function offsetInward(m, t, A) {
  const mesh = m.getMesh(); const np = mesh.numProp; const vp = mesh.vertProperties, tv = mesh.triVerts;
  const nv = vp.length / np; const lists = Array.from({ length: nv }, () => []);
  const fn = new Float64Array(tv.length);
  for (let f = 0; f < tv.length; f += 3) {
    const a = tv[f] * np, b = tv[f + 1] * np, c = tv[f + 2] * np;
    const ux = vp[b] - vp[a], uy = vp[b + 1] - vp[a + 1], uz = vp[b + 2] - vp[a + 2];
    const vx = vp[c] - vp[a], vy = vp[c + 1] - vp[a + 1], vz = vp[c + 2] - vp[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z);
    if (l < 1e-12) continue; x /= l; y /= l; z /= l; fn[f] = x; fn[f + 1] = y; fn[f + 2] = z;
    for (let j = 0; j < 3; j++) lists[tv[f + j]].push(f);
  }
  const out = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    // eindeutige Normalen sammeln, Normalgleichungen lösen: Σ n nᵀ d = -t Σ n
    const ns = [];
    for (const f of lists[v]) { const n = [fn[f], fn[f + 1], fn[f + 2]]; if (!ns.some(q => q[0] * n[0] + q[1] * n[1] + q[2] * n[2] > 0.999)) ns.push(n); }
    let d = [0, 0, 0];
    if (ns.length) {
      const M3 = [[1e-6, 0, 0], [0, 1e-6, 0], [0, 0, 1e-6]], r = [0, 0, 0];
      for (const n of ns) for (let i = 0; i < 3; i++) { r[i] -= t * n[i]; for (let j = 0; j < 3; j++) M3[i][j] += n[i] * n[j]; }
      if (ns.length < 3) { // unterbestimmt: kleinste Lösung entlang gemittelter Normalen ergänzen
        const avg = ns.reduce((s, n) => [s[0] + n[0], s[1] + n[1], s[2] + n[2]], [0, 0, 0]); const l = Math.hypot(...avg) || 1;
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M3[i][j] += 1e-3 * (avg[i] / l) * (avg[j] / l);
      }
      d = solve3(M3, r);
      const len = Math.hypot(...d); if (len > t * 4) d = d.map(x => x * t * 4 / len);
    }
    for (let i = 0; i < 3; i++) out[v * 3 + i] = vp[v * np + i] + d[i];
  }
  const inner = new W.Mesh({ numProp: 3, vertProperties: out, triVerts: new Uint32Array(tv) });
  let im = A.k(W.Manifold.ofMesh(inner));
  if (im.status() !== 'NoError' || im.isEmpty()) throw new Error('Aushöhlen bei dieser Form nicht möglich (Wand zu dick?)');
  // Selbstüberschneidungen bereinigen
  im = A.k(W.Manifold.union([im, A.k(W.Manifold.cube([0.0001, 0.0001, 0.0001]).translate([1e6, 1e6, 1e6]))]));
  if (im.volume() <= 0) throw new Error('Wandstärke zu groß für dieses Objekt');
  return im;
}
function solve3(M, r) {
  const det = (a) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const D = det(M); if (Math.abs(D) < 1e-12) return [0, 0, 0];
  return [0, 1, 2].map(c => det(M.map((row, i) => row.map((x, j) => (j === c ? r[i] : x)))) / D);
}

export function typeLabel(t) {
  if (PRIMITIVES[t]) return PRIMITIVES[t].label;
  if (BOOLEAN_TYPES[t]) return BOOLEAN_TYPES[t];
  if (MODIFIERS[t]) return MODIFIERS[t].label;
  if (t === 'import') return 'Import';
  if (t === 'template') return 'Vorlage';
  return t;
}

export function paramSchema(node) {
  if (PRIMITIVES[node.type]) return PRIMITIVES[node.type].params;
  if (node.type === 'template' && TEMPLATES[node.template]) return TEMPLATES[node.template].params;
  if (MODIFIERS[node.type]) return MODIFIERS[node.type].params;
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
      parts: (() => { try { const d = m.decompose(); const n = d.filter(x => x.volume() > 0).length; d.forEach(x => x.delete()); return n; } catch (e) { return 1; } })(), // Hohlräume zählen nicht als Teil
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
    m = T.build(kit, A, { ...defaultParams(T.params), ...node.params }, ctx);
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
    else if (node.type === 'hull') m = A.k(W.Manifold.hull(ms));
    else m = ms.length === 1 ? ms[0] : A.k(W.Manifold.intersection(ms));
  } else if (MODIFIERS[node.type]) {
    const c = (node.children || [])[0]; if (!c) throw new Error('Kein Objekt');
    const D = MODIFIERS[node.type];
    m = D.apply(buildManifold(c, ctx, A, true), { ...defaultParams(D.params), ...node.params }, A);
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
