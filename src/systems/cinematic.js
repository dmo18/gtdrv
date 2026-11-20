// Big moments: a short slow-motion beat on a big kill or blast, and a
// camera that pulls back and to the side when a vehicle explodes near the
// player. The rules (slow-mo gate and ramp, pull-back curve, kill test) are
// pure and run in node tests; the system wires them to game events and owns
// a small CSS vignette overlay, guarded so it works without `document`.
//
// Time scale: `game.timeScale` (1 normal) is read by core/loop.js, which
// scales REAL time before it goes into the fixed-step accumulator. Systems
// still see dt = 1/60, so physics stays deterministic. The slow-mo clock
// itself runs in real time (it is a presentation effect, not game logic).
import { clamp } from '../core/rng.js';

export const SLOWMO = {
  duration: 0.8, // s of real time
  scale: 0.35, // simulation speed at the deepest point
  ramp: 0.12, // s to ease in and out
  gap: 6, // s of real time between two slow-motion moments (from the start of one)
  zoom: 0.04, // FOV shrinks by this fraction at the deepest point
  enemyRange: 45, // "last enemy near the player" radius, m
};
export const PULL = {
  duration: 1.5, // s
  range: 40, // m: blasts farther than this do not move the camera
  yaw: 0.55, // rad to the side at the peak
  dist: 5, // m further back at the peak
  rise: 1.6, // m higher at the peak
};

const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

// Slow-motion state machine. update(realDt) advances it; `scale` and
// `k` (0..1 strength, for the overlay and zoom) are read after.
export function createSlowMo(cfg = SLOWMO) {
  const s = {
    t: 0, // real seconds into the current moment (valid while active)
    active: false,
    cool: 0, // real seconds until the next one may start
    scale: 1,
    k: 0,
    count: 0,
    trigger() {
      if (s.active || s.cool > 0) return false;
      s.active = true;
      s.t = 0;
      s.cool = cfg.gap;
      s.count++;
      return true;
    },
    update(dt) {
      if (s.cool > 0) s.cool = Math.max(0, s.cool - dt);
      if (!s.active) {
        s.k = 0;
        s.scale = 1;
        return s.scale;
      }
      s.t += dt;
      if (s.t >= cfg.duration) {
        s.active = false;
        s.k = 0;
        s.scale = 1;
        return s.scale;
      }
      s.k = Math.min(smooth(s.t / cfg.ramp), smooth((cfg.duration - s.t) / cfg.ramp));
      s.scale = 1 + (cfg.scale - 1) * s.k;
      return s.scale;
    },
    reset() {
      s.active = false;
      s.t = 0;
      s.k = 0;
      s.scale = 1;
    },
  };
  return s;
}

// Pull-back strength 0..1..0 over u = t / duration: eases out to the
// peak by u = 0.3, holds a moment, then eases home.
export function pullCurve(u) {
  if (!(u > 0) || u >= 1) return 0;
  return smooth(u / 0.3) * (1 - smooth((u - 0.5) / 0.5));
}

// One pull-back. start(side) begins (side = +1 or -1, which way it swings);
// update(dt, cancelled) advances and fills `out` (yaw, dist, rise).
export function createPullback(cfg = PULL) {
  const p = { active: false, t: 0, side: 1, yaw: 0, dist: 0, rise: 0, k: 0 };
  p.start = (side = 1) => {
    p.active = true;
    p.t = 0;
    p.side = side < 0 ? -1 : 1;
  };
  p.update = (dt, cancelled = false) => {
    if (p.active) {
      p.t += dt;
      if (cancelled || p.t >= cfg.duration) p.active = false;
    }
    p.k = p.active ? pullCurve(p.t / cfg.duration) : 0;
    p.yaw = p.k * cfg.yaw * p.side;
    p.dist = p.k * cfg.dist;
    p.rise = p.k * cfg.rise;
    return p;
  };
  return p;
}

// Does this takedown call for slow motion? `target` is what went down.
// `hostiles` is a function (x, z, range, except) -> count of other live
// enemies near the player, supplied by the system.
export function isBigKill(kind, target, isCraftTarget, othersNear) {
  if (isCraftTarget) return kind === 'blast';
  if (!target) return false;
  if (target.team === 'police') return true;
  return (target.team === 'crew' || target.team === 'hostile') && othersNear === 0;
}

export function createCinematic(game, uiRoot) {
  const slow = createSlowMo();
  const pull = createPullback();
  game.timeScale = 1;
  game.slowmo = slow;
  let overlay = null;
  let lastOp = -1;
  const reduced = () => !!(game.progress && game.progress.settings && game.progress.settings.reduceMotion);

  if (typeof document !== 'undefined' && uiRoot && uiRoot.appendChild) {
    overlay = document.createElement('div');
    overlay.className = 'rw-slowmo';
    overlay.setAttribute('aria-hidden', 'true');
    uiRoot.appendChild(overlay);
  }

  function enemiesNear(except) {
    const list = game.actors, p = game.player;
    if (!list) return 0;
    const r2 = SLOWMO.enemyRange * SLOWMO.enemyRange;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a === except || !(a.team === 'crew' || a.team === 'police')) continue;
      if (a.life !== 'ok' && a.life !== 'getup') continue;
      const dx = a.x - p.x, dz = a.z - p.z;
      if (dx * dx + dz * dz < r2) n++;
    }
    return n;
  }

  const ev = game.events;
  if (ev) {
    ev.on('takedown', (e) => {
      if (reduced()) return;
      const craft = !!(e.target && e.target.spec && typeof e.target.health === 'number' && e.target.hp === undefined);
      if (isBigKill(e.kind, e.target, craft, craft ? 0 : enemiesNear(e.target))) slow.trigger();
    });
    ev.on('explosion', (e) => {
      if (!e.craft || e.puff || reduced() || pull.active) return;
      const p = game.player;
      const dx = e.x - p.x, dz = e.z - p.z;
      if (dx * dx + dz * dz > PULL.range * PULL.range) return;
      // Swing to the side away from the blast.
      const h = game.camHeading || 0;
      const side = (dx * -Math.sin(h) + dz * Math.cos(h)) > 0 ? -1 : 1;
      if (game.chase && game.chase.fx) game.chase.fx.touched = false;
      pull.start(side);
    });
  }

  return {
    name: 'cinematic',
    slow,
    pull,
    render(alpha, dt) {
      if (game.paused || !(dt > 0)) return;
      game.timeScale = reduced() ? 1 : slow.update(dt);
      if (reduced()) slow.reset();
      const fx = game.chase && game.chase.fx;
      pull.update(dt, !!(fx && fx.touched) || reduced());
      if (fx) {
        if (pull.active || fx.dist !== 0 || fx.yaw !== 0 || fx.rise !== 0) {
          fx.yaw = pull.yaw;
          fx.dist = pull.dist;
          fx.rise = pull.rise;
        }
        fx.zoom = slow.k * SLOWMO.zoom;
        if (!pull.active) fx.touched = false;
      }
      if (overlay) {
        const op = Math.round(slow.k * 20) / 20;
        if (op !== lastOp) {
          lastOp = op;
          overlay.style.opacity = String(op);
        }
      }
    },
  };
}
