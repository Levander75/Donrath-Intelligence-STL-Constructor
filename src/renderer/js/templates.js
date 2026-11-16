// Parametrische Vorlagen. build(kit, arena, params) liefert ein Manifold auf dem Druckbett.

const sel = (key, label, options, def) => ({ key, label, type: 'select', options, def });
const num = (key, label, def, min, max, step = 0.1) => ({ key, label, type: 'num', def, min, max, step });

// ---------------------------------------------------------------------------
// TUBIQ Halo Handsender (Rev 0.2)
function halo(k, A, p) {
  const W = p.W, R = Math.min(p.R, W / 2 - 1), H = Math.max(p.H, 13), WALL = p.wall;
  const SPLIT = 6, FLOOR = 2.4, PCB_B = 6.8, PCB_T = 8.4, SW_T = 10.9;
  const SKIN_B = H - 2.4, DISH_F = H - 1.0, DISH_D = Math.min(p.dish, W - 2 * WALL - 4);
  const KEY_MY = p.keyMy, SL = [p.keyLen, p.keyWid, p.keyPitch];
  const BOSS = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => [a * p.boss, b * p.boss]);
  const MAG = [[-p.magX, -p.magY], [p.magX, -p.magY]];
  const GAP = p.gap;
  const PADS = [['my', 0, 0], ['up', 0, SL[2]], ['dn', 0, -SL[2]]];
  const C = k.C;

  const ringCircle = (r, w) => A.k(A.k(C.circle(r + w, k.seg)).subtract(A.k(C.circle(r, k.seg))));
  const ringSlot = (L, Wd, w) => A.k(k.rrect(L + 2 * w, Wd + 2 * w, Wd / 2 + w - 0.01).subtract(k.rrect(L, Wd, Wd / 2 - 0.01)));
  const sq = (w, h, x, y) => A.k(A.k(C.square([w, h], true)).translate([x, y]));

  function symbols(z0, z1) {
    const up = k.poly([[-3.2, SL[2] - 1.9], [3.2, SL[2] - 1.9], [0, SL[2] + 2.7]], z0, z1);
    const dn = k.poly([[-3.2, -SL[2] + 1.9], [0, -SL[2] - 2.7], [3.2, -SL[2] + 1.9]], z0, z1);
    const my = k.extrude(ringCircle(2.4, 1.0), z0, z1);
    return k.union([up, dn, my]);
  }
  function shell() {
    let top = k.sub(k.rbox(W, W, SPLIT, H, R, 3), k.rbox(W - 2 * WALL, W - 2 * WALL, SPLIT - 1, SKIN_B, R - WALL));
    top = k.sub(top, k.cyl(DISH_D, DISH_F, H + 1), k.cyl(2.2, SKIN_B - 1, H + 1, 0, W / 2 - 6.5));
    for (const [x, y] of BOSS) top = k.add(top, k.sub(k.cyl(5, PCB_T, SKIN_B + 0.1, x, y), k.cyl(1.7, PCB_T - 1, SKIN_B - 0.6, x, y)));
    for (const [, x, y] of PADS) top = k.add(top, k.cyl(3, SW_T + 0.2, SKIN_B + 0.1, x, y));
    if (p.symbols === 'ja') top = k.sub(top, symbols(DISH_F - 0.3, H + 1));
    if (p.variant === 'A') {
      for (const [kk, x, y] of PADS) {
        if (kk === 'my') {
          const sl = A.k(ringCircle(KEY_MY / 2, GAP).subtract(sq(4, 6, KEY_MY / 2 + GAP / 2, 0)));
          top = k.sub(top, A.k(k.extrude(sl, SKIN_B - 1, SKIN_B + 4).translate([x, y, 0])));
          const h0 = KEY_MY / 2 - 1.0, h1 = KEY_MY / 2 + GAP + 0.6;
          top = k.sub(top, k.extrude(sq(h1 - h0, 6, x + (h0 + h1) / 2, y), SKIN_B - 0.01, SKIN_B + 0.6));
        } else {
          const sl = A.k(ringSlot(SL[0], SL[1], GAP).subtract(sq(4, SL[1] + 2 * GAP + 1, -SL[0] / 2 - GAP / 2 + 0.5, 0)));
          top = k.sub(top, A.k(k.extrude(sl, SKIN_B - 1, SKIN_B + 4).translate([x, y, 0])));
          top = k.sub(top, k.extrude(sq(2.2, SL[1], x - SL[0] / 2 + 0.4, y), SKIN_B - 0.01, SKIN_B + 0.6));
        }
      }
    } else {
      for (const [kk, x, y] of PADS) {
        const rg = kk === 'my' ? ringCircle(KEY_MY / 2, 2.5) : ringSlot(SL[0], SL[1], 2.0);
        top = k.sub(top, A.k(k.extrude(rg, SKIN_B - 1, DISH_F - p.membrane).translate([x, y, 0])));
      }
    }
    return top;
  }
  function bottom() {
    let bot = k.sub(k.rbox(W, W, 0, SPLIT, R), k.rbox(W - 2 * WALL, W - 2 * WALL, FLOOR, SPLIT + 1, R - WALL));
    const LIP = W - 2 * WALL - 2 * 0.15;
    bot = k.add(bot, k.sub(k.rbox(LIP, LIP, SPLIT - 0.01, SPLIT + 2, R - WALL - 0.15), k.rbox(LIP - 1.6, LIP - 1.6, SPLIT - 1, SPLIT + 3, R - WALL - 0.95)));
    bot = k.add(bot, k.sub(k.rbox(W - 2 * WALL + 0.05, W - 2 * WALL + 0.05, SPLIT - 1.2, SPLIT, R - WALL + 0.02), k.rbox(LIP - 1.6, LIP - 1.6, SPLIT - 2, SPLIT + 1, R - WALL - 0.95)));
    for (const [x, y] of BOSS) {
      bot = k.add(bot, k.cyl(5, FLOOR - 0.01, PCB_B, x, y));
      bot = k.sub(bot, k.cyl(2.4, -1, PCB_B + 1, x, y), k.cyl(4.2, -1, 1.4, x, y));
    }
    for (const [x, y] of MAG) bot = k.sub(bot, k.cyl(p.magD + 0.2, -1, p.magH + 0.1, x, y));
    return bot;
  }
  function wall() {
    const PT = 4;
    let h = k.add(A.k(k.extrude(k.rrect(W + 12, W * 0.8, 8), 0, PT).translate([0, -W * 0.2, 0])),
      A.k(k.extrude(k.rrect(W + 4, 7, 3), 0, PT + 8).translate([0, -W / 2 - 3.3, 0])));
    for (const [x, y] of MAG) h = k.sub(h, k.cyl(p.magD + 0.2, PT - p.magH - 0.1, PT + 1, -x, y));
    for (const y of [2, -22]) {
      h = k.sub(h, k.cyl(3.6, -1, PT + 1, 0, y), k.cone(3.6, 7.2, PT - 1.8, PT + 0.001, 0, y));
    }
    return h;
  }
  function teststrip() {
    let t = k.sub(k.rbox(64, 28, 0, 2.4, 4), k.rbox(58, 22, 1.4, 3, 2));
    const slA = A.k(ringCircle(KEY_MY / 2, GAP).subtract(sq(4, 6, KEY_MY / 2 + GAP / 2, 0)));
    t = k.sub(t, A.k(k.extrude(slA, -1, 4).translate([-15, 0, 0])));
    t = k.sub(t, A.k(k.extrude(ringCircle(KEY_MY / 2, 2.5), -1, 0.8).translate([15, 0, 0])));
    return t;
  }
  switch (p.part) {
    case 'Oberschale': return k.flipToBed(shell());
    case 'Unterschale': return k.toBed(bottom());
    case 'Wandschale': return k.toBed(wall());
    case 'Teststreifen': return k.toBed(teststrip());
    case 'Zusammengebaut': return k.toBed(k.union([shell(), bottom()]));
    default: return k.row([k.flipToBed(shell()), k.toBed(bottom()), k.toBed(wall())], 10);
  }
}

// ---------------------------------------------------------------------------
// Projektbox mit Stülpdeckel
function projectBox(k, A, p) {
  const { L, B, H, wall, r, lid, clear, floor } = p;
  const box = () => k.sub(k.rbox(L, B, 0, H, r), k.rbox(L - 2 * wall, B - 2 * wall, floor, H + 1, Math.max(r - wall, 0.5)));
  const cover = () => {
    const inner = L - 2 * wall - 2 * clear, innerB = B - 2 * wall - 2 * clear;
    let c = k.rbox(L, B, 0, floor, r, Math.min(1, floor * 0.5));
    c = k.add(c, k.sub(k.rbox(inner, innerB, floor - 0.01, floor + lid, Math.max(r - wall - clear, 0.5)),
      k.rbox(inner - 2 * wall, innerB - 2 * wall, floor - 1, floor + lid + 1, Math.max(r - 2 * wall - clear, 0.5))));
    return c;
  };
  if (p.part === 'Box') return box();
  if (p.part === 'Deckel') return cover();
  return k.row([box(), cover()], 10);
}

// ---------------------------------------------------------------------------
function spacer(k, A, p) {
  const one = () => {
    let s = p.shape === 'Sechskant' ? k.cyl(p.od, 0, p.h, 0, 0, 6) : k.cyl(p.od, 0, p.h);
    return k.sub(s, k.cyl(p.id, -1, p.h + 1));
  };
  const n = Math.max(1, Math.round(p.count));
  if (n === 1) return one();
  const list = []; for (let i = 0; i < n; i++) list.push(one());
  return k.row(list, 4);
}

// ---------------------------------------------------------------------------
function wallHook(k, A, p) {
  const { w, h, t, depth, lip } = p;
  let plate = k.extrude(k.rrect(w, h, Math.min(4, w / 4)), 0, t);
  const shelf = A.k(k.extrude(k.rrect(w, t, t / 2 - 0.01), 0, depth + t).translate([0, -h / 2 + t / 2, 0]));
  let hook = k.add(plate, shelf);
  hook = k.add(hook, A.k(A.k(k.extrude(k.rrect(w, lip, Math.min(lip, t) / 2 - 0.01), 0, t)).translate([0, -h / 2 + lip / 2, depth])));
  for (const y of [h / 4, -h / 8]) hook = k.sub(hook, k.cyl(p.screw, -1, t + 1, 0, y), k.cone(p.screw, p.screw * 2, t - p.screw / 2, t + 0.001, 0, y));
  return k.toBed(hook);
}

export const TEMPLATES = {
  halo: {
    label: 'TUBIQ Halo Handsender', icon: 'remote',
    desc: 'Wandsender 60 × 60 mm mit eingebauten Tasten (Biegezunge oder Membran), Unterschale, Wandschale und Teststreifen.',
    params: [
      sel('part', 'Teil', ['Alle Teile', 'Oberschale', 'Unterschale', 'Wandschale', 'Teststreifen', 'Zusammengebaut'], 'Alle Teile'),
      sel('variant', 'Tasten', ['B', 'A'], 'B'),
      sel('symbols', 'Symbole einprägen', ['ja', 'nein'], 'ja'),
      num('W', 'Kantenlänge', 60, 45, 90, 0.5),
      num('H', 'Gesamthöhe', 15, 13, 25, 0.5),
      num('R', 'Eckenradius', 14, 2, 30, 0.5),
      num('wall', 'Wandstärke', 1.6, 1.0, 3.0, 0.1),
      num('dish', 'Mulde Ø', 41, 20, 70, 0.5),
      num('keyMy', 'Taste My Ø', 15, 8, 22, 0.5),
      num('keyLen', 'Pfeiltaste Länge', 18, 8, 26, 0.5),
      num('keyWid', 'Pfeiltaste Breite', 7, 4, 12, 0.5),
      num('keyPitch', 'Pfeiltaste Abstand', 13.5, 8, 20, 0.5),
      num('gap', 'Schlitz (A)', 0.5, 0.3, 1.0, 0.05),
      num('membrane', 'Membranstärke (B)', 0.6, 0.4, 1.2, 0.05),
      num('boss', 'Schraubdome ±', 22, 12, 35, 0.5),
      num('magD', 'Magnet Ø', 10, 5, 20, 0.5),
      num('magH', 'Magnet Höhe', 1.5, 1, 3, 0.1),
      num('magX', 'Magnet X ±', 14, 6, 30, 0.5),
      num('magY', 'Magnet Y', 14, 0, 30, 0.5),
    ],
    build: halo,
  },
  projectbox: {
    label: 'Projektbox mit Deckel', icon: 'box',
    desc: 'Gehäuse mit Stülpdeckel, Spiel einstellbar – für Platinen und Elektronik.',
    params: [
      sel('part', 'Teil', ['Beide', 'Box', 'Deckel'], 'Beide'),
      num('L', 'Länge', 80, 20, 250, 1), num('B', 'Breite', 50, 20, 250, 1), num('H', 'Höhe', 30, 8, 200, 1),
      num('wall', 'Wandstärke', 2, 0.8, 5, 0.1), num('floor', 'Boden', 2, 0.8, 5, 0.1),
      num('r', 'Eckenradius', 5, 0.5, 30, 0.5), num('lid', 'Deckelrand', 5, 2, 20, 0.5),
      num('clear', 'Spiel', 0.25, 0.05, 1.0, 0.05),
    ],
    build: projectBox,
  },
  spacer: {
    label: 'Abstandshalter', icon: 'ring',
    desc: 'Distanzhülsen rund oder sechskantig, mehrere auf einmal.',
    params: [
      sel('shape', 'Form', ['Rund', 'Sechskant'], 'Rund'),
      num('od', 'Außen-Ø', 7, 2, 40, 0.1), num('id', 'Bohrung Ø', 3.2, 0.5, 30, 0.1),
      num('h', 'Höhe', 10, 1, 100, 0.5), num('count', 'Anzahl', 4, 1, 20, 1),
    ],
    build: spacer,
  },
  wallhook: {
    label: 'Wandhalter / Ablage', icon: 'hook',
    desc: 'Wandplatte mit Ablage und Rand, z. B. für Fernbedienungen.',
    params: [
      num('w', 'Breite', 70, 20, 200, 1), num('h', 'Höhe', 50, 20, 200, 1), num('t', 'Stärke', 4, 2, 10, 0.5),
      num('depth', 'Ablagetiefe', 18, 5, 80, 0.5), num('lip', 'Randhöhe', 8, 2, 30, 0.5), num('screw', 'Schraube Ø', 3.6, 2, 6, 0.1),
    ],
    build: wallHook,
  },
};
