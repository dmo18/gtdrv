// Collects coloured quads/boxes into one big geometry so thousands of
// objects draw in a single call.
import * as THREE from 'three';

const _c = new THREE.Color();

export class MeshBuilder {
  constructor(withUv = false) {
    this.pos = [];
    this.col = [];
    this.nor = [];
    this.uv = withUv ? [] : null;
    this.idx = [];
    this.count = 0;
  }

  // Four corners in counter-clockwise order seen from the front.
  quad(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, color, nx, ny, nz, u0 = 0, v0 = 0, u1 = 1, v1 = 1) {
    _c.setHex(color, THREE.SRGBColorSpace);
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    for (let i = 0; i < 4; i++) {
      this.col.push(_c.r, _c.g, _c.b);
      this.nor.push(nx, ny, nz);
    }
    if (this.uv) this.uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    const n = this.count;
    this.idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    this.count += 4;
  }

  // Flat rectangle on the ground facing up.
  flat(x0, z0, x1, z1, y, color) {
    this.quad(x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0, color, 0, 1, 0);
  }

  // The four walls of an upright box. uScale/vScale are metres per
  // texture repeat (only used when this builder has UVs).
  walls(x0, z0, x1, z1, y0, y1, color, uScale = 1, vScale = 1) {
    const w = (x1 - x0) / uScale, d = (z1 - z0) / uScale, h = (y1 - y0) / vScale;
    this.quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1, color, 0, 0, 1, 0, 0, w, h); // south
    this.quad(x1, y0, z0, x0, y0, z0, x0, y1, z0, x1, y1, z0, color, 0, 0, -1, 0, 0, w, h); // north
    this.quad(x1, y0, z1, x1, y0, z0, x1, y1, z0, x1, y1, z1, color, 1, 0, 0, 0, 0, d, h); // east
    this.quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0, color, -1, 0, 0, 0, 0, d, h); // west
  }

  box(x0, z0, x1, z1, y0, y1, color, topColor = color) {
    this.walls(x0, z0, x1, z1, y0, y1, color);
    this.flat(x0, z0, x1, z1, y1, topColor);
  }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz, color, nx, ny, nz) {
    _c.setHex(color, THREE.SRGBColorSpace);
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) {
      this.col.push(_c.r, _c.g, _c.b);
      this.nor.push(nx, ny, nz);
    }
    if (this.uv) this.uv.push(0, 0, 0, 0, 0, 0);
    const n = this.count;
    this.idx.push(n, n + 1, n + 2);
    this.count += 3;
  }

  build(material) {
    if (!this.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

// A set of builders split over a grid of map tiles, so tiles outside
// the camera's view are skipped when drawing.
export class ChunkedBuilder {
  constructor(size, tiles, withUv = false) {
    this.size = size;
    this.tiles = tiles;
    this.withUv = withUv;
    this.map = new Map();
  }

  at(x, z) {
    const t = this.tiles, s = this.size;
    const cx = Math.max(0, Math.min(t - 1, Math.floor(((x + s) / (2 * s)) * t)));
    const cz = Math.max(0, Math.min(t - 1, Math.floor(((z + s) / (2 * s)) * t)));
    const k = cz * t + cx;
    let b = this.map.get(k);
    if (!b) this.map.set(k, (b = new MeshBuilder(this.withUv)));
    return b;
  }

  buildInto(group, material, renderOrder = 0) {
    for (const b of this.map.values()) {
      const m = b.build(material);
      if (m) {
        m.renderOrder = renderOrder;
        group.add(m);
      }
    }
  }
}
