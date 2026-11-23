// Minimap (round HUD canvas) and full-screen map. The island is drawn once
// into an offscreen canvas; both views just blit it with a transform.
//
// Coordinates: x east, z south, meters. Heading 0 faces +x and grows toward +z.
import { fillMapPicker } from './mappicker.js';
import { shortStreet, formatEta } from '../core/route.js';
import { formatDistance } from '../core/units.js';

const MAP_PX = 2048;
const COL = {
  sea: '#17323f',
  sand: '#d9c391',
  land: '#6f7b5c',
  block: '#7d8869',
  paved: '#8a8a86', // placeholder ground for a real map until city.lots exists
  park: '#4f8a4a',
  road: '#3b3a3c',
  avenue: '#4a484a',
  avenueLine: '#c9a35a',
  building: 'rgba(40, 36, 32, 0.28)',
  pier: '#8a6a4a',
  accent: '#e2733a',
  text: '#f6efe6',
  panel: 'rgba(24, 18, 15, 0.82)',
};
// Minimap color of each lot type (docs/REVAMP.md 6.2 table).
export const LOT_COLORS = {
  yard: '#7d8f62', carpark: '#6a6d72', plaza: '#b8b0a2', grass: '#86965f', works: '#8a8378',
  beach: '#d9c9a0', park: '#6f8f55', wateredge: '#9a9a94', site: '#a08a66', verge: '#8f8f8a',
};
export const PLAYER_COLOR = '#5fe0ff';

const POI_STYLE = {
  airfield: { color: '#8ec5e8', name: 'Airfield' },
  marina: { color: '#6fd0c4', name: 'Marina' },
  garage: { color: '#f2b84b', name: 'Garage' },
  shop: { color: '#e88aa8', name: 'Shop' },
  race: { color: '#f6efe6', name: 'Race' },
  helipad: { color: '#b9a6ee', name: 'Helipad' },
  depot: { color: '#c9b98a', name: 'Military depot' },
  landmark: { color: '#ffd24a', name: 'Landmark' },
};
const LANDMARK_NAME_ZOOM = 330; // minimap zoom (meters) at which landmark names show
const LANDMARK_TAP_PX = 30; // a tap this close to a landmark names it
// Activity markers passed in `state.markers` (races, sky courses, deliveries).
const ACT_STYLE = {
  street: { color: '#e2733a', name: 'Street race' },
  boat: { color: '#45c7dc', name: 'Boat race' },
  sky: { color: '#ffcf5a', name: 'Sky course' },
  delivery: { color: '#8bd66f', name: 'Delivery' },
  stunt: { color: '#b48cff', name: 'Stunt jump' },
};
const LABEL_ZOOM = 2; // full-map zoom at which marker labels appear
// GPS route line (src/core/route.js): a bright blue line with a dark edge, white chevrons on the full map.
export const ROUTE_COLOR = '#3d8bff';
const ROUTE_EDGE = 'rgba(6, 16, 34, 0.9)';
const LONG_PRESS_MS = 600; // full map: a long press clears the destination
const MAX_LABELS = 160; // street names drawn at once on the full map
const STREET_PX_PER_M = 0.35; // a real map opens at this scale round the player (about a mile across)
// Road class rank for street name priority (bigger first).
const SLOT_TRY = [0, -0.2, 0.2, -0.35, 0.35]; // where along its slot a name may sit
const CLASS_RANK = { motorway: 6, trunk: 5, primary: 4, secondary: 3, tertiary: 2, causeway: 3 };

// Adventure and garage markers (src/systems/adventures.js, through mapui.addLayer): an adventure is
// a ring with a question mark, a check mark once done; a garage is the garage glyph; the tracked
// adventure's step is a dashed ring of its fuzzy radius. Landmarks keep their pin.
export const EXPLORE_TYPES = { 'explore-rumour': 'Adventure', 'explore-garage': 'Garage', 'explore-ring': 'Search area' };
const EXPLORE_ADV_COLOR = '#ffd34d';
const isExplore = (t) => typeof t === 'string' && t.charCodeAt(0) === 101 && Object.hasOwn(EXPLORE_TYPES, t);
// '?' is the rumour label until the adventure is done (then its name).
const isDone = (m) => m.type === 'explore-rumour' && !!m.label && m.label !== '?';
function drawQuest(g, color, s, done) {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  g.arc(0, 0, s, 0, Math.PI * 2);
  g.fillStyle = 'rgba(26, 18, 13, 0.9)';
  g.fill();
  g.lineWidth = Math.max(2, s * 0.24);
  g.strokeStyle = color;
  g.stroke();
  g.lineWidth = Math.max(1.8, s * 0.26);
  g.beginPath();
  if (done) { // check mark
    g.moveTo(-s * 0.45, s * 0.02); g.lineTo(-s * 0.1, s * 0.4); g.lineTo(s * 0.5, -s * 0.38);
    g.stroke();
  } else { // question mark: hook, stem and dot
    g.arc(0, -s * 0.22, s * 0.34, Math.PI, Math.PI * 2.5);
    g.lineTo(0, s * 0.2);
    g.stroke();
    g.beginPath();
    g.arc(0, s * 0.52, Math.max(1.1, s * 0.1), 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  }
}
// One explore marker centered at (0, 0) of the current transform; ringPx is the ring's radius in px.
function drawExplore(g, m, s, ringPx) {
  if (m.type === 'explore-rumour') drawQuest(g, m.color || EXPLORE_ADV_COLOR, s, isDone(m));
  else if (m.type === 'explore-garage') drawIcon(g, 'garage', m.color || '#9aa0a6', s);
  else if (ringPx > 0) { // the tracked step: a dashed ring, off center by design
    g.lineWidth = 3;
    g.strokeStyle = m.color || '#ff8a3d';
    g.setLineDash([7, 5]);
    g.beginPath();
    g.arc(0, 0, ringPx, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
  }
}

// ---------------------------------------------------------------------------
// Pre-rendered map
// ---------------------------------------------------------------------------
export function createMapRenderer(city) {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_PX;
  canvas.height = MAP_PX;
  const half = city.mapHalf || city.size * 1.6;
  const scale = MAP_PX / (half * 2); // map pixels per meter

  function worldToMap(x, z, out) {
    out.x = (x + half) * scale;
    out.y = (z + half) * scale;
    return out;
  }

  function redraw() {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, MAP_PX, MAP_PX);
    g.fillStyle = COL.sea;
    g.fillRect(0, 0, MAP_PX, MAP_PX);
    g.setTransform(scale, 0, 0, scale, half * scale, half * scale);
    g.lineJoin = 'round';

    const outline = () => {
      g.beginPath();
      const steps = 240;
      for (let k = 0; k <= steps; k++) {
        const t = (k / steps) * Math.PI * 2;
        const r = city.radiusAt(t);
        const px = Math.cos(t) * r, pz = Math.sin(t) * r;
        if (k === 0) g.moveTo(px, pz); else g.lineTo(px, pz);
      }
      g.closePath();
    };
    const extra = city.extraLand || [];
    const rect = (r, grow) => g.rect(r.x0 - grow, r.z0 - grow, r.x1 - r.x0 + grow * 2, r.z1 - r.z0 + grow * 2);

    if (city.landRuns) {
      // A real map: land as runs from its land raster (islet included).
      const runs = city.landRuns(6);
      g.fillStyle = COL.land;
      for (let k = 0; k < runs.length; k += 4) g.fillRect(runs[k], runs[k + 1], runs[k + 2] - runs[k], runs[k + 3] - runs[k + 1] + 0.5);
    } else {
      // Sand rim, then land.
      g.fillStyle = COL.sand;
      g.strokeStyle = COL.sand;
      g.lineWidth = 16;
      outline();
      g.fill();
      g.stroke();
      for (const r of extra) { g.beginPath(); rect(r, 8); g.fill(); }
      g.fillStyle = COL.land;
      outline();
      g.fill();
      for (const r of extra) { g.beginPath(); rect(r, 0); g.fill(); }
    }

    // Blocks. On the real map the ground is mostly paving, not grass, so the
    // block color is a neutral gray until the lots (below) paint over it.
    for (const b of city.blocks) {
      g.fillStyle = b.district === 'park' ? COL.park : (city.map ? COL.paved : COL.block);
      g.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
    }
    // Lots (docs/REVAMP.md 6.2, W1): each lot in the color of its type. With
    // no lots (the island, or W1 not landed) the block colors above stay.
    if (Array.isArray(city.lots)) {
      for (const lot of city.lots) {
        const c = LOT_COLORS[lot.type];
        if (!c) continue;
        g.fillStyle = c;
        g.fillRect(lot.x0, lot.z0, lot.x1 - lot.x0, lot.z1 - lot.z0);
      }
    }

    // Roads: avenues on top of streets, with intersection squares.
    g.lineCap = city.map ? 'round' : 'butt';
    for (const pass of [false, true]) {
      g.strokeStyle = pass ? COL.avenue : COL.road;
      for (const e of city.edges) {
        if (e.avenue !== pass) continue;
        const a = city.nodes[e.a], b = city.nodes[e.b];
        g.lineWidth = e.width;
        g.beginPath();
        g.moveTo(a.x, a.z);
        g.lineTo(b.x, b.z);
        g.stroke();
      }
    }
    for (const n of city.nodes) {
      // Junction squares: grid widths on the island, box sizes elsewhere.
      const wX = city.map ? n.hx * 2 : city.wx[n.i], wZ = city.map ? n.hz * 2 : city.wz[n.j];
      const w = Math.max(wX, wZ);
      g.fillStyle = w > 12 ? COL.avenue : COL.road;
      g.fillRect(n.x - wX / 2, n.z - wZ / 2, wX, wZ);
    }
    // Avenue center lines.
    g.strokeStyle = COL.avenueLine;
    g.globalAlpha = 0.55;
    g.lineWidth = 1.2;
    for (const e of city.edges) {
      if (!e.avenue) continue;
      const a = city.nodes[e.a], b = city.nodes[e.b];
      g.beginPath();
      g.moveTo(a.x, a.z);
      g.lineTo(b.x, b.z);
      g.stroke();
    }
    g.globalAlpha = 1;

    // Building footprints (subtle).
    g.fillStyle = COL.building;
    for (const b of city.buildings) g.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);

    // Piers.
    g.fillStyle = COL.pier;
    for (const p of city.piers || []) g.fillRect(p.x0, p.z0, p.x1 - p.x0, p.z1 - p.z0);

    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  // Drawn on first use (the first minimap frame of play or the first open of the
  // full map), not when the game is built: it cost 0.4 s at start on a slow phone.
  let built = false;
  function ensure() {
    if (built) return canvas;
    built = true;
    redraw();
    return canvas;
  }
  return {
    get canvas() { return ensure(); },
    get built() { return built; },
    ensure,
    scale, half, size: MAP_PX, worldToMap,
    redraw() { built = true; redraw(); },
    city,
  };
}

// ---------------------------------------------------------------------------
// Round minimap
// ---------------------------------------------------------------------------
export function createMinimap(canvas, mapRenderer) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) / 2 - 4;
  const tmp = { x: 0, y: 0 };
  const last = { x: 1e9, z: 1e9, heading: 1e9, zoom: 0, sig: 1e9, count: -1 };
  const mapScale = mapRenderer.scale;

  function signature(s) {
    let sum = 0;
    const blips = s.blips;
    if (blips) for (let i = 0; i < blips.length; i++) sum += blips[i].x * 1.37 + blips[i].z * 0.73 + (blips[i].label ? blips[i].label.length * 0.011 : 0);
    if (s.waypoint) sum += s.waypoint.x * 3.1 + s.waypoint.z * 2.3;
    if (s.route && s.route.ok) sum += s.route.rev * 7.7 + (s.routeSeg | 0) * 0.37;
    if (s.northUp) sum += 0.5;
    return sum;
  }

  function draw(s) {
    const sig = signature(s);
    const dh = Math.abs(Math.atan2(Math.sin(s.heading - last.heading), Math.cos(s.heading - last.heading)));
    const thr = s.zoomMeters * 0.004; // ~0.35 px on screen
    if (
      Math.abs(s.x - last.x) < thr && Math.abs(s.z - last.z) < thr && dh < 0.004 &&
      s.zoomMeters === last.zoom && sig === last.sig && s.blipCount === last.count
    ) return;
    last.x = s.x; last.z = s.z; last.heading = s.heading; last.zoom = s.zoomMeters;
    last.sig = sig; last.count = s.blipCount;

    const pxPerM = R / s.zoomMeters; // screen px per meter
    const k = pxPerM / mapScale; // map px -> screen px
    // Heading-up (default) turns the map with the craft; north-up keeps north at the top.
    const rot = s.northUp ? 0 : -Math.PI / 2 - s.heading;
    const cos = Math.cos(rot) * k, sin = Math.sin(rot) * k;
    mapRenderer.worldToMap(s.x, s.z, tmp);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = COL.sea;
    ctx.fillRect(0, 0, W, H);
    // screen = C + Rot * k * (map - P)
    ctx.setTransform(cos, sin, -sin, cos, cx - (cos * tmp.x - sin * tmp.y), cy - (sin * tmp.x + cos * tmp.y));
    ctx.drawImage(mapRenderer.canvas, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // The route ahead: a thick line under everything else (screen space, clipped by the rim).
    const c = Math.cos(rot), sn = Math.sin(rot);
    const rt = s.route;
    if (rt && rt.ok && rt.n > 1) {
      const reach = s.zoomMeters * 2.5;
      const i0 = Math.max(0, Math.min(rt.n - 2, s.routeSeg | 0));
      const a0 = rt.cum[i0];
      ctx.beginPath();
      ctx.moveTo(cx + (c * (rt.x[i0] - s.x) - sn * (rt.z[i0] - s.z)) * pxPerM, cy + (sn * (rt.x[i0] - s.x) + c * (rt.z[i0] - s.z)) * pxPerM);
      for (let i = i0 + 1; i < rt.n; i++) {
        const dx = rt.x[i] - s.x, dz = rt.z[i] - s.z;
        ctx.lineTo(cx + (c * dx - sn * dz) * pxPerM, cy + (sn * dx + c * dz) * pxPerM);
        if (rt.cum[i] - a0 > reach) break;
      }
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = ROUTE_EDGE;
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = ROUTE_COLOR;
      ctx.lineWidth = 5;
      ctx.stroke();
    }

    // Waypoint and blips (screen space).
    if (s.waypoint) {
      project(s.waypoint.x - s.x, s.waypoint.z - s.z);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = COL.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    const lms = mapRenderer.city.mapLandmarks;
    if (lms) {
      // Dots for every landmark in view; the name of the one nearest the
      // center (inside 60% of the radius) when zoomed in enough to read.
      let best = -1, bestD = (R * 0.6) ** 2;
      for (let i = 0; i < lms.length; i++) {
        const lm = lms[i];
        project(lm.x - s.x, lm.z - s.z);
        if (clamped) continue;
        ctx.fillStyle = '#ffd24a';
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px, py, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        const d = (px - cx) ** 2 + (py - cy) ** 2;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0 && s.zoomMeters <= LANDMARK_NAME_ZOOM) {
        project(lms[best].x - s.x, lms[best].z - s.z);
        ctx.font = '700 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(14, 26, 32, 0.9)';
        ctx.fillStyle = '#fff6d6';
        ctx.strokeText(lms[best].name, px, py + 5);
        ctx.fillText(lms[best].name, px, py + 5);
      }
    }
    const blips = s.blips;
    const n = Math.min(s.blipCount | 0, blips ? blips.length : 0);
    for (let i = 0; i < n; i++) {
      const b = blips[i];
      project(b.x - s.x, b.z - s.z);
      if (isExplore(b.type)) {
        ctx.save();
        ctx.translate(px, py);
        drawExplore(ctx, b, clamped ? 5 : 6.5, b.r > 0 && !clamped ? Math.min(b.r * curK, R) : 0);
        ctx.restore();
        continue;
      }
      ctx.fillStyle = b.color || '#ffffff';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (b.type === 'tank') {
        // Tank: a square with a barrel tick toward the gun's heading.
        const q = clamped ? 3 : 4, bx = px, by = py;
        ctx.rect(bx - q, by - q, q * 2, q * 2);
        ctx.fill();
        ctx.stroke();
        project(b.x - s.x + Math.cos(b.h || 0) * 30, b.z - s.z + Math.sin(b.h || 0) * 30);
        const tx = px - bx, ty = py - by, tl = Math.sqrt(tx * tx + ty * ty) || 1;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + (tx / tl) * (q + 5), by + (ty / tl) * (q + 5));
        ctx.lineWidth = 2;
        ctx.strokeStyle = b.color || '#ffffff';
        ctx.stroke();
        continue;
      }
      ctx.arc(px, py, clamped ? 3.2 : 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // Rim and north marker.
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    // North is world -z: direction (0,-1) rotated by rot.
    const nx = cx + sn * (R - 1);
    const ny = cy - c * (R - 1);
    ctx.fillStyle = COL.accent;
    ctx.strokeStyle = '#1a120d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, ny + 0.5);

    // Player arrow (pointing up heading-up; along the heading north-up).
    if (s.northUp) {
      ctx.translate(cx, cy);
      ctx.rotate(s.heading + Math.PI / 2);
      ctx.translate(-cx, -cy);
    }
    ctx.fillStyle = PLAYER_COLOR;
    ctx.strokeStyle = '#1a120d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 11);
    ctx.lineTo(cx + 8, cy + 8);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx - 8, cy + 8);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // project() writes into px/py/clamped (module-level scratch via closure).
  let px = 0, py = 0, clamped = false;
  let curRot = 0, curK = 0;
  function project(dx, dz) {
    // curRot/curK are set lazily from the last draw's values.
    const rot = curRot;
    const sx = (Math.cos(rot) * dx - Math.sin(rot) * dz) * curK;
    const sy = (Math.sin(rot) * dx + Math.cos(rot) * dz) * curK;
    const d = Math.hypot(sx, sy);
    const lim = R - 5;
    clamped = d > lim;
    const f = clamped ? lim / d : 1;
    px = cx + sx * f;
    py = cy + sy * f;
  }

  return {
    draw(s) {
      curRot = s.northUp ? 0 : -Math.PI / 2 - s.heading;
      curK = R / s.zoomMeters;
      draw(s);
    },
    invalidate() { last.sig = 1e9; },
  };
}

// ---------------------------------------------------------------------------
// Full-screen map
// ---------------------------------------------------------------------------
const MAP_CSS = `
.rw-map-root {
  position: absolute; inset: 0; z-index: 40; display: none; touch-action: none;
  background: #0e1a20; color: ${COL.text}; font-family: system-ui, sans-serif;
  --rw-map-sl: env(safe-area-inset-left, 0px); --rw-map-sr: env(safe-area-inset-right, 0px);
  --rw-map-st: env(safe-area-inset-top, 0px); --rw-map-sb: env(safe-area-inset-bottom, 0px);
}
.rw-map-root.rw-map-open { display: block; }
.rw-map-canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; }
.rw-map-close {
  position: absolute; right: calc(var(--rw-map-sr) + 10px); top: calc(var(--rw-map-st) + 10px);
  width: 56px; height: 56px; border-radius: 50%; border: 2px solid ${COL.accent};
  background: ${COL.panel}; color: ${COL.text}; font-size: 28px; line-height: 1; cursor: pointer; padding: 0;
}
.rw-map-title {
  position: absolute; left: calc(var(--rw-map-sl) + 14px); top: calc(var(--rw-map-st) + 12px);
  font-size: 13px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8); pointer-events: none;
}
.rw-map-title small { display: block; font-weight: 500; letter-spacing: 0.02em; text-transform: none; opacity: 0.7; margin-top: 2px; }
.rw-map-legend {
  position: absolute; right: calc(var(--rw-map-sr) + 10px); bottom: calc(var(--rw-map-sb) + 10px);
  display: grid; grid-template-columns: auto auto; gap: 3px 14px; padding: 6px 10px; opacity: 0.92;
  background: ${COL.panel}; border: 1px solid rgba(246,239,230,0.22); border-radius: 12px;
  font-size: 12px; pointer-events: none;
}
.rw-map-toast {
  position: absolute; left: 50%; bottom: calc(var(--rw-map-sb) + 16px); transform: translateX(-50%);
  padding: 8px 16px; border-radius: 999px; background: ${COL.panel}; border: 1px solid ${COL.accent};
  font-size: 14px; font-weight: 700; pointer-events: none; opacity: 0; transition: opacity 0.25s;
}
.rw-map-travelbtn {
  position: absolute; left: calc(var(--rw-map-sl) + 10px); bottom: calc(var(--rw-map-sb) + 10px);
  min-width: 112px; height: 52px; padding: 0 18px; border-radius: 999px; border: 2px solid ${COL.accent};
  background: ${COL.panel}; color: ${COL.text}; font: inherit; font-size: 16px; font-weight: 800; cursor: pointer; touch-action: manipulation;
}
.rw-map-travel {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); box-sizing: border-box;
  width: min(560px, calc(100% - var(--rw-map-sl) - var(--rw-map-sr) - 24px)); max-height: calc(100% - var(--rw-map-st) - var(--rw-map-sb) - 24px); overflow-y: auto;
  padding: 10px; border-radius: 16px; background: rgba(14,26,32,0.96); border: 2px solid ${COL.accent}; touch-action: pan-y;
}
.rw-map-travelh { font-size: 13px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 4px 8px; }
.rw-map-zoom {
  position: absolute; right: calc(var(--rw-map-sr) + 14px); top: calc(var(--rw-map-st) + 76px);
  display: flex; flex-direction: column; gap: 8px;
}
.rw-map-zoom button, .rw-map-north {
  width: 48px; height: 48px; border-radius: 12px; border: 2px solid rgba(246,239,230,0.5); padding: 0;
  background: ${COL.panel}; color: ${COL.text}; font: inherit; font-size: 26px; font-weight: 800; line-height: 1; cursor: pointer; touch-action: manipulation;
}
.rw-map-north {
  position: absolute; left: calc(var(--rw-map-sl) + 10px); top: calc(var(--rw-map-st) + 52px);
  width: auto; height: 48px; padding: 0 14px; border-radius: 999px; font-size: 14px; font-weight: 700;
}
.rw-map-route {
  position: absolute; left: 50%; top: calc(var(--rw-map-st) + 12px); transform: translateX(-50%); max-width: 44%;
  padding: 7px 14px; border-radius: 999px; background: rgba(8, 22, 44, 0.9); border: 2px solid ${ROUTE_COLOR};
  font-size: 14px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none;
}
.rw-map-route[hidden] { display: none; }
.rw-map-legend span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.rw-map-legend canvas { width: 18px; height: 18px; }
`;

function injectCss() {
  if (document.getElementById('rw-map-style')) return;
  const st = document.createElement('style');
  st.id = 'rw-map-style';
  st.textContent = MAP_CSS;
  document.head.appendChild(st);
}

// Icon drawn centered at (0,0) in a box of roughly +-s.
function drawIcon(g, type, color, s) {
  g.fillStyle = color;
  g.strokeStyle = '#1a120d';
  g.lineWidth = Math.max(1.5, s * 0.14);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.beginPath();
  if (type === 'airfield') { // plane
    g.moveTo(0, -s); g.lineTo(s * 0.18, -s * 0.3); g.lineTo(s, s * 0.2); g.lineTo(s, s * 0.4);
    g.lineTo(s * 0.18, s * 0.15); g.lineTo(s * 0.12, s * 0.7); g.lineTo(s * 0.45, s * 0.95);
    g.lineTo(s * 0.45, s); g.lineTo(0, s * 0.85); g.lineTo(-s * 0.45, s); g.lineTo(-s * 0.45, s * 0.95);
    g.lineTo(-s * 0.12, s * 0.7); g.lineTo(-s * 0.18, s * 0.15); g.lineTo(-s, s * 0.4);
    g.lineTo(-s, s * 0.2); g.lineTo(-s * 0.18, -s * 0.3); g.closePath();
    g.stroke(); g.fill();
  } else if (type === 'marina') { // anchor-like: ring, shank, crossbar, flukes
    g.arc(0, -s * 0.7, s * 0.22, 0, Math.PI * 2);
    g.moveTo(0, -s * 0.48); g.lineTo(0, s * 0.8);
    g.moveTo(-s * 0.4, -s * 0.2); g.lineTo(s * 0.4, -s * 0.2);
    g.moveTo(-s * 0.8, s * 0.1); g.quadraticCurveTo(-s * 0.7, s * 0.85, 0, s * 0.85);
    g.quadraticCurveTo(s * 0.7, s * 0.85, s * 0.8, s * 0.1);
    g.lineWidth = Math.max(3, s * 0.34);
    g.strokeStyle = '#1a120d'; g.stroke();
    g.lineWidth = Math.max(1.6, s * 0.18);
    g.strokeStyle = color; g.stroke();
  } else if (type === 'garage') { // house with a door
    g.moveTo(-s, -s * 0.1); g.lineTo(0, -s * 0.95); g.lineTo(s, -s * 0.1); g.lineTo(s, s * 0.85);
    g.lineTo(-s, s * 0.85); g.closePath();
    g.stroke(); g.fill();
    g.fillStyle = '#1a120d';
    g.fillRect(-s * 0.45, s * 0.15, s * 0.9, s * 0.7);
  } else if (type === 'shop') { // bag
    g.rect(-s * 0.8, -s * 0.4, s * 1.6, s * 1.25);
    g.stroke(); g.fill();
    g.beginPath();
    g.arc(0, -s * 0.4, s * 0.4, Math.PI, 0);
    g.strokeStyle = color; g.lineWidth = Math.max(1.6, s * 0.16);
    g.stroke();
  } else if (type === 'street') { // flag on a pole
    g.moveTo(-s * 0.55, s * 0.95); g.lineTo(-s * 0.55, -s * 0.95);
    g.lineTo(s * 0.9, -s * 0.45); g.lineTo(-s * 0.55, s * 0.1);
    g.stroke(); g.fill();
  } else if (type === 'boat') { // sail and hull
    g.moveTo(0, -s); g.lineTo(s * 0.75, s * 0.35); g.lineTo(0, s * 0.35); g.closePath();
    g.stroke(); g.fill();
    g.beginPath();
    g.moveTo(-s * 0.9, s * 0.55); g.lineTo(s * 0.9, s * 0.55); g.lineTo(s * 0.55, s * 0.95); g.lineTo(-s * 0.55, s * 0.95);
    g.closePath();
    g.stroke(); g.fill();
  } else if (type === 'sky') { // hoop
    g.ellipse(0, 0, s * 0.7, s * 0.95, 0, 0, Math.PI * 2);
    g.lineWidth = Math.max(3, s * 0.42);
    g.strokeStyle = '#1a120d'; g.stroke();
    g.lineWidth = Math.max(1.8, s * 0.24);
    g.strokeStyle = color; g.stroke();
  } else if (type === 'delivery') { // parcel with a ribbon
    g.rect(-s * 0.85, -s * 0.7, s * 1.7, s * 1.4);
    g.stroke(); g.fill();
    g.beginPath();
    g.moveTo(0, -s * 0.7); g.lineTo(0, s * 0.7);
    g.moveTo(-s * 0.85, 0); g.lineTo(s * 0.85, 0);
    g.strokeStyle = '#1a120d'; g.lineWidth = Math.max(1.6, s * 0.2);
    g.stroke();
  } else if (type === 'stunt') { // ramp wedge with a jump arc
    g.moveTo(-s, s * 0.8); g.lineTo(s * 0.35, s * 0.8); g.lineTo(s * 0.35, s * 0.05); g.closePath();
    g.stroke(); g.fill();
    g.beginPath();
    g.moveTo(s * 0.1, -s * 0.15); g.quadraticCurveTo(s * 0.55, -s * 1.05, s * 0.95, -s * 0.2);
    g.lineWidth = Math.max(3, s * 0.34);
    g.strokeStyle = '#1a120d'; g.stroke();
    g.lineWidth = Math.max(1.6, s * 0.18);
    g.strokeStyle = color; g.stroke();
  } else if (type === 'race') { // chequered flag tile
    g.rect(-s * 0.85, -s * 0.85, s * 1.7, s * 1.7);
    g.stroke(); g.fill();
    g.fillStyle = '#1a120d';
    const q = s * 0.567;
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
      if ((a + b) % 2 === 0) g.fillRect(-s * 0.85 + a * q, -s * 0.85 + b * q, q, q);
    }
  } else if (type === 'landmark') { // teardrop pin with a star
    g.moveTo(0, s * 1.1);
    g.bezierCurveTo(-s * 1.25, -s * 0.2, -s * 0.9, -s * 1.05, 0, -s * 1.05);
    g.bezierCurveTo(s * 0.9, -s * 1.05, s * 1.25, -s * 0.2, 0, s * 1.1);
    g.closePath();
    g.stroke(); g.fill();
    g.fillStyle = '#1a120d';
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? s * 0.2 : s * 0.48;
      if (k) g.lineTo(Math.cos(a) * r, Math.sin(a) * r - s * 0.25);
      else g.moveTo(Math.cos(a) * r, Math.sin(a) * r - s * 0.25);
    }
    g.closePath();
    g.fill();
  } else if (type === 'depot') { // shield with a star
    g.moveTo(-s * 0.85, -s * 0.8); g.lineTo(s * 0.85, -s * 0.8); g.lineTo(s * 0.85, s * 0.05);
    g.quadraticCurveTo(s * 0.7, s * 0.7, 0, s); g.quadraticCurveTo(-s * 0.7, s * 0.7, -s * 0.85, s * 0.05);
    g.closePath();
    g.stroke(); g.fill();
    g.fillStyle = '#1a120d';
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? s * 0.22 : s * 0.5;
      if (k) g.lineTo(Math.cos(a) * r, Math.sin(a) * r - s * 0.02);
      else g.moveTo(Math.cos(a) * r, Math.sin(a) * r - s * 0.02);
    }
    g.closePath();
    g.fill();
  } else { // helipad: circle with an H
    g.arc(0, 0, s * 0.95, 0, Math.PI * 2);
    g.stroke(); g.fill();
    g.strokeStyle = '#1a120d'; g.lineWidth = Math.max(2, s * 0.22);
    g.beginPath();
    g.moveTo(-s * 0.4, -s * 0.5); g.lineTo(-s * 0.4, s * 0.5);
    g.moveTo(s * 0.4, -s * 0.5); g.lineTo(s * 0.4, s * 0.5);
    g.moveTo(-s * 0.4, 0); g.lineTo(s * 0.4, 0);
    g.stroke();
  }
}

// Street name runs for the full map: straight stretches of one name (edges
// joined through junctions while the road goes on straight), biggest roads
// first. Built once per renderer, on the first open.
function buildStreetRuns(city) {
  const nodes = city.nodes || [], edges = city.edges || [];
  const used = new Uint8Array(edges.length);
  const runs = [];
  const next = (e, at) => { // the straight same-name continuation of e at node `at`
    const n = nodes[at];
    if (!n || !n.edges) return null;
    const tx = e.b === at ? e.ux : -e.ux, tz = e.b === at ? e.uz : -e.uz;
    let best = null, bd = 0.95;
    for (const id of n.edges) {
      const o = edges[id];
      if (o === e || used[id] || o.name !== e.name) continue;
      const ox = o.a === at ? o.ux : -o.ux, oz = o.a === at ? o.uz : -o.uz;
      const d = ox * tx + oz * tz;
      if (d > bd) { bd = d; best = o; }
    }
    return best;
  };
  for (const e0 of edges) {
    if (!e0.name || used[e0.id]) continue;
    used[e0.id] = 1;
    let len = e0.length || 0;
    let endB = e0.b, endA = e0.a;
    for (let e = e0, at = e0.b, g = 0; g < 200; g++) {
      const o = next(e, at);
      if (!o) break;
      used[o.id] = 1; len += o.length || 0;
      at = o.a === at ? o.b : o.a; e = o; endB = at;
    }
    for (let e = e0, at = e0.a, g = 0; g < 200; g++) {
      const o = next(e, at);
      if (!o) break;
      used[o.id] = 1; len += o.length || 0;
      at = o.a === at ? o.b : o.a; e = o; endA = at;
    }
    const A = nodes[endA], B = nodes[endB];
    if (!A || !B || len < 40) continue;
    runs.push({ name: e0.name, short: shortStreet(e0.name), x0: A.x, z0: A.z, x1: B.x, z1: B.z, len, rank: (CLASS_RANK[e0.cls] || (e0.avenue ? 2 : 1)) - (e0.ped ? 1 : 0) });
  }
  runs.sort((a, b) => b.rank - a.rank || b.len - a.len || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return runs;
}

export function createFullMap(root, mapRenderer, { onWaypoint, onClose, travel = null, routeInfo = null, onNorthUp = null, northUp = false } = {}) {
  injectCss();
  const city = mapRenderer.city;
  const el = document.createElement('div');
  el.className = 'rw-map-root';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Map');
  const canvas = document.createElement('canvas');
  canvas.className = 'rw-map-canvas';
  el.appendChild(canvas);
  const title = document.createElement('div');
  title.className = 'rw-map-title';
  title.innerHTML = 'Rustwater<small>Tap to go there, hold to clear</small>';
  el.appendChild(title);
  const closeBtn = document.createElement('button');
  closeBtn.className = 'rw-map-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close map');
  closeBtn.textContent = '×';
  el.appendChild(closeBtn);
  const legend = document.createElement('div');
  legend.className = 'rw-map-legend';
  el.appendChild(legend);
  const toast = document.createElement('div');
  toast.className = 'rw-map-toast';
  el.appendChild(toast);
  // Zoom buttons (next to pinch), the minimap's north-up switch and the route summary.
  const zoomBox = document.createElement('div');
  zoomBox.className = 'rw-map-zoom';
  const zoomBtn = (txt, role, label, f) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = txt; b.dataset.role = role; b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { setZoom(view.zoom * f, cw / 2, ch / 2); schedule(); });
    zoomBox.appendChild(b);
    return b;
  };
  zoomBtn('+', 'map-zoom-in', 'Zoom in', 1.8);
  zoomBtn('\u2212', 'map-zoom-out', 'Zoom out', 1 / 1.8);
  el.appendChild(zoomBox);
  let north = !!northUp;
  const northBtn = document.createElement('button');
  northBtn.type = 'button';
  northBtn.className = 'rw-map-north';
  northBtn.dataset.role = 'map-northup';
  const paintNorth = () => {
    northBtn.textContent = north ? 'Minimap: north up' : 'Minimap: heading up';
    northBtn.setAttribute('aria-pressed', String(north));
  };
  paintNorth();
  northBtn.addEventListener('click', () => { north = !north; paintNorth(); if (onNorthUp) onNorthUp(north); });
  el.appendChild(northBtn);
  const routeEl = document.createElement('div');
  routeEl.className = 'rw-map-route';
  routeEl.dataset.role = 'map-route';
  routeEl.hidden = true;
  el.appendChild(routeEl);
  // The Travel list (PLAN_V2 3.4): every region, tap to go. travel = { current, go(id) -> message or '' }.
  let travelPanel = null;
  let travelBtn = null;
  if (travel) {
    const tb = document.createElement('button');
    travelBtn = tb;
    tb.className = 'rw-map-travelbtn';
    tb.type = 'button';
    tb.dataset.role = 'map-travel';
    tb.textContent = 'Travel';
    tb.setAttribute('aria-label', 'Travel to another part of Miami');
    el.appendChild(tb);
    tb.addEventListener('click', () => {
      if (travelPanel) { travelPanel.remove(); travelPanel = null; return; }
      travelPanel = document.createElement('div');
      travelPanel.className = 'rw-map-travel';
      travelPanel.dataset.role = 'travel-list';
      const h = document.createElement('div');
      h.className = 'rw-map-travelh';
      h.textContent = 'Travel to';
      travelPanel.appendChild(h);
      fillMapPicker(document, travelPanel, {
        current: travel.current, regionsOnly: true, hint: 'Tap to travel',
        onPick: (id) => {
          const msg = travel.go(id);
          if (msg) showToast(msg);
        },
      });
      el.appendChild(travelPanel);
    });
  }
  root.appendChild(el);

  const g = canvas.getContext('2d');
  const view = { cx: 0, cz: 0, ppm: 1, zoom: 1 }; // ppm: css px per meter
  let fitPpm = 1;
  let cw = 1, ch = 1, dpr = 1;
  let opened = false;
  let st = { x: 0, z: 0, heading: 0, waypoint: null, markers: null };
  let lmBoxes = new Float32Array(0);
  let waypoint = null;
  let dirty = false;
  const pointers = new Map(); // id -> {x, y}
  let gesture = null;
  // A real map's region box: the view fits it, and the rest is dimmed.
  const crop = city.crop && Number.isFinite(city.crop.x0) ? city.crop : null;
  let runs = null; // street name runs, on first open
  const runBoxes = new Float32Array((MAX_LABELS + 8) * 4);
  const placedRun = new Array(MAX_LABELS).fill('');
  const textW = new Map(); // label -> width at the label font
  const stats = { labels: 0, routePts: 0, roads: 0 };

  function buildLegend() {
    legend.textContent = '';
    const types = new Set((city.pois || []).map((p) => p.type));
    if (city.mapLandmarks && city.mapLandmarks.length) types.add('landmark');
    const entries = [['player', 'You', COL.accent]];
    for (const t of Object.keys(POI_STYLE)) if (types.has(t)) entries.push([t, POI_STYLE[t].name, POI_STYLE[t].color]);
    const acts = new Set((st.markers || []).map((m) => m.type));
    for (const t of Object.keys(ACT_STYLE)) if (acts.has(t)) entries.push([t, ACT_STYLE[t].name, ACT_STYLE[t].color]);
    if (acts.has('explore-rumour')) entries.push(['explore-rumour', EXPLORE_TYPES['explore-rumour'], EXPLORE_ADV_COLOR]);
    if (acts.has('explore-garage') && !types.has('garage')) entries.push(['explore-garage', EXPLORE_TYPES['explore-garage'], '#f2b84b']);
    entries.push(['waypoint', 'Waypoint', '#ffffff']);
    for (const [t, name, color] of entries) {
      const span = document.createElement('span');
      const c = document.createElement('canvas');
      c.width = 36; c.height = 36;
      const lg = c.getContext('2d');
      lg.translate(18, 18);
      if (t === 'player') drawArrow(lg, 0, 0, 1, 12);
      else if (t === 'waypoint') drawPin(lg, 0, 6, 11);
      else if (t === 'explore-rumour') drawQuest(lg, color, 10, false);
      else if (t === 'explore-garage') drawIcon(lg, 'garage', color, 11);
      else drawIcon(lg, t, color, 11);
      span.appendChild(c);
      span.appendChild(document.createTextNode(name));
      legend.appendChild(span);
    }
  }

  function drawArrow(c, x, y, rot, s) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    c.fillStyle = PLAYER_COLOR;
    c.strokeStyle = '#1a120d';
    c.lineWidth = 2.5;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(0, -s); c.lineTo(s * 0.72, s * 0.8); c.lineTo(0, s * 0.3); c.lineTo(-s * 0.72, s * 0.8);
    c.closePath();
    c.stroke(); c.fill();
    c.restore();
  }
  function drawPin(c, x, y, s) {
    c.fillStyle = '#ffffff';
    c.strokeStyle = COL.accent;
    c.lineWidth = 3;
    c.beginPath();
    c.arc(x, y - s, s * 0.6, Math.PI * 0.8, Math.PI * 2.2);
    c.lineTo(x, y);
    c.closePath();
    c.stroke(); c.fill();
    c.fillStyle = COL.accent;
    c.beginPath();
    c.arc(x, y - s, s * 0.22, 0, Math.PI * 2);
    c.fill();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = el.clientWidth || window.innerWidth;
    ch = el.clientHeight || window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    fitPpm = crop
      ? Math.min(cw / ((crop.x1 - crop.x0) * 1.04), ch / ((crop.z1 - crop.z0) * 1.04))
      : Math.min(cw, ch) / ((city.mapHalf || city.size) * 0.95 * 2);
    view.ppm = fitPpm * view.zoom;
  }
  // Highest zoom: street level (about 5 px per meter) on a real map.
  const maxZoom = () => Math.max(8, 5 / fitPpm);

  const toWorld = (sx, sy, out) => {
    out.x = view.cx + (sx - cw / 2) / view.ppm;
    out.z = view.cz + (sy - ch / 2) / view.ppm;
    return out;
  };
  const toScreen = (x, z, out) => {
    out.x = cw / 2 + (x - view.cx) * view.ppm;
    out.y = ch / 2 + (z - view.cz) * view.ppm;
    return out;
  };
  const tmpW = { x: 0, z: 0 }, tmpS = { x: 0, y: 0 };

  function clampView() {
    if (crop) {
      view.cx = Math.max(crop.x0, Math.min(crop.x1, view.cx));
      view.cz = Math.max(crop.z0, Math.min(crop.z1, view.cz));
      return;
    }
    const lim = (city.mapHalf || city.size * 1.6) * 0.95;
    view.cx = Math.max(-lim, Math.min(lim, view.cx));
    view.cz = Math.max(-lim, Math.min(lim, view.cz));
  }

  function setZoom(z, ax, ay) {
    // Zoom keeping the world point under screen (ax, ay) fixed.
    toWorld(ax, ay, tmpW);
    const wx = tmpW.x, wz = tmpW.z;
    view.zoom = Math.max(0.6, Math.min(maxZoom(), z));
    view.ppm = fitPpm * view.zoom;
    view.cx = wx - (ax - cw / 2) / view.ppm;
    view.cz = wz - (ay - ch / 2) / view.ppm;
    clampView();
  }

  // Road strips as vector lines (only the ones in view).
  function drawRoads() {
    const nodes = city.nodes, edges = city.edges;
    if (!nodes || !edges) return;
    const mx = 40 / view.ppm;
    toWorld(0, 0, tmpW);
    const wx0 = tmpW.x - mx, wz0 = tmpW.z - mx;
    toWorld(cw, ch, tmpW);
    const wx1 = tmpW.x + mx, wz1 = tmpW.z + mx;
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? COL.avenue : COL.road;
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        if (!!e.avenue !== (pass === 1)) continue;
        const a = nodes[e.a], b = nodes[e.b];
        if ((a.x < wx0 && b.x < wx0) || (a.x > wx1 && b.x > wx1) || (a.z < wz0 && b.z < wz0) || (a.z > wz1 && b.z > wz1)) continue;
        g.lineWidth = Math.max(1.5, (e.width || 8) * view.ppm);
        g.beginPath();
        toScreen(a.x, a.z, tmpS); g.moveTo(tmpS.x, tmpS.y);
        toScreen(b.x, b.z, tmpS); g.lineTo(tmpS.x, tmpS.y);
        g.stroke();
        stats.roads++;
      }
    }
  }

  // The route still ahead: a blue line with white chevrons every 64 px.
  function drawRoute() {
    stats.routePts = 0;
    const info = routeInfo ? routeInfo() : null;
    const r = info && info.route;
    if (!r || !r.ok || r.n < 2) return;
    const i0 = Math.max(0, Math.min(r.n - 2, info.seg | 0));
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    for (let i = i0; i < r.n; i++) {
      toScreen(r.x[i], r.z[i], tmpS);
      if (i === i0) g.moveTo(tmpS.x, tmpS.y); else g.lineTo(tmpS.x, tmpS.y);
    }
    const w = Math.max(5, Math.min(12, 4 * view.ppm));
    g.strokeStyle = ROUTE_EDGE;
    g.lineWidth = w + 4;
    g.stroke();
    g.strokeStyle = ROUTE_COLOR;
    g.lineWidth = w;
    g.stroke();
    stats.routePts = r.n - i0;
    // Chevrons along the line, pointing the way.
    const gap = 64, cs = Math.max(3.5, w * 0.55);
    let carry = gap / 2;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.2;
    toScreen(r.x[i0], r.z[i0], tmpS);
    let px = tmpS.x, py = tmpS.y;
    g.beginPath();
    for (let i = i0 + 1; i < r.n; i++) {
      toScreen(r.x[i], r.z[i], tmpS);
      const dx = tmpS.x - px, dy = tmpS.y - py, L = Math.hypot(dx, dy);
      if (L > 0.01) {
        const ux = dx / L, uy = dy / L;
        let t = carry;
        while (t < L) {
          const x = px + ux * t, y = py + uy * t;
          if (x > -20 && y > -20 && x < cw + 20 && y < ch + 20) {
            g.moveTo(x - ux * cs - uy * cs, y - uy * cs + ux * cs);
            g.lineTo(x, y);
            g.lineTo(x - ux * cs + uy * cs, y - uy * cs - ux * cs);
          }
          t += gap;
        }
        carry = t - L;
      }
      px = tmpS.x; py = tmpS.y;
    }
    g.stroke();
  }

  // Street names along their roads, biggest roads first, never overlapping;
  // a name shows once its stretch is long enough on screen to hold it.
  function drawStreetNames() {
    stats.labels = 0;
    if (!city.nodes || !city.edges) return;
    if (!runs) runs = buildStreetRuns(city);
    if (!runs.length || view.ppm < 0.035) return;
    g.font = '700 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    // The map's own buttons and panels are taken first: no name under them.
    let reserved = 0;
    const cr = canvas.getBoundingClientRect();
    for (const b of [title, northBtn, zoomBox, closeBtn, legend, routeEl, travelBtn]) {
      if (!b || b.hidden || reserved >= 8) continue;
      const r = b.getBoundingClientRect();
      if (!(r.width > 0)) continue;
      const o = reserved * 4;
      runBoxes[o] = r.left - cr.left - 4; runBoxes[o + 1] = r.top - cr.top - 4;
      runBoxes[o + 2] = r.right - cr.left + 4; runBoxes[o + 3] = r.bottom - cr.top + 4;
      reserved++;
    }
    let placed = 0;
    for (let k = 0; k < runs.length && placed < MAX_LABELS; k++) {
      const rn = runs[k];
      const L = rn.len * view.ppm;
      let w = textW.get(rn.short);
      if (w === undefined) { w = g.measureText(rn.short).width; textW.set(rn.short, w); }
      if (L < w + 24) continue;
      toScreen(rn.x0, rn.z0, tmpS);
      const sx0 = tmpS.x, sy0 = tmpS.y;
      toScreen(rn.x1, rn.z1, tmpS);
      const sx1 = tmpS.x, sy1 = tmpS.y;
      if ((sx0 < 0 && sx1 < 0) || (sx0 > cw && sx1 > cw) || (sy0 < 0 && sy1 < 0) || (sy0 > ch && sy1 > ch)) continue;
      let ang = Math.atan2(sy1 - sy0, sx1 - sx0);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      const ca = Math.abs(Math.cos(ang)), sa = Math.abs(Math.sin(ang));
      const hw = w / 2 + 3, hh = 7;
      const ex = ca * hw + sa * hh, ey = sa * hw + ca * hh;
      const count = Math.max(1, Math.min(4, Math.floor(L / (w * 5 + 200))));
      for (let j = 0; j < count && placed < MAX_LABELS; j++) {
        // The slot's middle first, then a little either side, until one is free.
        let x = 0, y = 0, free = false;
        for (let c = 0; c < SLOT_TRY.length && !free; c++) {
          const t = (j + 0.5 + SLOT_TRY[c]) / count;
          x = sx0 + (sx1 - sx0) * t; y = sy0 + (sy1 - sy0) * t;
          if (x < ex || y < ey || x > cw - ex || y > ch - ey) continue; // inside the screen
          let hit = false;
          for (let q = 0; q < placed + reserved && !hit; q++) {
            const o = q * 4;
            hit = x - ex < runBoxes[o + 2] && x + ex > runBoxes[o] && y - ey < runBoxes[o + 3] && y + ey > runBoxes[o + 1];
          }
          free = !hit;
        }
        if (!free) continue;
        // The same name close by already (a divided road's other half): once is enough.
        let twin = false;
        for (let q = 0; q < placed && !twin; q++) {
          if (placedRun[q] !== rn.short) continue;
          const o = (q + reserved) * 4;
          twin = Math.abs((runBoxes[o] + runBoxes[o + 2]) / 2 - x) < 170 && Math.abs((runBoxes[o + 1] + runBoxes[o + 3]) / 2 - y) < 170;
        }
        if (twin) continue;
        placedRun[placed] = rn.short;
        const o = (placed + reserved) * 4;
        runBoxes[o] = x - ex; runBoxes[o + 1] = y - ey; runBoxes[o + 2] = x + ex; runBoxes[o + 3] = y + ey;
        placed++;
        g.save();
        g.translate(x, y);
        g.rotate(ang);
        g.lineWidth = 3.5;
        g.strokeStyle = 'rgba(14, 22, 28, 0.92)';
        g.strokeText(rn.short, 0, 0);
        g.fillStyle = rn.rank >= 3 ? '#fff3c4' : '#f2f2ee';
        g.fillText(rn.short, 0, 0);
        g.restore();
      }
    }
    stats.labels = placed;
  }

  // The route summary pill: "To Waypoint: 1.2 mi, 4 min".
  function paintRouteInfo() {
    const info = routeInfo ? routeInfo() : null;
    const r = info && info.route;
    if (!r || !r.ok) { routeEl.hidden = true; return; }
    const left = Math.max(0, info.remaining !== undefined ? info.remaining : r.length);
    const eta = info.eta !== undefined ? info.eta : r.time;
    routeEl.textContent = (info.label ? info.label + ': ' : '') + formatDistance(left) + ', ' + formatEta(eta) + (r.partial ? ' (nearest road)' : '');
    routeEl.hidden = false;
  }

  function render() {
    dirty = false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COL.sea;
    g.fillRect(0, 0, cw, ch);
    const k = view.ppm / mapRenderer.scale;
    toScreen(-mapRenderer.half, -mapRenderer.half, tmpS);
    g.imageSmoothingQuality = 'high';
    g.drawImage(mapRenderer.canvas, tmpS.x, tmpS.y, mapRenderer.size * k, mapRenderer.size * k);
    // Zoomed past the raster: the roads again as sharp lines.
    stats.roads = 0;
    if (view.ppm > mapRenderer.scale * 1.3) drawRoads();
    // Other regions dimmed: only this region's box is in full color.
    if (crop) {
      toScreen(crop.x0, crop.z0, tmpS);
      const x0 = tmpS.x, y0 = tmpS.y;
      toScreen(crop.x1, crop.z1, tmpS);
      const x1 = tmpS.x, y1 = tmpS.y;
      g.fillStyle = 'rgba(6, 12, 16, 0.55)';
      if (y0 > 0) g.fillRect(0, 0, cw, y0);
      if (y1 < ch) g.fillRect(0, y1, cw, ch - y1);
      if (x0 > 0) g.fillRect(0, Math.max(0, y0), x0, Math.min(ch, y1) - Math.max(0, y0));
      if (x1 < cw) g.fillRect(x1, Math.max(0, y0), cw - x1, Math.min(ch, y1) - Math.max(0, y0));
    }
    drawStreetNames();
    drawRoute();

    // POIs.
    const iconS = 13;
    g.font = '600 12px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const p of city.pois || []) {
      toScreen(p.x, p.z, tmpS);
      if (tmpS.x < -40 || tmpS.y < -40 || tmpS.x > cw + 40 || tmpS.y > ch + 40) continue;
      g.save();
      g.translate(tmpS.x, tmpS.y);
      drawIcon(g, p.type, (POI_STYLE[p.type] || POI_STYLE.race).color, iconS);
      g.restore();
      if (p.label) {
        g.lineWidth = 3.5;
        g.strokeStyle = 'rgba(14, 26, 32, 0.9)';
        g.fillStyle = COL.text;
        g.lineJoin = 'round';
        g.strokeText(p.label, tmpS.x, tmpS.y + iconS + 3);
        g.fillText(p.label, tmpS.x, tmpS.y + iconS + 3);
      }
    }
    // Real places: icons always, names in list order unless one would
    // overlap a name already placed (zoom in to see the rest).
    const lms = city.mapLandmarks;
    if (lms) {
      if (lmBoxes.length < lms.length * 4) lmBoxes = new Float32Array(lms.length * 4);
      let placed = 0;
      g.font = '700 12px system-ui, sans-serif';
      for (let i = 0; i < lms.length; i++) {
        const lm = lms[i];
        toScreen(lm.x, lm.z, tmpS);
        if (tmpS.x < -80 || tmpS.y < -40 || tmpS.x > cw + 80 || tmpS.y > ch + 40) continue;
        g.save();
        g.translate(tmpS.x, tmpS.y - iconS * 0.9);
        drawIcon(g, 'landmark', POI_STYLE.landmark.color, iconS * 0.8);
        g.restore();
        const hw = g.measureText(lm.name).width / 2 + 2, y0 = tmpS.y + 1, y1 = y0 + 15;
        let hit = false;
        for (let k = 0; k < placed && !hit; k++) {
          hit = tmpS.x - hw < lmBoxes[k * 4 + 2] && tmpS.x + hw > lmBoxes[k * 4] && y0 < lmBoxes[k * 4 + 3] && y1 > lmBoxes[k * 4 + 1];
        }
        if (hit) continue;
        lmBoxes[placed * 4] = tmpS.x - hw; lmBoxes[placed * 4 + 1] = y0;
        lmBoxes[placed * 4 + 2] = tmpS.x + hw; lmBoxes[placed * 4 + 3] = y1;
        placed++;
        g.lineWidth = 3.5;
        g.strokeStyle = 'rgba(14, 26, 32, 0.9)';
        g.fillStyle = '#fff6d6';
        g.lineJoin = 'round';
        g.strokeText(lm.name, tmpS.x, tmpS.y + 2);
        g.fillText(lm.name, tmpS.x, tmpS.y + 2);
      }
      g.font = '600 12px system-ui, sans-serif';
    }
    // Activity markers (live list owned by the game).
    const marks = st.markers;
    if (marks) {
      for (let i = 0; i < marks.length; i++) {
        const m = marks[i];
        toScreen(m.x, m.z, tmpS);
        if (tmpS.x < -40 || tmpS.y < -40 || tmpS.x > cw + 40 || tmpS.y > ch + 40) continue;
        const style = ACT_STYLE[m.type];
        const ex = isExplore(m.type);
        g.save();
        g.translate(tmpS.x, tmpS.y);
        if (ex) drawExplore(g, m, iconS, m.r > 0 ? m.r * view.ppm : 0);
        else if (style) drawIcon(g, m.type, m.color || style.color, iconS);
        else { // checkpoints and anything else: a small dot
          g.fillStyle = m.color || '#ffffff';
          g.strokeStyle = '#1a120d';
          g.lineWidth = 2;
          g.beginPath();
          g.arc(0, 0, 5, 0, Math.PI * 2);
          g.stroke(); g.fill();
        }
        g.restore();
        if ((style || (ex && m.type !== 'explore-ring')) && m.label && m.label !== '?' && view.zoom >= LABEL_ZOOM) {
          g.lineWidth = 3.5;
          g.strokeStyle = 'rgba(14, 26, 32, 0.9)';
          g.fillStyle = COL.text;
          g.lineJoin = 'round';
          g.strokeText(m.label, tmpS.x, tmpS.y + iconS + 3);
          g.fillText(m.label, tmpS.x, tmpS.y + iconS + 3);
        }
      }
    }
    if (waypoint) {
      toScreen(waypoint.x, waypoint.z, tmpS);
      drawPin(g, tmpS.x, tmpS.y, 18);
    }
    toScreen(st.x, st.z, tmpS);
    const px = tmpS.x, py = tmpS.y;
    // The current objective (race checkpoint) or the waypoint: a bold ring,
    // a "GO" label and a dashed line from the player, so the way is obvious.
    let goal = null;
    if (marks) for (let i = 0; i < marks.length; i++) if (marks[i].type === 'checkpoint') goal = marks[i];
    if (!goal && waypoint) goal = waypoint;
    if (goal) {
      toScreen(goal.x, goal.z, tmpS);
      g.save();
      if (!stats.routePts) { // no road route: the straight line
        g.setLineDash([8, 7]);
        g.strokeStyle = '#ffd34d';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(px, py);
        g.lineTo(tmpS.x, tmpS.y);
        g.stroke();
        g.setLineDash([]);
      }
      g.fillStyle = 'rgba(255, 211, 77, 0.28)';
      g.strokeStyle = '#ffd34d';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(tmpS.x, tmpS.y, 17, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.font = '800 13px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(14, 26, 32, 0.95)';
      g.fillStyle = '#ffd34d';
      g.strokeText('GO HERE', tmpS.x, tmpS.y - 22);
      g.fillText('GO HERE', tmpS.x, tmpS.y - 22);
      g.restore();
    }
    // You: a big cyan halo, the arrow and a label, unlike every other icon.
    g.save();
    g.fillStyle = 'rgba(80, 220, 255, 0.28)';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(px, py, 24, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
    drawArrow(g, px, py, st.heading + Math.PI / 2, 18);
    g.save();
    g.font = '800 14px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(14, 26, 32, 0.95)';
    g.fillStyle = '#7fe8ff';
    g.strokeText('YOU', px, py + 28);
    g.fillText('YOU', px, py + 28);
    g.restore();
  }

  function schedule() {
    if (dirty || !opened) return;
    dirty = true;
    requestAnimationFrame(() => { if (opened) render(); else dirty = false; });
  }

  function tap(sx, sy) {
    if (waypoint) {
      toScreen(waypoint.x, waypoint.z, tmpS);
      if (Math.hypot(sx - tmpS.x, sy - (tmpS.y - 14)) < 30 || Math.hypot(sx - tmpS.x, sy - tmpS.y) < 30) {
        clearWaypoint(false);
        return;
      }
    }
    toWorld(sx, sy, tmpW);
    waypoint = { x: tmpW.x, z: tmpW.z };
    // Close to a landmark: the waypoint snaps to it and its name shows.
    const lms = city.mapLandmarks;
    let near = null, nearD = LANDMARK_TAP_PX;
    if (lms) {
      for (let i = 0; i < lms.length; i++) {
        toScreen(lms[i].x, lms[i].z, tmpS);
        const d = Math.min(Math.hypot(sx - tmpS.x, sy - tmpS.y), Math.hypot(sx - tmpS.x, sy - (tmpS.y - 12)));
        if (d < nearD) { nearD = d; near = lms[i]; }
      }
    }
    if (near) { waypoint.x = near.x; waypoint.z = near.z; }
    showToast(near ? 'Route to ' + near.name : '');
    if (onWaypoint) onWaypoint({ x: waypoint.x, z: waypoint.z, label: near ? near.name : '' });
    paintRouteInfo();
    schedule();
  }
  function clearWaypoint(say) {
    const had = !!waypoint;
    waypoint = null;
    if (onWaypoint) onWaypoint(null);
    if (say && had) showToast('Destination cleared');
    paintRouteInfo();
    schedule();
  }
  let pressTimer = 0;
  const stopPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; } };
  let toastTimer = 0;
  function showToast(text) {
    toast.textContent = text;
    toast.style.opacity = text ? '1' : '0';
    clearTimeout(toastTimer);
    if (text) toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
  }

  const localPos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function startGesture() {
    const pts = [...pointers.values()];
    if (pts.length === 2) {
      gesture = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        zoom: view.zoom, moved: true,
      };
    } else if (pts.length === 1) {
      gesture = { sx: pts[0].x, sy: pts[0].y, cx: view.cx, cz: view.cz, t: performance.now(), moved: false };
    } else gesture = null;
  }
  // Hold one finger still: the destination is cleared (and the lift is no tap).
  function armPress() {
    stopPress();
    if (pointers.size !== 1 || !gesture || gesture.moved) return;
    const gs = gesture;
    pressTimer = setTimeout(() => {
      pressTimer = 0;
      if (gesture !== gs || gs.moved || pointers.size !== 1) return;
      gs.moved = true;
      clearWaypoint(true);
    }, LONG_PRESS_MS);
  }
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic or ended pointer */ }
    pointers.set(e.pointerId, localPos(e));
    startGesture();
    armPress();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    const p = localPos(e);
    pointers.set(e.pointerId, p);
    const pts = [...pointers.values()];
    if (pts.length >= 2 && gesture.dist) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      setZoom(gesture.zoom * (d / gesture.dist), (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
      schedule();
    } else if (pts.length === 1 && gesture.sx !== undefined) {
      const dx = p.x - gesture.sx, dy = p.y - gesture.sy;
      if (!gesture.moved && Math.hypot(dx, dy) > 10) { gesture.moved = true; stopPress(); }
      if (gesture.moved) {
        view.cx = gesture.cx - dx / view.ppm;
        view.cz = gesture.cz - dy / view.ppm;
        clampView();
        schedule();
      }
    }
  });
  function endPointer(e, canceled) {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    const still = !canceled && pointers.size === 1 && gesture && !gesture.moved;
    const held = still ? performance.now() - gesture.t : 0;
    const wasTap = still && held < LONG_PRESS_MS;
    // A busy frame can hold the timer back: a still finger lifted late is the long press too.
    if (still && !wasTap && pressTimer) { gesture.moved = true; clearWaypoint(true); }
    stopPress();
    pointers.delete(e.pointerId);
    if (wasTap) tap(p.x, p.y);
    startGesture();
    if (gesture) gesture.moved = true; // remaining finger after pinch must not tap
  }
  canvas.addEventListener('pointerup', (e) => endPointer(e, false));
  canvas.addEventListener('pointercancel', (e) => endPointer(e, true));
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = localPos(e);
    setZoom(view.zoom * (e.deltaY < 0 ? 1.2 : 1 / 1.2), p.x, p.y);
    schedule();
  }, { passive: false });

  function close() {
    if (!opened) return;
    opened = false;
    if (travelPanel) { travelPanel.remove(); travelPanel = null; }
    el.classList.remove('rw-map-open');
    pointers.clear();
    gesture = null;
    toast.style.opacity = '0';
    stopPress();
    if (onClose) onClose();
  }
  closeBtn.addEventListener('click', close);
  window.addEventListener('resize', () => { if (opened) { resize(); schedule(); } });

  return {
    open(state) {
      st = { x: state.x, z: state.z, heading: state.heading, markers: state.markers || null };
      waypoint = state.waypoint ? { x: state.waypoint.x, z: state.waypoint.z } : null;
      if (state.northUp !== undefined) { north = !!state.northUp; paintNorth(); }
      buildLegend();
      el.classList.add('rw-map-open');
      opened = true;
      view.zoom = 1;
      resize();
      if (crop) {
        // A real map opens round the player at street-name scale (zoom out for the whole region).
        view.zoom = Math.max(1, Math.min(maxZoom(), STREET_PX_PER_M / fitPpm));
        view.cx = st.x;
        view.cz = st.z;
        // With a destination: both the player and it in view (zoomed out as needed).
        const info = routeInfo ? routeInfo() : null;
        const dest = waypoint || (info && info.route && info.route.ok ? { x: info.route.destX, z: info.route.destZ } : null);
        if (dest) {
          const dx = Math.abs(dest.x - st.x) + 160, dz = Math.abs(dest.z - st.z) + 160;
          const ppm = Math.min((cw - 160) / dx, (ch - 190) / dz);
          view.zoom = Math.max(1, Math.min(view.zoom, ppm / fitPpm));
          view.cx = (dest.x + st.x) / 2;
          view.cz = (dest.z + st.z) / 2;
        }
        view.ppm = fitPpm * view.zoom;
        clampView();
      } else {
        view.cx = 0;
        view.cz = 0;
      }
      paintRouteInfo();
      render();
    },
    close,
    isOpen: () => opened,
    // The destination was cleared or changed outside the map (arrival).
    setWaypoint(p) { waypoint = p ? { x: p.x, z: p.z } : null; paintRouteInfo(); schedule(); },
    // Redraw (the route changed while open).
    refresh() { paintRouteInfo(); schedule(); },
    // Zoom to a level (1 = fit) round the view center; tests and the zoom buttons.
    setZoom(z) { setZoom(z, cw / 2, ch / 2); schedule(); },
    centerOn(x, z) { view.cx = x; view.cz = z; clampView(); schedule(); },
    // What the last frame drew (tests): street names, route points, vector roads.
    getStats: () => ({ labels: stats.labels, routePts: stats.routePts, roads: stats.roads }),
    renderNow: () => { if (opened) render(); },
    // Read-only view info, handy for tests.
    getView: () => ({ cx: view.cx, cz: view.cz, ppm: view.ppm, zoom: view.zoom, width: cw, height: ch }),
  };
}
