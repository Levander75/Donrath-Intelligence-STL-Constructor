// Donrath Intelligence STL Constructor – Anwendung
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import ManifoldModule from 'manifold-3d';
import * as G from './geometry.js';
import { TEMPLATES } from './templates.js';
import { Viewer } from './viewer.js';
import { runPrintCheck, MATERIALS, fmt } from './printcheck.js';
import { importMesh, serializeProject, parseProject, EXPORT_FORMATS, IMPORT_EXTENSIONS } from './io.js';
import { icon } from './icons.js';
import fontJson from '../assets/helvetiker_bold.typeface.json';

const api = window.dicApi || {
  // Fallback für den Browser (Entwicklung/Test)
  minimize() {}, maximize() {}, close() {}, onWinState() {},
  openFiles: async () => [], saveFile: async (k, name, data) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data])); a.download = name; a.click(); return name; },
  writeFile: async () => null, confirm: async (m) => (window.confirm(m) ? 0 : 1),
};
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const PALETTE = ['#F4F5F6', '#A3A9AF', '#DFE2E5', '#7A8189', '#C9CDD1', '#5B636B'];

// ---------------------------------------------------------------------------
// Zustand
const state = {
  doc: newDoc(), assets: {}, sel: [], filePath: null, dirty: false,
  undo: [], redo: [], mode: 'translate', snap: true, section: false, measure: false, wire: false,
  check: null, expanded: new Set(), results: new Map(), idCounter: 1,
};
function newDoc() {
  return { name: 'Unbenannt', settings: { bed: [256, 256, 256], material: 'PETG', overhang: 45, minWall: 0.8, seg: 64 }, nodes: [] };
}
const uid = () => 'n' + Date.now().toString(36) + (state.idCounter++).toString(36);

// Schrift für Text-Primitive
const font = new FontLoader().parse(fontJson);
function textToPolygons(text, size) {
  const shapes = font.generateShapes(text, size);
  const polys = [];
  for (const sh of shapes) {
    const { shape, holes } = sh.extractPoints(6);
    polys.push(shape.map(p => [p.x, p.y]));
    for (const h of holes) polys.push(h.map(p => [p.x, p.y]));
  }
  return polys;
}
const ctx = () => ({ assets: state.assets, seg: state.doc.settings.seg, textToPolygons });

// ---------------------------------------------------------------------------
// Baum-Helfer
function walk(nodes, fn, parent = null) { for (const n of nodes) { fn(n, parent); if (n.children) walk(n.children, fn, n); } }
function findNode(id) { let r = null; walk(state.doc.nodes, (n, p) => { if (n.id === id) r = { node: n, parent: p }; }); return r; }
function topLevelOf(id) { for (const n of state.doc.nodes) { let hit = n.id === id; if (!hit) walk(n.children || [], c => { if (c.id === id) hit = true; }); if (hit) return n; } return null; }
function siblings(parent) { return parent ? parent.children : state.doc.nodes; }

// ---------------------------------------------------------------------------
// Verlauf (Rückgängig/Wiederholen)
function snapshot() { return JSON.stringify(state.doc); }
function commit(label) {
  state.undo.push(state.lastSnap ?? snapshot()); if (state.undo.length > 120) state.undo.shift();
  state.redo = []; state.lastSnap = snapshot(); state.dirty = true; state.check = null;
  refresh(); if (label) setMsg(label);
}
function undo() { if (!state.undo.length) return; state.redo.push(snapshot()); state.doc = JSON.parse(state.undo.pop()); state.lastSnap = snapshot(); state.sel = state.sel.filter(id => findNode(id)); state.dirty = true; refresh(); setMsg('Rückgängig'); }
function redo() { if (!state.redo.length) return; state.undo.push(snapshot()); state.doc = JSON.parse(state.redo.pop()); state.lastSnap = snapshot(); state.sel = state.sel.filter(id => findNode(id)); state.dirty = true; refresh(); setMsg('Wiederholt'); }

// ---------------------------------------------------------------------------
// Auswertung & Anzeige
let viewer;
let refreshTimer = null;
function refresh(immediate = false) {
  renderTree(); renderProps(); renderCheck(); updateTitle(); updateToolbarState();
  clearTimeout(refreshTimer);
  const run = () => {
    const needs = state.doc.nodes.some(n => !state.results.has(n.id) || state.results.get(n.id).key !== resultKey(n));
    if (needs) setBusy(true, 'Berechne Geometrie …');
    setTimeout(() => {
      const t0 = performance.now();
      const items = [];
      for (const n of state.doc.nodes) {
        const key = resultKey(n);
        let r = state.results.get(n.id);
        if (!r || r.key !== key) { r = { key, res: G.evaluate(n, ctx()) }; state.results.set(n.id, r); }
        items.push({ id: n.id, vert: r.res.vert, tri: r.res.tri, geoRef: key, color: n.color, pos: n.pos, rot: n.rot, scale: n.scale, visible: n.visible !== false, ok: r.res.ok });
      }
      for (const id of [...state.results.keys()]) if (!state.doc.nodes.find(n => n.id === id)) state.results.delete(id);
      viewer.sync(items);
      viewer.setSelection(state.sel.map(id => (topLevelOf(id) || {}).id).filter(Boolean));
      const tl = state.sel.length === 1 && state.doc.nodes.find(n => n.id === state.sel[0]);
      if (tl && state.mode !== 'none') viewer.attachGizmo(tl.id, state.mode); else viewer.detachGizmo();
      setBusy(false);
      updateStatus(); renderTree(); renderProps();
      const ms = performance.now() - t0; if (ms > 50) setMsg(`Berechnet in ${Math.round(ms)} ms`);
    }, needs ? 16 : 0);
  };
  if (immediate) run(); else refreshTimer = setTimeout(run, 30);
}
function resultKey(n) { return JSON.stringify({ t: n.type, tp: n.template, p: n.params, a: n.asset, mf: n.mf, c: n.children, seg: state.doc.settings.seg }); }
function resultOf(id) {
  const r = state.results.get(id); const n = state.doc.nodes.find(x => x.id === id);
  if (!n) return r ? r.res : null;
  // Fehlt das Ergebnis oder ist es veraltet, sofort (synchron) berechnen – Maße stimmen dann direkt nach einer Änderung
  const key = resultKey(n);
  if (!r || r.key !== key) { const nr = { key, res: G.evaluate(n, ctx()) }; state.results.set(id, nr); return nr.res; }
  return r.res;
}

// Weltnetz eines Top-Level-Knotens
function worldMesh(n) {
  const r = resultOf(n.id); if (!r) return null;
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...(n.pos || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(n.rot || [0, 0, 0]).map(THREE.MathUtils.degToRad), 'ZYX')),
    new THREE.Vector3(...(n.scale || [1, 1, 1])));
  const v = new Float32Array(r.vert.length); const p = new THREE.Vector3();
  for (let i = 0; i < v.length; i += 3) { p.set(r.vert[i], r.vert[i + 1], r.vert[i + 2]).applyMatrix4(m); v[i] = p.x; v[i + 1] = p.y; v[i + 2] = p.z; }
  let tri = r.tri;
  if (m.determinant() < 0) { tri = new Uint32Array(r.tri); for (let i = 0; i < tri.length; i += 3) { const t = tri[i + 1]; tri[i + 1] = tri[i + 2]; tri[i + 2] = t; } }
  const s = n.scale || [1, 1, 1];
  return { id: n.id, name: n.name, vert: v, tri, ok: r.ok, error: r.error, parts: r.parts, volume: r.volume * Math.abs(s[0] * s[1] * s[2]), color: n.color };
}
function worldBox(n) {
  const w = worldMesh(n); const bb = new THREE.Box3(); if (!w) return bb;
  for (let i = 0; i < w.vert.length; i += 3) bb.expandByPoint(new THREE.Vector3(w.vert[i], w.vert[i + 1], w.vert[i + 2]));
  return bb;
}

// ---------------------------------------------------------------------------
// Aktionen
function addNode(node, select = true) {
  node.id = node.id || uid(); node.pos = node.pos || [0, 0, 0]; node.rot = node.rot || [0, 0, 0]; node.scale = node.scale || [1, 1, 1];
  node.color = node.color || PALETTE[state.doc.nodes.length % PALETTE.length]; node.visible = true;
  // Freien Platz rechts neben vorhandenen Objekten suchen (lokale Maße sofort berechnen)
  if (state.doc.nodes.length && !node.keepPos) {
    let maxX = -Infinity; for (const n of state.doc.nodes) { const b = worldBox(n); if (!b.isEmpty()) maxX = Math.max(maxX, b.max.x); }
    const r = G.evaluate(node, ctx()); let minX = 0;
    if (r.vert.length) { minX = Infinity; for (let i = 0; i < r.vert.length; i += 3) minX = Math.min(minX, r.vert[i]); }
    if (isFinite(maxX)) node.pos = [Math.round((maxX + 12 - minX) * 100) / 100, 0, 0];
  }
  delete node.keepPos;
  state.doc.nodes.push(node);
  if (select) state.sel = [node.id];
  commit(`${node.name} eingefügt`);
}
function addPrimitive(type) {
  const def = G.PRIMITIVES[type]; const count = countType(type) + 1;
  addNode({ type, name: `${def.label} ${count}`, params: G.defaultParams(def.params) });
}
function addTemplate(id) {
  const T = TEMPLATES[id];
  addNode({ type: 'template', template: id, name: T.label, params: G.defaultParams(T.params), color: id === 'halo' ? '#F4F5F6' : undefined });
  setTimeout(() => viewer.focusOn(), 150);
}
function countType(t) { let c = 0; walk(state.doc.nodes, n => { if (n.type === t) c++; }); return c; }

function selectedTop() { return state.sel.map(id => state.doc.nodes.find(n => n.id === id)).filter(Boolean); }

function booleanOp(type) {
  const nodes = selectedTop();
  if (nodes.length < 2) { toast('Für diese Operation mindestens zwei Objekte auswählen (Strg/Umschalt + Klick).', true); return; }
  const bb = new THREE.Box3(); nodes.forEach(n => bb.union(worldBox(n)));
  const c = bb.isEmpty() ? new THREE.Vector3() : bb.getCenter(new THREE.Vector3());
  const cx = Math.round(c.x * 100) / 100, cy = Math.round(c.y * 100) / 100;
  const node = { id: uid(), type, name: `${G.BOOLEAN_TYPES[type]} ${countType(type) + 1}`, params: {}, pos: [cx, cy, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    color: nodes[0].color, visible: true, children: nodes.map(n => ({ ...n, visible: true, pos: [n.pos[0] - cx, n.pos[1] - cy, n.pos[2]] })) };
  state.doc.nodes = state.doc.nodes.filter(n => !nodes.includes(n));
  state.doc.nodes.push(node); state.sel = [node.id]; state.expanded.add(node.id);
  commit(type === 'difference' ? `„${nodes[0].name}“ minus ${nodes.length - 1} Objekt(e)` : `${G.BOOLEAN_TYPES[type]} erstellt`);
}
function ungroup() {
  const n = state.sel.length === 1 && findNode(state.sel[0]);
  if (!n || !n.node.children) { toast('Eine Operation, Gruppe oder einen Modifikator auswählen.', true); return; }
  const kids = n.node.children.map(c => composeInto(n.node, c));
  const list = siblings(n.parent); const i = list.indexOf(n.node);
  list.splice(i, 1, ...kids);
  state.sel = kids.map(k => k.id); commit('Aufgelöst');
}
function takeOut(id) { // Kind aus seiner Operation herausnehmen
  const f = findNode(id); if (!f || !f.parent) return;
  const parentTop = f.parent;
  f.parent.children = f.parent.children.filter(c => c !== f.node);
  const out = composeInto(parentTop, f.node);
  state.doc.nodes.push(out); state.sel = [out.id]; commit(`„${out.name}“ herausgenommen`);
}
// Kind-Transformation mit Eltern-Transformation verrechnen
function composeInto(parent, child) {
  const mk = (n) => new THREE.Matrix4().compose(new THREE.Vector3(...(n.pos || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(n.rot || [0, 0, 0]).map(THREE.MathUtils.degToRad), 'ZYX')), new THREE.Vector3(...(n.scale || [1, 1, 1])));
  const m = mk(parent).multiply(mk(child));
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q, 'ZYX'); const r3 = (x) => Math.round(x * 1000) / 1000;
  return { ...child, pos: p.toArray().map(r3), rot: [e.x, e.y, e.z].map(v => r3(THREE.MathUtils.radToDeg(v))), scale: s.toArray().map(r3) };
}
function duplicate() {
  const nodes = selectedTop(); if (!nodes.length) return;
  const copies = nodes.map(n => { const c = JSON.parse(JSON.stringify(n)); reId(c); c.name = n.name + ' Kopie'; const b = worldBox(n); c.pos = [...n.pos]; c.pos[0] += (b.isEmpty() ? 20 : b.max.x - b.min.x + 5); return c; });
  state.doc.nodes.push(...copies); state.sel = copies.map(c => c.id); commit('Dupliziert');
}
function reId(n) { n.id = uid(); (n.children || []).forEach(reId); }
function del() {
  if (!state.sel.length) return;
  const ids = new Set(state.sel);
  const prune = (list) => list.filter(n => !ids.has(n.id)).map(n => (n.children ? { ...n, children: prune(n.children) } : n));
  state.doc.nodes = prune(state.doc.nodes); state.sel = []; commit('Gelöscht');
}
function mirror(ax) {
  const f = state.sel.length === 1 && findNode(state.sel[0]); if (!f) return;
  f.node.mf = { ...(f.node.mf || {}), [ax]: !(f.node.mf || {})[ax] }; commit(`Gespiegelt (${ax.toUpperCase()})`);
}
function dropToBed(ids) {
  const nodes = (ids || state.sel).map(id => state.doc.nodes.find(n => n.id === id)).filter(Boolean);
  if (!nodes.length) return;
  for (const n of nodes) { const b = worldBox(n); if (!b.isEmpty()) n.pos[2] = Math.round((n.pos[2] - b.min.z) * 1000) / 1000; }
  commit('Auf Druckbett gelegt');
}
function centerOnBed(all = false) {
  const nodes = all ? state.doc.nodes : selectedTop(); if (!nodes.length) return;
  const bb = new THREE.Box3(); nodes.forEach(n => bb.union(worldBox(n)));
  const c = bb.getCenter(new THREE.Vector3());
  nodes.forEach(n => { n.pos[0] = Math.round((n.pos[0] - c.x) * 100) / 100; n.pos[1] = Math.round((n.pos[1] - c.y) * 100) / 100; });
  commit('Zentriert');
}
function arrange() {
  const nodes = state.doc.nodes.filter(n => n.visible !== false); if (!nodes.length) return;
  const boxes = nodes.map(worldBox); const gap = 8;
  const total = boxes.reduce((a, b) => a + (b.max.x - b.min.x), 0) + gap * (nodes.length - 1);
  let x = -total / 2;
  nodes.forEach((n, i) => { const b = boxes[i]; n.pos[0] = Math.round((n.pos[0] + x - b.min.x) * 100) / 100; n.pos[1] = Math.round((n.pos[1] - (b.min.y + b.max.y) / 2) * 100) / 100; n.pos[2] = Math.round((n.pos[2] - b.min.z) * 100) / 100; x += b.max.x - b.min.x + gap; });
  commit('Auf dem Bett angeordnet');
}

// ---------------------------------------------------------------------------
// Dateien
async function confirmDiscard() {
  if (!state.dirty || !state.doc.nodes.length) return true;
  const r = await api.confirm('Ungespeicherte Änderungen verwerfen?', 'Das aktuelle Projekt wurde noch nicht gespeichert.', ['Verwerfen', 'Abbrechen']);
  return r === 0;
}
async function newProject() { if (!(await confirmDiscard())) return; Object.assign(state, { doc: newDoc(), assets: {}, sel: [], filePath: null, undo: [], redo: [], check: null }); state.lastSnap = snapshot(); state.dirty = false; G.clearCache(); state.results.clear(); viewer.setBed(state.doc.settings.bed); refresh(); }
async function openProject() {
  if (!(await confirmDiscard())) return;
  const files = await api.openFiles('project'); if (!files.length) return;
  loadProjectData(new Uint8Array(files[0].data), files[0].path);
}
function loadProjectData(bytes, path) {
  try {
    const { doc, assets } = parseProject(bytes);
    Object.assign(state, { doc, assets, sel: [], filePath: path || null, undo: [], redo: [], check: null }); state.lastSnap = snapshot(); state.dirty = false;
    G.clearCache(); state.results.clear(); viewer.setBed(doc.settings.bed); refresh(); setTimeout(() => viewer.focusOn(), 200);
    toast(`Projekt „${doc.name}“ geöffnet`);
  } catch (e) { toast('Projekt konnte nicht geöffnet werden: ' + e.message, true); }
}
// Dateien per Ziehen & Ablegen: Projekte öffnen, Modelle importieren
async function dropFiles(list) {
  const files = [...list]; const proj = files.find(f => /\.dicp$/i.test(f.name));
  if (proj) { if (await confirmDiscard()) loadProjectData(new Uint8Array(await proj.arrayBuffer()), null); return; }
  let added = 0; setBusy(true, 'Importiere …');
  for (const f of files) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!IMPORT_EXTENSIONS.includes(ext)) { toast(`${f.name}: Format nicht unterstützt`, true); continue; }
    try { for (const m of importMesh(f.name, new Uint8Array(await f.arrayBuffer()))) { const aid = 'a' + uid(); state.assets[aid] = { vert: m.vert, tri: m.tri }; addNodeSilent({ type: 'import', asset: aid, name: m.name, params: {} }); added++; } }
    catch (e) { toast(`${f.name}: ${e.message}`, true); }
  }
  setBusy(false);
  if (added) { commit(`${added} Modell(e) importiert`); setTimeout(() => viewer.focusOn(), 300); }
}
async function saveProject(as = false) {
  const data = serializeProject(state.doc, usedAssets());
  let p = state.filePath;
  if (as || !p) p = await api.saveFile('project', (state.doc.name || 'Projekt') + '.dicp', data);
  else await api.writeFile(p, data);
  if (!p) return;
  state.filePath = p; state.doc.name = String(p).split(/[\\/]/).pop().replace(/\.dicp$/i, ''); state.dirty = false; updateTitle(); toast('Projekt gespeichert');
}
function usedAssets() { const u = {}; walk(state.doc.nodes, n => { if (n.asset && state.assets[n.asset]) u[n.asset] = state.assets[n.asset]; }); return u; }
async function importFiles() {
  const files = await api.openFiles('mesh'); if (!files.length) return;
  setBusy(true, 'Importiere …');
  setTimeout(() => {
    let added = 0;
    for (const f of files) {
      try {
        for (const m of importMesh(f.name, new Uint8Array(f.data))) {
          const aid = 'a' + uid(); state.assets[aid] = { vert: m.vert, tri: m.tri };
          addNodeSilent({ type: 'import', asset: aid, name: m.name, params: {} }); added++;
        }
      } catch (e) { toast(`${f.name}: ${e.message}`, true); }
    }
    setBusy(false);
    if (added) { commit(`${added} Modell(e) importiert`); setTimeout(() => { const bad = state.doc.nodes.filter(n => n.type === 'import' && resultOf(n.id) && !resultOf(n.id).ok); if (bad.length) toast(`${bad.length} importierte(s) Netz(e) sind nicht wasserdicht. Anzeige möglich, boolesche Operationen nicht.`, true); viewer.focusOn(); }, 300); }
  }, 20);
}
function addNodeSilent(node) {
  node.id = uid(); node.pos = [0, 0, 0]; node.rot = [0, 0, 0]; node.scale = [1, 1, 1]; node.color = PALETTE[state.doc.nodes.length % PALETTE.length]; node.visible = true;
  state.doc.nodes.push(node); state.sel = [node.id];
}
async function exportAs(kind) {
  const F = EXPORT_FORMATS[kind]; if (!F) return;
  let nodes = selectedTop(); if (!nodes.length) nodes = state.doc.nodes.filter(n => n.visible !== false);
  if (!nodes.length) { toast('Nichts zum Exportieren.', true); return; }
  refresh(true);
  const meshes = nodes.map(worldMesh).filter(Boolean);
  const bad = meshes.filter(m => !m.ok);
  if (bad.length) toast(`Achtung: ${bad.map(b => b.name).join(', ')} ist nicht wasserdicht.`, true);
  const below = meshes.some(m => { for (let i = 2; i < m.vert.length; i += 3) if (m.vert[i] < -0.01) return true; return false; });
  if (below) toast('Hinweis: Teile ragen unter das Druckbett. „Auf Bett legen“ (B) vor dem Export empfohlen.', true);
  const base = nodes.length === 1 ? nodes[0].name : (state.doc.name || 'Export');
  const data = F.write(meshes.map(m => ({ name: m.name, vert: m.vert, tri: m.tri, color: m.color })));
  const p = await api.saveFile(kind, safeName(base) + '.' + F.ext, data);
  if (p) { state.doc.settings.lastExport = kind; toast(`${F.label} gespeichert: ${String(p).split(/[\\/]/).pop()}`); }
}
function exportDialog() {
  const last = state.doc.settings.lastExport || '3mf';
  const n = selectedTop().length;
  dialog(`<h3>Exportieren</h3><p class="pinfo">${n ? `${n} ausgewähltes Objekt(e)` : 'Alle sichtbaren Objekte'} werden exportiert.</p>
    <div class="fmt-list">${Object.entries(EXPORT_FORMATS).map(([k, f]) => `<label class="fmt"><input type="radio" name="fmt" value="${k}" ${k === last ? 'checked' : ''}><b>${esc(f.label)}</b><span>${esc(f.desc)}</span></label>`).join('')}</div>`,
  (m) => { const k = m.querySelector('input[name=fmt]:checked')?.value; if (k) setTimeout(() => exportAs(k), 0); }, 'Exportieren …');
}
async function exportImage() {
  const url = viewer.screenshot(); const bin = atob(url.split(',')[1]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const p = await api.saveFile('png', safeName(state.doc.name || 'Ansicht') + '.png', u); if (p) toast('Bild gespeichert');
}
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Modell';

// ---------------------------------------------------------------------------
// Druck-Check
async function doCheck() {
  const objs = state.doc.nodes.filter(n => n.visible !== false).map(worldMesh).filter(Boolean);
  setBusy(true, 'Druck-Check …');
  try {
    state.check = await runPrintCheck(objs, state.doc.settings, (t) => setBusy(true, t));
    viewer.setHighlights(state.check.highlights);
  } catch (e) { toast('Druck-Check fehlgeschlagen: ' + e.message, true); }
  setBusy(false); renderCheck();
}
function renderCheck() {
  const el = $('#check');
  if (!state.check) { el.innerHTML = `<p class="pinfo">Prüft Bauraum, Bettkontakt, Wasserdichtheit, Überhänge und dünne Wände aller sichtbaren Objekte.</p><div class="btn-row"><button class="btn primary" data-act="check">Druck-Check starten</button></div>`; viewer && viewer.setHighlights(null); return; }
  const { items, summary } = state.check;
  let h = '';
  if (summary) h += `<div class="kv"><span>Maße gesamt</span><b>${fmt(summary.size.x)} × ${fmt(summary.size.y)} × ${fmt(summary.size.z)} mm</b>
    <span>Volumen</span><b>${fmt(summary.volume / 1000, 2)} cm³</b>
    <span>Gewicht (${esc(state.doc.settings.material)}, massiv)</span><b>${fmt(summary.grams, 1)} g</b>
    ${summary.filamentM != null ? `<span>Filament 1,75 mm (massiv)</span><b>${fmt(summary.filamentM, 2)} m</b>` : ''}</div>
    <p class="pinfo" style="margin-top:-4px">Gewicht und Länge gelten für 100 % Füllung. Mit Infill wird es weniger.</p>`;
  for (const it of items) {
    h += `<div class="citem ${it.level}">${icon(it.level === 'ok' ? 'ok' : it.level === 'warn' ? 'warn' : it.level === 'err' ? 'err' : 'info')}<div><b>${esc(it.title)}</b>${it.text ? `<br><span>${esc(it.text)}</span>` : ''}
      ${it.action ? `<div class="act"><button class="btn small" data-act="${it.action.id}" data-target="${it.action.target || ''}">${esc(it.action.label)}</button></div>` : ''}</div></div>`;
  }
  el.innerHTML = h;
}

// ---------------------------------------------------------------------------
// Zurücksetzen, Zwischenablage, Fläche aufs Bett, Isolieren
function resetTransform(what, ids) {
  const nodes = (ids || state.sel).map(id => findNode(id)).filter(Boolean).map(f => f.node);
  if (!nodes.length) return;
  for (const n of nodes) {
    if (what === 'rot' || what === 'all') n.rot = [0, 0, 0];
    if (what === 'scale' || what === 'all') n.scale = [1, 1, 1];
    if (what === 'pos' || what === 'all') n.pos = [0, 0, 0];
  }
  // Position 0 heißt: Mitte des Druckbetts, Unterkante auf Z = 0
  if (what === 'pos' || what === 'all') {
    for (const n of nodes) {
      if (!state.doc.nodes.includes(n)) continue;
      const b = worldBox(n); if (b.isEmpty()) continue;
      const c = b.getCenter(new THREE.Vector3());
      n.pos = [Math.round(-c.x * 1000) / 1000, Math.round(-c.y * 1000) / 1000, Math.round(-b.min.z * 1000) / 1000];
    }
  }
  commit({ pos: 'Position auf 0 gesetzt', rot: 'Drehung zurückgesetzt', scale: 'Skalierung zurückgesetzt', all: 'Komplett zurückgesetzt' }[what]);
}
function copySel() {
  const nodes = selectedTop(); if (!nodes.length) return;
  state.clip = JSON.stringify(nodes); setMsg(`${nodes.length} Objekt(e) kopiert`);
}
function cutSel() { copySel(); del(); }
function paste() {
  if (!state.clip) { toast('Zwischenablage ist leer.'); return; }
  const nodes = JSON.parse(state.clip);
  for (const n of nodes) { reId(n); n.pos = [n.pos[0] + 10, n.pos[1] + 10, n.pos[2]]; }
  state.doc.nodes.push(...nodes); state.sel = nodes.map(n => n.id); state.clip = JSON.stringify(nodes);
  commit(`${nodes.length} Objekt(e) eingefügt`);
}
function layFlat(id, normal) {
  const n = state.doc.nodes.find(x => x.id === id); if (!n || !normal) return;
  const cur = new THREE.Quaternion().setFromEuler(new THREE.Euler(...n.rot.map(THREE.MathUtils.degToRad), 'ZYX'));
  const q = new THREE.Quaternion().setFromUnitVectors(normal.clone().normalize(), new THREE.Vector3(0, 0, -1));
  const e = new THREE.Euler().setFromQuaternion(q.multiply(cur), 'ZYX');
  n.rot = [e.x, e.y, e.z].map(v => Math.round(THREE.MathUtils.radToDeg(v) * 1000) / 1000);
  const b = worldBox(n); if (!b.isEmpty()) n.pos[2] = Math.round((n.pos[2] - b.min.z) * 1000) / 1000;
  commit('Mit der Fläche aufs Bett gelegt');
}
function isolate(id) { for (const n of state.doc.nodes) n.visible = n.id === id; commit('Nur dieses Objekt sichtbar'); }
function showAll() { walk(state.doc.nodes, n => { n.visible = true; }); commit('Alles eingeblendet'); }
function setColor(color) { const nodes = state.sel.map(id => findNode(id)).filter(Boolean); nodes.forEach(f => (f.node.color = color)); commit('Farbe geändert'); }
async function exportSingle(id, kind) { const keep = state.sel; state.sel = [id]; await exportAs(kind); state.sel = keep; }
function renameNode(id) {
  state.expanded.add(topLevelOf(id)?.id); renderTree();
  const row = document.querySelector(`.tnode[data-id="${id}"]`); if (row) row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Modifikatoren (Aushöhlen, Abschneiden, Muster) – zerstörungsfrei, jederzeit änderbar
function wrapNode(n, type, params = {}) {
  const b = worldBox(n); const c = b.isEmpty() ? new THREE.Vector3() : b.getCenter(new THREE.Vector3());
  const cx = Math.round(c.x * 100) / 100, cy = Math.round(c.y * 100) / 100;
  return { id: uid(), type, name: `${G.MODIFIERS[type].label}: ${n.name}`, params: { ...G.defaultParams(G.MODIFIERS[type].params), ...params }, pos: [cx, cy, 0], rot: [0, 0, 0], scale: [1, 1, 1],
    color: n.color, visible: true, children: [{ ...n, visible: true, pos: [n.pos[0] - cx, n.pos[1] - cy, n.pos[2]] }] };
}
function modify(type, params) {
  refresh(true);
  const nodes = selectedTop(); if (!nodes.length) { toast('Zuerst ein Objekt auswählen.', true); return; }
  const out = nodes.map(n => { const w = wrapNode(n, type, params); const i = state.doc.nodes.indexOf(n); state.doc.nodes.splice(i, 1, w); return w; });
  state.sel = out.map(w => w.id);
  commit(`${G.MODIFIERS[type].label} angewendet – Werte rechts unter „Parameter“ anpassen`);
}
function splitSel(axis = 'Z') {
  refresh(true);
  const n = selectedTop()[0]; if (!n || selectedTop().length !== 1) { toast('Genau ein Objekt zum Teilen auswählen.', true); return; }
  const a = wrapNode(n, 'cut', { axis, at: 50, keep: 'Unten / Minus' });
  const copy = JSON.parse(JSON.stringify(n)); reId(copy);
  const b = wrapNode(copy, 'cut', { axis, at: 50, keep: 'Oben / Plus' });
  a.name = `${n.name} (Teil 1)`; b.name = `${n.name} (Teil 2)`;
  const i = state.doc.nodes.indexOf(n); state.doc.nodes.splice(i, 1, a, b);
  state.sel = [a.id, b.id]; refresh(true);
  const ba = worldBox(a), bb = worldBox(b);
  if (!bb.isEmpty() && !ba.isEmpty()) {
    if (axis === 'Z') b.pos[2] -= bb.min.z; // obere Hälfte aufs Bett
    b.pos[0] += Math.round((ba.max.x - bb.min.x + 10) * 100) / 100;
  }
  commit('Geteilt – Schnitthöhe unter „Parameter“ einstellbar');
}
function align(axis, where) {
  const nodes = selectedTop(); if (nodes.length < 2) { toast('Zum Ausrichten mindestens zwei Objekte wählen.', true); return; }
  const i = { x: 0, y: 1, z: 2 }[axis]; const k = ['x', 'y', 'z'][i];
  const ref = worldBox(nodes[0]); const target = where === 'min' ? ref.min[k] : where === 'max' ? ref.max[k] : (ref.min[k] + ref.max[k]) / 2;
  for (const n of nodes.slice(1)) {
    const b = worldBox(n); if (b.isEmpty()) continue;
    const v = where === 'min' ? b.min[k] : where === 'max' ? b.max[k] : (b.min[k] + b.max[k]) / 2;
    n.pos[i] = Math.round((n.pos[i] + target - v) * 1000) / 1000;
  }
  commit('Ausgerichtet am zuerst gewählten Objekt');
}
function distribute(axis, gap = null) {
  const nodes = selectedTop(); if (nodes.length < 3 && gap == null) { toast('Zum Verteilen mindestens drei Objekte wählen.', true); return; }
  const i = { x: 0, y: 1 }[axis]; const k = ['x', 'y'][i];
  const list = nodes.map(n => ({ n, b: worldBox(n) })).filter(o => !o.b.isEmpty()).sort((a, b) => a.b.min[k] - b.b.min[k]);
  const total = list.reduce((s, o) => s + (o.b.max[k] - o.b.min[k]), 0);
  const span = list[list.length - 1].b.max[k] - list[0].b.min[k];
  const g = gap != null ? gap : (span - total) / (list.length - 1);
  let cur = list[0].b.min[k];
  for (const o of list) { o.n.pos[i] = Math.round((o.n.pos[i] + cur - o.b.min[k]) * 1000) / 1000; cur += o.b.max[k] - o.b.min[k] + g; }
  commit(gap != null ? `Mit ${gap} mm Abstand aufgereiht` : 'Gleichmäßig verteilt');
}
function rotate90(axis, dir = 1) {
  const nodes = selectedTop(); if (!nodes.length) return;
  const ax = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  for (const n of nodes) {
    const before = worldBox(n); const c0 = before.getCenter(new THREE.Vector3());
    const q = new THREE.Quaternion().setFromAxisAngle(ax, dir * Math.PI / 2).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...n.rot.map(THREE.MathUtils.degToRad), 'ZYX')));
    const e = new THREE.Euler().setFromQuaternion(q, 'ZYX');
    n.rot = [e.x, e.y, e.z].map(v => Math.round(THREE.MathUtils.radToDeg(v) * 1000) / 1000);
    const after = worldBox(n); if (!after.isEmpty() && !before.isEmpty()) {
      const c1 = after.getCenter(new THREE.Vector3());
      n.pos[0] = Math.round((n.pos[0] + c0.x - c1.x) * 1000) / 1000; n.pos[1] = Math.round((n.pos[1] + c0.y - c1.y) * 1000) / 1000;
      n.pos[2] = Math.round((n.pos[2] - after.min.z + Math.max(before.min.z, 0)) * 1000) / 1000;
    }
  }
  commit(`Um ${axis.toUpperCase()} um ${dir > 0 ? '+' : '−'}90° gedreht`);
}
function sizeDialog() {
  const n = selectedTop()[0]; if (!n) { toast('Zuerst ein Objekt auswählen.', true); return; }
  refresh(true); const b = worldBox(n); if (b.isEmpty()) return; const sz = b.getSize(new THREE.Vector3());
  dialog(`<h3>Maße setzen – ${esc(n.name)}</h3>
    <div class="pgroup"><div class="prow"><label for="dX">Breite X (mm)</label><input id="dX" class="field" type="number" step="0.1" value="${sz.x.toFixed(2)}"></div>
    <div class="prow"><label for="dY">Tiefe Y (mm)</label><input id="dY" class="field" type="number" step="0.1" value="${sz.y.toFixed(2)}"></div>
    <div class="prow"><label for="dZ">Höhe Z (mm)</label><input id="dZ" class="field" type="number" step="0.1" value="${sz.z.toFixed(2)}"></div>
    <div class="prow"><label for="dU">Seitenverhältnis halten</label><input id="dU" type="checkbox" checked></div>
    <div class="prow"><label for="dP">… oder Skalierung in %</label><input id="dP" class="field" type="number" step="1" placeholder="z. B. 150"></div></div>
    <p class="pinfo">Die Maße beziehen sich auf die Außenmaße im Druckbett. Bei gedrehten Objekten wird entlang der Objektachsen skaliert.</p>`, (m) => {
    const g = (id) => +m.querySelector('#' + id).value; const uni = m.querySelector('#dU').checked; const pct = g('dP');
    let f = [g('dX') / sz.x, g('dY') / sz.y, g('dZ') / sz.z];
    if (pct > 0) f = [pct / 100, pct / 100, pct / 100];
    else if (uni) { const changed = [0, 1, 2].find(i => Math.abs(f[i] - 1) > 1e-6); const u = changed == null ? 1 : f[changed]; f = [u, u, u]; }
    if (f.some(x => !(x > 0) || !isFinite(x))) { toast('Ungültige Maße.', true); return; }
    // Weltachsen auf Objektachsen abbilden (bei 90°-Drehungen exakt)
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...n.rot.map(THREE.MathUtils.degToRad), 'ZYX'));
    const loc = [0, 0, 0];
    for (let i = 0; i < 3; i++) { const v = new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(q); const w = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)]; loc[i] = w[0] * f[0] + w[1] * f[1] + w[2] * f[2]; }
    const c0 = b.getCenter(new THREE.Vector3());
    n.scale = n.scale.map((s, i) => Math.round(s * loc[i] * 10000) / 10000);
    refresh(true); const a = worldBox(n); const c1 = a.getCenter(new THREE.Vector3());
    n.pos = [n.pos[0] + c0.x - c1.x, n.pos[1] + c0.y - c1.y, n.pos[2] - a.min.z + b.min.z].map(v => Math.round(v * 1000) / 1000);
    commit('Maße gesetzt');
  });
}

// ---------------------------------------------------------------------------
// Kontextmenü (Rechtsklick)
const COLORS = ['#F4F5F6', '#DFE2E5', '#C9CDD1', '#A3A9AF', '#7A8189', '#3D4650', '#1D2329', '#F87171', '#FBBF24', '#86EFAC', '#93C5FD', '#C4B5FD'];
function openContext(x, y, target) {
  const el = $('#ctx'); const items = [];
  const it = (label, run, opts = {}) => items.push({ label, run, ...opts });
  const sep = () => items.push('-');
  const f = target && target.id ? findNode(target.id) : null;
  if (f) {
    const n = f.node; const isTop = !f.parent; const multi = selectedTop().length > 1;
    if (!state.sel.includes(n.id)) { state.sel = [n.id]; refresh(); }
    items.push({ head: multi ? `${state.sel.length} Objekte` : n.name });
    if (!multi) it('Umbenennen', () => renameNode(n.id), { icon: 'text', key: 'F2' });
    it('Duplizieren', duplicate, { icon: 'duplicate', key: 'Strg+D', disabled: !isTop });
    it('Kopieren', copySel, { icon: 'duplicate', key: 'Strg+C', disabled: !isTop });
    it('Ausschneiden', cutSel, { key: 'Strg+X', disabled: !isTop });
    sep();
    it('Auf Bett legen', () => dropToBed(), { icon: 'bed', key: 'B', disabled: !isTop });
    if (target.normal && isTop && !multi) it('Mit dieser Fläche aufs Bett legen', () => layFlat(n.id, target.normal), { icon: 'bed' });
    it('Auf Bett zentrieren', () => centerOnBed(false), { icon: 'center', key: 'C', disabled: !isTop });
    items.push({ label: 'Zurücksetzen', icon: 'undo', sub: [
      { label: 'Position auf 0 (Bettmitte)', run: () => resetTransform('pos') },
      { label: 'Drehung auf 0°', run: () => resetTransform('rot') },
      { label: 'Skalierung auf 100 %', run: () => resetTransform('scale') },
      '-', { label: 'Alles zurücksetzen', run: () => resetTransform('all') }] });
    items.push({ label: 'Drehen 90°', icon: 'rotate', disabled: !isTop, sub: [
      { label: 'Um X +90°', run: () => rotate90('x', 1) }, { label: 'Um X −90°', run: () => rotate90('x', -1) },
      { label: 'Um Y +90°', run: () => rotate90('y', 1) }, { label: 'Um Y −90°', run: () => rotate90('y', -1) },
      { label: 'Um Z +90°', run: () => rotate90('z', 1) }, { label: 'Um Z −90°', run: () => rotate90('z', -1) }] });
    if (isTop) it('Maße setzen …', sizeDialog, { icon: 'scale' });
    items.push({ label: 'Spiegeln', icon: 'mirror', sub: [
      { label: 'An X spiegeln', run: () => mirror('x') }, { label: 'An Y spiegeln', run: () => mirror('y') }, { label: 'An Z spiegeln', run: () => mirror('z') }], disabled: multi });
    items.push({ label: 'Farbe', icon: 'box', colors: true });
    sep();
    if (isTop) items.push({ label: 'Verändern', icon: 'settings', sub: [
      { label: 'Aushöhlen (Wandstärke) …', run: () => modify('shell') },
      { label: 'Aushöhlen, oben offen', run: () => modify('shell', { open: 'Oben offen' }) },
      '-', { label: 'Teilen (waagerecht, Mitte)', run: () => splitSel('Z') }, { label: 'Teilen (senkrecht X)', run: () => splitSel('X') },
      { label: 'Abschneiden …', run: () => modify('cut') },
      '-', { label: 'Muster: Reihe', run: () => modify('pattern', { mode: 'Reihe X' }) }, { label: 'Muster: Raster', run: () => modify('pattern', { mode: 'Raster XY' }) },
      { label: 'Muster: Kreis', run: () => modify('pattern', { mode: 'Kreis' }) }] });
    if (multi) {
      items.push({ label: 'Ausrichten', icon: 'arrange', sub: [
        { label: 'Links (X min)', run: () => align('x', 'min') }, { label: 'Mitte X', run: () => align('x', 'mid') }, { label: 'Rechts (X max)', run: () => align('x', 'max') }, '-',
        { label: 'Vorne (Y min)', run: () => align('y', 'min') }, { label: 'Mitte Y', run: () => align('y', 'mid') }, { label: 'Hinten (Y max)', run: () => align('y', 'max') }, '-',
        { label: 'Unten (Z min)', run: () => align('z', 'min') }, { label: 'Mitte Z', run: () => align('z', 'mid') }, { label: 'Oben (Z max)', run: () => align('z', 'max') }, '-',
        { label: 'Gleichmäßig verteilen X', run: () => distribute('x') }, { label: 'Gleichmäßig verteilen Y', run: () => distribute('y') },
        { label: 'Aufreihen X (5 mm Abstand)', run: () => distribute('x', 5) }] });
      it('Vereinen', () => booleanOp('union'), { icon: 'union', key: 'Strg+U' });
      it('Abziehen (erstes minus Rest)', () => booleanOp('difference'), { icon: 'difference', key: 'Strg+M' });
      it('Schnittmenge', () => booleanOp('intersection'), { icon: 'intersection' });
      it('Hülle (umspannen)', () => booleanOp('hull'), { icon: 'hull' });
      it('Gruppieren', () => booleanOp('group'), { icon: 'group', key: 'Strg+G' });
      sep();
    }
    if (n.children) it('Auflösen', ungroup, { icon: 'ungroup', key: 'Strg+Umschalt+G' });
    if (!isTop) it('Aus Operation herausnehmen', () => takeOut(n.id), { icon: 'ungroup' });
    it(n.visible === false ? 'Einblenden' : 'Ausblenden', () => { n.visible = n.visible === false; commit(); }, { icon: n.visible === false ? 'eye' : 'eyeOff', key: 'H' });
    if (isTop && !multi) it('Nur dieses anzeigen', () => isolate(n.id), { icon: 'eye' });
    it('Einpassen', () => viewer.focusOn(selectedTop().map(x => x.id)), { icon: 'focus', key: 'F' });
    sep();
    if (isTop) {
      items.push({ label: multi ? 'Auswahl exportieren' : 'Exportieren', icon: 'export', sub: Object.entries(EXPORT_FORMATS).map(([k, f]) => ({ label: f.label + ' …', run: () => exportAs(k) })) });
      sep();
    }
    it('Löschen', del, { icon: 'delete', key: 'Entf', danger: true });
  } else {
    items.push({ head: 'Szene' });
    items.push({ label: 'Form einfügen', icon: 'box', sub: Object.keys(G.PRIMITIVES).map(t => ({ label: G.PRIMITIVES[t].label, run: () => addPrimitive(t) })) });
    items.push({ label: 'Vorlage einfügen', icon: 'remote', sub: Object.keys(TEMPLATES).map(t => ({ label: TEMPLATES[t].label, run: () => addTemplate(t) })) });
    it('Importieren …', importFiles, { icon: 'import', key: 'Strg+I' });
    it('Einfügen', paste, { key: 'Strg+V', disabled: !state.clip });
    sep();
    it('Alles auswählen', ACTIONS.selectAll.run, { key: 'Strg+A', disabled: !state.doc.nodes.length });
    it('Alles einblenden', showAll, { icon: 'eye', disabled: !state.doc.nodes.length });
    it('Alles anordnen', arrange, { icon: 'arrange', disabled: !state.doc.nodes.length });
    sep();
    items.push({ label: 'Ansicht', icon: 'iso', sub: [
      { label: 'ISO', run: () => viewer.view('iso') }, { label: 'Oben', run: () => viewer.view('top') }, { label: 'Vorne', run: () => viewer.view('front') },
      { label: 'Rechts', run: () => viewer.view('right') }, '-', { label: 'Alles einpassen', run: () => viewer.focusOn() }] });
    it('Bild der Ansicht speichern …', exportImage, { icon: 'export' });
    it('Druck-Check', doCheck, { icon: 'check', key: 'F5' });
  }
  const btn = (o) => `<button class="ci ${o.danger ? 'danger' : ''}" ${o.disabled ? 'disabled' : ''}>${o.icon ? icon(o.icon) : '<svg viewBox="0 0 24 24"></svg>'}<span>${esc(o.label)}</span>${o.key ? `<kbd>${o.key}</kbd>` : o.sub || o.colors ? icon('chevR') : ''}</button>`;
  const flat = [];
  const render = (list) => list.map(o => {
    if (o === '-') return '<hr>';
    if (o.head) return `<div class="ctx-head">${esc(o.head)}</div>`;
    if (o.colors) return `<div class="sub">${btn(o)}<div class="flyout"><div class="swatches">${COLORS.map(c => `<button data-color="${c}" style="background:${c}" aria-label="Farbe ${c}"></button>`).join('')}</div></div></div>`;
    if (o.sub) return `<div class="sub">${btn(o)}<div class="flyout">${o.sub.map(x => x === '-' ? '<hr>' : (flat.push(x), `<button class="ci" data-i="${flat.length - 1}"><span>${esc(x.label)}</span></button>`)).join('')}</div></div>`;
    flat.push(o); return btn(o).replace('<button class="ci', `<button data-i="${flat.length - 1}" class="ci`);
  }).join('');
  el.innerHTML = render(items);
  el.classList.remove('hidden');
  // Position im Fenster halten
  const r = el.getBoundingClientRect(); const W = window.innerWidth, H = window.innerHeight;
  el.style.left = Math.min(x, W - r.width - 8) + 'px'; el.style.top = Math.min(y, H - r.height - 8) + 'px';
  el.querySelectorAll('.sub').forEach(sb => {
    if (x + r.width + 210 > W) sb.classList.add('left');
    sb.addEventListener('mouseenter', () => { // Untermenü im Fenster halten
      const fo = sb.querySelector('.flyout'); fo.style.top = '-6px'; const fr = fo.getBoundingClientRect();
      if (fr.bottom > H - 8) fo.style.top = (-6 - (fr.bottom - H + 8)) + 'px';
    });
  });
  el.onclick = (e) => {
    const c = e.target.closest('[data-color]'); if (c) { closeContext(); setColor(c.dataset.color); return; }
    const b = e.target.closest('[data-i]'); if (!b || b.disabled) return;
    closeContext(); flat[+b.dataset.i].run();
  };
}
function closeContext() { $('#ctx').classList.add('hidden'); }

// ---------------------------------------------------------------------------
// Oberfläche: Menü & Werkzeugleiste
const ACTIONS = {
  new: { label: 'Neues Projekt', key: 'Strg+N', run: newProject, icon: 'new' },
  open: { label: 'Projekt öffnen …', key: 'Strg+O', run: openProject, icon: 'open' },
  save: { label: 'Speichern', key: 'Strg+S', run: () => saveProject(false), icon: 'save' },
  saveAs: { label: 'Speichern unter …', key: 'Strg+Umschalt+S', run: () => saveProject(true) },
  import: { label: 'Importieren (STL, OBJ, 3MF, PLY, AMF, OFF) …', key: 'Strg+I', run: importFiles, icon: 'import' },
  exportStl: { label: 'Als STL exportieren …', key: 'Strg+E', run: () => exportAs('stl'), icon: 'export' },
  export3mf: { label: 'Als 3MF exportieren (mit Farben) …', run: () => exportAs('3mf') },
  exportAny: { label: 'Exportieren als …', key: 'Strg+Umschalt+E', run: exportDialog },
  exportPng: { label: 'Bild der Ansicht speichern …', run: exportImage },
  hull: { label: 'Hülle (umspannen)', run: () => booleanOp('hull'), icon: 'hull', needMulti: true },
  shell: { label: 'Aushöhlen …', run: () => modify('shell'), icon: 'shell', needSel: true },
  cutMod: { label: 'Abschneiden …', run: () => modify('cut'), icon: 'cutplane', needSel: true },
  split: { label: 'Teilen (waagerecht)', run: () => splitSel('Z'), icon: 'cutplane', needSel: true },
  pattern: { label: 'Muster / Anordnung …', run: () => modify('pattern'), icon: 'pattern', needSel: true },
  size: { label: 'Maße setzen …', key: 'Strg+L', run: sizeDialog, icon: 'scale', needSel: true },
  rotX: { label: 'Um X +90° drehen', run: () => rotate90('x', 1), needSel: true }, rotY: { label: 'Um Y +90° drehen', run: () => rotate90('y', 1), needSel: true }, rotZ: { label: 'Um Z +90° drehen', run: () => rotate90('z', 1), needSel: true },
  alignL: { label: 'Links ausrichten', run: () => align('x', 'min'), needMulti: true }, alignCX: { label: 'Mittig ausrichten (X)', run: () => align('x', 'mid'), needMulti: true },
  alignB: { label: 'Unten ausrichten (Z)', run: () => align('z', 'min'), needMulti: true }, distX: { label: 'Gleichmäßig verteilen (X)', run: () => distribute('x'), needMulti: true },
  quit: { label: 'Beenden', run: () => api.close() },
  undo: { label: 'Rückgängig', key: 'Strg+Z', run: undo, icon: 'undo' },
  redo: { label: 'Wiederholen', key: 'Strg+Y', run: redo, icon: 'redo' },
  duplicate: { label: 'Duplizieren', key: 'Strg+D', run: duplicate, icon: 'duplicate', needSel: true },
  delete: { label: 'Löschen', key: 'Entf', run: del, icon: 'delete', needSel: true },
  copy: { label: 'Kopieren', key: 'Strg+C', run: copySel, needSel: true },
  cut: { label: 'Ausschneiden', key: 'Strg+X', run: cutSel, needSel: true },
  paste: { label: 'Einfügen', key: 'Strg+V', run: paste },
  rename: { label: 'Umbenennen', key: 'F2', run: () => state.sel.length === 1 && renameNode(state.sel[0]), needSel: true },
  hide: { label: 'Aus-/Einblenden', key: 'H', run: () => { const fs = state.sel.map(id => findNode(id)).filter(Boolean); if (!fs.length) return; const v = fs[0].node.visible === false; fs.forEach(f => (f.node.visible = v)); commit(); }, needSel: true },
  showAll: { label: 'Alles einblenden', key: 'Umschalt+H', run: showAll },
  resetPos: { label: 'Position auf 0 setzen', key: 'Strg+0', run: () => resetTransform('pos'), needSel: true },
  resetRot: { label: 'Drehung zurücksetzen', run: () => resetTransform('rot'), needSel: true },
  resetScale: { label: 'Skalierung zurücksetzen', run: () => resetTransform('scale'), needSel: true },
  resetAll: { label: 'Alles zurücksetzen', run: () => resetTransform('all'), needSel: true },
  selectAll: { label: 'Alles auswählen', key: 'Strg+A', run: () => { state.sel = state.doc.nodes.map(n => n.id); refresh(); } },
  mirrorX: { label: 'Spiegeln X', run: () => mirror('x'), needSel: true }, mirrorY: { label: 'Spiegeln Y', run: () => mirror('y'), needSel: true }, mirrorZ: { label: 'Spiegeln Z', run: () => mirror('z'), needSel: true },
  union: { label: 'Vereinen', key: 'Strg+U', run: () => booleanOp('union'), icon: 'union', needMulti: true },
  difference: { label: 'Abziehen (erstes minus Rest)', key: 'Strg+M', run: () => booleanOp('difference'), icon: 'difference', needMulti: true },
  intersection: { label: 'Schnittmenge', run: () => booleanOp('intersection'), icon: 'intersection', needMulti: true },
  group: { label: 'Gruppieren', key: 'Strg+G', run: () => booleanOp('group'), icon: 'group', needMulti: true },
  ungroup: { label: 'Auflösen', key: 'Strg+Umschalt+G', run: ungroup, icon: 'ungroup', needSel: true },
  move: { label: 'Verschieben', key: 'W', run: () => setMode('translate'), icon: 'move' },
  rotate: { label: 'Drehen', key: 'E', run: () => setMode('rotate'), icon: 'rotate' },
  scale: { label: 'Skalieren', key: 'R', run: () => setMode('scale'), icon: 'scale' },
  snap: { label: 'Raster (1 mm / 15°)', key: 'G', run: () => { state.snap = !state.snap; viewer.setSnap(state.snap); updateToolbarState(); }, icon: 'snap' },
  bed: { label: 'Auf Bett legen', key: 'B', run: () => dropToBed(), icon: 'bed', needSel: true },
  center: { label: 'Auf Bett zentrieren', key: 'C', run: () => centerOnBed(false), icon: 'center', needSel: true },
  arrange: { label: 'Alles anordnen', run: arrange, icon: 'arrange' },
  measure: { label: 'Messen', key: 'M', run: () => setMeasure(!state.measure), icon: 'measure' },
  section: { label: 'Schnittansicht', key: 'X', run: () => setSection(!state.section), icon: 'section' },
  wire: { label: 'Drahtgitter', run: () => { state.wire = !state.wire; viewer.setWireframe(state.wire); updateToolbarState(); }, icon: 'wire' },
  focus: { label: 'Auswahl einpassen', key: 'F', run: () => viewer.focusOn(selectedTop().map(n => n.id)), icon: 'focus' },
  viewIso: { label: 'Ansicht ISO', key: '0', run: () => viewer.view('iso') }, viewTop: { label: 'Ansicht oben', key: '7', run: () => viewer.view('top') },
  viewFront: { label: 'Ansicht vorne', key: '1', run: () => viewer.view('front') }, viewRight: { label: 'Ansicht rechts', key: '3', run: () => viewer.view('right') },
  overhang: { label: 'Überhang-Markierung', run: () => { const on = viewer.toggleOverhang(); toast(on ? 'Markierung an' : 'Markierung aus'); } },
  check: { label: 'Druck-Check', key: 'F5', run: doCheck, icon: 'check' },
  settings: { label: 'Einstellungen …', run: settingsDialog, icon: 'settings' },
  shortcuts: { label: 'Tastenkürzel', key: 'F1', run: shortcutsDialog },
  about: { label: 'Über …', run: aboutDialog },
};
for (const t of Object.keys(G.PRIMITIVES)) ACTIONS['add_' + t] = { label: G.PRIMITIVES[t].label, run: () => addPrimitive(t), icon: t };
for (const t of Object.keys(TEMPLATES)) ACTIONS['tpl_' + t] = { label: TEMPLATES[t].label, run: () => addTemplate(t), icon: TEMPLATES[t].icon };

const MENUS = [
  ['Datei', ['new', 'open', 'save', 'saveAs', '-', 'import', 'exportStl', 'export3mf', 'exportAny', 'exportPng', '-', 'settings', '-', 'quit']],
  ['Bearbeiten', ['undo', 'redo', '-', 'cut', 'copy', 'paste', 'duplicate', 'delete', 'rename', '-', 'selectAll', 'hide', 'showAll', '-', 'mirrorX', 'mirrorY', 'mirrorZ', '-', 'resetPos', 'resetRot', 'resetScale', 'resetAll']],
  ['Einfügen', [...Object.keys(G.PRIMITIVES).map(t => 'add_' + t), '-', ...Object.keys(TEMPLATES).map(t => 'tpl_' + t)]],
  ['Ändern', ['union', 'difference', 'intersection', 'hull', 'group', 'ungroup', '-', 'shell', 'split', 'cutMod', 'pattern', '-', 'move', 'rotate', 'scale', 'size', 'rotX', 'rotY', 'rotZ', 'snap', '-', 'alignL', 'alignCX', 'alignB', 'distX', '-', 'bed', 'center', 'arrange']],
  ['Ansicht', ['viewIso', 'viewTop', 'viewFront', 'viewRight', 'focus', '-', 'wire', 'section', 'overhang']],
  ['Werkzeuge', ['measure', 'check']],
  ['Hilfe', ['shortcuts', 'about']],
];
const TOOLBAR = [
  ['new', 'open', 'save'], ['import', 'exportStl'], ['undo', 'redo'],
  ['add_box', 'add_cylinder', 'add_tube', 'add_cone', 'add_sphere', 'add_torus', 'add_prism', 'add_text'],
  ['union', 'difference', 'intersection', 'ungroup'],
  ['move', 'rotate', 'scale', 'snap'],
  ['bed', 'center', 'duplicate', 'delete'],
  ['measure', 'section', 'check'],
];
function buildChrome() {
  const mb = $('#menubar');
  mb.innerHTML = MENUS.map(([title, items], i) => `<div class="menu" data-i="${i}"><button>${title}</button><div class="dropdown">${items.map(a => a === '-' ? '<hr>' : `<button data-act="${a}"><span>${ACTIONS[a].label}</span>${ACTIONS[a].key ? `<kbd>${ACTIONS[a].key}</kbd>` : ''}</button>`).join('')}</div></div>`).join('');
  mb.querySelectorAll('.menu > button').forEach(b => {
    b.addEventListener('click', (e) => { const m = b.parentElement; const was = m.classList.contains('open'); closeMenus(); if (!was) m.classList.add('open'); e.stopPropagation(); });
    b.addEventListener('mouseenter', () => { if (mb.querySelector('.menu.open')) { closeMenus(); b.parentElement.classList.add('open'); } });
  });
  document.addEventListener('click', closeMenus);
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#ctx')) closeContext(); });
  window.addEventListener('blur', closeContext);
  document.addEventListener('contextmenu', (e) => { if (!e.target.closest('#gl, #tree, input, textarea')) e.preventDefault(); });
  $('#toolbar').innerHTML = TOOLBAR.map(g => `<div class="tgroup">${g.map(a => `<button class="tbtn" data-act="${a}" title="${ACTIONS[a].label}${ACTIONS[a].key ? ' (' + ACTIONS[a].key + ')' : ''}" aria-label="${ACTIONS[a].label}">${icon(ACTIONS[a].icon)}${['union', 'difference', 'check', 'import'].includes(a) ? `<span>${{ union: 'Vereinen', difference: 'Abziehen', check: 'Druck-Check', import: 'Import' }[a]}</span>` : ''}</button>`).join('')}</div>`).join('');
  $('#viewBtns').innerHTML = [['viewIso', 'ISO'], ['viewTop', 'OBEN'], ['viewFront', 'VORN'], ['viewRight', 'RECHTS']].map(([a, t]) => `<button data-act="${a}" title="${ACTIONS[a].label}">${t}</button>`).join('') + `<button data-act="focus" title="Einpassen (F)">${icon('focus')}</button><button data-act="wire" title="Drahtgitter">${icon('wire')}</button>`;
  $('#templateList').innerHTML = Object.entries(TEMPLATES).map(([id, T]) => `<div class="tcard" data-act="tpl_${id}" role="button" tabindex="0"><h4>${icon(T.icon)}${esc(T.label)}</h4><p>${esc(T.desc)}</p></div>`).join('') +
    `<p class="pinfo" style="padding:4px">Vorlagen sind parametrisch: Nach dem Einfügen rechts unter „Parameter“ die Maße anpassen.</p>`;
  document.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const a = b.dataset.act;
    if (a === 'drop') { dropToBed([b.dataset.target]); return; }
    if (a === 'centerAll') { centerOnBed(true); return; }
    if (a === 'showOverhang') { ACTIONS.overhang.run(); return; }
    if (ACTIONS[a]) { closeMenus(); ACTIONS[a].run(); }
  });
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    $('#tab-scene').classList.toggle('hidden', t.dataset.tab !== 'scene'); $('#tab-templates').classList.toggle('hidden', t.dataset.tab !== 'templates');
  }));
  $('#runCheck').addEventListener('click', doCheck);
  $('#wMin').onclick = () => api.minimize(); $('#wMax').onclick = () => api.maximize(); $('#wClose').onclick = async () => { if (await confirmDiscard()) api.close(); };
  $('#sectionZ').addEventListener('input', (e) => { const z = parseFloat(e.target.value); viewer.setSection(true, z); $('#sectionVal').textContent = fmt(z) + ' mm'; });
}
function closeMenus() { document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); }
function updateToolbarState() {
  const nSel = state.sel.length, multi = selectedTop().length >= 2;
  document.querySelectorAll('[data-act]').forEach(b => {
    const a = ACTIONS[b.dataset.act]; if (!a) return;
    b.disabled = (a.needSel && !nSel) || (a.needMulti && !multi) || (b.dataset.act === 'undo' && !state.undo.length) || (b.dataset.act === 'redo' && !state.redo.length);
  });
  const act = { move: state.mode === 'translate', rotate: state.mode === 'rotate', scale: state.mode === 'scale', snap: state.snap, measure: state.measure, section: state.section, wire: state.wire };
  for (const [k, v] of Object.entries(act)) document.querySelectorAll(`[data-act="${k}"]`).forEach(b => b.classList.toggle('active', v));
}
function setMode(m) { state.mode = m; if (state.measure) setMeasure(false); viewer.setGizmoMode(m); refresh(); }
function setMeasure(on) {
  state.measure = on; viewer.setMeasure(on); if (on) viewer.detachGizmo(); else refresh();
  const mi = $('#measureInfo'); mi.classList.toggle('hidden', !on); mi.innerHTML = 'Messen: ersten Punkt auf einem Objekt anklicken. <br>Esc beendet.'; updateToolbarState();
}
function setSection(on) {
  state.section = on; const ctl = $('#sectionCtl'); ctl.classList.toggle('hidden', !on);
  if (on) {
    let maxZ = 10; for (const n of state.doc.nodes) { const b = worldBox(n); if (!b.isEmpty()) maxZ = Math.max(maxZ, b.max.z); }
    const r = $('#sectionZ'); r.max = Math.ceil(maxZ * 10) / 10; r.value = Math.round(maxZ / 2 * 10) / 10; r.dispatchEvent(new Event('input'));
  } else viewer.setSection(false);
  updateToolbarState();
}

// ---------------------------------------------------------------------------
// Szenenbaum
function renderTree() {
  const el = $('#tree');
  if (!state.doc.nodes.length) { el.innerHTML = `<div class="tree-empty">Noch keine Objekte.<br><br>Form in der Werkzeugleiste anklicken, eine Vorlage wählen oder ein Modell importieren (Strg+I).</div>`; return; }
  const row = (n, depth) => {
    const r = resultOf(n.id); const hasKids = n.children && n.children.length; const open = state.expanded.has(n.id);
    const ic = n.type === 'template' ? TEMPLATES[n.template]?.icon : n.type === 'import' ? 'import3d' : n.type === 'cut' ? 'cutplane' : n.type;
    let h = `<div class="tnode ${state.sel.includes(n.id) ? 'sel' : ''} ${n.visible === false ? 'hiddenNode' : ''}" data-id="${n.id}" role="treeitem" style="padding-left:${6 + depth * 16}px">
      <span class="tw" data-tw="${n.id}">${hasKids ? icon(open ? 'chevD' : 'chevR') : ''}</span><span class="ic">${icon(ic)}</span>
      <span class="nm" title="Doppelklick zum Umbenennen">${esc(n.name)}</span>${r && !r.ok ? `<span class="err" title="${esc(r.error)}">${icon('warn')}</span>` : ''}
      <span class="sw" style="background:${esc(n.color || '#ddd')}"></span>
      <button class="eye" data-eye="${n.id}" aria-label="Sichtbarkeit">${icon(n.visible === false ? 'eyeOff' : 'eye')}</button></div>`;
    if (hasKids && open) for (const c of n.children) h += row(c, depth + 1);
    return h;
  };
  el.innerHTML = state.doc.nodes.map(n => row(n, 0)).join('');
}
function bindTree() {
  const el = $('#tree');
  el.addEventListener('click', (e) => {
    const tw = e.target.closest('[data-tw]'); if (tw) { const id = tw.dataset.tw; state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); renderTree(); return; }
    const eye = e.target.closest('[data-eye]'); if (eye) { const f = findNode(eye.dataset.eye); f.node.visible = f.node.visible === false; commit(f.node.visible ? 'Eingeblendet' : 'Ausgeblendet'); return; }
    const row = e.target.closest('.tnode'); if (!row) return;
    pick(row.dataset.id, e.shiftKey || e.ctrlKey);
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault(); const row = e.target.closest('.tnode');
    if (row && !state.sel.includes(row.dataset.id)) { state.sel = [row.dataset.id]; refresh(); }
    openContext(e.clientX, e.clientY, row ? { id: row.dataset.id } : null);
  });
  el.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.tnode'); if (!row) return;
    const f = findNode(row.dataset.id); const nm = row.querySelector('.nm');
    const inp = document.createElement('input'); inp.value = f.node.name; nm.replaceWith(inp); inp.focus(); inp.select();
    const done = (ok) => { if (ok && inp.value.trim()) { f.node.name = inp.value.trim(); commit('Umbenannt'); } else renderTree(); };
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); ev.stopPropagation(); });
    inp.addEventListener('blur', () => done(true));
  });
}
function pick(id, additive) {
  if (!id) { if (!additive) state.sel = []; }
  else if (additive) state.sel = state.sel.includes(id) ? state.sel.filter(x => x !== id) : [...state.sel, id];
  else state.sel = [id];
  refresh();
}

// ---------------------------------------------------------------------------
// Eigenschaften
function renderProps() {
  const el = $('#props');
  if (document.activeElement && el.contains(document.activeElement) && document.activeElement.matches('input[type=text], input[type=number]')) return; // Eingabe nicht unterbrechen
  if (!state.sel.length) {
    el.innerHTML = `<p class="pinfo" style="margin-top:4px">Nichts ausgewählt.</p>
      <div class="pgroup"><h5>Projekt</h5><div class="kv"><span>Objekte</span><b>${state.doc.nodes.length}</b><span>Druckbett</span><b>${state.doc.settings.bed.join(' × ')} mm</b><span>Material</span><b>${esc(state.doc.settings.material)}</b></div>
      <div class="btn-row"><button class="btn" data-act="settings">Einstellungen</button><button class="btn" data-act="arrange">Alles anordnen</button></div></div>
      <div class="pgroup"><h5>Bedienung</h5><p class="pinfo">Linke Maustaste: drehen · Rechte/mittlere: verschieben · Rad: zoomen · Klick: auswählen · Umschalt+Klick: mehrere · Doppelklick: einpassen</p></div>`;
    return;
  }
  if (state.sel.length > 1) {
    el.innerHTML = `<p class="pinfo" style="margin-top:4px">${state.sel.length} Objekte ausgewählt. Das zuerst gewählte ist bei „Abziehen“ der Grundkörper.</p>
      <div class="btn-row"><button class="btn" data-act="union">Vereinen</button><button class="btn" data-act="difference">Abziehen</button><button class="btn" data-act="intersection">Schnittmenge</button><button class="btn" data-act="group">Gruppieren</button></div>
      <div class="btn-row"><button class="btn" data-act="hull">Hülle</button><button class="btn" data-act="alignL">Links bündig</button><button class="btn" data-act="alignB">Unten bündig</button><button class="btn" data-act="distX">Verteilen</button></div>
      <div class="btn-row"><button class="btn" data-act="bed">Auf Bett legen</button><button class="btn" data-act="center">Zentrieren</button><button class="btn" data-act="duplicate">Duplizieren</button><button class="btn" data-act="delete">Löschen</button></div>`;
    updateToolbarState(); return;
  }
  const f = findNode(state.sel[0]); if (!f) { el.innerHTML = ''; return; }
  const n = f.node; const isTop = !f.parent; const r = resultOf(topLevelOf(n.id)?.id);
  const numIn = (path, val, ax, step = 0.5) => `<div class="num-wrap"><span class="ax">${ax}</span><input class="field" type="number" step="${step}" data-path="${path}" value="${+(+val).toFixed(3)}"></div>`;
  let h = `<div class="pgroup"><h5>${esc(G.typeLabel(n.type))}${n.type === 'template' ? ' · ' + esc(TEMPLATES[n.template]?.label) : ''}</h5>
    <div class="prow"><label>Name</label><input class="field" type="text" data-path="name" value="${esc(n.name)}"></div>
    <div class="prow"><label>Farbe</label><input class="field" type="color" data-path="color" value="${esc(n.color || '#dddddd')}"></div></div>`;
  h += `<div class="pgroup"><h5>${isTop ? 'Lage' : 'Lage in der Operation'}</h5>
    <div class="prow trio"><label>Position</label>${numIn('pos.0', n.pos[0], 'X')}${numIn('pos.1', n.pos[1], 'Y')}${numIn('pos.2', n.pos[2], 'Z')}</div>
    <div class="prow trio"><label>Drehung °</label>${numIn('rot.0', n.rot[0], 'X', 15)}${numIn('rot.1', n.rot[1], 'Y', 15)}${numIn('rot.2', n.rot[2], 'Z', 15)}</div>
    <div class="prow trio"><label>Skalierung</label>${numIn('scale.0', n.scale[0], 'X', 0.05)}${numIn('scale.1', n.scale[1], 'Y', 0.05)}${numIn('scale.2', n.scale[2], 'Z', 0.05)}</div>
    <div class="btn-row">${isTop ? '<button class="btn" data-act="bed">Auf Bett legen</button><button class="btn" data-act="center">Zentrieren</button>' : `<button class="btn" data-takeout="${n.id}">Aus Operation herausnehmen</button>`}
    <button class="btn" data-act="mirrorX">Spiegeln X</button><button class="btn" data-act="mirrorY">Y</button><button class="btn" data-act="mirrorZ">Z</button></div>
    ${isTop ? '<div class="btn-row"><button class="btn" data-act="resetPos">Position 0</button><button class="btn" data-act="resetRot">Drehung 0</button><button class="btn" data-act="size">Maße setzen …</button></div><div class="btn-row"><button class="btn" data-act="shell">Aushöhlen</button><button class="btn" data-act="split">Teilen</button><button class="btn" data-act="pattern">Muster</button></div>' : ''}</div>`;
  const schema = G.paramSchema(n);
  if (schema.length) {
    h += `<div class="pgroup"><h5>Parameter</h5>` + schema.map(s => {
      const v = n.params[s.key] ?? s.def;
      let input;
      if (s.type === 'select') input = `<select class="field" data-param="${s.key}">${s.options.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      else if (s.type === 'text') input = `<input class="field" type="text" data-param="${s.key}" value="${esc(v)}">`;
      else input = `<input class="field" type="number" data-param="${s.key}" step="${s.step ?? 0.5}" ${s.min != null ? `min="${s.min}"` : ''} ${s.max != null ? `max="${s.max}"` : ''} value="${v}">`;
      return `<div class="prow"><label>${esc(s.label)}</label>${input}</div>`;
    }).join('') + `</div>`;
  }
  if (n.children && G.MODIFIERS[n.type]) {
    h += `<div class="pgroup"><h5>Modifikator</h5><p class="pinfo">${esc(G.MODIFIERS[n.type].label)} wirkt auf „${esc(n.children[0]?.name)}“. Werte oben unter „Parameter“ ändern; das Original bleibt erhalten.</p><div class="btn-row"><button class="btn" data-act="ungroup">Modifikator entfernen</button></div></div>`;
  }
  if (n.children && G.BOOLEAN_TYPES[n.type]) {
    h += `<div class="pgroup"><h5>Operation</h5><div class="prow"><label>Art</label><select class="field" data-optype="1">${Object.entries(G.BOOLEAN_TYPES).map(([k, l]) => `<option value="${k}" ${k === n.type ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <p class="pinfo">${n.children.length} Teile. Bei „Differenz“ wird vom ersten Teil alles Weitere abgezogen. Teile im Szenenbaum aufklappen und einzeln verschieben.</p>
      <div class="btn-row"><button class="btn" data-act="ungroup">Auflösen</button></div></div>`;
  }
  if (isTop && r) {
    const bb = worldBox(n); const sz = bb.isEmpty() ? null : bb.getSize(new THREE.Vector3());
    h += `<div class="pgroup"><h5>Info</h5><div class="kv">
      ${sz ? `<span>Maße</span><b>${fmt(sz.x)} × ${fmt(sz.y)} × ${fmt(sz.z)} mm</b><span>Unterkante Z</span><b>${fmt(bb.min.z, 2)} mm</b>` : ''}
      <span>Volumen</span><b>${fmt(r.volume * Math.abs(n.scale[0] * n.scale[1] * n.scale[2]) / 1000, 2)} cm³</b>
      <span>Dreiecke</span><b>${(r.tri.length / 3).toLocaleString('de-DE')}</b>
      <span>Körper</span><b>${r.parts}</b>
      <span>Status</span><b style="color:${r.ok ? 'var(--green)' : 'var(--red)'}">${r.ok ? 'wasserdicht' : esc(r.error || 'Fehler')}</b></div></div>`;
  }
  el.innerHTML = h;
  updateToolbarState();
}
function bindProps() {
  const el = $('#props');
  const apply = (t, final) => {
    const f = state.sel.length === 1 && findNode(state.sel[0]); if (!f) return;
    const n = f.node;
    if (t.dataset.path) {
      const [k, i] = t.dataset.path.split('.');
      if (i != null) { const v = parseFloat(t.value); if (!isFinite(v)) return; n[k] = [...n[k]]; n[k][+i] = v; }
      else n[k] = t.value;
    } else if (t.dataset.param) {
      const s = G.paramSchema(n).find(x => x.key === t.dataset.param);
      let v = t.value; if (s.type === 'num') { v = parseFloat(v); if (!isFinite(v)) return; if (s.min != null) v = Math.max(s.min, v); if (s.max != null) v = Math.min(s.max, v); }
      n.params = { ...n.params, [t.dataset.param]: v };
    } else if (t.dataset.optype) { n.type = t.value; }
    else return;
    if (final) commit(); else { state.dirty = true; refresh(); }
  };
  el.addEventListener('change', (e) => apply(e.target, true));
  el.addEventListener('input', (e) => { if (e.target.type === 'color') apply(e.target, false); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.target.blur(); } e.stopPropagation(); });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-takeout]'); if (b) takeOut(b.dataset.takeout); });
}

// ---------------------------------------------------------------------------
// Dialoge
function dialog(html, onOk, okLabel = 'Übernehmen') {
  const m = $('#modal'); m.innerHTML = `<div class="dialog">${html}<div class="btn-row" style="justify-content:flex-end;margin-top:18px">${onOk ? '<button class="btn" data-close>Abbrechen</button><button class="btn primary" data-ok>${okLabel}</button>' : '<button class="btn primary" data-close>Schließen</button>'}</div></div>`;
  m.classList.remove('hidden');
  const close = () => m.classList.add('hidden');
  m.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  const ok = m.querySelector('[data-ok]'); if (ok) ok.onclick = () => { onOk(m); close(); };
  m.onclick = (e) => { if (e.target === m) close(); };
  m.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); };
  const first = m.querySelector('input, select, button'); first && first.focus();
  const pr = m.querySelector('#sPr'); if (pr) pr.onchange = () => { const b = PRINTERS[pr.value]; if (b) ['sBx', 'sBy', 'sBz'].forEach((id, i) => (m.querySelector('#' + id).value = b[i])); };
}
const PRINTERS = {
  'Bambu Lab X1 / P1 / P2S': [256, 256, 256], 'Bambu Lab A1': [256, 256, 256], 'Bambu Lab A1 mini': [180, 180, 180], 'Bambu Lab H2D': [325, 320, 325],
  'Prusa Core One': [250, 220, 270], 'Prusa MK4S': [250, 210, 220], 'Prusa MINI+': [180, 180, 180], 'Prusa XL': [360, 360, 360],
  'Creality Ender-3 V3': [220, 220, 250], 'Creality K1 / K2': [220, 220, 250], 'Creality K1 Max': [300, 300, 300], 'Anycubic Kobra 3': [250, 250, 260],
  'Elegoo Neptune 4 Pro': [225, 225, 265], 'Voron 2.4 (350)': [350, 350, 340], 'Qidi Plus4': [305, 305, 280],
  'Harz: Elegoo Saturn 4 Ultra': [218, 123, 220], 'Harz: Anycubic Photon Mono M7': [223, 126, 230], 'Harz: Formlabs Form 4': [200, 125, 210],
};
function settingsDialog() {
  const s = state.doc.settings;
  dialog(`<h3>Einstellungen</h3>
    <div class="pgroup"><h5>Drucker</h5>
      <div class="prow"><label for="sPr">Profil</label><select id="sPr" class="field"><option value="">– eigener Bauraum –</option>${Object.entries(PRINTERS).map(([k, b]) => `<option value="${k}" ${b.join() === s.bed.join() ? 'selected' : ''}>${k} (${b.join(' × ')})</option>`).join('')}</select></div>
      <div class="prow"><label for="sBx">Bauraum X (mm)</label><input id="sBx" class="field" type="number" value="${s.bed[0]}"></div>
      <div class="prow"><label for="sBy">Bauraum Y (mm)</label><input id="sBy" class="field" type="number" value="${s.bed[1]}"></div>
      <div class="prow"><label for="sBz">Bauraum Z (mm)</label><input id="sBz" class="field" type="number" value="${s.bed[2]}"></div>
      <div class="prow"><label for="sMat">Material</label><select id="sMat" class="field">${Object.keys(MATERIALS).map(k => `<option ${k === s.material ? 'selected' : ''}>${k}</option>`).join('')}</select></div></div>
    <div class="pgroup"><h5>Druck-Check</h5>
      <div class="prow"><label for="sOh">Überhang-Grenze (° zur Horizontalen)</label><input id="sOh" class="field" type="number" min="10" max="80" value="${s.overhang}"></div>
      <div class="prow"><label for="sMw">Mindest-Wandstärke (mm)</label><input id="sMw" class="field" type="number" step="0.1" value="${s.minWall}"></div></div>
    <div class="pgroup"><h5>Qualität</h5>
      <div class="prow"><label for="sSeg">Kreis-Segmente (Vorlagen)</label><select id="sSeg" class="field">${[32, 48, 64, 96, 128].map(v => `<option ${v === s.seg ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div>`,
  (m) => {
    const g = (id) => m.querySelector('#' + id).value;
    s.bed = [+g('sBx') || 256, +g('sBy') || 256, +g('sBz') || 256]; s.material = g('sMat'); s.overhang = +g('sOh') || 45; s.minWall = +g('sMw') || 0.8; s.seg = +g('sSeg') || 64;
    viewer.setBed(s.bed); G.clearCache(); state.results.clear(); commit('Einstellungen übernommen');
  });
}
function shortcutsDialog() {
  const rows = Object.values(ACTIONS).filter(a => a.key).map(a => `<tr><td>${a.key}</td><td>${a.label}</td></tr>`).join('');
  dialog(`<h3>Tastenkürzel</h3><table>${rows}<tr><td>Esc</td><td>Auswahl aufheben / Messen beenden</td></tr><tr><td>Pfeiltasten</td><td>Auswahl um 1 mm verschieben (Umschalt: 10 mm)</td></tr><tr><td>Bild ↑ / Bild ↓</td><td>Auswahl um 1 mm heben / senken</td></tr></table>`);
}
function aboutDialog() {
  dialog(`<h3>Donrath Intelligence STL Constructor</h3><p>Version 1.0.0<br>Parametrischer 3D-Konstruktor für den 3D-Druck.</p>
    <p>Geometrie-Kern: Manifold (Apache-2.0) · 3D-Ansicht: three.js (MIT) · Schrift: Helvetiker (three.js-Beispiele).</p>`);
}

// ---------------------------------------------------------------------------
// Status, Meldungen
function updateStatus() {
  const nodes = selectedTop();
  if (!state.sel.length) { $('#stSel').textContent = `${state.doc.nodes.length} Objekt(e)`; }
  else $('#stSel').textContent = state.sel.length === 1 ? (findNode(state.sel[0])?.node.name || '') : `${state.sel.length} ausgewählt`;
  const list = nodes.length ? nodes : state.doc.nodes.filter(n => n.visible !== false);
  const bb = new THREE.Box3(); let vol = 0, tri = 0;
  for (const n of list) { bb.union(worldBox(n)); const r = resultOf(n.id); if (r) { vol += r.volume * Math.abs(n.scale[0] * n.scale[1] * n.scale[2]); tri += r.tri.length / 3; } }
  if (bb.isEmpty()) { $('#stDims').textContent = ''; $('#stVol').textContent = ''; $('#stTri').textContent = ''; }
  else { const s = bb.getSize(new THREE.Vector3()); $('#stDims').textContent = `${fmt(s.x)} × ${fmt(s.y)} × ${fmt(s.z)} mm`; $('#stVol').textContent = `${fmt(vol / 1000, 2)} cm³`; $('#stTri').textContent = `${tri.toLocaleString('de-DE')} Dreiecke`; }
  $('#stBed').textContent = `Bett ${state.doc.settings.bed.slice(0, 2).join(' × ')} · ${state.doc.settings.material}`;
}
function updateTitle() { $('#docTitle').textContent = (state.doc.name || 'Unbenannt') + (state.dirty ? ' •' : ''); document.title = 'Donrath Intelligence STL Constructor – ' + (state.doc.name || 'Unbenannt'); }
let msgTimer; function setMsg(t, err = false) { const m = $('#stMsg'); m.textContent = t; m.classList.toggle('err', err); clearTimeout(msgTimer); msgTimer = setTimeout(() => (m.textContent = ''), 4000); }
function toast(t, err = false) { const d = document.createElement('div'); d.className = 'toast' + (err ? ' err' : ''); d.textContent = t; $('#toasts').appendChild(d); setTimeout(() => d.remove(), err ? 6500 : 3500); }
function setBusy(on, text) { $('#busy').classList.toggle('hidden', !on); if (text) $('#busyText').textContent = text; }

// ---------------------------------------------------------------------------
// Tastatur
function keyName(e) { return [e.ctrlKey || e.metaKey ? 'Strg' : '', e.shiftKey ? 'Umschalt' : '', e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join('+'); }
const KEYMAP = {}; for (const [id, a] of Object.entries(ACTIONS)) if (a.key) KEYMAP[a.key.replace('Entf', 'Delete')] = id;
function bindKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea') || !$('#modal').classList.contains('hidden')) return;
    const k = keyName(e);
    if (k === 'Escape' && !$('#ctx').classList.contains('hidden')) { closeContext(); return; }
    if (k === 'Escape') { if (state.measure) setMeasure(false); else { state.sel = []; refresh(); } closeMenus(); return; }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(e.key) && selectedTop().length) {
      const d = e.shiftKey ? 10 : 1; const v = { ArrowLeft: [-d, 0, 0], ArrowRight: [d, 0, 0], ArrowUp: [0, d, 0], ArrowDown: [0, -d, 0], PageUp: [0, 0, d], PageDown: [0, 0, -d] }[e.key];
      selectedTop().forEach(n => { n.pos = n.pos.map((p, i) => Math.round((p + v[i]) * 1000) / 1000); }); commit(); e.preventDefault(); return;
    }
    if (k === 'Backspace') { del(); return; }
    const id = KEYMAP[k] || KEYMAP[k.replace('Strg+Y', 'Strg+Y')] || (k === 'Strg+Umschalt+Z' ? 'redo' : null);
    if (id) { e.preventDefault(); ACTIONS[id].run(); }
  });
}

// ---------------------------------------------------------------------------
// Start
async function main() {
  buildChrome(); bindTree(); bindProps(); bindKeys();
  api.onWinState(() => {});
  setBusy(true, 'Lade Geometrie-Kern …');
  await G.initGeometry(ManifoldModule, { locateFile: () => './manifold.wasm' });
  viewer = new Viewer($('#gl'), $('#labels'), {
    onPick: (id, add) => { closeContext(); pick(id, add); },
    onContext: (x, y, info) => openContext(x, y, info),
    onTransform: (id, t, final) => {
      const n = state.doc.nodes.find(x => x.id === id); if (!n) return;
      Object.assign(n, t);
      if (final) commit(); else { renderPropsLive(n); }
    },
    onMeasure: (m) => {
      const mi = $('#measureInfo');
      if (!m) mi.innerHTML = 'Messen: ersten Punkt auf einem Objekt anklicken.<br>Esc beendet.';
      else if (m.first) mi.innerHTML = 'Zweiten Punkt anklicken …';
      else mi.innerHTML = `Abstand <b>${fmt(m.d, 2)} mm</b><br>ΔX ${fmt(m.dx, 2)} · ΔY ${fmt(m.dy, 2)} · ΔZ ${fmt(m.dz, 2)} mm<br>Nächster Klick startet neu.`;
    },
  });
  viewer.setSnap(state.snap);
  state.lastSnap = snapshot();
  setBusy(false);
  refresh(true);
  // Ziehen & Ablegen
  document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  document.addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('dropping'); if (e.dataTransfer.files.length) dropFiles(e.dataTransfer.files); });
  // Schließen (Titelleiste, Alt+F4, Taskleiste): bei ungespeicherten Änderungen nachfragen
  api.onCloseRequest && api.onCloseRequest(async () => {
    if (!state.dirty || !state.doc.nodes.length) { api.confirmClose(); return; }
    const r = await api.confirm('Änderungen vor dem Beenden speichern?', `„${state.doc.name || 'Unbenannt'}“ wurde geändert.`, ['Speichern', 'Nicht speichern', 'Abbrechen']);
    if (r === 0) { await saveProject(false); if (!state.dirty) api.confirmClose(); } else if (r === 1) api.confirmClose();
  });
  // Per Doppelklick geöffnete .dicp-Datei
  api.onOpenFile && api.onOpenFile(async (f) => { if (await confirmDiscard()) loadProjectData(new Uint8Array(f.data), f.path); });
  api.ready && api.ready();
  window.__dic = { state, ACTIONS, viewer, G, api, modify, splitSel, align, distribute, rotate90, exportAs, resetTransform, paste, copySel, layFlat, openContext, dropFiles }; // für Tests
}
function renderPropsLive(n) {
  // Während des Ziehens nur die Zahlenfelder aktualisieren
  document.querySelectorAll('#props [data-path]').forEach(inp => { const [k, i] = inp.dataset.path.split('.'); if (i != null && n[k]) inp.value = +(+n[k][+i]).toFixed(3); });
}
main().catch(e => {
  console.error(e); setBusy(false);
  const gl = /WebGL/i.test(String(e.message));
  dialog(`<h3>${gl ? '3D-Ansicht konnte nicht starten' : 'Startfehler'}</h3><p>${gl ? 'Die Grafikkarte stellt kein WebGL bereit. Bitte den Grafiktreiber aktualisieren. Bei Remote-Desktop-Verbindungen die App direkt am Rechner starten.' : esc(e.message)}</p>`);
});
