// Import / Export: STL, OBJ, 3MF, PLY, AMF, OFF, X3D, Projektdatei
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { AMFLoader } from 'three/examples/jsm/loaders/AMFLoader.js';
import * as THREE from 'three';

// ---------- Export ----------
export function toBinarySTL(vert, tri, name = 'Donrath Intelligence STL Constructor') {
  const n = tri.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const head = new TextEncoder().encode(name.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(head);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let i = 0; i < n; i++) {
    const a = tri[i * 3] * 3, b = tri[i * 3 + 1] * 3, c = tri[i * 3 + 2] * 3;
    const ux = vert[b] - vert[a], uy = vert[b + 1] - vert[a + 1], uz = vert[b + 2] - vert[a + 2];
    const vx = vert[c] - vert[a], vy = vert[c + 1] - vert[a + 1], vz = vert[c + 2] - vert[a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true); o += 12;
    for (const idx of [a, b, c]) { dv.setFloat32(o, vert[idx], true); dv.setFloat32(o + 4, vert[idx + 1], true); dv.setFloat32(o + 8, vert[idx + 2], true); o += 12; }
    dv.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

// 3MF: mehrere Objekte, je eines pro Eintrag {name, vert, tri, color}
export function to3MF(objects) {
  const fmt = (x) => (Math.round(x * 1e5) / 1e5).toString();
  let res = '', objs = '', items = '';
  objects.forEach((o, i) => {
    const id = i + 2;
    res += `<base name="${esc(o.name)}" displaycolor="${(o.color || '#DDDDDD').toUpperCase()}FF"/>`;
    let v = '', t = '';
    for (let k = 0; k < o.vert.length; k += 3) v += `<vertex x="${fmt(o.vert[k])}" y="${fmt(o.vert[k + 1])}" z="${fmt(o.vert[k + 2])}"/>`;
    for (let k = 0; k < o.tri.length; k += 3) t += `<triangle v1="${o.tri[k]}" v2="${o.tri[k + 1]}" v3="${o.tri[k + 2]}"/>`;
    objs += `<object id="${id}" name="${esc(o.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
    items += `<item objectid="${id}"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Donrath Intelligence STL Constructor</metadata>
<resources><basematerials id="1">${res}</basematerials>${objs}</resources><build>${items}</build></model>`;
  const ct = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const enc = new TextEncoder();
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(ct) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
  ]);
}
// Exportformate – alle Formate bekommen eine Liste {name, vert, tri, color}
const num = (x) => (Math.round(x * 1e5) / 1e5).toString();
const hexRGB = (c) => { const h = String(c || '#DDDDDD').replace('#', ''); return [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255); };
function faceNormal(v, a, b, c) {
  const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2], vx = v[c] - v[a], vy = v[c + 1] - v[a + 1], vz = v[c + 2] - v[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l];
}
export function mergeObjects(objects) {
  let tv = 0, tt = 0; objects.forEach(m => { tv += m.vert.length; tt += m.tri.length; });
  const vert = new Float32Array(tv), tri = new Uint32Array(tt); let ov = 0, ot = 0;
  for (const m of objects) { vert.set(m.vert, ov); for (let i = 0; i < m.tri.length; i++) tri[ot + i] = m.tri[i] + ov / 3; ov += m.vert.length; ot += m.tri.length; }
  return { vert, tri };
}
export function toAsciiSTL(objects) {
  const out = [];
  for (const o of objects) {
    const nm = String(o.name).replace(/\s+/g, '_'); out.push(`solid ${nm}`); const v = o.vert;
    for (let i = 0; i < o.tri.length; i += 3) {
      const a = o.tri[i] * 3, b = o.tri[i + 1] * 3, c = o.tri[i + 2] * 3; const n = faceNormal(v, a, b, c);
      out.push(` facet normal ${n.map(num).join(' ')}`, '  outer loop');
      for (const k of [a, b, c]) out.push(`   vertex ${num(v[k])} ${num(v[k + 1])} ${num(v[k + 2])}`);
      out.push('  endloop', ' endfacet');
    }
    out.push(`endsolid ${nm}`);
  }
  return new TextEncoder().encode(out.join('\n') + '\n');
}
export function toOBJ(objects) {
  const out = ['# Donrath Intelligence STL Constructor', '# Einheit: Millimeter, Z oben', 'mtllib none']; let base = 1;
  for (const o of objects) {
    out.push(`o ${String(o.name).replace(/\s+/g, '_')}`);
    for (let i = 0; i < o.vert.length; i += 3) out.push(`v ${num(o.vert[i])} ${num(o.vert[i + 1])} ${num(o.vert[i + 2])}`);
    for (let i = 0; i < o.tri.length; i += 3) out.push(`f ${o.tri[i] + base} ${o.tri[i + 1] + base} ${o.tri[i + 2] + base}`);
    base += o.vert.length / 3;
  }
  return new TextEncoder().encode(out.filter(l => l !== 'mtllib none').join('\n') + '\n');
}
export function toPLY(objects) { // binär, mit Eckpunktfarben je Objekt
  const nv = objects.reduce((a, o) => a + o.vert.length / 3, 0), nf = objects.reduce((a, o) => a + o.tri.length / 3, 0);
  const head = new TextEncoder().encode(`ply\nformat binary_little_endian 1.0\ncomment Donrath Intelligence STL Constructor (mm)\nelement vertex ${nv}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nelement face ${nf}\nproperty list uchar uint vertex_indices\nend_header\n`);
  const buf = new ArrayBuffer(head.length + nv * 15 + nf * 13); new Uint8Array(buf).set(head); const dv = new DataView(buf); let o = head.length, base = 0;
  for (const ob of objects) { const c = hexRGB(ob.color).map(x => Math.round(x * 255)); for (let i = 0; i < ob.vert.length; i += 3) { dv.setFloat32(o, ob.vert[i], true); dv.setFloat32(o + 4, ob.vert[i + 1], true); dv.setFloat32(o + 8, ob.vert[i + 2], true); dv.setUint8(o + 12, c[0]); dv.setUint8(o + 13, c[1]); dv.setUint8(o + 14, c[2]); o += 15; } }
  for (const ob of objects) { for (let i = 0; i < ob.tri.length; i += 3) { dv.setUint8(o, 3); dv.setUint32(o + 1, ob.tri[i] + base, true); dv.setUint32(o + 5, ob.tri[i + 1] + base, true); dv.setUint32(o + 9, ob.tri[i + 2] + base, true); o += 13; } base += ob.vert.length / 3; }
  return new Uint8Array(buf);
}
export function toAMF(objects) {
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<amf unit="millimeter" version="1.1">\n<metadata type="producer">Donrath Intelligence STL Constructor</metadata>\n`;
  objects.forEach((o, i) => {
    const [r, g, b] = hexRGB(o.color);
    s += `<object id="${i}"><metadata type="name">${esc(o.name)}</metadata><color><r>${num(r)}</r><g>${num(g)}</g><b>${num(b)}</b></color><mesh><vertices>`;
    for (let k = 0; k < o.vert.length; k += 3) s += `<vertex><coordinates><x>${num(o.vert[k])}</x><y>${num(o.vert[k + 1])}</y><z>${num(o.vert[k + 2])}</z></coordinates></vertex>`;
    s += '</vertices><volume>';
    for (let k = 0; k < o.tri.length; k += 3) s += `<triangle><v1>${o.tri[k]}</v1><v2>${o.tri[k + 1]}</v2><v3>${o.tri[k + 2]}</v3></triangle>`;
    s += '</volume></mesh></object>\n';
  });
  return new TextEncoder().encode(s + '</amf>\n');
}
export function toOFF(objects) {
  const { vert, tri } = mergeObjects(objects); const out = ['OFF', `${vert.length / 3} ${tri.length / 3} 0`];
  for (let i = 0; i < vert.length; i += 3) out.push(`${num(vert[i])} ${num(vert[i + 1])} ${num(vert[i + 2])}`);
  for (let i = 0; i < tri.length; i += 3) out.push(`3 ${tri[i]} ${tri[i + 1]} ${tri[i + 2]}`);
  return new TextEncoder().encode(out.join('\n') + '\n');
}
export function toX3D(objects) { // für Farbdrucker (z. B. Gips-/PolyJet-Dienste); Einheit mm
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<X3D profile="Interchange" version="3.3"><head><meta name="generator" content="Donrath Intelligence STL Constructor"/><unit category="length" name="millimeter" conversionFactor="0.001"/></head><Scene>\n`;
  for (const o of objects) {
    const [r, g, b] = hexRGB(o.color); let pts = '', idx = '';
    for (let k = 0; k < o.vert.length; k += 3) pts += `${num(o.vert[k])} ${num(o.vert[k + 1])} ${num(o.vert[k + 2])} `;
    for (let k = 0; k < o.tri.length; k += 3) idx += `${o.tri[k]} ${o.tri[k + 1]} ${o.tri[k + 2]} -1 `;
    s += `<Shape DEF="${esc(String(o.name).replace(/\s+/g, '_'))}"><Appearance><Material diffuseColor="${num(r)} ${num(g)} ${num(b)}"/></Appearance><IndexedFaceSet solid="true" coordIndex="${idx.trim()}"><Coordinate point="${pts.trim()}"/></IndexedFaceSet></Shape>\n`;
  }
  return new TextEncoder().encode(s + '</Scene></X3D>\n');
}

// Alle Exportformate an einer Stelle
export const EXPORT_FORMATS = {
  stl: { label: 'STL (binär)', ext: 'stl', desc: 'Standard für alle Slicer', multi: 'merge', write: (o) => { const m = mergeObjects(o); return toBinarySTL(m.vert, m.tri); } },
  stla: { label: 'STL (ASCII)', ext: 'stl', desc: 'Textformat, für ältere Programme', write: toAsciiSTL },
  '3mf': { label: '3MF', ext: '3mf', desc: 'Mehrere Objekte mit Farben – empfohlen für Bambu, Prusa, Orca, Cura', write: to3MF },
  obj: { label: 'OBJ', ext: 'obj', desc: 'Universell, für CAD/Blender und Harzdrucker-Slicer', write: toOBJ },
  ply: { label: 'PLY (binär, farbig)', ext: 'ply', desc: 'Mit Farben je Objekt, für Farbdruck und Meshlab', write: toPLY },
  amf: { label: 'AMF', ext: 'amf', desc: 'Additive Manufacturing Format, mehrere Objekte mit Farben', write: toAMF },
  off: { label: 'OFF', ext: 'off', desc: 'Einfaches Netzformat (Meshlab, CGAL, OpenSCAD)', write: toOFF },
  x3d: { label: 'X3D', ext: 'x3d', desc: 'Für Farbdruck-Dienste (z. B. Vollfarb-Gips)', write: toX3D },
};
export const IMPORT_EXTENSIONS = ['stl', 'obj', '3mf', 'ply', 'amf', 'off'];

const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// Minimaler ZIP-Writer (ohne Kompression)
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
export function zipStore(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  for (const f of files) {
    const nm = enc.encode(f.name); const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nm);
    offset += 30 + nm.length + f.data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0;
  for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

// ---------- Import ----------
// Liefert eine Liste {name, vert: Float32Array, tri: Uint32Array} mit verschweißten Eckpunkten
export function importMesh(fileName, bytes) {
  const ext = fileName.split('.').pop().toLowerCase();
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const geos = [];
  if (ext === 'stl') geos.push({ name: base(fileName), geo: new STLLoader().parse(ab) });
  else if (ext === 'obj') collect(new OBJLoader().parse(new TextDecoder().decode(bytes)), geos, base(fileName));
  else if (ext === '3mf') collect(new ThreeMFLoader().parse(ab), geos, base(fileName));
  else if (ext === 'ply') geos.push({ name: base(fileName), geo: new PLYLoader().parse(ab) });
  else if (ext === 'amf') collect(new AMFLoader().parse(ab), geos, base(fileName));
  else if (ext === 'off') geos.push({ name: base(fileName), geo: parseOFF(new TextDecoder().decode(bytes)) });
  else throw new Error('Format nicht unterstützt: ' + ext);
  return geos.map(g => ({ name: g.name, ...weld(g.geo) }));
}
function parseOFF(text) {
  const tok = text.replace(/#.*$/gm, '').split(/\s+/).filter(Boolean); let i = 0;
  if (/^[A-Z]*OFF$/.test(tok[0])) i++;
  const nv = +tok[i++], nf = +tok[i++]; i++;
  if (!(nv > 0 && nf > 0)) throw new Error('Ungültige OFF-Datei');
  const pos = new Float32Array(nv * 3); for (let k = 0; k < nv * 3; k++) pos[k] = +tok[i++];
  const idx = [];
  for (let f = 0; f < nf; f++) { const n = +tok[i++]; const v = []; for (let k = 0; k < n; k++) v.push(+tok[i++]); for (let k = 1; k < n - 1; k++) idx.push(v[0], v[k], v[k + 1]); while (i < tok.length && !/^\d+$/.test(tok[i]) && f < nf - 1 && isNaN(+tok[i])) i++; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}
const base = (n) => n.replace(/\.[^.]+$/, '');
function collect(obj, out, fallback) {
  obj.updateMatrixWorld(true);
  obj.traverse(o => {
    if (o.isMesh) {
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      out.push({ name: o.name || fallback, geo: g });
    }
  });
  // 3MF/OBJ sind meist Y-oben exportiert? 3MF ist Z-oben, OBJ häufig Y-oben → Nutzer kann drehen.
}
export function weld(geo, eps = 1e-4) {
  const pos = geo.getAttribute('position'); const idx = geo.getIndex();
  const map = new Map(); const verts = []; const tris = [];
  const remap = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = Math.round(x / eps) + ',' + Math.round(y / eps) + ',' + Math.round(z / eps);
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; verts.push(x, y, z); map.set(key, id); }
    remap[i] = id;
  }
  const n = idx ? idx.count : pos.count;
  for (let i = 0; i < n; i += 3) {
    const a = remap[idx ? idx.getX(i) : i], b = remap[idx ? idx.getX(i + 1) : i + 1], c = remap[idx ? idx.getX(i + 2) : i + 2];
    if (a !== b && b !== c && a !== c) tris.push(a, b, c);
  }
  return { vert: new Float32Array(verts), tri: new Uint32Array(tris) };
}

// ---------- Projekt ----------
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
export function serializeProject(doc, assets) {
  const a = {};
  for (const [id, m] of Object.entries(assets)) a[id] = { v: b64(new Uint8Array(m.vert.buffer.slice(0))), t: b64(new Uint8Array(m.tri.buffer.slice(0))) };
  return new TextEncoder().encode(JSON.stringify({ format: 'donrath-constructor', version: 1, doc, assets: a }));
}
export function parseProject(bytes) {
  const j = JSON.parse(new TextDecoder().decode(bytes));
  if (j.format !== 'donrath-constructor') throw new Error('Keine Donrath-Constructor-Projektdatei');
  const assets = {};
  for (const [id, m] of Object.entries(j.assets || {})) assets[id] = { vert: new Float32Array(unb64(m.v).buffer), tri: new Uint32Array(unb64(m.t).buffer) };
  return { doc: j.doc, assets };
}

export { THREE };
