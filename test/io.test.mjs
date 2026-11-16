// Export aller Formate und Rückimport (3MF/AMF brauchen DOMParser → nur im Programm geprüft)
import * as IO from '../src/renderer/js/io.js';
const box = { name: 'Würfel A', color: '#F87171', vert: new Float32Array([0,0,0, 10,0,0, 10,10,0, 0,10,0, 0,0,10, 10,0,10, 10,10,10, 0,10,10]),
  tri: new Uint32Array([0,2,1, 0,3,2, 4,5,6, 4,6,7, 0,1,5, 0,5,4, 1,2,6, 1,6,5, 2,3,7, 2,7,6, 3,0,4, 3,4,7]) };
const two = [box, { ...box, name: 'B', vert: box.vert.map((v,i)=> i%3===0? v+20: v) }];
let fail = 0;
for (const [k, f] of Object.entries(IO.EXPORT_FORMATS)) {
  const data = f.write(two);
  let back = '—';
  const ext = k === 'stla' ? 'stl' : f.ext;
  if (IO.IMPORT_EXTENSIONS.includes(ext)) { if (typeof DOMParser === 'undefined' && (ext === '3mf' || ext === 'amf')) back = 'im Programm geprüft'; else try { const r = IO.importMesh('t.' + ext, data); back = r.map(x => `${x.vert.length/3}v/${x.tri.length/3}t`).join(' + '); } catch (e) { back = 'FEHLER ' + e.message; fail++; } }
  console.log(k.padEnd(5), String(data.length).padStart(6), 'Bytes  Rückimport:', back);
}
process.exit(fail ? 1 : 0);
