// Druck-Check: prüft Weltnetze auf Druckbarkeit
import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export const MATERIALS = {
  PLA: { density: 1.24, label: 'PLA' },
  PETG: { density: 1.27, label: 'PETG' },
  ASA: { density: 1.07, label: 'ASA' },
  ABS: { density: 1.04, label: 'ABS' },
  TPU: { density: 1.21, label: 'TPU (flexibel)' },
  'PA / Nylon': { density: 1.14, label: 'PA / Nylon' },
  PC: { density: 1.20, label: 'PC' },
  'PLA-CF': { density: 1.29, label: 'PLA-CF' },
  'PETG-CF': { density: 1.30, label: 'PETG-CF' },
  'PA-CF': { density: 1.20, label: 'PA-CF' },
  'Resin (Standard)': { density: 1.12, label: 'Resin (Standard)' },
  'Resin (Tough)': { density: 1.15, label: 'Resin (Tough)' },
};

// objects: [{ id, name, vert (Welt), tri, ok, error, parts, volume }]
// settings: { bed:[x,y,z], material, overhang (Grad), minWall (mm) }
export async function runPrintCheck(objects, settings, progress = () => {}) {
  const items = []; const highlights = { overhang: [], thin: [] };
  const add = (level, title, text, action) => items.push({ level, title, text, action });
  if (!objects.length) { add('info', 'Nichts zu prüfen', 'Die Szene ist leer oder alles ist ausgeblendet.'); return { items, highlights, summary: null }; }

  // Gesamtmaße
  const bb = new THREE.Box3();
  for (const o of objects) for (let i = 0; i < o.vert.length; i += 3) bb.expandByPoint(new THREE.Vector3(o.vert[i], o.vert[i + 1], o.vert[i + 2]));
  const size = bb.getSize(new THREE.Vector3());
  const [bx, by, bz] = settings.bed;
  const totalVol = objects.reduce((a, o) => a + (o.volume || 0), 0);
  const dens = (MATERIALS[settings.material] || MATERIALS.PLA).density;
  const grams = totalVol / 1000 * dens;
  const filamentM = settings.material.startsWith('Resin') ? null : (totalVol / (Math.PI * 0.875 * 0.875)) / 1000;
  const summary = { size, volume: totalVol, grams, filamentM };

  // Bauraum
  const fitsXY = (size.x <= bx && size.y <= by) || (size.y <= bx && size.x <= by);
  if (size.z > bz || !fitsXY) add('err', 'Größer als der Bauraum', `Modell ${f(size.x)} × ${f(size.y)} × ${f(size.z)} mm, Bauraum ${bx} × ${by} × ${bz} mm.`);
  else if (bb.min.x < -bx / 2 || bb.max.x > bx / 2 || bb.min.y < -by / 2 || bb.max.y > by / 2) add('warn', 'Teilweise außerhalb des Druckbetts', 'Das Modell passt, liegt aber nicht vollständig auf der Platte.', { id: 'centerAll', label: 'Alles zentrieren' });
  else add('ok', 'Passt in den Bauraum', `${f(size.x)} × ${f(size.y)} × ${f(size.z)} mm`);

  let step = 0;
  for (const o of objects) {
    step++; progress(`Prüfe ${o.name} (${step}/${objects.length})`);
    // Wasserdicht
    if (!o.ok) add('err', `${o.name}: nicht druckbar`, o.error || 'Das Netz ist nicht geschlossen (nicht wasserdicht).');
    // Auf dem Bett
    let zmin = Infinity;
    for (let i = 2; i < o.vert.length; i += 3) zmin = Math.min(zmin, o.vert[i]);
    if (zmin < -0.01) add('err', `${o.name}: ragt unter das Druckbett`, `Tiefster Punkt bei Z = ${f(zmin)} mm.`, { id: 'drop', target: o.id, label: 'Auf Bett legen' });
    else if (zmin > 0.01) add('warn', `${o.name}: schwebt über dem Bett`, `Tiefster Punkt bei Z = ${f(zmin)} mm. Viele Slicer melden das als Fehler.`, { id: 'drop', target: o.id, label: 'Auf Bett legen' });
    // Mehrere / schwebende Teile
    if (o.parts > 1) add('info', `${o.name}: besteht aus ${o.parts} getrennten Körpern`, 'Für Vorlagen mit mehreren Teilen normal. Bei einem Einzelteil prüfen, ob etwas lose schwebt.');

    // Überhänge und Bettkontakt
    const cosLim = Math.cos(THREE.MathUtils.degToRad(90 - settings.overhang));
    let ohArea = 0, bedArea = 0, area = 0; const ohFaces = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let t = 0; t < o.tri.length; t += 3) {
      a.fromArray(o.vert, o.tri[t] * 3); b.fromArray(o.vert, o.tri[t + 1] * 3); c.fromArray(o.vert, o.tri[t + 2] * 3);
      n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)); const A2 = n.length(); if (A2 === 0) continue;
      const ar = A2 / 2; n.divideScalar(A2); area += ar;
      const minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
      if (n.z < -0.999 && maxZ - zmin < 0.05) { bedArea += ar; continue; }
      if (n.z < -cosLim && minZ - zmin > 0.3) { ohArea += ar; ohFaces.push(t / 3); }
    }
    highlights.overhang.push({ id: o.id, faces: ohFaces });
    if (bedArea < 1 && o.ok) add('warn', `${o.name}: kaum Auflagefläche`, `Nur ${f(bedArea)} mm² liegen auf dem Bett. Teil drehen oder Brim verwenden.`);
    else if (o.ok) add('ok', `${o.name}: Auflagefläche ${f(bedArea, 0)} mm²`, '');
    if (ohArea > 0.5) {
      const pct = ohArea / Math.max(area, 1) * 100;
      add(pct > 8 ? 'warn' : 'info', `${o.name}: Überhänge ${f(ohArea, 0)} mm² (${f(pct, 1)} %)`, `Flächen flacher als ${settings.overhang}° zur Horizontalen brauchen Stützen. Sie sind im Modell rot markiert.`, { id: 'showOverhang', label: 'Markierung umschalten' });
    } else add('ok', `${o.name}: keine kritischen Überhänge`, '');

    // Dünne Wände (Strahltest gegen BVH)
    await new Promise(r => setTimeout(r, 0));
    const thin = thinWalls(o, settings.minWall);
    highlights.thin.push({ id: o.id, faces: thin.faces });
    if (thin.count > 0) add(thin.ratio > 0.02 ? 'warn' : 'info', `${o.name}: dünne Stellen < ${f(settings.minWall)} mm`, `${thin.count} von ${thin.samples} Stichproben, dünnste Stelle ca. ${f(thin.min, 2)} mm. Bei 0,4-mm-Düse sind Wände unter 0,8 mm kritisch.`);
    else add('ok', `${o.name}: keine Wände dünner als ${f(settings.minWall)} mm gefunden`, `${thin.samples} Stichproben geprüft.`);
  }
  return { items, highlights, summary };
}

function thinWalls(o, minWall) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(o.vert, 3));
  geo.setIndex(new THREE.BufferAttribute(o.tri, 1));
  geo.boundsTree = new MeshBVH(geo);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const rc = new THREE.Raycaster(); rc.firstHitOnly = true;
  const nTri = o.tri.length / 3; const samples = Math.min(nTri, 4000); const stepT = nTri / samples;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), p = new THREE.Vector3();
  let count = 0, min = Infinity; const faces = [];
  for (let s = 0; s < samples; s++) {
    const t = Math.floor(s * stepT) * 3;
    a.fromArray(o.vert, o.tri[t] * 3); b.fromArray(o.vert, o.tri[t + 1] * 3); c.fromArray(o.vert, o.tri[t + 2] * 3);
    n.crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a));
    if (n.lengthSq() === 0) continue; n.normalize();
    p.copy(a).add(b).add(c).divideScalar(3);
    rc.set(p.clone().addScaledVector(n, -1e-3), n.clone().negate()); rc.far = minWall;
    const hit = rc.intersectObject(mesh, false)[0];
    if (hit && hit.distance > 1e-3) { count++; min = Math.min(min, hit.distance); faces.push(t / 3); }
  }
  geo.boundsTree = null; geo.dispose();
  return { count, samples, min, faces, ratio: count / Math.max(samples, 1) };
}

const f = (x, d = 1) => Number(x).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
export { f as fmt };
