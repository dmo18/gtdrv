// Tank playback (task 32): the 'tracks' engine rig for the player's tank
// (diesel rumble by track speed, clank layer, pivot squeal, turret motor)
// plus the crush crunch. audio.js builds it with its own node helpers
// and calls these from its player-rig and event code; the buffers come
// from src/audio/tanksounds.js through banks.js.
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);

// api: { gainNode(v, dest), biq(type, f, q, dest), loopSrc(name, dest, rate),
//        set(param, v, now, tc), bus, playAt(name, x, z, range, gain, rate) }
export function createTankRig(api) {
  return {
    build() {
      const { gainNode, biq, loopSrc, bus } = api;
      const out = gainNode(0, bus.engine);
      const lp = biq('lowpass', 900, 0.6, out);
      const rumG = gainNode(0, lp);
      const squealG = gainNode(0, out);
      const turG = gainNode(0, bus.effects);
      const s1 = loopSrc('tankTracks', rumG, 0.7);
      const s2 = loopSrc('tankTracks', squealG, 2.2);
      const s3 = loopSrc('tankTurret', turG, 1);
      return { kind: 'tracks', out, lp, rumG, squealG, turG, srcs: [s1, s2, s3], s1, s2, s3, prevYaw: NaN };
    },
    update(r, c, now, dt) {
      const { set } = api;
      const spec = c.spec || {};
      const maxS = spec.maxSpeed || 13;
      const tl = Math.abs(fin(c.trackL)), tr = Math.abs(fin(c.trackR));
      const track = clamp(Math.max(tl, tr) / maxS, 0, 1.3);
      const th = clamp(fin(c.throttle) + fin(c.brake) * 0.6 + Math.abs(fin(c.steer)) * 0.5, 0, 1);
      const live = !c.wrecked && !c.bailed;
      // Diesel: idles, pitch and grit up with load and track speed.
      if (r.s1) set(r.s1.playbackRate, 0.62 + 0.55 * track + 0.18 * th, now, 0.12);
      set(r.lp.frequency, 500 + 1500 * Math.max(track, th * 0.7), now, 0.15);
      set(r.rumG.gain, live ? 0.55 + 0.3 * th + 0.2 * track : 0, now, 0.15);
      // Pivot squeal: the tracks running opposite ways.
      const pivot = live && fin(c.trackL) * fin(c.trackR) < 0 ? clamp(Math.min(tl, tr) / 1.2, 0, 1) : 0;
      if (r.s2) set(r.s2.playbackRate, 2.0 + 0.4 * pivot, now, 0.1);
      set(r.squealG.gain, 0.22 * pivot, now, 0.08);
      // Turret motor while it traverses.
      const yaw = fin(c.turretYaw);
      let rate = 0;
      if (Number.isFinite(r.prevYaw) && dt > 0) {
        let d = yaw - r.prevYaw;
        if (d > Math.PI) d -= Math.PI * 2;
        else if (d < -Math.PI) d += Math.PI * 2;
        rate = Math.abs(d) / dt;
      }
      r.prevYaw = yaw;
      const mot = live ? clamp(rate / ((spec.traverse || 1.6) * 0.8), 0, 1) : 0;
      if (r.s3) set(r.s3.playbackRate, 0.8 + 0.35 * mot, now, 0.06);
      set(r.turG.gain, 0.3 * mot, now, 0.06);
      set(r.out.gain, 0.8, now, 0.2);
    },
    // `crush` {tank, target, x, z}: a car crumples, a bench splinters.
    crush(e) {
      if (!e) return;
      api.playAt('tankCrush', fin(e.x), fin(e.z), 90, e.target ? 1 : 0.55, e.target ? 0.9 : 1.35);
    },
  };
}
