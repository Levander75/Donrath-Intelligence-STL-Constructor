// 3D-Ansicht: Szene, Druckbett, Kamera, Gizmo, Auswahl, Schnitt, Messen
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export class Viewer {
  constructor(canvas, labelsEl, cb) {
    this.canvas = canvas; this.labelsEl = labelsEl; this.cb = cb; // cb: onPick(id, additive), onTransform(id, pos, rot, scale, final)
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    r.localClippingEnabled = true;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(180, -220, 170);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.12;
    this.controls.target.set(0, 0, 10);
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };

    // Licht – weich, mit Glanzlichtern für den Hochglanz-Eindruck
    const hemi = new THREE.HemisphereLight(0xffffff, 0x202020, 1.1); hemi.position.set(0, 0, 1); this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(120, -160, 260); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-200, 180, 120); this.scene.add(rim);
    const env = new THREE.PMREMGenerator(r);
    this.scene.environment = env.fromScene(roomEnv(), 0.04).texture;

    this.world = new THREE.Group(); this.scene.add(this.world);
    this.meshes = new Map(); // id -> THREE.Group(mesh, back, overlay)
    this.selected = new Set();
    this.bedGroup = new THREE.Group(); this.scene.add(this.bedGroup);
    this.setBed([256, 256, 256]);

    // Gizmo
    this.pivot = new THREE.Object3D(); this.scene.add(this.pivot);
    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.8);
    this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value && this.gizmoTarget) this.cb.onTransform(this.gizmoTarget, this.pivotToNode(), true);
    });
    this.gizmo.addEventListener('objectChange', () => {
      if (!this.gizmoTarget) return;
      const g = this.meshes.get(this.gizmoTarget);
      if (g) { g.position.copy(this.pivot.position); g.rotation.copy(this.pivot.rotation); g.scale.copy(this.pivot.scale); }
      this.cb.onTransform(this.gizmoTarget, this.pivotToNode(), false);
    });

    // Schnittebene
    this.clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);
    this.sectionOn = false;

    // Messen
    this.measure = { active: false, pts: [], objs: new THREE.Group() }; this.scene.add(this.measure.objs);

    // Interaktion
    this.ray = new THREE.Raycaster(); this.mouse = new THREE.Vector2();
    let down = null;
    canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || e.button !== 0) return;
      if (this.gizmo.dragging) return;
      const hit = this.pick(e);
      if (this.measure.active) { if (hit) this.addMeasurePoint(hit.point); return; }
      this.cb.onPick(hit ? hit.object.userData.nodeId : null, e.shiftKey || e.ctrlKey);
    });
    // Rechtsklick ohne Ziehen → Kontextmenü (Ziehen mit rechts bleibt Verschieben der Ansicht)
    let rDown = null;
    canvas.addEventListener('pointerdown', (e) => { if (e.button === 2) rDown = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (rDown && Math.hypot(e.clientX - rDown.x, e.clientY - rDown.y) > 4) return;
      const hit = this.pick(e);
      let info = null;
      if (hit) {
        const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize() : null;
        info = { id: hit.object.userData.nodeId, point: hit.point.clone(), normal: n };
      }
      this.cb.onContext && this.cb.onContext(e.clientX, e.clientY, info);
    });
    canvas.addEventListener('dblclick', (e) => { const hit = this.pick(e); if (hit) this.focusOn([hit.object.userData.nodeId]); });

    this.overhangOn = true;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    const loop = () => { requestAnimationFrame(loop); this.controls.update(); this.updateLabels(); r.render(this.scene, this.camera); };
    loop();
  }

  resize() {
    const p = this.canvas.parentElement; const w = p.clientWidth, h = p.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setBed([x, y, z]) {
    this.bed = [x, y, z];
    this.bedGroup.clear();
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(x, y), new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9, metalness: 0 }));
    plate.position.z = -0.05; plate.receiveShadow = true; this.bedGroup.add(plate);
    const grid = new THREE.Group();
    const mat1 = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.06 });
    const mat10 = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 });
    const pts1 = [], pts10 = [];
    for (let i = -x / 2; i <= x / 2 + 1e-6; i += 10) ((Math.round(i) % 50 === 0) ? pts10 : pts1).push(i, -y / 2, 0, i, y / 2, 0);
    for (let j = -y / 2; j <= y / 2 + 1e-6; j += 10) ((Math.round(j) % 50 === 0) ? pts10 : pts1).push(-x / 2, j, 0, x / 2, j, 0);
    for (const [pts, m] of [[pts1, mat1], [pts10, mat10]]) {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      grid.add(new THREE.LineSegments(g, m));
    }
    this.bedGroup.add(grid);
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(x, y, z)), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 }));
    frame.position.z = z / 2; this.bedGroup.add(frame);
    // Achsen
    const ax = (to, col) => { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-x / 2, -y / 2, 0.02), to]); return new THREE.Line(g, new THREE.LineBasicMaterial({ color: col })); };
    this.bedGroup.add(ax(new THREE.Vector3(-x / 2 + 30, -y / 2, 0.02), 0xf87171), ax(new THREE.Vector3(-x / 2, -y / 2 + 30, 0.02), 0x86efac), ax(new THREE.Vector3(-x / 2, -y / 2, 30), 0x93c5fd));
  }

  // --------- Objekte ---------
  // items: [{ id, vert, tri, color, pos, rot, scale, visible, ok }]
  sync(items) {
    const keep = new Set(items.map(i => i.id));
    for (const [id, g] of this.meshes) if (!keep.has(id)) { this.disposeGroup(g); this.world.remove(g); this.meshes.delete(id); }
    for (const it of items) {
      let g = this.meshes.get(it.id);
      if (!g || g.userData.geoRef !== it.geoRef) {
        if (g) { this.disposeGroup(g); this.world.remove(g); }
        g = this.makeGroup(it); this.world.add(g); this.meshes.set(it.id, g);
      }
      const front = g.userData.front;
      front.material.color.set(it.color || '#dddddd');
      front.material.opacity = it.ok === false ? 0.85 : 1; front.material.transparent = it.ok === false;
      g.position.fromArray(it.pos || [0, 0, 0]);
      g.rotation.set(...(it.rot || [0, 0, 0]).map(THREE.MathUtils.degToRad), 'ZYX');
      g.scale.fromArray(it.scale || [1, 1, 1]);
      g.visible = it.visible !== false;
    }
    this.applySelectionLook();
    if (this.gizmoTarget && this.meshes.has(this.gizmoTarget)) this.attachGizmo(this.gizmoTarget, this.gizmo.mode);
    else this.detachGizmo();
  }

  makeGroup(it) {
    const g = new THREE.Group(); g.userData.geoRef = it.geoRef;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(it.vert, 3));
    geo.setIndex(new THREE.BufferAttribute(it.tri, 1));
    const shaded = it.tri.length ? toCreasedNormals(geo, THREE.MathUtils.degToRad(32)) : geo;
    shaded.computeBoundingBox(); shaded.computeBoundingSphere();
    if (it.tri.length) shaded.boundsTree = new MeshBVH(shaded);
    const front = new THREE.Mesh(shaded, new THREE.MeshPhysicalMaterial({
      color: it.color || '#dddddd', roughness: 0.22, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.12,
      clippingPlanes: [this.clip], side: THREE.FrontSide }));
    front.userData.nodeId = it.id;
    const back = new THREE.Mesh(shaded, new THREE.MeshBasicMaterial({ color: 0xf87171, side: THREE.BackSide, clippingPlanes: [this.clip] }));
    back.userData.nodeId = it.id; back.raycast = () => {}; back.visible = this.sectionOn;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, clippingPlanes: [this.clip] }));
    edges.raycast = () => {};
    g.add(front, back, edges);
    g.userData.back = back; g.userData.front = front; g.userData.edges = edges; g.userData.srcGeo = geo;
    return g;
  }
  disposeGroup(g) { g.traverse(o => { if (o.geometry) { o.geometry.boundsTree = null; o.geometry.dispose(); } if (o.material) o.material.dispose(); }); }

  setSelection(ids) { this.selected = new Set(ids); this.applySelectionLook(); }
  applySelectionLook() {
    for (const [id, g] of this.meshes) {
      const sel = this.selected.has(id);
      g.userData.edges.material.opacity = sel ? 0.9 : (this.wire ? 0.5 : 0.0);
      g.userData.front.material.emissive.set(sel ? 0x1c1c1c : 0x000000);
      g.userData.front.material.wireframe = !!this.wire;
    }
  }
  setWireframe(on) { this.wire = on; this.applySelectionLook(); }

  // Überhang-/Dünnwand-Markierung
  setHighlights(hl) {
    for (const [, g] of this.meshes) { const o = g.userData.overlay; if (o) { g.remove(o); o.geometry.dispose(); o.material.dispose(); g.userData.overlay = null; } }
    this.lastHl = hl;
    if (!hl || !this.overhangOn) return;
    const byId = new Map();
    for (const h of hl.overhang) byId.set(h.id, { faces: h.faces, color: 0xf87171 });
    for (const h of hl.thin) if (h.faces.length) { const e = byId.get(h.id) || { faces: [], color: 0xf87171 }; byId.set(h.id, { faces: e.faces.concat(h.faces), color: e.color }); }
    for (const [id, h] of byId) {
      const g = this.meshes.get(id); if (!g || !h.faces.length) continue;
      const src = g.userData.srcGeo; const pos = src.getAttribute('position'); const idx = src.getIndex();
      const arr = new Float32Array(h.faces.length * 9);
      // Overlay in Weltkoordinaten berechnet → in lokale Koordinaten zurückrechnen nicht nötig: Highlights stammen aus Weltnetz,
      // Flächenindizes stimmen mit dem lokalen Netz überein (gleiche Triangulierung).
      h.faces.forEach((f, i) => { for (let k = 0; k < 3; k++) { const v = idx.getX(f * 3 + k); arr[i * 9 + k * 3] = pos.getX(v); arr[i * 9 + k * 3 + 1] = pos.getY(v); arr[i * 9 + k * 3 + 2] = pos.getZ(v); } });
      const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const ov = new THREE.Mesh(og, new THREE.MeshBasicMaterial({ color: h.color, transparent: true, opacity: 0.55, depthTest: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, clippingPlanes: [this.clip] }));
      ov.raycast = () => {}; g.add(ov); g.userData.overlay = ov;
    }
  }
  toggleOverhang() { this.overhangOn = !this.overhangOn; this.setHighlights(this.lastHl); return this.overhangOn; }

  // --------- Gizmo ---------
  attachGizmo(id, mode = 'translate') {
    const g = this.meshes.get(id); if (!g) return this.detachGizmo();
    this.gizmoTarget = id;
    this.pivot.position.copy(g.position); this.pivot.rotation.copy(g.rotation); this.pivot.scale.copy(g.scale);
    this.gizmo.attach(this.pivot); this.gizmo.setMode(mode);
    this.gizmo.setSpace(mode === 'scale' ? 'local' : 'world');
  }
  detachGizmo() { this.gizmoTarget = null; this.gizmo.detach(); }
  setGizmoMode(m) { if (this.gizmoTarget) this.attachGizmo(this.gizmoTarget, m); this.gizmoMode = m; }
  setSnap(on) {
    this.gizmo.setTranslationSnap(on ? 1 : null);
    this.gizmo.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.gizmo.setScaleSnap(on ? 0.05 : null);
  }
  pivotToNode() {
    const p = this.pivot; const e = new THREE.Euler().setFromQuaternion(p.quaternion, 'ZYX');
    const r3 = (x) => Math.round(x * 1000) / 1000;
    return { pos: p.position.toArray().map(r3), rot: [e.x, e.y, e.z].map(v => r3(THREE.MathUtils.radToDeg(v))), scale: p.scale.toArray().map(r3) };
  }

  // --------- Ansicht ---------
  pick(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.mouse, this.camera); this.ray.firstHitOnly = true;
    const targets = [...this.meshes.values()].filter(g => g.visible).map(g => g.userData.front);
    const hits = this.ray.intersectObjects(targets, false);
    if (this.sectionOn) return hits.find(h => h.point.z <= this.clip.constant + 1e-6) || null;
    return hits[0] || null;
  }
  worldBox(ids) {
    const bb = new THREE.Box3();
    for (const [id, g] of this.meshes) if ((!ids || ids.includes(id)) && g.visible) bb.expandByObject(g.userData.front);
    return bb;
  }
  focusOn(ids) {
    let bb = this.worldBox(ids && ids.length ? ids : null);
    if (bb.isEmpty()) bb = new THREE.Box3(new THREE.Vector3(-this.bed[0] / 2, -this.bed[1] / 2, 0), new THREE.Vector3(this.bed[0] / 2, this.bed[1] / 2, 20));
    const c = bb.getCenter(new THREE.Vector3()); const r = bb.getSize(new THREE.Vector3()).length() / 2 || 20;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    this.animateTo(c, c.clone().addScaledVector(dir, dist));
  }
  view(name) {
    const dirs = { iso: [1, -1.2, 0.95], top: [0, -0.0001, 1], front: [0, -1, 0.0001], right: [1, 0, 0.0001], back: [0, 1, 0.0001], left: [-1, 0, 0.0001], bottom: [0, 0.0001, -1] };
    const v = new THREE.Vector3(...dirs[name]).normalize();
    // Auf alle sichtbaren Objekte einpassen
    let bb = this.worldBox(null);
    if (bb.isEmpty()) bb = new THREE.Box3(new THREE.Vector3(-this.bed[0] / 2, -this.bed[1] / 2, 0), new THREE.Vector3(this.bed[0] / 2, this.bed[1] / 2, 20));
    const c = bb.getCenter(new THREE.Vector3()); const r = bb.getSize(new THREE.Vector3()).length() / 2 || 20;
    const d = r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.05;
    this.animateTo(c, c.clone().addScaledVector(v, d));
  }
  animateTo(target, pos) {
    const t0 = this.controls.target.clone(), p0 = this.camera.position.clone(); const start = performance.now();
    const step = (now) => { const k = Math.min((now - start) / 350, 1); const e = 1 - Math.pow(1 - k, 3);
      this.controls.target.lerpVectors(t0, target, e); this.camera.position.lerpVectors(p0, pos, e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // --------- Schnitt ---------
  setSection(on, z) { this.sectionOn = on; this.clip.constant = on ? z : 1e6; for (const [, g] of this.meshes) g.userData.back.visible = on; }

  // --------- Messen ---------
  setMeasure(on) { this.measure.active = on; if (!on) this.clearMeasure(); this.canvas.style.cursor = on ? 'crosshair' : ''; }
  clearMeasure() { this.measure.pts = []; this.measure.objs.clear(); this.labelsEl.innerHTML = ''; this.labels = []; this.cb.onMeasure && this.cb.onMeasure(null); }
  addMeasurePoint(p) {
    if (this.measure.pts.length >= 2) this.clearMeasure();
    this.measure.pts.push(p.clone());
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    dot.position.copy(p); dot.renderOrder = 10; this.measure.objs.add(dot);
    if (this.measure.pts.length === 2) {
      const [a, b] = this.measure.pts;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
      line.renderOrder = 10; this.measure.objs.add(line);
      const d = a.distanceTo(b);
      const el = document.createElement('div'); el.className = 'mlabel'; el.textContent = d.toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' mm';
      this.labelsEl.appendChild(el); this.labels = [{ el, pos: a.clone().add(b).multiplyScalar(0.5) }];
      this.cb.onMeasure && this.cb.onMeasure({ d, dx: Math.abs(b.x - a.x), dy: Math.abs(b.y - a.y), dz: Math.abs(b.z - a.z) });
    } else this.cb.onMeasure && this.cb.onMeasure({ first: true });
  }
  updateLabels() {
    if (!this.labels) return;
    const rect = this.canvas.getBoundingClientRect();
    for (const l of this.labels) { const v = l.pos.clone().project(this.camera); l.el.style.left = ((v.x + 1) / 2 * rect.width) + 'px'; l.el.style.top = ((1 - v.y) / 2 * rect.height) + 'px'; l.el.style.display = v.z < 1 ? '' : 'none'; }
  }

  screenshot() { this.renderer.render(this.scene, this.camera); return this.canvas.toDataURL('image/png'); }
}

// Einfache Studio-Umgebung für Reflexe
function roomEnv() {
  const s = new THREE.Scene();
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const room = new THREE.Mesh(new THREE.BoxGeometry(60, 60, 60), new THREE.MeshBasicMaterial({ color: 0x151515, side: THREE.BackSide }));
  s.add(room);
  const light = (x, y, z, sx, sy, sz, c) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: c })); m.position.set(x, y, z); m.scale.set(sx, sy, sz); s.add(m); };
  light(0, 0, 28, 30, 30, 1, 0xffffff);
  light(-28, 0, 8, 1, 20, 10, 0x9a9a9a);
  light(28, 10, 6, 1, 14, 8, 0xbbbbbb);
  light(0, -28, 10, 24, 1, 8, 0x777777);
  return s;
}
