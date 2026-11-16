// Import / Export: STL, OBJ, 3MF, Projektdatei
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';
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
  else throw new Error('Format nicht unterstützt: ' + ext);
  return geos.map(g => ({ name: g.name, ...weld(g.geo) }));
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
