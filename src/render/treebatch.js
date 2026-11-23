// Miami trees and palms as instances of one batch (docs/PERF.md, G1b):
// every species (street canopies and palms, the lighter lot ones) has a
// near shape (the full template: trunk and crown in one) and a far shape
// (a low canopy of two leafy balls, a palm of six two-piece fronds), all
// in one THREE.BatchedMesh with the detail material, so the trees of the
// whole near street cost one draw and one shadow draw.
//
// Each street tile hands in its trees when it is built (addTile) and
// takes them out when it is dropped (removeTile). update() runs every
// drawn frame: the trees of a tile are grouped in CELL m cells; a cell
// is drawn when its bounds meet the view (or it is close enough to cast a
// shadow into it), and a tree in a drawn cell takes its near shape
// within nearR of the camera (with a few meters of hysteresis), else its
// far shape. Instance slots are kept in our own pool (never deleted from
// the batch, so its internal free list never needs sorting), and nothing
// is allocated per frame.
//
// No DOM: the batch only fills typed arrays until the renderer uploads
// them, so node tests run it.
import * as THREE from 'three';

export const TREE_STRIDE = 9; // species, x, y, z, rot, sx, sy, sz, shade
export const CELL = 50; // m
const SHADOW_KEEP = 45; // m: cells this close stay drawn (their shadows)
const CELL_R = CELL * 0.75 + 8; // a cell's bounding sphere (trees reach out)

class TreeBatch extends THREE.BatchedMesh {
  onBeforeShadow(renderer, object, camera, shadowCamera, geometry, depthMaterial, group) {
    this.perObjectFrustumCulled = true;
    super.onBeforeShadow(renderer, object, camera, shadowCamera, geometry, depthMaterial, group);
    this.perObjectFrustumCulled = false;
    // Private to three (r187, pinned): the view pass rebuilds its list.
    this._visibilityChanged = true;
  }
}

function geometryOf(B) {
  const n = B.count, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(B.P.slice(0, n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(B.N.slice(0, n * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(B.C.slice(0, n * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(B.U.slice(0, n * 2), 2));
  g.setIndex(new THREE.BufferAttribute(Uint16Array.from(B.I.subarray(0, B.ni)), 1));
  return g;
}

// species: [{ near, far, distant }] MeshBuilders (props.js treeSpecies).
// Shape levels: 0 distant, 1 far, 2 near.
export function createTreeBatch(species, material, cap = 4096) {
  const geos = [];
  let nv = 0, ni = 0;
  for (const s of species) {
    for (const B of [s.distant, s.far, s.near]) {
      geos.push(geometryOf(B));
      nv += B.count;
      ni += B.ni;
    }
  }
  const mesh = new TreeBatch(cap, nv, ni, material);
  mesh.name = 'trees';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Culling is ours, by cell (see update); no sorting. The shadow pass
  // (drawn first in a frame) culls each tree against the shadow camera,
  // so only the trees in the shadow map's box cast; the view pass then
  // takes the cell list again.
  mesh.perObjectFrustumCulled = false;

  mesh.sortObjects = false;
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  // geo[species * 3 + level]: the batch's geometry id; tris the same.
  const geo = new Int32Array(geos.length), tris = new Int32Array(geos.length);
  for (let i = 0; i < geos.length; i++) {
    geo[i] = mesh.addGeometry(geos[i]);
    tris[i] = geos[i].index.count / 3;
    geos[i].dispose();
  }
  // Every slot exists from the start, hidden; ours hands them out.
  let free = new Int32Array(cap);
  let nFree = 0;
  const color = new THREE.Color(1, 1, 1);
  function addSlots(from, to) {
    for (let i = from; i < to; i++) {
      const id = mesh.addInstance(geo[0]);
      mesh.setVisibleAt(id, false);
      mesh.setColorAt(id, color);
    }
    const f2 = new Int32Array(to);
    f2.set(free.subarray(0, nFree));
    free = f2;
    for (let i = to - 1; i >= from; i--) free[nFree++] = i;
  }
  addSlots(0, cap);
  function take() {
    if (!nFree) {
      const old = mesh.maxInstanceCount;
      mesh.setInstanceCount(old * 2);
      addSlots(old, old * 2);
    }
    return free[--nFree];
  }

  const tiles = new Map(); // tile key -> entry
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), p4 = new THREE.Vector3(), s4 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  // Drawn trees and their triangles (one pass) by level, distant to near.
  const stats = { trees: 0, drawn: 0, n: [0, 0, 0], tris: [0, 0, 0] };

  // data: TREE_STRIDE numbers a tree. Trees are grouped by cell.
  // x0, z0, size: the tile square.
  function addTile(key, data, n, x0, z0, size, shown) {
    removeTile(key);
    if (!n) return;
    const nx = Math.max(1, Math.ceil(size / CELL));
    const cellOf = (x, z) => Math.max(0, Math.min(nx - 1, Math.floor((x - x0) / CELL))) + Math.max(0, Math.min(nx - 1, Math.floor((z - z0) / CELL))) * nx;
    const nc = nx * nx;
    const counts = new Int32Array(nc + 1);
    for (let i = 0; i < n; i++) counts[cellOf(data[i * TREE_STRIDE + 1], data[i * TREE_STRIDE + 3]) + 1]++;
    for (let c = 0; c < nc; c++) counts[c + 1] += counts[c];
    const start = counts.slice();
    const ids = new Int32Array(n), sp = new Uint8Array(n), px = new Float32Array(n), pz = new Float32Array(n), lod = new Uint8Array(n);
    const fill = counts.slice(0, nc);
    for (let i = 0; i < n; i++) {
      const o = i * TREE_STRIDE;
      const k = fill[cellOf(data[o + 1], data[o + 3])]++;
      const id = take();
      ids[k] = id;
      sp[k] = data[o];
      px[k] = data[o + 1];
      pz[k] = data[o + 3];
      q4.setFromAxisAngle(UP, -data[o + 4]);
      p4.set(data[o + 1], data[o + 2], data[o + 3]);
      s4.set(data[o + 5], data[o + 6], data[o + 7]);
      mesh.setMatrixAt(id, m4.compose(p4, q4, s4));
      color.setRGB(data[o + 8], data[o + 8], data[o + 8], THREE.LinearSRGBColorSpace);
      mesh.setColorAt(id, color);
      mesh.setGeometryIdAt(id, geo[data[o] * 3]);
      mesh.setVisibleAt(id, false);
    }
    const cx = new Float32Array(nc), cz = new Float32Array(nc);
    for (let c = 0; c < nc; c++) {
      cx[c] = x0 + ((c % nx) + 0.5) * CELL;
      cz[c] = z0 + (Math.floor(c / nx) + 0.5) * CELL;
    }
    tiles.set(key, { ids, sp, px, pz, lod, start, nc, cx, cz, cellOn: new Uint8Array(nc), cellLod: new Uint8Array(nc), shown: false, n });
    stats.trees += n;
    if (shown) setShown(key, true);
  }
  function removeTile(key) {
    const e = tiles.get(key);
    if (!e) return;
    for (let i = 0; i < e.n; i++) {
      mesh.setVisibleAt(e.ids[i], false);
      free[nFree++] = e.ids[i];
    }
    stats.trees -= e.n;
    tiles.delete(key);
  }
  function showCell(e, c, on) {
    e.cellOn[c] = on;
    for (let i = e.start[c]; i < e.start[c + 1]; i++) mesh.setVisibleAt(e.ids[i], on === 1);
  }
  function setShown(key, shown) {
    const e = tiles.get(key);
    if (!e || e.shown === shown) return;
    e.shown = shown;
    if (!shown) for (let c = 0; c < e.nc; c++) if (e.cellOn[c]) showCell(e, c, 0);
    // Shown cells come on at the next update.
    force = true;
  }

  const frustum = new THREE.Frustum(), pm = new THREE.Matrix4(), sphere = new THREE.Sphere();
  let lastX = Infinity, lastZ = Infinity, lastR = -1, lastF = -1, force = true;
  // camera: a three.js camera (cells culled by its view) or anything
  // with a position (every cell of a shown tile drawn). nearR, farR: the
  // near shape within nearR, the far one within farR, else the distant.
  function update(camera, nearR, farR) {
    const x = camera.position.x, z = camera.position.z;
    const cull = !!(camera.isCamera && camera.projectionMatrix);
    if (cull) {
      camera.updateMatrixWorld();
      pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(pm, camera.coordinateSystem);
    }
    const moved = force || nearR !== lastR || farR !== lastF || (x - lastX) * (x - lastX) + (z - lastZ) * (z - lastZ) > 4;
    force = false;
    if (moved) { lastX = x; lastZ = z; lastR = nearR; lastF = farR; }
    const n2 = nearR * nearR, n2h = (nearR + 4) * (nearR + 4), f2 = farR * farR, f2h = (farR + 8) * (farR + 8);
    const sn = stats.n, st = stats.tris;
    sn[0] = sn[1] = sn[2] = st[0] = st[1] = st[2] = 0;
    let drawn = 0;
    for (const e of tiles.values()) {
      if (!e.shown) continue;
      for (let c = 0; c < e.nc; c++) {
        const a = e.start[c], b = e.start[c + 1];
        if (a === b) continue;
        const dx = e.cx[c] - x, dz = e.cz[c] - z, d = Math.sqrt(dx * dx + dz * dz);
        let on = 1;
        if (cull && d > SHADOW_KEEP + CELL_R) {
          sphere.center.set(e.cx[c], 6, e.cz[c]);
          sphere.radius = CELL_R;
          on = frustum.intersectsSphere(sphere) ? 1 : 0;
        }
        if (on !== e.cellOn[c]) showCell(e, c, on);
        if (!on) continue;
        drawn += b - a;
        // The shape per tree, only where the camera moved; a cell wholly
        // past farR is all distant (checked once).
        if (moved && (d < farR + 8 + CELL_R || e.cellLod[c])) {
          let any = 0;
          for (let i = a; i < b; i++) {
            const ex = e.px[i] - x, ez = e.pz[i] - z, q = ex * ex + ez * ez, l = e.lod[i];
            const want = q < (l === 2 ? n2h : n2) ? 2 : q < (l >= 1 ? f2h : f2) ? 1 : 0;
            if (want !== l) {
              e.lod[i] = want;
              mesh.setGeometryIdAt(e.ids[i], geo[e.sp[i] * 3 + want]);
            }
            any |= want;
          }
          e.cellLod[c] = any ? 1 : 0;
        }
        for (let i = a; i < b; i++) {
          const l = e.lod[i];
          sn[l]++;
          st[l] += tris[e.sp[i] * 3 + l];
        }
      }
    }
    stats.drawn = drawn;
  }
  return { mesh, addTile, removeTile, setShown, update, stats, tiles };
}
