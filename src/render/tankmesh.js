// Rustback tank mesh (original low-poly design): a low wedge hull with
// side skirts, a rounded turret set back, a long barrel with a muzzle
// collar, and two tread bands whose tread pattern runs with the track
// speed (a shader offset on a baked "distance along the band" attribute,
// so no texture). Geometry is built once per spec and colour and shared;
// draw calls near: hull, turret, gun, tracks.
// Origin at the ground centre, nose along local +x, up +y (docs/CRAFT.md).
// Hierarchy: group (position, yaw, sway) -> hull, tracks, turret (yaw) ->
// gun (pitch) -> barrel (recoil).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { angleDiff } from '../core/rng.js';

const TRACK = 0x2c2b29;
const WHEEL = 0x3b3c3a;
const METAL = 0x50555c;
const DARK = 0x24272b;
const LAMP = 0xf3ecd2;
const WHITE = 0xeef0f0;
const tmp = new THREE.Color();

function shade(hex, k) {
  tmp.setHex(hex);
  tmp.r *= k; tmp.g *= k; tmp.b *= k;
  return tmp.getHex();
}

// Non-indexed, position + normal + colour (+ tread attribute).
function finish(geo, hex, tread = -1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  g.computeVertexNormals();
  tmp.setHex(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  const tr = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmp.r;
    col[i * 3 + 1] = tmp.g;
    col[i * 3 + 2] = tmp.b;
    tr[i * 2] = tread;
    tr[i * 2 + 1] = 0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTread', new THREE.BufferAttribute(tr, 2));
  return g;
}
function box(parts, hex, sx, sy, sz, x, y, z, rz = 0, ry = 0) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  parts.push(finish(g, hex));
}
function cylX(parts, hex, r0, r1, len, x, y, z, seg = 10) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.rotateZ(-Math.PI / 2); // axis along +x, r1 at the +x end
  g.translate(x, y, z);
  parts.push(finish(g, hex));
}
function cylZ(parts, hex, r, len, x, y, z, seg = 8) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  parts.push(finish(g, hex));
}
// A side profile in (x, y) extruded across z (centred).
function prism(parts, hex, pts, width, z = 0) {
  const sh = new THREE.Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) sh.lineTo(pts[i][0], pts[i][1]);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, z - width / 2);
  parts.push(finish(g, hex));
}

// One tread band: a rectangle swept round a stadium loop in the x-y
// plane at side offset zc. aTread.x = metres along the loop (the top run
// goes forward), aTread.y = side (-1 left, +1 right).
function band(parts, zc, side) {
  const R = 0.46, XF = 3.12, XR = -3.12, YC = 0.58, W = 0.74, T = 0.11;
  const path = [];
  const N = 7;
  path.push([XR, YC + R]);
  path.push([XF, YC + R]);
  for (let i = 1; i < N; i++) {
    const a = Math.PI / 2 - (i / N) * Math.PI;
    path.push([XF + Math.cos(a) * R, YC + Math.sin(a) * R]);
  }
  path.push([XF, YC - R]);
  path.push([XR, YC - R]);
  for (let i = 1; i < N; i++) {
    const a = -Math.PI / 2 - (i / N) * Math.PI;
    path.push([XR + Math.cos(a) * R, YC + Math.sin(a) * R]);
  }
  const n = path.length;
  const dist = [0];
  for (let i = 1; i <= n; i++) {
    const a = path[i - 1], b = path[i % n];
    dist.push(dist[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const pos = [], tr = [];
  const quad = (p0, p1, p2, p3, s0, s1) => {
    pos.push(...p0, ...p1, ...p2, ...p0, ...p2, ...p3);
    tr.push(s0, side, s0, side, s1, side, s0, side, s1, side, s1, side);
  };
  for (let i = 0; i < n; i++) {
    const a = path[i], b = path[(i + 1) % n];
    // Outward normal of this segment (the loop runs clockwise seen from +z).
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l, ny = dx / l;
    const ao = [a[0] + nx * T, a[1] + ny * T], bo = [b[0] + nx * T, b[1] + ny * T];
    const z0 = zc - W / 2, z1 = zc + W / 2;
    const s0 = dist[i], s1 = dist[i + 1];
    quad([ao[0], ao[1], z0], [ao[0], ao[1], z1], [bo[0], bo[1], z1], [bo[0], bo[1], z0], s0, s1); // tread face
    quad([a[0], a[1], z1], [a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1], s0, s1); // inner face
    quad([a[0], a[1], z1], [b[0], b[1], z1], [bo[0], bo[1], z1], [ao[0], ao[1], z1], s0, s1); // edges
    quad([b[0], b[1], z0], [a[0], a[1], z0], [ao[0], ao[1], z0], [bo[0], bo[1], z0], s0, s1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  tmp.setHex(TRACK);
  const cnt = pos.length / 3;
  const col = new Float32Array(cnt * 3);
  for (let i = 0; i < cnt; i++) {
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTread', new THREE.Float32BufferAttribute(tr, 2));
  parts.push(g);
}

function buildHull(spec, col, police) {
  const parts = [];
  const L = spec.length, H = L / 2;
  const deck = 1.62;
  const lower = shade(col, 0.72);
  // Belly between the tracks.
  box(parts, lower, L - 0.9, 0.7, 2.0, 0, 0.72, 0);
  // Upper hull: a low wedge, long sloped glacis, short rear plate.
  prism(parts, col, [
    [-H + 0.05, 0.95], [H - 0.35, 0.95], [H, 1.18], [H - 1.75, deck + 0.04], [-H + 0.35, deck], [-H, deck - 0.22],
  ], 3.36);
  // Side skirts over the upper run of the tracks.
  for (const s of [-1, 1]) {
    prism(parts, shade(col, 0.9), [[-H + 0.25, 0.62], [H - 0.6, 0.62], [H - 0.2, 1.02], [H - 0.35, 1.16], [-H + 0.15, 1.16]], 0.09, s * 1.79);
    // A slim rail along the top of the skirt.
    box(parts, shade(col, 0.6), L - 1.0, 0.07, 0.12, -0.15, 1.18, s * 1.74);
    // Lamps on the glacis corners, toolbox at the rear.
    box(parts, DARK, 0.22, 0.2, 0.36, H - 0.62, 1.2, s * 1.28, -0.3);
    box(parts, LAMP, 0.06, 0.13, 0.26, H - 0.5, 1.22, s * 1.28, -0.3);
    box(parts, shade(col, 0.8), 1.3, 0.3, 0.42, -H + 1.4, deck + 0.13, s * 1.25);
  }
  // Engine deck grille and exhaust box at the back.
  box(parts, DARK, 1.6, 0.05, 1.7, -H + 1.25, deck + 0.02, 0);
  box(parts, METAL, 0.25, 0.32, 1.2, -H + 0.12, 1.18, 0);
  // Driver's hatch on the glacis.
  cylZ(parts, shade(col, 0.82), 0.26, 0.06, H - 1.95, deck - 0.02, 0, 8);
  if (police) for (const s of [-1, 1]) box(parts, WHITE, L - 1.6, 0.16, 0.03, -0.2, 1.0, s * 1.84);
  return parts;
}

function buildTracks() {
  const parts = [];
  for (const s of [-1, 1]) {
    const zc = s * 1.42;
    band(parts, zc, s);
    // Road wheels, drive sprocket and idler (inside the band).
    for (let k = 0; k < 6; k++) cylZ(parts, WHEEL, 0.36, 0.56, -2.55 + k * 1.02, 0.5, zc, 8);
    cylZ(parts, METAL, 0.4, 0.5, 3.12, 0.58, zc, 8);
    cylZ(parts, METAL, 0.4, 0.5, -3.12, 0.58, zc, 8);
  }
  return parts;
}

function buildTurret(spec, col, police) {
  const parts = [];
  // Rounded, tapering body (10 sides), stretched fore and aft.
  const g = new THREE.CylinderGeometry(1.12, 1.42, 0.78, 10, 1);
  g.scale(1.22, 1, 1);
  g.translate(0.1, 0.39, 0);
  parts.push(finish(g, col));
  const top = new THREE.CylinderGeometry(0.85, 1.12, 0.12, 10, 1);
  top.scale(1.22, 1, 1);
  top.translate(0.1, 0.84, 0);
  parts.push(finish(top, shade(col, 0.92)));
  // Bustle at the back, cupola and hatch, a stubby sight box.
  box(parts, shade(col, 0.88), 1.0, 0.56, 1.9, -1.55, 0.42, 0);
  const cup = new THREE.CylinderGeometry(0.3, 0.36, 0.28, 10, 1);
  cup.translate(-0.35, 1.02, -0.52);
  parts.push(finish(cup, shade(col, 0.8)));
  box(parts, DARK, 0.42, 0.26, 0.3, 0.55, 1.02, 0.62);
  box(parts, METAL, 0.04, 1.3, 0.04, -1.8, 1.25, 0.72);
  if (police) for (const s of [-1, 1]) box(parts, WHITE, 1.8, 0.14, 0.03, -0.1, 0.42, s * 1.43);
  return parts;
}

function buildGun(spec, col) {
  const parts = [];
  // Mantlet, barrel with a fume collar, muzzle collar; coax beside it.
  box(parts, shade(col, 0.85), 0.62, 0.56, 0.95, 1.38, 0, 0);
  cylX(parts, shade(col, 0.95), 0.15, 0.13, 1.6, 2.4, 0, 0, 10);
  cylX(parts, shade(col, 0.8), 0.2, 0.2, 0.42, 3.2, 0, 0, 10);
  cylX(parts, shade(col, 0.95), 0.125, 0.12, 1.1, 3.95, 0, 0, 10);
  cylX(parts, DARK, 0.19, 0.17, 0.32, spec.barrelLen - 0.16, 0, 0, 10);
  cylX(parts, DARK, 0.045, 0.045, 0.6, 1.9, 0.08, 0.42, 6);
  return parts;
}

// ---- materials --------------------------------------------------------------
let paintMat = null, burntMat = null;
function hullMaterial(burnt) {
  if (!paintMat) {
    paintMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0.08 });
    burntMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, vertexColors: true, roughness: 0.95, metalness: 0 });
  }
  return burnt ? burntMat : paintMat;
}
// Tread material: one per tank (its own phase uniform), one shared program.
function treadMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  const uPhase = { value: new THREE.Vector2(0, 0) };
  m.userData.uPhase = uPhase;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPhase = uPhase;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aTread;\nvarying vec2 vTread;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTread = aTread;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec2 uPhase;\nvarying vec2 vTread;')
      .replace('#include <color_fragment>', `#include <color_fragment>
  if (vTread.x >= 0.0) {
    float ph = vTread.y < 0.0 ? uPhase.x : uPhase.y;
    float s = fract((vTread.x - ph) * 2.8);
    diffuseColor.rgb *= mix(1.25, 0.55, smoothstep(0.45, 0.6, s) * (1.0 - smoothstep(0.88, 1.0, s)));
  }`);
  };
  m.customProgramCacheKey = () => 'rw-tread';
  return m;
}

// ---- geometry cache -----------------------------------------------------------
const cache = new Map();
let trackGeo = null;
function merged(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  return g;
}
function entry(spec, col) {
  const key = spec.id + ':' + col;
  let e = cache.get(key);
  if (e) return e;
  const police = !!spec.police;
  if (!trackGeo) trackGeo = merged(buildTracks());
  e = {
    hull: merged(buildHull(spec, col, police)),
    turret: merged(buildTurret(spec, col, police)),
    gun: merged(buildGun(spec, col)),
    tracks: trackGeo,
  };
  e.tris = (e.hull.attributes.position.count + e.turret.attributes.position.count + e.gun.attributes.position.count + e.tracks.attributes.position.count) / 3;
  cache.set(key, e);
  return e;
}

// Triangle count of one tank (for tools and tests).
export function tankStats(spec, color) {
  return { tris: entry(spec, color == null ? spec.colors[0] : color).tris };
}

export function createTankMesh(spec, color) {
  const col = color == null ? spec.colors[0] : color;
  const e = entry(spec, col);
  const group = new THREE.Group();
  group.rotation.order = 'YZX';
  const hull = new THREE.Mesh(e.hull, hullMaterial(false));
  const tmat = treadMaterial();
  const tracks = new THREE.Mesh(e.tracks, tmat);
  const turret = new THREE.Group();
  turret.position.set(spec.turretX, 1.62, 0);
  const turretBody = new THREE.Mesh(e.turret, hullMaterial(false));
  const gun = new THREE.Group();
  gun.position.set(0, spec.turretY - 1.62, 0);
  const barrel = new THREE.Mesh(e.gun, hullMaterial(false));
  gun.add(barrel);
  turret.add(turretBody, gun);
  group.add(hull, tracks, turret);
  group.userData = { spec, color: col, hull, tracks, tmat, turret, turretBody, gun, barrel, wrecked: false, tris: e.tris };
  return group;
}

export function updateTankMesh(mesh, t, alpha = 1) {
  const ud = mesh.userData;
  const x = t.px + (t.x - t.px) * alpha;
  const z = t.pz + (t.z - t.pz) * alpha;
  const h = t.pheading + angleDiff(t.heading, t.pheading) * alpha;
  const pp = Number.isFinite(t.ppitch) ? t.ppitch : t.pitch;
  const pr = Number.isFinite(t.proll) ? t.proll : t.roll;
  mesh.position.set(x, Number.isFinite(t.y) ? t.y : 0, z);
  mesh.rotation.set(pr + (t.roll - pr) * alpha, -h, pp + (t.pitch - pp) * alpha);
  const ty = t.pturretYaw + angleDiff(t.turretYaw, t.pturretYaw) * alpha;
  ud.turret.rotation.y = -ty;
  ud.gun.rotation.z = t.pgunPitch + (t.gunPitch - t.pgunPitch) * alpha;
  ud.barrel.position.x = -0.55 * (t.recoil || 0);
  ud.tmat.userData.uPhase.value.set(t.trackPhaseL || 0, t.trackPhaseR || 0);
  const wrecked = !!t.wrecked;
  if (wrecked !== ud.wrecked) {
    ud.wrecked = wrecked;
    const m = hullMaterial(wrecked);
    ud.hull.material = m;
    ud.turretBody.material = m;
    ud.barrel.material = m;
    ud.tmat.color.setHex(wrecked ? 0x504c48 : 0xffffff);
  }
}
