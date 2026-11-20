// Tank gun sight (docs/ARMS.md section 3): a cross where the camera wants
// the gun, a circle where the shell would land now (they merge when the
// turret is on target), a ring around a LOCK target and a reload arc on
// the circle. A small SVG overlay; nothing is built without a DOM.
import { MOUNTS, mountReload } from '../core/weapons.js';
import { barrelRay } from '../entities/tank.js';
import { targetPoint } from '../core/aim.js';

const NS = 'http://www.w3.org/2000/svg';
const RING_C = 2 * Math.PI * 15;

export function createTankHud(root) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'rw-tankhud');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible;display:none;z-index:3';
  const mk = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };
  const shadow = 'rgba(0,0,0,0.55)';
  const cross = mk('g', {});
  mk('path', { d: 'M-14 0h9M5 0h9M0 -14v9M0 5v9', stroke: shadow, 'stroke-width': 4, 'stroke-linecap': 'round', fill: 'none' }, cross);
  mk('path', { d: 'M-14 0h9M5 0h9M0 -14v9M0 5v9', stroke: '#f6efe6', 'stroke-width': 2, 'stroke-linecap': 'round', fill: 'none' }, cross);
  const gun = mk('g', {});
  mk('circle', { r: 15, stroke: shadow, 'stroke-width': 4.5, fill: 'none' }, gun);
  const gunRing = mk('circle', { r: 15, stroke: '#ffcf5a', 'stroke-width': 2.2, fill: 'none' }, gun);
  const reload = mk('circle', {
    r: 15, stroke: '#e2733a', 'stroke-width': 3.2, fill: 'none', transform: 'rotate(-90)',
    'stroke-dasharray': `${RING_C} ${RING_C}`, 'stroke-dashoffset': 0,
  }, gun);
  const lock = mk('g', {});
  mk('rect', { x: -22, y: -22, width: 44, height: 44, rx: 6, stroke: shadow, 'stroke-width': 4.5, fill: 'none' }, lock);
  mk('rect', { x: -22, y: -22, width: 44, height: 44, rx: 6, stroke: '#ff4b3a', 'stroke-width': 2.2, fill: 'none' }, lock);
  root.appendChild(svg);

  const scr = { x: 0, y: 0, ok: false };
  function project(cam, x, y, z, W, H) {
    const m = cam.matrixWorldInverse.elements, pm = cam.projectionMatrix.elements;
    const vx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const vy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const vz = m[2] * x + m[6] * y + m[10] * z + m[14];
    scr.ok = -vz > 0.3;
    if (!scr.ok) return scr;
    const cx = pm[0] * vx + pm[4] * vy + pm[8] * vz + pm[12];
    const cy = pm[1] * vx + pm[5] * vy + pm[9] * vz + pm[13];
    const cw = pm[3] * vx + pm[7] * vy + pm[11] * vz + pm[15];
    scr.x = (cx / cw * 0.5 + 0.5) * W;
    scr.y = (0.5 - cy / cw * 0.5) * H;
    scr.ok = scr.x > -40 && scr.x < W + 40 && scr.y > -40 && scr.y < H + 40;
    return scr;
  }
  const BR = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0, px: 0, py: 0, pz: 0 };
  const tp = { x: 0, y: 0, z: 0 };
  const st = { on: false, cx: '', gx: '', lx: '', lockOn: false, crossOn: false, gunOn: false, off: -1, hot: null };
  const show = (e, v, key) => {
    if (st[key] === v) return;
    st[key] = v;
    e.style.display = v ? '' : 'none';
  };

  return {
    get on() { return st.on; },
    update(t, view, cam, arms) {
      const on = !!t && !!cam && !!cam.matrixWorldInverse;
      if (on !== st.on) {
        st.on = on;
        svg.style.display = on ? '' : 'none';
      }
      if (!on) return;
      const W = window.innerWidth, H = window.innerHeight;
      // Cross: the point the camera asks the gun to hit.
      let crossOn = false;
      if (view.have) {
        project(cam, view.aimX, view.aimY, view.aimZ, W, H);
        if (scr.ok) {
          crossOn = true;
          const k = `translate(${scr.x.toFixed(1)} ${scr.y.toFixed(1)})`;
          if (k !== st.cx) { st.cx = k; cross.setAttribute('transform', k); }
        }
      }
      show(cross, crossOn, 'crossOn');
      // Circle: where a shell fired now would come down at that range.
      barrelRay(t, BR);
      const ax = view.have ? view.aimX - BR.x : BR.dx * 80, az = view.have ? view.aimZ - BR.z : BR.dz * 80;
      const hd = Math.max(8, Math.min(300, Math.sqrt(ax * ax + az * az)));
      const hl = Math.sqrt(BR.dx * BR.dx + BR.dz * BR.dz) || 1;
      const m = MOUNTS.cannon;
      const tf = hd / (m.speed * hl);
      const gy = BR.y + BR.dy * m.speed * tf - 0.5 * 9.81 * m.drop * tf * tf;
      project(cam, BR.x + (BR.dx / hl) * hd, gy, BR.z + (BR.dz / hl) * hd, W, H);
      show(gun, scr.ok, 'gunOn');
      if (scr.ok) {
        const k = `translate(${scr.x.toFixed(1)} ${scr.y.toFixed(1)})`;
        if (k !== st.gx) { st.gx = k; gun.setAttribute('transform', k); }
      }
      // Reload arc (cannon): full ring when ready.
      const r = arms && arms.reloading && arms.reloading.cannon ? mountReload(arms, 'cannon') : 1;
      const off = Math.round((1 - (Number.isFinite(r) ? r : 1)) * RING_C);
      if (off !== st.off) {
        st.off = off;
        reload.setAttribute('stroke-dashoffset', String(off));
        gunRing.setAttribute('stroke', off > 0 ? '#8c8478' : '#ffcf5a');
      }
      // Lock ring.
      let lockOn = false;
      if (view.lock) {
        targetPoint(view.lock, -0.6, tp);
        project(cam, tp.x, tp.y, tp.z, W, H);
        if (scr.ok) {
          lockOn = true;
          const k = `translate(${scr.x.toFixed(1)} ${scr.y.toFixed(1)})`;
          if (k !== st.lx) { st.lx = k; lock.setAttribute('transform', k); }
        }
      }
      show(lock, lockOn, 'lockOn');
    },
  };
}
