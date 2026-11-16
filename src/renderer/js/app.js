// Donrath Intelligence STL Constructor – Anwendung
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import ManifoldModule from 'manifold-3d';
import * as G from './geometry.js';
import { TEMPLATES } from './templates.js';
import { Viewer } from './viewer.js';
import { runPrintCheck, MATERIALS, fmt } from './printcheck.js';
import { toBinarySTL, to3MF, importMesh, serializeProject, parseProject } from './io.js';
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
function resultOf(id) { const r = state.results.get(id); return r ? r.res : null; }

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
  if (!n || !n.node.children) { toast('Eine boolesche Operation oder Gruppe auswählen.', true); return; }
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
  try {
    const { doc, assets } = parseProject(new Uint8Array(files[0].data));
    Object.assign(state, { doc, assets, sel: [], filePath: files[0].path, undo: [], redo: [], check: null }); state.lastSnap = snapshot(); state.dirty = false;
    G.clearCache(); state.results.clear(); viewer.setBed(doc.settings.bed); refresh(); setTimeout(() => viewer.focusOn(), 200);
    toast(`Projekt „${doc.name}“ geöffnet`);
  } catch (e) { toast('Projekt konnte nicht geöffnet werden: ' + e.message, true); }
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
  let nodes = selectedTop(); if (!nodes.length) nodes = state.doc.nodes.filter(n => n.visible !== false);
  if (!nodes.length) { toast('Nichts zum Exportieren.', true); return; }
  const meshes = nodes.map(worldMesh).filter(Boolean);
  const bad = meshes.filter(m => !m.ok);
  if (bad.length) toast(`Achtung: ${bad.map(b => b.name).join(', ')} ist nicht wasserdicht.`, true);
  const below = meshes.some(m => { for (let i = 2; i < m.vert.length; i += 3) if (m.vert[i] < -0.01) return true; return false; });
  if (below) toast('Hinweis: Teile ragen unter das Druckbett. „Auf Bett legen“ (B) vor dem Export empfohlen.', true);
  const base = nodes.length === 1 ? nodes[0].name : (state.doc.name || 'Export');
  let data;
  if (kind === 'stl') {
    // Mehrere Objekte zu einem Netz zusammenfassen
    let tv = 0, tt = 0; meshes.forEach(m => { tv += m.vert.length; tt += m.tri.length; });
    const vert = new Float32Array(tv), tri = new Uint32Array(tt); let ov = 0, ot = 0;
    for (const m of meshes) { vert.set(m.vert, ov); for (let i = 0; i < m.tri.length; i++) tri[ot + i] = m.tri[i] + ov / 3; ov += m.vert.length; ot += m.tri.length; }
    data = toBinarySTL(vert, tri);
  } else data = to3MF(meshes.map(m => ({ name: m.name, vert: m.vert, tri: m.tri, color: m.color })));
  const p = await api.saveFile(kind, safeName(base) + '.' + kind, data);
  if (p) toast(`${kind.toUpperCase()} gespeichert: ${String(p).split(/[\\/]/).pop()}`);
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
// Oberfläche: Menü & Werkzeugleiste
const ACTIONS = {
  new: { label: 'Neues Projekt', key: 'Strg+N', run: newProject, icon: 'new' },
  open: { label: 'Projekt öffnen …', key: 'Strg+O', run: openProject, icon: 'open' },
  save: { label: 'Speichern', key: 'Strg+S', run: () => saveProject(false), icon: 'save' },
  saveAs: { label: 'Speichern unter …', key: 'Strg+Umschalt+S', run: () => saveProject(true) },
  import: { label: 'Importieren (STL, OBJ, 3MF) …', key: 'Strg+I', run: importFiles, icon: 'import' },
  exportStl: { label: 'Als STL exportieren …', key: 'Strg+E', run: () => exportAs('stl'), icon: 'export' },
  export3mf: { label: 'Als 3MF exportieren (mit Farben) …', key: 'Strg+Umschalt+E', run: () => exportAs('3mf') },
  quit: { label: 'Beenden', run: () => api.close() },
  undo: { label: 'Rückgängig', key: 'Strg+Z', run: undo, icon: 'undo' },
  redo: { label: 'Wiederholen', key: 'Strg+Y', run: redo, icon: 'redo' },
  duplicate: { label: 'Duplizieren', key: 'Strg+D', run: duplicate, icon: 'duplicate', needSel: true },
  delete: { label: 'Löschen', key: 'Entf', run: del, icon: 'delete', needSel: true },
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
  ['Datei', ['new', 'open', 'save', 'saveAs', '-', 'import', 'exportStl', 'export3mf', '-', 'settings', '-', 'quit']],
  ['Bearbeiten', ['undo', 'redo', '-', 'duplicate', 'delete', 'selectAll', '-', 'mirrorX', 'mirrorY', 'mirrorZ']],
  ['Einfügen', [...Object.keys(G.PRIMITIVES).map(t => 'add_' + t), '-', ...Object.keys(TEMPLATES).map(t => 'tpl_' + t)]],
  ['Ändern', ['union', 'difference', 'intersection', 'group', 'ungroup', '-', 'move', 'rotate', 'scale', 'snap', '-', 'bed', 'center', 'arrange']],
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
    const ic = n.type === 'template' ? TEMPLATES[n.template]?.icon : n.type === 'import' ? 'import3d' : n.type;
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
    <button class="btn" data-act="mirrorX">Spiegeln X</button><button class="btn" data-act="mirrorY">Y</button><button class="btn" data-act="mirrorZ">Z</button></div></div>`;
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
  if (n.children) {
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
function dialog(html, onOk) {
  const m = $('#modal'); m.innerHTML = `<div class="dialog">${html}<div class="btn-row" style="justify-content:flex-end;margin-top:18px">${onOk ? '<button class="btn" data-close>Abbrechen</button><button class="btn primary" data-ok>Übernehmen</button>' : '<button class="btn primary" data-close>Schließen</button>'}</div></div>`;
  m.classList.remove('hidden');
  const close = () => m.classList.add('hidden');
  m.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  const ok = m.querySelector('[data-ok]'); if (ok) ok.onclick = () => { onOk(m); close(); };
  m.onclick = (e) => { if (e.target === m) close(); };
  m.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); };
  const first = m.querySelector('input, select, button'); first && first.focus();
}
function settingsDialog() {
  const s = state.doc.settings;
  dialog(`<h3>Einstellungen</h3>
    <div class="pgroup"><h5>Drucker</h5>
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
    onPick: (id, add) => pick(id, add),
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
  window.__dic = { state, ACTIONS, viewer, G, api }; // für Tests
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
