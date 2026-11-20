// Fighter extras that are not part of the airframe mesh: the shock ring
// (a cheap "sonic" cone of vapour) when a Gannetfang on afterburner goes
// past SHOCK_V. One pooled additive mesh, hidden when idle (0 draw calls
// most of the time, 1 while a ring shows). The afterburner glow and the
// bomb rack live in aircraftmesh.js; wingtip vapour in effects.js.
import * as THREE from 'three';

export const SHOCK_V = 140; // m/s, crossing upward fires a ring
const REARM_V = 125;
const LIFE = 0.7;

export function createJetFx(game) {
  const armed = new WeakMap(); // craft -> may fire again
  let ring = null, mat = null;
  let life = 0, craft = null;
  if (game.scene) {
    // A short open cone around the fuselage, opening backward (+x is the nose).
    const geo = new THREE.CylinderGeometry(0.35, 1, 1, 20, 1, true);
    geo.rotateZ(-Math.PI / 2); // narrow (+y) end toward the nose (+x)
    mat = new THREE.MeshBasicMaterial({
      color: 0xf4f8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    ring = new THREE.Mesh(geo, mat);
    ring.visible = false;
    ring.frustumCulled = false;
    ring.rotation.order = 'YZX';
    ring.renderOrder = 6;
    game.scene.add(ring);
  }
  return {
    name: 'jetfx',
    get active() { return life > 0; },
    fixedUpdate(dt) {
      const vs = game.vehicles;
      for (let i = 0; i < vs.length; i++) {
        const v = vs[i];
        if (!v.spec || v.spec.id !== 'fighter' || v.asleep) continue;
        const sp = v.airspeed || 0;
        const ok = armed.get(v) !== false;
        if (ok && sp > SHOCK_V && !v.onGround && !v.wrecked) {
          armed.set(v, false);
          craft = v;
          life = LIFE;
          if (game.events && game.events.emit) game.events.emit('shockRing', v);
        } else if (!ok && sp < REARM_V) armed.set(v, true);
      }
      if (life > 0) life = Math.max(0, life - dt);
    },
    render() {
      if (!ring) return;
      const c = craft;
      ring.visible = life > 0 && !!c && !c.removed;
      if (!ring.visible) return;
      const t = 1 - life / LIFE; // 0..1
      const s = c.spec;
      ring.position.set(c.x, (c.y || 0) + s.height * 0.5, c.z);
      ring.rotation.set(c.roll || 0, -c.heading, c.pitch || 0);
      const r = s.width * (0.35 + 0.5 * t);
      ring.scale.set(s.length * (0.4 + 0.3 * t), r, r);
      mat.opacity = 0.5 * (1 - t) * (1 - t);
    },
  };
}
