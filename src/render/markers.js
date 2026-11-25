// World markers for races and deliveries: glowing start pillars, ground
// checkpoints, buoy gates and sky rings. Everything is built once and
// pooled; showing a marker only moves and recolors an existing mesh, and
// update() animates without allocating.
import * as THREE from 'three';

import { markerLook } from '../core/access.js';

export const MARKER_COLORS = {
  street: 0xe2733a, // rust orange
  boat: 0x45c7dc,
  sky: 0xffcf5a,
  delivery: 0x8bd66f,
  next: 0xff8a4a,
  after: 0xf6efe6,
  finish: 0xfff3c4,
  passed: 0xffffff,
  stunt: 0xb48cff, // violet: stunt ramps (systems/stunts.js)
};
const MAX_STARTS = 20;
const SLOTS = 3;
const START_SHOW_DIST = 320;

// A vertical open tube whose alpha fades from `a0` at the bottom to 0 at the top.
function fadeTube(radius = 1, height = 1, segs = 28, a0 = 1) {
  const g = new THREE.CylinderGeometry(radius, radius, height, segs, 1, true);
  g.translate(0, height / 2, 0);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height;
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1;
    col[i * 4 + 3] = a0 * (1 - t) * (1 - t);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

// Two-sided see-through glows, drawn in one pass (forceSinglePass): no
// back-faces-first pass, so half the draws and no second program each
// (they write no depth, the order inside one marker does not show).
function glow(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, vertexColors: true, fog: true, forceSinglePass: true,
  });
}
function flat(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: true, forceSinglePass: true });
}

// Unit-sized shared geometries (scaled per use).
const GEO = {};
function geo() {
  if (GEO.tube) return GEO;
  GEO.tube = fadeTube(1, 1, 32, 1);
  GEO.disc = new THREE.RingGeometry(0.86, 1, 40, 1).rotateX(-Math.PI / 2);
  GEO.fill = new THREE.CircleGeometry(0.86, 40).rotateX(-Math.PI / 2);
  GEO.torus = new THREE.TorusGeometry(1, 0.075, 8, 48);
  GEO.torusGlow = new THREE.TorusGeometry(1, 0.2, 6, 48);
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.cone = new THREE.ConeGeometry(1, 1, 4);
  GEO.buoyBody = new THREE.CylinderGeometry(0.75, 0.95, 1.6, 8).translate(0, 0.5, 0);
  GEO.buoyTop = new THREE.ConeGeometry(0.75, 0.9, 8).translate(0, 1.75, 0);
  GEO.pole = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 4).translate(0, 3.3, 0);
  GEO.flag = new THREE.BufferGeometry();
  GEO.flag.setAttribute('position', new THREE.Float32BufferAttribute([0, 4.55, 0, 0, 3.75, 0, 1.25, 4.15, 0], 3));
  GEO.flag.computeVertexNormals();
  GEO.arrow = new THREE.ConeGeometry(1, 1.4, 4).rotateX(Math.PI);
  return GEO;
}

// Small icon shapes that float above a start pillar, one per type.
function makeIcon(type, mat) {
  const g = geo();
  const icon = new THREE.Group();
  const add = (geom, sx, sy, sz, x, y, z) => {
    const m = new THREE.Mesh(geom, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x, y, z);
    icon.add(m);
    return m;
  };
  if (type === 'street') {
    // Chequered-ish flag: pole and a two-tone banner.
    add(g.box, 0.18, 3.4, 0.18, -1.1, 0, 0);
    add(g.box, 2.1, 1.3, 0.12, 0, 1.0, 0);
    add(g.box, 0.7, 0.65, 0.16, -0.35, 1.32, 0);
    add(g.box, 0.7, 0.65, 0.16, 0.35, 0.68, 0);
  } else if (type === 'boat') {
    // A little hull with a sail.
    add(g.box, 2.6, 0.5, 1.0, 0, -0.6, 0);
    add(g.cone, 0.55, 0.9, 0.55, 1.5, -0.6, 0).rotation.z = -Math.PI / 2;
    add(g.cone, 0.85, 2.0, 0.12, 0.1, 0.65, 0);
  } else if (type === 'sky') {
    // A tiny aircraft: fuselage, wings, tail.
    add(g.box, 2.8, 0.4, 0.4, 0, 0, 0);
    add(g.box, 0.8, 0.12, 3.4, 0.2, 0.05, 0);
    add(g.box, 0.4, 0.12, 1.4, -1.2, 0.05, 0);
    add(g.box, 0.4, 0.8, 0.1, -1.25, 0.4, 0);
  } else if (type === 'stunt') {
    // A ramp wedge with an arrow arcing off its lip.
    add(g.box, 2.4, 0.18, 1.2, -0.2, -0.55, 0).rotation.z = 0.42;
    add(g.box, 0.18, 0.95, 1.2, 0.85, -0.6, 0);
    add(g.box, 1.2, 0.16, 0.2, 0.3, 0.75, 0).rotation.z = -0.25;
    add(g.cone, 0.32, 0.6, 0.32, 1.05, 0.55, 0).rotation.z = -Math.PI / 2 - 0.6;
  } else {
    // A parcel with a strap.
    add(g.box, 1.8, 1.4, 1.8, 0, 0, 0);
    add(g.box, 1.86, 1.46, 0.3, 0, 0, 0).userData.strap = true;
  }
  return icon;
}

export function createMarkers(scene, opts = {}) {
  const g = geo();
  const seaY = opts.seaY ?? -0.6;
  const root = new THREE.Group();
  root.name = 'activity-markers';
  scene.add(root);

  // --- Start markers -------------------------------------------------------
  // opts.maxStarts / opts.slots: a smaller set (stunt ramps use a few
  // starts and no checkpoint slots).
  const nStarts = Number.isInteger(opts.maxStarts) ? Math.max(0, Math.min(MAX_STARTS, opts.maxStarts)) : MAX_STARTS;
  const nSlots = Number.isInteger(opts.slots) ? Math.max(0, Math.min(SLOTS, opts.slots)) : SLOTS;
  const starts = [];
  for (let i = 0; i < nStarts; i++) {
    const grp = new THREE.Group();
    grp.visible = false;
    const tubeMat = glow(0xffffff, 0.55);
    const discMat = flat(0xffffff, 0.75);
    const fillMat = flat(0xffffff, 0.16);
    const iconMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
    const strapMat = new THREE.MeshBasicMaterial({ color: 0x2b2018, fog: true });
    const tube = new THREE.Mesh(g.tube, tubeMat);
    const disc = new THREE.Mesh(g.disc, discMat);
    const fill = new THREE.Mesh(g.fill, fillMat);
    disc.position.y = fill.position.y = 0.08;
    tube.renderOrder = disc.renderOrder = fill.renderOrder = 2;
    grp.add(fill, disc, tube);
    root.add(grp);
    starts.push({ grp, tube, disc, fill, tubeMat, discMat, fillMat, iconMat, strapMat, icon: null, type: null, phase: i * 1.7, baseY: 0 });
  }

  function showStart(i, course, radius = 9) {
    const s = starts[i];
    if (!s) return;
    const type = course.type;
    if (s.type !== type) {
      if (s.icon) s.grp.remove(s.icon);
      s.icon = makeIcon(type, s.iconMat);
      s.icon.traverse((m) => { if (m.userData.strap) m.material = s.strapMat; });
      s.grp.add(s.icon);
      s.type = type;
    }
    const color = MARKER_COLORS[type] ?? MARKER_COLORS.street;
    s.tubeMat.color.setHex(color);
    s.discMat.color.setHex(color);
    s.fillMat.color.setHex(color);
    s.iconMat.color.setHex(color);
    const water = type === 'boat';
    s.baseY = (course.start.y || 0) + (water ? seaY + 0.1 : 0);
    s.grp.position.set(course.start.x, s.baseY, course.start.z);
    s.tube.scale.set(radius, 7, radius);
    s.disc.scale.set(radius, 1, radius);
    s.fill.scale.set(radius, 1, radius);
    s.icon.position.y = 9;
    s.icon.scale.setScalar(2);
    s.grp.visible = true;
  }
  function hideStart(i) {
    if (starts[i]) starts[i].grp.visible = false;
  }
  function hideStarts() {
    for (const s of starts) s.grp.visible = false;
  }

  // --- Checkpoint slots ------------------------------------------------------
  const slots = [];
  for (let k = 0; k < nSlots; k++) {
    const grp = new THREE.Group();
    grp.visible = false;
    const tubeMat = glow(0xffffff, 0.5);
    const discMat = flat(0xffffff, 0.8);
    const ringMat = flat(0xffffff, 0.92);
    const haloMat = flat(0xffffff, 0.22);
    const buoyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0xf6efe6 });
    const flagMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: true });
    const beamMat = glow(0xffffff, 0.35);

    // Ground checkpoint / roof pad: glowing tube with a ring on the ground.
    const ground = new THREE.Group();
    const gTube = new THREE.Mesh(g.tube, tubeMat);
    const gDisc = new THREE.Mesh(g.disc, discMat);
    gDisc.position.y = 0.1;
    const arrow = new THREE.Mesh(g.arrow, ringMat);
    arrow.visible = false;
    gTube.renderOrder = gDisc.renderOrder = 3;
    ground.add(gTube, gDisc, arrow);

    // Buoy gate: two buoys with flags and a soft beam above each.
    const gate = new THREE.Group();
    const buoys = [];
    for (let s = 0; s < 2; s++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(g.buoyBody, buoyMat);
      const top = new THREE.Mesh(g.buoyTop, stripeMat);
      const pole = new THREE.Mesh(g.pole, stripeMat);
      const flag = new THREE.Mesh(g.flag, flagMat);
      const beam = new THREE.Mesh(g.tube, beamMat);
      beam.scale.set(1.3, 16, 1.3);
      beam.renderOrder = 3;
      b.add(body, top, pole, flag, beam);
      b.userData.flag = flag;
      gate.add(b);
      buoys.push(b);
    }
    const gLine = new THREE.Mesh(g.box, haloMat);
    gLine.renderOrder = 3;
    gate.add(gLine);

    // Sky ring: a bright torus with a soft halo.
    const ring = new THREE.Group();
    const torus = new THREE.Mesh(g.torus, ringMat);
    const halo = new THREE.Mesh(g.torusGlow, haloMat);
    torus.renderOrder = halo.renderOrder = 4;
    ring.add(halo, torus);

    grp.add(ground, gate, ring);
    root.add(grp);
    slots.push({
      grp, ground, gTube, gDisc, arrow, gate, buoys, gLine, ring, torus, halo,
      tubeMat, discMat, ringMat, haloMat, buoyMat, flagMat, beamMat,
      cp: null, styleArg: null, safe: false, kind: null, style: null, r: 1, alpha: 1, phase: k * 2.1, y: 0,
    });
  }

  const STYLE_ALPHA = { next: 1, finish: 1, after: 0.32, passed: 0.7 };

  function showCheckpoint(slot, cp, style = 'next') {
    const s = slots[slot];
    if (!s || !cp) return;
    const kind = cp.kind || 'ground';
    const safe = typeof opts.colorSafe === 'function' && opts.colorSafe() === true;
    const look = markerLook(style, safe, MARKER_COLORS[style] ?? MARKER_COLORS.next);
    const color = look.color;
    const a = STYLE_ALPHA[style] ?? 1;
    s.cp = cp; s.styleArg = style; s.safe = safe;
    s.kind = kind;
    s.style = style;
    s.alpha = a;
    s.r = cp.r;
    s.ground.visible = kind === 'ground' || kind === 'pad';
    s.gate.visible = kind === 'buoy';
    s.ring.visible = kind === 'ring';
    s.tubeMat.color.setHex(color);
    s.discMat.color.setHex(color);
    s.ringMat.color.setHex(color);
    s.haloMat.color.setHex(color);
    s.beamMat.color.setHex(color);
    s.tubeMat.opacity = 0.5 * a;
    s.discMat.opacity = 0.8 * a;
    s.ringMat.opacity = 0.95 * a;
    s.haloMat.opacity = 0.22 * a;
    s.beamMat.opacity = 0.35 * a;
    // Buoys: the leading gate is rust orange with bright flags.
    s.buoyMat.color.setHex(style === 'after' ? 0xd8cfc4 : style === 'finish' ? 0xf2f2f2 : 0xe2733a);
    s.flagMat.color.setHex(style === 'finish' ? 0x2b2018 : color);
    s.grp.position.set(cp.x, 0, cp.z);
    const dir = cp.dir || 0;
    if (kind === 'ground' || kind === 'pad') {
      const pad = kind === 'pad';
      s.y = pad ? cp.y - 0.9 : 0;
      s.ground.position.y = s.y;
      s.gTube.scale.set(cp.r * look.wide, pad ? 5 : 6, cp.r * look.wide);
      s.gDisc.scale.set(cp.r, 1, cp.r);
      s.arrow.visible = pad || look.arrow; // color-safe: the arrow marks next and finish by shape
      s.arrow.scale.setScalar(Math.max(1.2, cp.r * 0.3) * look.arrowScale);
    } else if (kind === 'buoy') {
      s.y = seaY;
      s.gate.position.y = seaY;
      // Buoys sit on a line across the direction of travel.
      const px = -Math.sin(dir), pz = Math.cos(dir);
      s.buoys[0].position.set(px * cp.r, 0, pz * cp.r);
      s.buoys[1].position.set(-px * cp.r, 0, -pz * cp.r);
      s.buoys[0].rotation.y = s.buoys[1].rotation.y = -dir;
      s.gLine.scale.set(0.5, 0.08, cp.r * 2);
      s.gLine.rotation.y = -dir;
      s.gLine.position.y = 0.55;
      s.gLine.visible = style !== 'after' || safe; // color-safe: the far gate keeps a line, a thin one
      s.gLine.scale.y = safe && style === 'after' ? 0.03 : 0.08;
    } else {
      s.y = cp.y;
      s.ring.position.y = cp.y;
      // Torus faces local +z; turn it so it faces the direction of travel.
      s.ring.rotation.set(0, Math.PI / 2 - dir, 0);
      s.ring.scale.setScalar(cp.r);
    }
    s.grp.visible = true;
  }
  function hideCheckpoint(slot) {
    if (slots[slot]) slots[slot].grp.visible = false;
  }
  function hideCheckpoints() {
    for (const s of slots) s.grp.visible = false;
  }

  function update(time, cameraPos) {
    for (let i = 0; i < starts.length; i++) {
      const s = starts[i];
      if (!s.type) continue;
      if (cameraPos) {
        const dx = s.grp.position.x - cameraPos.x, dz = s.grp.position.z - cameraPos.z;
        const near = dx * dx + dz * dz < START_SHOW_DIST * START_SHOW_DIST;
        s.tube.visible = s.disc.visible = s.fill.visible = s.icon.visible = near;
      }
      if (!s.grp.visible) continue;
      const t = time + s.phase;
      s.icon.rotation.y = t * 0.9;
      s.icon.position.y = 9 + Math.sin(t * 1.6) * 0.5;
      s.tubeMat.opacity = 0.42 + 0.12 * Math.sin(t * 2.2);
      if (s.type === 'boat') s.grp.position.y = s.baseY + Math.sin(t * 1.3) * 0.12;
    }
    for (let k = 0; k < slots.length; k++) {
      const s = slots[k];
      if (!s.grp.visible) continue;
      // The color-safe setting changed while a marker shows: draw it again at once.
      if (typeof opts.colorSafe === 'function' && s.cp && (opts.colorSafe() === true) !== s.safe) showCheckpoint(k, s.cp, s.styleArg);
      const t = time + s.phase;
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      if (s.kind === 'ring') {
        const sc = s.r * (1 + 0.035 * pulse * (s.style === 'after' ? 0 : 1));
        s.ring.scale.x = s.ring.scale.y = sc;
        s.halo.material.opacity = (0.12 + 0.2 * pulse) * s.alpha;
      } else if (s.kind === 'buoy') {
        for (let b = 0; b < 2; b++) {
          const bo = s.buoys[b];
          bo.position.y = Math.sin(t * 1.7 + b * 1.3) * 0.18;
          bo.rotation.z = Math.sin(t * 1.3 + b) * 0.06;
          bo.userData.flag.rotation.y = Math.sin(t * 5 + b) * 0.35;
        }
        s.beamMat.opacity = (0.22 + 0.16 * pulse) * s.alpha;
      } else {
        s.tubeMat.opacity = (0.36 + 0.2 * pulse) * s.alpha;
        if (s.arrow.visible) {
          s.arrow.position.y = 5 + Math.sin(t * 3) * 0.8;
          s.arrow.rotation.y = t * 1.5;
        }
      }
    }
  }

  function dispose() {
    scene.remove(root);
  }

  return { root, showStart, hideStart, hideStarts, showCheckpoint, hideCheckpoint, hideCheckpoints, update, dispose };
}

// ---- Travel pads (docs/PLAN_V2.md 3.4) -------------------------------------
// The glow and the words of each city.travelPads entry: a faint tube over
// the pad in the destination's color and a floating "To Miami Beach"
// label that shows within TRAVEL_SHOW m. The paving, arrows and curb sign
// are static props (render/props.js). Built once; update() only moves
// opacity and visibility. Browser only: returns null without a scene, a
// document or pads, so node tests and the island are unaffected.
export const TRAVEL_SHOW = 260;
const TRAVEL_COLOR = { 'miami-downtown': 0x1f9aa8, 'miami-beach': 0xf0a030, 'miami-north': 0xe2573a, 'miami-west': 0x3fbf86, 'miami-south': 0x4d90e8 };
// "Miami Beach and the Islands" reads "Miami Beach" on a sign.
export function padLabel(name) {
  const short = String(name || '').split(' and ')[0];
  return 'To ' + short;
}
function labelSprite(text, color) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 96;
  const c = cv.getContext('2d');
  if (!c) return null;
  c.fillStyle = 'rgba(16,20,24,0.78)';
  c.fillRect(0, 0, 512, 96);
  c.fillStyle = '#' + color.toString(16).padStart(6, '0');
  c.fillRect(0, 0, 14, 96);
  c.fillStyle = '#f6efe6';
  c.font = 'bold 44px sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 262, 50, 480);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(14, 14 * 96 / 512, 1);
  return sp;
}
// names: { regionId: name } (the picker's names; REGIONS in world/regions.js).
export function createTravelMarkers(scene, city, names = {}) {
  const pads = city && city.travelPads;
  if (!scene || !pads || !pads.length || typeof document === 'undefined') return null;
  const g = geo();
  const root = new THREE.Group();
  root.name = 'travel-markers';
  const items = [];
  for (const p of pads) {
    const col = TRAVEL_COLOR[p.to] || 0x1f9aa8;
    const grp = new THREE.Group();
    grp.position.set(p.x, 0, p.z);
    const tubeMat = glow(col, 0.5);
    const tube = new THREE.Mesh(g.tube, tubeMat);
    tube.scale.set(p.r * 0.92, 7, p.r * 0.92);
    tube.renderOrder = 2;
    grp.add(tube);
    const label = labelSprite(padLabel(names[p.to] || p.to), col);
    if (label) {
      label.position.set(0, 9.5, 0);
      label.renderOrder = 3;
      grp.add(label);
    }
    grp.visible = false;
    root.add(grp);
    items.push({ p, grp, tubeMat, phase: items.length * 0.7 });
  }
  scene.add(root);
  return {
    root,
    items,
    // x, z: the player (or the camera); time: seconds of play.
    update(x, z, time) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const on = Math.hypot(it.p.x - x, it.p.z - z) < TRAVEL_SHOW;
        if (it.grp.visible !== on) it.grp.visible = on;
        if (on) it.tubeMat.opacity = 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(time * 3 + it.phase));
      }
    },
    dispose() {
      scene.remove(root);
    },
  };
}
