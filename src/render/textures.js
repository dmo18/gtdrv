// Every surface picture in the game is painted here at load time onto
// canvases: no image files, nothing downloaded. Textures tile, are
// mipmapped and are shared by the whole city.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';

const TAU = Math.PI * 2;

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Tileable smooth noise, 0..1, as a size*size array. `period` is the
// coarsest lattice; each octave doubles the detail.
function noiseField(size, period, octaves, rng, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const p = Math.min(size, period << o);
    const lat = new Float32Array(p * p);
    for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
    const k = p / size;
    for (let y = 0; y < size; y++) {
      const fy = y * k, y0 = fy | 0, ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % p) * p, r1 = ((y0 + 1) % p) * p;
      for (let x = 0; x < size; x++) {
        const fx = x * k, x0 = fx | 0, tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % p, xb = (x0 + 1) % p;
        const a = lat[r0 + xa] + (lat[r0 + xb] - lat[r0 + xa]) * sx;
        const b = lat[r1 + xa] + (lat[r1 + xb] - lat[r1 + xa]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// Multiply a canvas by noise: each pixel * (1 + (n - 0.5) * amount),
// plus optional per-pixel grain.
function grain(c, field, fsize, amount, rng, speckle = 0, ox = 0, oy = 0) {
  const g = c.getContext('2d');
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const w = c.width, h = c.height;
  for (let y = 0; y < h; y++) {
    const fy = ((y + oy) % fsize) * fsize;
    for (let x = 0; x < w; x++) {
      let k = 1 + (field[fy + ((x + ox) % fsize)] - 0.5) * amount;
      if (speckle) k += (rng.next() - 0.5) * speckle;
      const i = (y * w + x) * 4;
      d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
    }
  }
  g.putImageData(img, 0, 0);
}

// Tangent-space normal map from a height array (tileable).
function normalFromHeight(height, size, strength) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const yu = ((y + size - 1) % size) * size, yd = ((y + 1) % size) * size, yc = y * size;
    for (let x = 0; x < size; x++) {
      const xl = (x + size - 1) % size, xr = (x + 1) % size;
      const dx = (height[yc + xr] - height[yc + xl]) * strength;
      const dy = (height[yd + x] - height[yu + x]) * strength;
      const l = 1 / Math.hypot(dx, dy, 1);
      const i = (yc + x) * 4;
      d[i] = (-dx * l * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * l * 0.5 + 0.5) * 255;
      d[i + 2] = (l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return toTexture(c, { srgb: false });
}

// Luminance of a canvas as a height array.
function heightOf(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const out = new Float32Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765;
  return out;
}

const grey = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
const rgb = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

// Draw something at every wrapped copy so it tiles across the edges.
function wrapDraw(size, fn) {
  for (let oy = -size; oy <= size; oy += size) for (let ox = -size; ox <= size; ox += size) fn(ox, oy);
}

// A wandering crack as a polyline.
function crack(g, rng, x, y, len, width, style) {
  g.strokeStyle = style;
  g.lineWidth = width;
  g.lineJoin = 'round';
  let a = rng.range(0, TAU);
  g.beginPath();
  g.moveTo(x, y);
  for (let i = 0; i < len; i++) {
    a += rng.range(-0.7, 0.7);
    x += Math.cos(a) * 6;
    y += Math.sin(a) * 6;
    g.lineTo(x, y);
  }
  g.stroke();
}

// ---------------------------------------------------------------- ground ----
function makeAsphalt(rng, N) {
  const S = 512;
  const c = canvas(S);
  const g = c.getContext('2d');
  g.fillStyle = grey(206);
  g.fillRect(0, 0, S, S);
  // Aggregate: small pale and dark stones.
  for (let i = 0; i < 5200; i++) {
    const v = rng.chance(0.55) ? rng.range(215, 255) : rng.range(120, 180);
    g.fillStyle = grey(v, rng.range(0.25, 0.7));
    const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(0.5, 1.5);
    g.fillRect(x, y, r, r);
  }
  // Hairline cracks and tar seams.
  const pts = [];
  for (let i = 0; i < 6; i++) pts.push([rng.range(0, S), rng.range(0, S), rng.int(8, 26), rng.int(1, 1000000)]);
  wrapDraw(S, (ox, oy) => {
    for (const p of pts) crack(g, createRng(p[3]), p[0] + ox, p[1] + oy, p[2], 1.1, grey(70, 0.55));
  });
  grain(c, N.fine, 512, 0.34, rng, 0.2);
  grain(c, N.coarse, 512, 0.16, rng);
  const map = toTexture(c);
  const normalMap = normalFromHeight(heightOf(c), S, 2.6);
  // Puddle mask in the green channel: where water collects in the rain.
  const P = 256;
  const pc = canvas(P);
  const pg = pc.getContext('2d');
  const img = pg.createImageData(P, P);
  const pf = noiseField(P, 4, 4, rng);
  for (let i = 0; i < P * P; i++) {
    const v = Math.min(1, Math.max(0, (pf[i] - 0.42) * 5));
    const k = 70 + 185 * v;
    img.data[i * 4] = k; img.data[i * 4 + 1] = k; img.data[i * 4 + 2] = k; img.data[i * 4 + 3] = 255;
  }
  pg.putImageData(img, 0, 0);
  const wetMap = toTexture(pc, { srgb: false });
  wetMap.repeat.set(0.4, 0.4);
  return { map, normalMap, wetMap };
}

function makePavement(rng, N) {
  const S = 512, n = 4, cell = S / n;
  const c = canvas(S);
  const g = c.getContext('2d');
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      g.fillStyle = grey(rng.range(196, 226));
      g.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  // Stains and old gum.
  for (let i = 0; i < 26; i++) {
    g.fillStyle = grey(rng.range(90, 150), rng.range(0.12, 0.3));
    g.beginPath();
    g.ellipse(rng.range(0, S), rng.range(0, S), rng.range(2, 9), rng.range(2, 7), rng.range(0, 3), 0, TAU);
    g.fill();
  }
  grain(c, N.fine, 512, 0.26, rng, 0.14);
  grain(c, N.coarse, 512, 0.12, rng);
  const hc = canvas(S);
  const hg = hc.getContext('2d');
  hg.drawImage(c, 0, 0);
  for (const [ctx, col, w] of [[g, grey(96), 2.5], [hg, grey(0), 4]]) {
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(S, i * cell); ctx.stroke();
    }
  }
  return { map: toTexture(c), normalMap: normalFromHeight(heightOf(hc), S, 2.2) };
}

function makeGrass(rng, N) {
  const S = 512;
  const c = canvas(S);
  const g = c.getContext('2d');
  g.fillStyle = rgb(196, 214, 170);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const v = rng.range(0.6, 1.15);
    g.strokeStyle = rgb(170 * v, 215 * v, 140 * v, 0.5);
    const x = rng.range(0, S), y = rng.range(0, S), a = rng.range(0, TAU);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5);
    g.stroke();
  }
  // Drier, yellower patches.
  for (let i = 0; i < 14; i++) {
    const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(20, 60);
    wrapDraw(S, (ox, oy) => {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      gr.addColorStop(0, 'rgba(222,208,140,0.26)');
      gr.addColorStop(1, 'rgba(222,208,140,0)');
      g.fillStyle = gr;
      g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    });
  }
  grain(c, N.fine, 512, 0.4, rng, 0.2);
  grain(c, N.coarse, 512, 0.3, rng);
  return { map: toTexture(c) };
}

function makeSand(rng, N) {
  const S = 256;
  const c = canvas(S);
  const g = c.getContext('2d');
  g.fillStyle = rgb(236, 228, 208);
  g.fillRect(0, 0, S, S);
  // Wind ripples.
  g.strokeStyle = 'rgba(160,140,100,0.14)';
  g.lineWidth = 2;
  for (let y = 0; y < S; y += 16) {
    g.beginPath();
    for (let x = 0; x <= S; x += 8) g.lineTo(x, y + Math.sin((x / S) * TAU * 3 + y) * 3);
    g.stroke();
  }
  grain(c, N.fine, 512, 0.22, rng, 0.18);
  grain(c, N.coarse, 512, 0.14, rng, 0, 100, 37);
  return { map: toTexture(c) };
}

function makeWood(rng, N) {
  const S = 256, n = 8, w = S / n;
  const c = canvas(S);
  const g = c.getContext('2d');
  for (let i = 0; i < n; i++) {
    g.fillStyle = grey(rng.range(170, 230));
    g.fillRect(i * w, 0, w, S);
    g.strokeStyle = grey(90, 0.25);
    g.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      const x = i * w + rng.range(3, w - 3);
      g.beginPath();
      g.moveTo(x, 0);
      g.bezierCurveTo(x + rng.range(-3, 3), S / 3, x + rng.range(-3, 3), (S * 2) / 3, x, S);
      g.stroke();
    }
    g.fillStyle = grey(40);
    g.fillRect(i * w, 0, 2, S);
    g.fillStyle = grey(60);
    g.fillRect(i * w + w / 2 - 1, 20, 2, 2);
    g.fillRect(i * w + w / 2 - 1, S - 22, 2, 2);
  }
  grain(c, N.fine, 512, 0.22, rng, 0.1);
  return { map: toTexture(c) };
}

// Worn road paint: white with chipped-away holes in the alpha.
function makePaint(rng, N) {
  const S = 256;
  const c = canvas(S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const a = N.fine[(y * 2) * 512 + x * 2], b = N.coarse[((y * 2 + 97) % 512) * 512 + ((x * 2 + 31) % 512)];
      const wear = a * 0.6 + b * 0.55;
      const i = (y * S + x) * 4;
      const v = 215 + 40 * a;
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
      d[i + 3] = wear < 0.4 ? 0 : wear < 0.44 ? 150 : 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { map: toTexture(c) };
}

// ------------------------------------------------------------ atlas tool ----
// Packs named pictures onto one canvas in rows and remembers where.
function createAtlas(size) {
  const c = canvas(size), e = canvas(size);
  const g = c.getContext('2d'), ge = e.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, size, size);
  let x = 0, y = 0, rowH = 0;
  const rects = {};
  return {
    c, e, g, ge, rects,
    // draw(g, ge, w, h) paints at the origin; both contexts are moved.
    add(name, w, h, draw) {
      if (x + w > size) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      if (y + h > size) {
        // Out of room: leave this picture out rather than stop the game.
        // Its users check for the missing entry (props.js, buildings.js).
        console.warn('atlas full, skipped: ' + name);
        return;
      }
      for (const ctx of [g, ge]) {
        ctx.save();
        ctx.translate(x, y);
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.clip();
      }
      draw(g, ge, w, h);
      g.restore();
      ge.restore();
      const p = 0.75; // keep clear of the neighbours when mipmapped
      rects[name] = { u0: (x + p) / size, u1: (x + w - p) / size, v0: 1 - (y + h - p) / size, v1: 1 - (y + p) / size, w, h };
      x += w;
      rowH = Math.max(rowH, h);
    },
  };
}

// -------------------------------------------------------- ground decals ----
function makeDecals(rng) {
  const A = createAtlas(1024);
  const C = 256;
  const blot = (g, n, col, rmin, rmax, spread) => {
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, TAU), d = rng.range(0, spread);
      const x = C / 2 + Math.cos(a) * d, y = C / 2 + Math.sin(a) * d, r = rng.range(rmin, rmax);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, col);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  };
  A.add('manhole', C, C, (g) => {
    g.fillStyle = 'rgba(30,30,32,0.9)';
    g.beginPath(); g.arc(128, 128, 118, 0, TAU); g.fill();
    g.fillStyle = grey(88);
    g.beginPath(); g.arc(128, 128, 108, 0, TAU); g.fill();
    g.strokeStyle = grey(50);
    g.lineWidth = 6;
    for (let r = 22; r < 105; r += 20) { g.beginPath(); g.arc(128, 128, r, 0, TAU); g.stroke(); }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      g.beginPath(); g.moveTo(128 + Math.cos(a) * 24, 128 + Math.sin(a) * 24); g.lineTo(128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100); g.stroke();
    }
    g.fillStyle = grey(120, 0.5);
    for (let i = 0; i < 300; i++) g.fillRect(rng.range(30, 226), rng.range(30, 226), 2, 2);
  });
  A.add('grate', C, C, (g) => {
    g.fillStyle = 'rgba(28,28,30,0.92)';
    g.fillRect(20, 50, 216, 156);
    g.fillStyle = grey(84);
    g.fillRect(30, 60, 196, 136);
    g.fillStyle = grey(12);
    for (let x = 44; x < 216; x += 22) g.fillRect(x, 70, 11, 116);
  });
  A.add('stain1', C, C, (g) => blot(g, 16, 'rgba(12,12,14,0.34)', 14, 52, 62));
  A.add('stain2', C, C, (g) => blot(g, 40, 'rgba(16,14,12,0.3)', 5, 26, 96));
  A.add('patch1', C, C, (g) => {
    g.fillStyle = 'rgba(26,27,30,0.62)';
    g.fillRect(14, 30, 228, 196);
    g.strokeStyle = 'rgba(8,8,10,0.75)';
    g.lineWidth = 7;
    g.strokeRect(14, 30, 228, 196);
    g.fillStyle = 'rgba(70,70,74,0.25)';
    for (let i = 0; i < 400; i++) g.fillRect(rng.range(18, 238), rng.range(34, 222), 2, 2);
  });
  A.add('patch2', C, C, (g) => {
    g.fillStyle = 'rgba(96,98,102,0.5)';
    g.beginPath();
    g.moveTo(30, 20); g.lineTo(236, 34); g.lineTo(226, 230); g.lineTo(18, 216);
    g.fill();
    g.strokeStyle = 'rgba(10,10,12,0.6)';
    g.lineWidth = 5;
    g.stroke();
  });
  A.add('crack', C, C, (g) => {
    for (let i = 0; i < 4; i++) crack(g, rng, rng.range(40, 216), rng.range(40, 216), rng.int(10, 22), rng.range(1.5, 3.5), 'rgba(10,10,12,0.7)');
  });
  A.add('skid', C, C, (g) => {
    for (const x of [78, 178]) {
      const gr = g.createLinearGradient(0, 0, 0, C);
      gr.addColorStop(0, 'rgba(8,8,10,0)');
      gr.addColorStop(0.3, 'rgba(8,8,10,0.55)');
      gr.addColorStop(1, 'rgba(8,8,10,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x - 12, 0);
      g.bezierCurveTo(x - 12 + 16, 90, x - 12 - 8, 170, x - 12 + 22, C);
      g.lineTo(x + 12 + 22, C);
      g.bezierCurveTo(x + 12 - 8, 170, x + 12 + 16, 90, x + 12, 0);
      g.fill();
    }
  });
  A.add('rubber', C, C, (g) => {
    for (let i = 0; i < 70; i++) {
      const x = 128 + (rng.next() + rng.next() - 1) * 100;
      const y0 = rng.range(-40, 160), len = rng.range(60, 200);
      const gr = g.createLinearGradient(0, y0, 0, y0 + len);
      gr.addColorStop(0, 'rgba(6,6,8,0)');
      gr.addColorStop(0.25, 'rgba(6,6,8,0.3)');
      gr.addColorStop(1, 'rgba(6,6,8,0)');
      g.fillStyle = gr;
      g.fillRect(x, y0, rng.range(3, 8), len);
    }
  });
  A.add('arrow', C, C, (g) => {
    g.fillStyle = 'rgba(232,230,220,0.9)';
    g.beginPath();
    g.moveTo(128, 14); g.lineTo(196, 110); g.lineTo(152, 110); g.lineTo(152, 242); g.lineTo(104, 242); g.lineTo(104, 110); g.lineTo(60, 110);
    g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${rng.range(0.3, 1)})`; g.fillRect(rng.range(40, 216), rng.range(0, 256), rng.range(1, 5), rng.range(1, 5)); }
    g.globalCompositeOperation = 'source-over';
  });
  A.add('bus', C, C, (g) => {
    g.fillStyle = 'rgba(222,178,60,0.9)';
    g.font = 'bold 96px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.save(); g.translate(128, 128); g.scale(1, 2.3); g.fillText('BUS', 0, 4); g.restore();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(0,0,0,${rng.range(0.3, 1)})`; g.fillRect(rng.range(0, 256), rng.range(0, 256), rng.range(1, 5), rng.range(1, 5)); }
    g.globalCompositeOperation = 'source-over';
  });
  A.add('leaves', C, C, (g) => {
    for (let i = 0; i < 90; i++) {
      g.fillStyle = rgb(rng.range(120, 190), rng.range(90, 140), rng.range(30, 60), 0.75);
      g.beginPath();
      g.ellipse(128 + (rng.next() + rng.next() - 1) * 110, 128 + (rng.next() + rng.next() - 1) * 110, 5, 2.5, rng.range(0, 3), 0, TAU);
      g.fill();
    }
  });
  A.add('slab', C, C, (g) => {
    g.fillStyle = 'rgb(214,212,206)';
    g.fillRect(6, 0, C - 12, C);
    g.fillStyle = 'rgba(90,90,90,0.5)';
    for (let y = 0; y < C; y += 64) g.fillRect(6, y, C - 12, 3);
    for (let i = 0; i < 500; i++) { g.fillStyle = grey(rng.range(150, 240), 0.5); g.fillRect(rng.range(6, C - 8), rng.range(0, C), 2, 2); }
  });
  const map = toTexture(A.c, { repeat: false });
  return { map, rects: A.rects };
}

// --------------------------------------------------------------- facades ----
// Window mask: white where the glass is, black on the wall, for one
// facade tile of 4 bays by 4 floors (same layout as the facade picture).
// Which windows are lit, and what the room behind looks like, is decided
// per window in the facade shader (see nightlights.js), so the mask is
// small and the same for every building of a style. `bars` adds the
// mullion (and transom) lines that split each pane.
// The old lit-window picture drew from the shared random stream; the
// same draws are still taken here so every texture painted after this
// one (and so the daytime look) stays exactly as it was.
function windowMask(rng, nx, ny, rectFn, frac, rowRuns, bars) {
  for (let iy = 0; iy < ny; iy++) {
    const rowOn = rowRuns ? rng.chance(0.55) : true;
    let run = 0;
    for (let ix = 0; ix < nx; ix++) {
      let on;
      if (rowRuns) {
        if (run > 0) { on = true; run--; } else {
          on = rowOn && rng.chance(frac);
          if (on) run = rng.int(0, 3);
        }
      } else on = rng.chance(frac);
      if (!on) continue;
      rng.range(0.5, 1); rng.next();
      if (rng.chance(0.5)) rng.range(0.1, 0.5);
      else { rng.range(0, 0.6); }
    }
  }
  const size = 128, cw = size / 4;
  const c = canvas(size);
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  for (let iy = 0; iy < 4; iy++) {
    for (let ix = 0; ix < 4; ix++) {
      const r = rectFn(ix, iy);
      const x = ix * cw + r[0] * cw, y = iy * cw + r[1] * cw, w = r[2] * cw, h = r[3] * cw;
      g.fillStyle = '#fff';
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgb(40,40,40)';
      if (bars & 1) g.fillRect(ix * cw + cw / 2 - 0.75, y, 1.5, h);
      if (bars & 2) g.fillRect(x, y + h * 0.48, w, 1.2);
    }
  }
  return toTexture(c, { aniso: 4 });
}

// Rooms seen through lit windows at night: one shared 4 x 2 atlas of
// small pictures, each covering one window cell (a bay by a floor).
// 0 warm room, 1 warm with blinds, 2 cool office, 3 dark room lit by a
// television, 4 curtains half drawn, 5 cool blinds, 6 warm white with a
// ceiling lamp, 7 dim amber (a hall or a night light).
export function makeWindowAtlas(seed = 1) {
  const rng = createRng(seed);
  const T = 64, c = canvas(T * 4, T * 2);
  const g = c.getContext('2d');
  const tile = (i, fn) => {
    g.save();
    g.translate((i % 4) * T, Math.floor(i / 4) * T);
    g.beginPath();
    g.rect(0, 0, T, T);
    g.clip();
    fn(g);
    g.restore();
  };
  const vgrad = (top, bottom) => {
    const gr = g.createLinearGradient(0, 0, 0, T);
    gr.addColorStop(0, top);
    gr.addColorStop(1, bottom);
    g.fillStyle = gr;
    g.fillRect(0, 0, T, T);
  };
  const glow = (x, y, r, col) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, T, T);
  };
  const furniture = (col) => {
    g.fillStyle = col;
    for (let i = 0; i < 3; i++) {
      const w = rng.range(8, 22), h = rng.range(6, 20);
      g.fillRect(rng.range(0, T - w), T * 0.86 - h, w, h + T);
    }
  };
  const slats = (col, from) => {
    g.fillStyle = col;
    for (let y = from; y < T; y += 4) g.fillRect(0, y, T, 2);
  };
  tile(0, () => { vgrad('rgb(255,196,120)', 'rgb(170,96,44)'); glow(T * 0.7, T * 0.25, 26, 'rgba(255,236,190,0.9)'); furniture('rgba(40,18,8,0.7)'); });
  tile(1, () => { vgrad('rgb(255,190,110)', 'rgb(190,110,52)'); slats('rgba(60,26,8,0.55)', T * 0.28); });
  tile(2, () => {
    vgrad('rgb(214,236,255)', 'rgb(120,150,190)');
    g.fillStyle = 'rgba(245,252,255,0.95)';
    g.fillRect(0, T * 0.14, T, 3);
    g.fillStyle = 'rgba(20,30,46,0.6)';
    g.fillRect(0, T * 0.66, T, T);
    for (let x = 4; x < T; x += 16) { g.fillStyle = 'rgba(150,200,255,0.8)'; g.fillRect(x, T * 0.58, 7, 5); }
  });
  tile(3, () => { vgrad('rgb(14,22,52)', 'rgb(8,10,26)'); glow(T * 0.4, T * 0.62, 30, 'rgba(110,150,255,1)'); glow(T * 0.4, T * 0.62, 10, 'rgba(200,220,255,0.8)'); furniture('rgba(4,6,16,0.8)'); });
  tile(4, () => {
    vgrad('rgb(255,206,140)', 'rgb(200,124,64)');
    g.fillStyle = 'rgba(150,60,30,0.75)';
    g.fillRect(0, 0, T * 0.3, T);
    g.fillRect(T * 0.72, 0, T * 0.28, T);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    for (let x = 2; x < T * 0.3; x += 5) g.fillRect(x, 0, 1, T);
  });
  tile(5, () => { vgrad('rgb(206,226,255)', 'rgb(130,156,200)'); slats('rgba(30,40,60,0.5)', 0); });
  tile(6, () => { vgrad('rgb(255,238,214)', 'rgb(196,160,120)'); glow(T * 0.5, T * 0.1, 30, 'rgba(255,250,236,1)'); furniture('rgba(50,34,20,0.6)'); });
  tile(7, () => { vgrad('rgb(150,86,34)', 'rgb(70,34,12)'); glow(T * 0.3, T * 0.5, 22, 'rgba(255,170,80,0.8)'); });
  const t = toTexture(c, { repeat: false, aniso: 2 });
  return t;
}

// Roughness (green) and metalness (blue) picture drawn with rect lists.
function rmCanvas(size, baseRough, baseMetal) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const set = (rough, metal) => { g.fillStyle = rgb(0, rough * 255, metal * 255); };
  set(baseRough, baseMetal);
  g.fillRect(0, 0, size, size);
  return { c, g, set };
}

function makeGlassFacade(rng, N) {
  const S = 512, n = 4, cw = S / n;
  const c = canvas(S);
  const g = c.getContext('2d');
  const rm = rmCanvas(256, 0.5, 0.2);
  const k = 256 / S;
  const sp = 26; // spandrel band at each floor
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = x * cw, py = y * cw;
      const v = rng.range(168, 214);
      const gr = g.createLinearGradient(0, py + sp, 0, py + cw);
      gr.addColorStop(0, grey(v + 28));
      gr.addColorStop(1, grey(v - 26));
      g.fillStyle = gr;
      g.fillRect(px, py + sp, cw, cw - sp);
      if (rng.chance(0.22)) {
        g.fillStyle = grey(236, 0.5);
        g.fillRect(px + 4, py + sp, cw - 8, rng.range(14, 60));
      }
      g.fillStyle = grey(rng.range(96, 122));
      g.fillRect(px, py, cw, sp);
      rm.set(0.07, 1);
      rm.g.fillRect(px * k, (py + sp) * k, cw * k, (cw - sp) * k);
      rm.set(0.22, 0.85);
      rm.g.fillRect(px * k, py * k, cw * k, sp * k);
    }
  }
  g.fillStyle = grey(236);
  rm.set(0.45, 0.6);
  for (let i = 0; i < n; i++) {
    g.fillRect(i * cw - 2.5, 0, 5, S);
    g.fillRect(i * cw + cw / 2 - 1, 0, 2, S);
    g.fillRect(0, i * cw + sp - 1.5, S, 3);
    rm.g.fillRect((i * cw - 2.5) * k, 0, 5 * k, 256);
  }
  g.fillRect(S - 2.5, 0, 2.5, S);
  grain(c, N.coarse, 512, 0.1, rng);
  const emissiveMap = windowMask(rng, 8, 8, () => [0.02, sp / cw + 0.02, 0.96, 1 - sp / cw - 0.03], 0.4, true, 1);
  const rmTex = toTexture(rm.c, { srgb: false, aniso: 4 });
  return { map: toTexture(c), emissiveMap, roughnessMap: rmTex, metalnessMap: rmTex, normalMap: normalFromHeight(heightOf(c), S, 0.7) };
}

function brickPattern(g, S, rng, bw, bh) {
  g.fillStyle = grey(150);
  g.fillRect(0, 0, S, S);
  for (let y = 0, row = 0; y < S; y += bh, row++) {
    const off = row % 2 ? bw / 2 : 0;
    for (let x = -bw; x < S; x += bw) {
      const v = rng.range(178, 240);
      const t = rng.range(-10, 10);
      g.fillStyle = rgb(v + t, v, v - t);
      g.fillRect(x + off + 0.6, y + 0.6, bw - 1.2, bh - 1.2);
    }
  }
}

function makeBrickFacade(rng, N) {
  const S = 512, n = 4, cw = S / n;
  const c = canvas(S);
  const g = c.getContext('2d');
  brickPattern(g, S, rng, 16, 6.4);
  const win = [0.26, 0.2, 0.48, 0.58];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = x * cw + win[0] * cw, py = y * cw + win[1] * cw, w = win[2] * cw, h = win[3] * cw;
      // Stone lintel and sill.
      g.fillStyle = grey(244);
      g.fillRect(px - 6, py - 10, w + 12, 10);
      g.fillRect(px - 8, py + h, w + 16, 7);
      g.fillStyle = grey(110, 0.5);
      g.fillRect(px - 8, py + h + 7, w + 16, 3);
      // Frame and glass.
      g.fillStyle = grey(250);
      g.fillRect(px, py, w, h);
      const v = rng.range(46, 86);
      const gr = g.createLinearGradient(0, py, 0, py + h);
      gr.addColorStop(0, rgb(v + 30, v + 38, v + 50));
      gr.addColorStop(1, rgb(v - 8, v, v + 10));
      g.fillStyle = gr;
      g.fillRect(px + 4, py + 4, w - 8, h - 8);
      if (rng.chance(0.4)) {
        g.fillStyle = rgb(226, 220, 204, 0.85);
        g.fillRect(px + 4, py + 4, w - 8, rng.range(8, h * 0.6));
      }
      g.fillStyle = grey(250);
      g.fillRect(px + w / 2 - 1.5, py, 3, h);
      g.fillRect(px, py + h * 0.48, w, 3);
    }
  }
  // Soot streaks under the sills.
  for (let i = 0; i < 16; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    const gr = g.createLinearGradient(0, y, 0, y + 50);
    gr.addColorStop(0, 'rgba(40,30,26,0.16)');
    gr.addColorStop(1, 'rgba(40,30,26,0)');
    g.fillStyle = gr;
    g.fillRect(x, y, rng.range(4, 12), 50);
  }
  grain(c, N.fine, 512, 0.16, rng, 0.08);
  grain(c, N.coarse, 512, 0.14, rng);
  const emissiveMap = windowMask(rng, 8, 8, () => [win[0] + 0.03, win[1] + 0.03, win[2] - 0.06, win[3] - 0.06], 0.36, false, 3);
  return { map: toTexture(c), emissiveMap, normalMap: normalFromHeight(heightOf(c), S, 1.6) };
}

function makeConcreteFacade(rng, N) {
  const S = 512, n = 4, cw = S / n;
  const c = canvas(S);
  const g = c.getContext('2d');
  g.fillStyle = grey(226);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 30; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    const gr = g.createLinearGradient(0, y, 0, y + 46);
    gr.addColorStop(0, 'rgba(60,56,50,0.2)');
    gr.addColorStop(1, 'rgba(60,56,50,0)');
    g.fillStyle = gr;
    g.fillRect(x, y, rng.range(3, 10), 46);
  }
  grain(c, N.fine, 512, 0.14, rng, 0.07);
  grain(c, N.coarse, 512, 0.14, rng);
  const rm = rmCanvas(256, 0.85, 0);
  const k = 256 / S;
  const band = [0.2, 0.52]; // ribbon window: top offset and height
  for (let y = 0; y < n; y++) {
    const py = y * cw + band[0] * cw, h = band[1] * cw;
    g.fillStyle = grey(120);
    g.fillRect(0, py - 3, S, h + 6);
    for (let x = 0; x < n; x++) {
      const v = rng.range(52, 92);
      const gr = g.createLinearGradient(0, py, 0, py + h);
      gr.addColorStop(0, rgb(v + 34, v + 42, v + 52));
      gr.addColorStop(1, rgb(v - 6, v, v + 8));
      g.fillStyle = gr;
      g.fillRect(x * cw + 3, py, cw - 6, h);
      if (rng.chance(0.35)) {
        g.fillStyle = rgb(222, 222, 214, 0.8);
        g.fillRect(x * cw + 3, py, cw - 6, rng.range(8, h * 0.7));
      }
      g.fillStyle = grey(150);
      g.fillRect(x * cw + cw / 2 - 1, py, 2, h);
    }
    rm.set(0.12, 0.7);
    rm.g.fillRect(0, py * k, 256, h * k);
    // Panel joint and drip shadow under the ribbon.
    g.fillStyle = grey(120, 0.45);
    g.fillRect(0, y * cw, S, 2);
    g.fillStyle = grey(60, 0.2);
    g.fillRect(0, py + h + 3, S, 6);
  }
  g.fillStyle = grey(140, 0.5);
  for (let x = 0; x < n; x++) g.fillRect(x * cw, 0, 2, S);
  const emissiveMap = windowMask(rng, 8, 8, () => [0.03, band[0] + 0.01, 0.94, band[1] - 0.02], 0.42, true, 1);
  const rmTex = toTexture(rm.c, { srgb: false, aniso: 4 });
  return { map: toTexture(c), emissiveMap, roughnessMap: rmTex, metalnessMap: rmTex, normalMap: normalFromHeight(heightOf(c), S, 1.2) };
}

function makeStuccoFacade(rng, N) {
  const S = 512, n = 4, cw = S / n;
  const c = canvas(S);
  const g = c.getContext('2d');
  g.fillStyle = grey(240);
  g.fillRect(0, 0, S, S);
  grain(c, N.fine, 512, 0.1, rng, 0.05);
  grain(c, N.coarse, 512, 0.1, rng);
  const win = [0.2, 0.2, 0.6, 0.66];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const px = x * cw + win[0] * cw, py = y * cw + win[1] * cw, w = win[2] * cw, h = win[3] * cw;
      g.fillStyle = grey(252);
      g.fillRect(px - 3, py - 3, w + 6, h + 3);
      const v = rng.range(56, 96);
      const gr = g.createLinearGradient(0, py, 0, py + h);
      gr.addColorStop(0, rgb(v + 36, v + 48, v + 60));
      gr.addColorStop(1, rgb(v - 10, v, v + 8));
      g.fillStyle = gr;
      g.fillRect(px, py, w, h);
      if (rng.chance(0.5)) {
        // Curtains drawn part way.
        g.fillStyle = rgb(240, 232, 214, 0.9);
        const k = rng.range(0.2, 0.5);
        g.fillRect(px, py, w * k, h);
        if (rng.chance(0.5)) g.fillRect(px + w * (1 - k), py, w * k, h);
      }
      g.fillStyle = grey(250);
      g.fillRect(px + w / 2 - 1.5, py, 3, h);
      // Recessed: the reveal throws a shadow at the top and one side;
      // a sill stands out below with its own shadow.
      g.fillStyle = grey(20, 0.42);
      g.fillRect(px, py, w, 6);
      g.fillRect(px, py + 6, 4, h - 6);
      g.fillStyle = grey(255);
      g.fillRect(px - 7, py + h, w + 14, 6);
      g.fillStyle = grey(40, 0.32);
      g.fillRect(px - 7, py + h + 6, w + 14, 5);
    }
    // Floor slab line with a soft shadow below it.
    g.fillStyle = grey(255);
    g.fillRect(0, y * cw + 0.9 * cw, S, 0.1 * cw);
    g.fillStyle = grey(40, 0.22);
    g.fillRect(0, y * cw, S, 8);
  }
  const emissiveMap = windowMask(rng, 8, 8, () => [win[0] + 0.01, win[1] + 0.01, win[2] - 0.02, win[3] - 0.03], 0.38, false, 1);
  return { map: toTexture(c), emissiveMap, normalMap: normalFromHeight(heightOf(c), S, 1.4) };
}

// Low-rise Miami stucco (Little Havana and the like): tall windows with
// round arches, louvred shutters, moulded surrounds and sills, some with
// a little iron balconette. Four bays by four floors like the others.
function makeHavanaFacade(rng, N) {
  const S = 512, n = 4, cw = S / n;
  const c = canvas(S), e = canvas(S);
  const g = c.getContext('2d'), ge = e.getContext('2d');
  g.fillStyle = grey(238);
  g.fillRect(0, 0, S, S);
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, S, S);
  grain(c, N.fine, 512, 0.12, rng, 0.05);
  grain(c, N.coarse, 512, 0.12, rng);
  const w = cw * 0.36, top = cw * 0.2, bot = cw * 0.84, r = w / 2;
  const arch = (ctx, x, y0, y1, rr) => {
    ctx.beginPath();
    ctx.moveTo(x - rr, y1);
    ctx.lineTo(x - rr, y0 + rr);
    ctx.arc(x, y0 + rr, rr, Math.PI, 0);
    ctx.lineTo(x + rr, y1);
    ctx.closePath();
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const mx = x * cw + cw / 2, y0 = y * cw + top, y1 = y * cw + bot;
      const closed = rng.chance(0.18);
      // Moulded surround.
      g.fillStyle = grey(252);
      arch(g, mx, y0 - 6, y1, r + 6);
      g.fill();
      // Glass, darker at the top of the arch.
      const v = rng.range(50, 86);
      const gr = g.createLinearGradient(0, y0, 0, y1);
      gr.addColorStop(0, rgb(v - 12, v - 4, v + 6));
      gr.addColorStop(0.4, rgb(v + 30, v + 40, v + 52));
      gr.addColorStop(1, rgb(v - 6, v, v + 8));
      g.fillStyle = gr;
      arch(g, mx, y0, y1, r);
      g.fill();
      if (!closed) {
        ge.fillStyle = '#fff';
        arch(ge, mx, y0 + 2, y1 - 2, r - 2);
        ge.fill();
      }
      // Reveal shadow, glazing bars.
      g.strokeStyle = grey(20, 0.45);
      g.lineWidth = 5;
      arch(g, mx, y0 + 2, y1 + 3, r - 2.5);
      g.stroke();
      g.fillStyle = grey(245);
      g.fillRect(mx - 1.5, y0 + r, 3, y1 - y0 - r);
      g.fillRect(mx - r, y0 + r, w, 3);
      g.fillRect(mx - r, y0 + r + (y1 - y0 - r) * 0.5, w, 2.5);
      // Louvred shutters (open beside the window, or closed over it).
      const sw = w * 0.5, tone = rng.range(96, 140);
      const shut = (sx, sy, ww, hh) => {
        g.fillStyle = rgb(tone * 0.8, tone, tone * 0.94);
        g.fillRect(sx, sy, ww, hh);
        g.fillStyle = grey(30, 0.4);
        for (let k = sy + 3; k < sy + hh; k += 4) g.fillRect(sx + 2, k, ww - 4, 1.5);
        g.strokeStyle = grey(40, 0.5);
        g.lineWidth = 1.5;
        g.strokeRect(sx + 0.75, sy + 0.75, ww - 1.5, hh - 1.5);
      };
      if (closed) {
        shut(mx - r, y0 + r * 0.7, r, y1 - y0 - r * 0.7);
        shut(mx, y0 + r * 0.7, r, y1 - y0 - r * 0.7);
      } else {
        shut(mx - r - 8 - sw, y0 + r * 0.6, sw, y1 - y0 - r * 0.6);
        shut(mx + r + 8, y0 + r * 0.6, sw, y1 - y0 - r * 0.6);
      }
      // Sill and its shadow.
      g.fillStyle = grey(255);
      g.fillRect(mx - r - 9, y1, w + 18, 6);
      g.fillStyle = grey(40, 0.3);
      g.fillRect(mx - r - 9, y1 + 6, w + 18, 6);
      if (rng.chance(0.35)) {
        // Iron balconette over the lower part of the window.
        g.fillStyle = grey(34);
        const bt = y1 - (y1 - y0) * 0.3;
        g.fillRect(mx - r - 4, bt, w + 8, 2.5);
        g.fillRect(mx - r - 4, y1 - 2, w + 8, 2);
        for (let k = mx - r - 2; k < mx + r + 4; k += 5) g.fillRect(k, bt, 1.5, y1 - bt);
      }
    }
    // Floor band with a soft shadow below it, and grime from the band.
    g.fillStyle = grey(250);
    g.fillRect(0, y * cw + 0.93 * cw, S, 0.07 * cw);
    g.fillStyle = grey(40, 0.2);
    g.fillRect(0, y * cw, S, 7);
  }
  for (let i = 0; i < 22; i++) {
    const x = rng.range(0, S), y = rng.range(0, S);
    const gr = g.createLinearGradient(0, y, 0, y + 60);
    gr.addColorStop(0, 'rgba(70,60,50,0.14)');
    gr.addColorStop(1, 'rgba(70,60,50,0)');
    g.fillStyle = gr;
    g.fillRect(x, y, rng.range(3, 10), 60);
  }
  return { map: toTexture(c), emissiveMap: toTexture(e, { aniso: 4 }), normalMap: normalFromHeight(heightOf(c), S, 1.5) };
}

function makeSiding(rng, N) {
  const S = 256, boards = 12, bh = S / boards;
  const c = canvas(S);
  const g = c.getContext('2d');
  for (let i = 0; i < boards; i++) {
    const v = rng.range(226, 246);
    const gr = g.createLinearGradient(0, i * bh, 0, (i + 1) * bh);
    gr.addColorStop(0, grey(v + 8));
    gr.addColorStop(0.82, grey(v - 12));
    gr.addColorStop(0.86, grey(120));
    gr.addColorStop(1, grey(96));
    g.fillStyle = gr;
    g.fillRect(0, i * bh, S, bh);
    g.fillStyle = grey(150, 0.5);
    g.fillRect(rng.range(0, S), i * bh, 1.5, bh - 3);
  }
  grain(c, N.fine, 512, 0.1, rng, 0.05);
  return { map: toTexture(c) };
}

function makeCorrugated(rng, N) {
  const S = 256, ribs = 16, rw = S / ribs;
  const c = canvas(S);
  const g = c.getContext('2d');
  for (let i = 0; i < ribs; i++) {
    const gr = g.createLinearGradient(i * rw, 0, (i + 1) * rw, 0);
    gr.addColorStop(0, grey(150));
    gr.addColorStop(0.35, grey(250));
    gr.addColorStop(0.7, grey(206));
    gr.addColorStop(1, grey(150));
    g.fillStyle = gr;
    g.fillRect(i * rw, 0, rw, S);
  }
  // Rust and grime running down from the top edge and sheet seams.
  for (let i = 0; i < 26; i++) {
    const x = rng.range(0, S), len = rng.range(40, 200);
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, 'rgba(120,70,36,0.3)');
    gr.addColorStop(1, 'rgba(120,70,36,0)');
    g.fillStyle = gr;
    g.fillRect(x, 0, rng.range(2, 9), len);
  }
  g.fillStyle = grey(70, 0.55);
  g.fillRect(0, 0, S, 3);
  g.fillRect(0, S - 2, S, 2);
  g.fillStyle = grey(90, 0.4);
  g.fillRect(0, 0, 2, S);
  g.fillRect(S / 2, 0, 2, S);
  grain(c, N.coarse, 512, 0.2, rng, 0.05);
  return { map: toTexture(c) };
}

function makeRoofing(rng, N) {
  const S = 256, rows = 10, rh = S / rows, sw = 20;
  const c = canvas(S);
  const g = c.getContext('2d');
  for (let r = 0; r < rows; r++) {
    for (let x = -sw; x < S + sw; x += sw) {
      const px = x + (r % 2 ? sw / 2 : 0);
      const v = rng.range(180, 246);
      const gr = g.createLinearGradient(0, r * rh, 0, (r + 1) * rh);
      gr.addColorStop(0, grey(v * 0.7));
      gr.addColorStop(0.25, grey(v));
      gr.addColorStop(1, grey(v * 0.92));
      g.fillStyle = gr;
      g.fillRect(px + 0.5, r * rh, sw - 1, rh);
      if (px < 0) g.fillRect(px + S + 0.5, r * rh, sw - 1, rh);
    }
  }
  grain(c, N.fine, 512, 0.2, rng, 0.1);
  return { map: toTexture(c) };
}

// One storey of shopfronts: four bays, 16 m by 4 m.
function makeShopfront(rng, N) {
  const W = 1024, H = 256, bw = W / 4;
  const c = canvas(W, H), e = canvas(W, H);
  const g = c.getContext('2d'), ge = e.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, W, H);
  g.fillStyle = grey(232);
  g.fillRect(0, 0, W, H);
  const rm = rmCanvas(256, 0.85, 0);
  const kx = 256 / W, ky = 256 / H;
  const fascia = 50, plinth = 26;
  const glass = (x, y, w, h, lit, interior) => {
    const v = rng.range(44, 70);
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, rgb(v + 40, v + 52, v + 62));
    gr.addColorStop(0.5, rgb(v, v + 6, v + 12));
    gr.addColorStop(1, rgb(v - 14, v - 10, v - 4));
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
    rm.set(0.1, 0.5);
    rm.g.fillRect(x * kx, y * ky, w * kx, h * ky);
    const warm = rng.chance(0.9);
    if (lit) {
      const eg = ge.createLinearGradient(0, y, 0, y + h);
      eg.addColorStop(0, warm ? 'rgb(255,200,128)' : 'rgb(176,206,246)');
      eg.addColorStop(1, warm ? 'rgb(150,96,50)' : 'rgb(80,104,140)');
      ge.fillStyle = eg;
      ge.fillRect(x, y, w, h);
    }
    if (interior) {
      // Shelves and goods seen through the glass.
      for (let i = 0; i < 3; i++) {
        const sy = y + h * (0.3 + i * 0.22);
        g.fillStyle = grey(30, 0.45);
        g.fillRect(x + 6, sy, w - 12, 3);
        for (let px = x + 8; px < x + w - 16; px += rng.range(9, 20)) {
          const col = rgb(rng.range(60, 230), rng.range(60, 210), rng.range(60, 200), 0.55);
          const bh2 = rng.range(8, 20);
          g.fillStyle = col;
          g.fillRect(px, sy - bh2, rng.range(5, 12), bh2);
          if (lit) { ge.fillStyle = 'rgba(0,0,0,0.45)'; ge.fillRect(px, sy - bh2, 8, bh2 + 3); }
        }
      }
    }
  };
  for (let b = 0; b < 4; b++) {
    const x0 = b * bw;
    const lit = b !== 2;
    // Pilaster between shops.
    g.fillStyle = grey(206);
    g.fillRect(x0, 0, 12, H);
    g.fillRect(x0 + bw - 12, 0, 12, H);
    if (b === 1) {
      // Recessed door with side lights and a transom.
      glass(x0 + 18, fascia + 6, 70, H - fascia - plinth - 6, lit, true);
      glass(x0 + bw - 88, fascia + 6, 70, H - fascia - plinth - 6, lit, true);
      g.fillStyle = grey(70);
      g.fillRect(x0 + 94, fascia + 4, 68, H - fascia - 4);
      glass(x0 + 100, fascia + 40, 56, H - fascia - 62, lit, false);
      glass(x0 + 100, fascia + 8, 56, 26, lit, false);
      g.fillStyle = grey(220);
      g.fillRect(x0 + 146, fascia + 120, 5, 26);
    } else {
      glass(x0 + 18, fascia + 6, bw - 36, H - fascia - plinth - 6, lit, b !== 3);
      g.fillStyle = grey(90);
      g.fillRect(x0 + bw / 2 - 2, fascia + 6, 4, H - fascia - plinth - 6);
      if (b === 3) {
        // Roller shutter half down.
        g.fillStyle = grey(176);
        g.fillRect(x0 + 18, fascia + 6, bw - 36, 70);
        g.fillStyle = grey(120, 0.6);
        for (let y = fascia + 10; y < fascia + 76; y += 7) g.fillRect(x0 + 18, y, bw - 36, 2);
        ge.fillStyle = '#000';
        ge.fillRect(x0 + 18, fascia + 6, bw - 36, 70);
      }
    }
    // Frame, plinth and fascia.
    g.strokeStyle = grey(60);
    g.lineWidth = 4;
    g.strokeRect(x0 + 16, fascia + 4, bw - 32, H - fascia - plinth - 2);
    g.fillStyle = grey(110);
    g.fillRect(x0 + 12, H - plinth, bw - 24, plinth);
    g.fillStyle = grey(150);
    g.fillRect(x0, 0, bw, fascia);
    g.fillStyle = grey(70, 0.5);
    g.fillRect(x0, fascia - 3, bw, 3);
  }
  g.fillStyle = grey(40, 0.35);
  g.fillRect(0, H - 6, W, 6);
  grain(c, N.fine, 512, 0.1, rng, 0.04);
  const rmTex = toTexture(rm.c, { srgb: false, aniso: 4 });
  return { map: toTexture(c), emissiveMap: toTexture(e, { aniso: 4 }), roughnessMap: rmTex, metalnessMap: rmTex };
}

// ----------------------------------------------------------- detail atlas ----
// Invented shop names: none is a real brand.
export const SHOP_NAMES = [
  ["MOLA'S BAKERY", '#f3e2c0', '#7a2e1a', 'serif'], ['TIDEWATER BOOKS', '#1f3a4a', '#f0e6c8', 'serif'],
  ['RUSTWATER HARDWARE', '#b5381f', '#fff4dc', 'sans-serif'], ['GULLWING CAFE', '#f6f1e4', '#2c5a6a', 'serif'],
  ['PALE SHORE SURF', '#27a3a8', '#fffbe8', 'sans-serif'], ['CINDER ROW TOOLS', '#30312f', '#f2b632', 'sans-serif'],
  ['FERNSIDE FLORIST', '#2f6b3f', '#fbe9ef', 'serif'], ['SALTYARD FISH CO', '#e8eef2', '#1d4f7a', 'sans-serif'],
  ['MARROW ST DELI', '#7c1f2b', '#f8e8c8', 'serif'], ['GLASSWELL OPTICS', '#f4f6f8', '#22303c', 'sans-serif'],
  ['BRINE & BARREL', '#3a2a1c', '#e8c27a', 'serif'], ['LANTERN NOODLES', '#c8321e', '#ffe9a8', 'sans-serif'],
  ['COPPER KETTLE', '#b0683a', '#fff3e0', 'serif'], ['HARBOUR PAWN', '#f2c230', '#1c1c1c', 'sans-serif'],
  ['NIGHTJAR RECORDS', '#1b1b2c', '#f25fa8', 'sans-serif'], ['VELA PHARMACY', '#ffffff', '#1e8a4c', 'sans-serif'],
  ['OTTER LAUNDRY', '#5aa9d6', '#ffffff', 'sans-serif'], ['DRIFT DINER', '#f6e9d0', '#c2372b', 'serif'],
  ['QUILL STATIONERS', '#2c3e2e', '#e9dfc0', 'serif'], ['HALYARD OUTFITTERS', '#d8d2c0', '#2d3a2a', 'sans-serif'],
  ['PICO TACOS', '#f08a24', '#3a1808', 'sans-serif'], ['EMBERLINE GRILL', '#201814', '#ff7a2e', 'serif'],
  ['MOTH & MOON TAILOR', '#2a2440', '#e6dcb8', 'serif'], ['ZEPHYR CYCLES', '#eaf2f0', '#d2452c', 'sans-serif'],
  ['KELP SUSHI', '#18332c', '#eaf6e2', 'sans-serif'], ['TIN WHISTLE PUB', '#3c2414', '#f0d48a', 'serif'],
  ['HERON SAVINGS', '#0f3050', '#dfe9f2', 'serif'], ['SUNDIAL WATCHES', '#f0ead8', '#6a4a1c', 'serif'],
  ['JUNIPER MARKET', '#3f7a3a', '#ffffff', 'sans-serif'], ['ANCHOR BARBER', '#ffffff', '#b02a2a', 'sans-serif'],
  ['MIRELA SHOES', '#f2d8de', '#5a2038', 'serif'], ['FOXGLOVE TEA', '#6a3f7a', '#f6ecd8', 'serif'],
];
const BILLBOARDS = [
  ['VISIT PALE SHORE', 'sun, sand, bad ideas', '#2aa6c8', '#ffe27a', '#fff'],
  ['GULLWING AIR TOURS', 'see it all from above', '#f4efe2', '#c2452b', '#22303c'],
  ['BRINE SODA', 'salty. fizzy. why not.', '#d23c2a', '#fff3d8', '#fff'],
  ['RADIO RUST 99.9', 'the sound of the island', '#1c1830', '#f25fa8', '#ffe27a'],
];

function fitText(g, text, w, h, family, weight = 'bold') {
  let px = h;
  g.font = `${weight} ${px}px ${family}`;
  const m = g.measureText(text).width;
  if (m > w) px = Math.max(6, (px * w) / m);
  g.font = `${weight} ${px | 0}px ${family}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
}

function makeDetails(rng, streetNames) {
  const A = createAtlas(1024);
  // Shop signs: lit box signs, so the same art goes on the glow layer.
  SHOP_NAMES.forEach(([name, bg, fg, family], i) => {
    A.add('sign' + i, 256, 64, (g, ge, w, h) => {
      for (const ctx of [g, ge]) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = fg;
        ctx.lineWidth = 3;
        ctx.strokeRect(5, 5, w - 10, h - 10);
        ctx.fillStyle = fg;
        fitText(ctx, name, w - 28, 34, family);
        ctx.fillText(name, w / 2, h / 2 + 2);
      }
      ge.fillStyle = 'rgba(0,0,0,0.3)';
      ge.fillRect(0, 0, w, h);
    });
  });
  BILLBOARDS.forEach(([title, sub, bg, accent, fg], i) => {
    A.add('bill' + i, 256, 128, (g, ge, w, h) => {
      for (const ctx of [g, ge]) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = accent;
        if (i === 0) { ctx.beginPath(); ctx.arc(200, 44, 26, 0, TAU); ctx.fill(); ctx.fillRect(0, 96, w, 32); }
        else if (i === 1) { ctx.beginPath(); ctx.moveTo(20, 96); ctx.lineTo(236, 60); ctx.lineTo(236, 72); ctx.lineTo(20, 108); ctx.fill(); }
        else if (i === 2) { for (let k = 0; k < 9; k++) { ctx.beginPath(); ctx.arc(24 + k * 26, 104 - (k % 3) * 9, 6 + (k % 2) * 3, 0, TAU); ctx.fill(); } }
        else { for (let k = 0; k < 16; k++) ctx.fillRect(12 + k * 15, 100 - Math.abs(Math.sin(k * 1.3)) * 30, 8, 60); }
        ctx.fillStyle = fg;
        fitText(ctx, title, w - 30, 34, 'sans-serif');
        ctx.fillText(title, w / 2, 36);
        fitText(ctx, sub, w - 50, 17, 'serif', 'italic');
        ctx.fillText(sub, w / 2, 68);
      }
      ge.fillStyle = 'rgba(0,0,0,0.5)';
      ge.fillRect(0, 0, w, h);
    });
  });
  // Street name plates.
  streetNames.forEach((name, i) => {
    A.add('plate' + i, 128, 32, (g, ge, w, h) => {
      g.fillStyle = '#1f5a3c';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f4f4ec';
      g.lineWidth = 2;
      g.strokeRect(2, 2, w - 4, h - 4);
      g.fillStyle = '#f4f4ec';
      fitText(g, name, w - 12, 19, 'sans-serif');
      g.fillText(name, w / 2, h / 2 + 1);
      ge.fillStyle = '#000';
    });
  });
  // House window: white trim, two sashes. Lit warm at night.
  const houseWindow = (lit, curtain) => (g, ge, w, h) => {
    g.fillStyle = '#f6f4ee';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c9c6bd';
    g.fillRect(0, h - 10, w, 10);
    const gr = g.createLinearGradient(0, 12, 0, h - 16);
    gr.addColorStop(0, '#7f96ac');
    gr.addColorStop(1, '#2c3a48');
    g.fillStyle = gr;
    g.fillRect(12, 12, w - 24, h - 30);
    if (curtain) {
      g.fillStyle = 'rgba(240,232,214,0.92)';
      g.fillRect(12, 12, 26, h - 30);
      g.fillRect(w - 38, 12, 26, h - 30);
    }
    g.fillStyle = '#f6f4ee';
    g.fillRect(w / 2 - 3, 12, 6, h - 30);
    g.fillRect(12, h / 2 - 6, w - 24, 5);
    if (lit) {
      ge.fillStyle = 'rgb(255,204,132)';
      ge.fillRect(12, 12, w - 24, h - 30);
      ge.fillStyle = 'rgba(0,0,0,0.5)';
      ge.fillRect(12, 12, w - 24, 20);
      ge.fillStyle = '#000';
      ge.fillRect(w / 2 - 3, 12, 6, h - 30);
      ge.fillRect(12, h / 2 - 6, w - 24, 5);
    }
  };
  A.add('hwin0', 128, 128, houseWindow(true, true));
  A.add('hwin1', 128, 128, houseWindow(false, false));
  A.add('hwin2', 128, 128, houseWindow(true, false));
  A.add('door', 64, 128, (g, ge, w, h) => {
    g.fillStyle = '#f6f4ee';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b8b0a0';
    g.fillRect(6, 6, w - 12, h - 6);
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.lineWidth = 2;
    g.strokeRect(13, 14, w - 26, 40);
    g.strokeRect(13, 64, w - 26, 50);
    g.fillStyle = '#3a4654';
    g.fillRect(17, 18, w - 34, 22);
    g.fillStyle = '#d8c070';
    g.fillRect(w - 18, 66, 5, 5);
    ge.fillStyle = 'rgb(200,160,100)';
    ge.fillRect(17, 18, w - 34, 22);
  });
  A.add('garage', 128, 128, (g, ge, w, h) => {
    g.fillStyle = '#f6f4ee';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d8d6d0';
    g.fillRect(6, 8, w - 12, h - 8);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 8; y < h; y += 30) g.fillRect(6, y, w - 12, 3);
    for (let x = 6 + (w - 12) / 4; x < w - 8; x += (w - 12) / 4) g.fillRect(x, 8, 2, h - 8);
  });
  A.add('roller', 128, 128, (g, ge, w, h) => {
    g.fillStyle = '#5c5f63';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b9bcc0';
    g.fillRect(8, 10, w - 16, h - 10);
    for (let y = 10; y < h; y += 6) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(8, y + 4, w - 16, 2);
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.fillRect(8, y, w - 16, 1);
    }
    g.fillStyle = '#d9a833';
    for (let x = 8; x < w - 8; x += 16) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 8, h); g.lineTo(x + 16, h - 8); g.lineTo(x + 8, h - 8); g.fill(); }
    g.fillStyle = 'rgba(90,50,24,0.25)';
    for (let i = 0; i < 8; i++) g.fillRect(rng.range(8, w - 12), rng.range(10, 60), rng.range(2, 5), rng.range(20, 60));
  });
  A.add('cdoor', 128, 128, (g, ge, w, h) => {
    // Shipping container end: two doors with locking bars.
    g.fillStyle = '#e8e8e8';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 3;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(w / 2 - 1.5, 3, 3, h - 6);
    g.fillStyle = '#9a9a9a';
    for (const x of [22, 46, 80, 104]) g.fillRect(x, 6, 4, h - 12);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 16; y < h; y += 14) g.fillRect(4, y, w - 8, 2);
  });
  // Picket fence: see-through between the pales.
  A.add('fence', 128, 64, (g, ge, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f2f0e8';
    for (let x = 2; x < w; x += 16) {
      g.fillRect(x, 10, 11, h - 10);
      g.beginPath(); g.moveTo(x, 10); g.lineTo(x + 5.5, 1); g.lineTo(x + 11, 10); g.fill();
    }
    g.fillRect(0, 20, w, 6);
    g.fillRect(0, 46, w, 6);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 12; x < w; x += 16) g.fillRect(x, 10, 1.5, h - 10);
  });
  const roundSign = (bg, ring, text, fg, shape = 'circle') => (g, ge, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = ring;
    g.beginPath();
    if (shape === 'oct') {
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; g.lineTo(w / 2 + Math.cos(a) * 31, h / 2 + Math.sin(a) * 31); }
    } else if (shape === 'rect') g.rect(8, 2, w - 16, h - 4);
    else g.arc(w / 2, h / 2, 30, 0, TAU);
    g.fill();
    g.fillStyle = bg;
    g.beginPath();
    if (shape === 'oct') {
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; g.lineTo(w / 2 + Math.cos(a) * 27, h / 2 + Math.sin(a) * 27); }
    } else if (shape === 'rect') g.rect(12, 6, w - 24, h - 12);
    else g.arc(w / 2, h / 2, 23, 0, TAU);
    g.fill();
    g.fillStyle = fg;
    fitText(g, text, w - 28, shape === 'rect' ? 30 : 20, 'sans-serif');
    g.fillText(text, w / 2, h / 2 + 2);
  };
  A.add('stop', 64, 64, roundSign('#c42a22', '#f4f4f0', 'STOP', '#fff', 'oct'));
  // Chain-link fence for yards.
  A.add('mesh', 128, 64, (g, ge, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(170,176,180,0.95)';
    g.lineWidth = 1.6;
    for (let k = -h; k < w + h; k += 9) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke();
      g.beginPath(); g.moveTo(k + h, 0); g.lineTo(k, h); g.stroke();
    }
    g.fillStyle = '#8f969b';
    g.fillRect(0, 0, w, 4);
    g.fillRect(0, h - 3, w, 3);
    g.fillRect(0, 0, 4, h);
  });
  A.add('bike', 128, 64, (g, ge, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#1c1c1e';
    g.lineWidth = 4;
    g.beginPath(); g.arc(26, 40, 20, 0, TAU); g.stroke();
    g.beginPath(); g.arc(100, 40, 20, 0, TAU); g.stroke();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4.5;
    g.beginPath();
    g.moveTo(26, 40); g.lineTo(50, 14); g.lineTo(88, 14); g.lineTo(100, 40);
    g.moveTo(50, 14); g.lineTo(62, 40); g.lineTo(88, 14);
    g.moveTo(26, 40); g.lineTo(62, 40);
    g.stroke();
    g.strokeStyle = '#1c1c1e';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(42, 8); g.lineTo(58, 8); g.moveTo(86, 16); g.lineTo(84, 4); g.lineTo(96, 4); g.stroke();
  });
  A.add('speed', 64, 64, roundSign('#f6f6f2', '#c42a22', '50', '#111'));
  A.add('park', 64, 64, roundSign('#1f55a8', '#f4f4f0', 'P', '#fff', 'rect'));
  A.add('busstop', 64, 64, roundSign('#f2c230', '#1c1c1c', 'BUS', '#1c1c1c', 'rect'));
  for (let i = 0; i < 4; i++) {
    A.add('poster' + i, 64, 64, (g, ge, w, h) => {
      const cols = [['#e8d8b0', '#b5381f'], ['#20303c', '#f2c230'], ['#f0f0ea', '#27a3a8'], ['#5a2038', '#f6ecd8']][i];
      for (const ctx of [g, ge]) {
        ctx.fillStyle = cols[0];
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = cols[1];
        ctx.beginPath(); ctx.arc(32, 24, 13, 0, TAU); ctx.fill();
        ctx.fillRect(8, 44, 48, 5);
        ctx.fillRect(14, 53, 36, 3);
      }
      ge.fillStyle = 'rgba(0,0,0,0.45)';
      ge.fillRect(0, 0, w, h);
    });
  }
  A.add('vent', 64, 64, (g, ge, w, h) => {
    g.fillStyle = '#c8cacc';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#3c3e42';
    for (let y = 8; y < h - 6; y += 8) g.fillRect(6, y, w - 12, 4);
    g.strokeStyle = '#8e9094';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, w - 3, h - 3);
  });
  // Glass balcony front: frosted panels, posts and a handrail.
  A.add('rail', 64, 16, (g, ge, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, 'rgb(214,232,240)');
    gr.addColorStop(0.45, 'rgb(170,196,210)');
    gr.addColorStop(0.55, 'rgb(236,246,250)');
    gr.addColorStop(1, 'rgb(150,176,192)');
    g.fillStyle = gr;
    g.fillRect(0, 4, w, h - 4);
    g.fillStyle = 'rgb(96,102,108)';
    g.fillRect(0, 0, w, 4);
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2.5, h);
  });
  // Roof railing: posts and two rails, see-through.
  A.add('railing', 64, 16, (g, ge, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgb(150,156,162)';
    g.fillRect(0, 0, w, 3.5);
    g.fillRect(0, h * 0.5, w, 2.5);
    g.fillRect(0, h - 3, w, 3);
    for (let x = 1; x < w; x += 21.3) g.fillRect(x, 0, 3, h);
  });
  // Palm frond seen from above: a rib with leaflets, along +u.
  A.add('frond', 128, 32, (g, ge, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 46; i++) {
      const t = i / 46, x = 4 + t * (w - 8);
      const len = (h * 0.5 - 1) * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08));
      const v = 70 + ((i * 37) % 30);
      g.strokeStyle = rgb(v * 0.55, v + 40, v * 0.45);
      g.lineWidth = 1.6;
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(x, h / 2);
        g.lineTo(x + len * 0.55, h / 2 + sgn * len);
        g.stroke();
      }
    }
    g.strokeStyle = 'rgb(150,150,90)';
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  });
  // Foliage for round canopies: overlapping leaf dabs, light on top of
  // dark, grey so the vertex colour sets the green. Its own number
  // stream (the shared one is left alone).
  A.add('leaves', 64, 32, (g, ge, w, h) => {
    let q = 12345;
    const rnd = () => ((q = (Math.imul(q, 1103515245) + 12345) >>> 0) / 4294967296);
    // Light overall (the vertex colour carries the green and the shade):
    // the leaf dabs only break the surface up.
    g.fillStyle = grey(178);
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const x = rnd() * w, y = rnd() * h, v = 135 + rnd() * 120 * (0.6 + 0.4 * (1 - y / h));
      g.fillStyle = grey(v);
      g.beginPath();
      g.ellipse(x, y, 1 + rnd() * 1.6, 0.7 + rnd() * 1, rnd() * TAU, 0, TAU);
      g.fill();
    }
  });
  A.add('white', 64, 64, (g, ge, w, h) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
  });
  A.add('glow', 64, 64, (g, ge, w, h) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    ge.fillStyle = '#fff';
    ge.fillRect(0, 0, w, h);
  });
  return {
    map: toTexture(A.c, { repeat: false }),
    emissiveMap: toTexture(A.e, { repeat: false, aniso: 4 }),
    rects: A.rects,
  };
}

// Builds every texture once. streetNames: plate labels, in atlas order.
export function createTextures(seed, streetNames = []) {
  const rng = createRng(seed);
  const N = { fine: noiseField(512, 32, 4, rng, 0.6), coarse: noiseField(512, 4, 4, rng) };
  return {
    asphalt: makeAsphalt(rng, N),
    pavement: makePavement(rng, N),
    grass: makeGrass(rng, N),
    sand: makeSand(rng, N),
    wood: makeWood(rng, N),
    paint: makePaint(rng, N),
    decals: makeDecals(rng),
    glass: makeGlassFacade(rng, N),
    brick: makeBrickFacade(rng, N),
    office: makeConcreteFacade(rng, N),
    stucco: makeStuccoFacade(rng, N),
    siding: makeSiding(rng, N),
    corrugated: makeCorrugated(rng, N),
    roofing: makeRoofing(rng, N),
    shopfront: makeShopfront(rng, N),
    details: makeDetails(rng, streetNames),
    havana: makeHavanaFacade(rng, N),
  };
}
