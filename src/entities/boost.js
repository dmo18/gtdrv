// Shared boost meter for every craft the player can boost (cars, boats,
// planes, helicopters). Pure logic (no three.js, no DOM), fixed steps only.
//
// An entity carries four fields (see initBoost): boostMeter (1 full, 0
// empty), boostLevel (0..1, eased: how much of the boost is applied now,
// so engine force and the speed cap fade in and out instead of stepping),
// boostLock (true after the meter ran dry, until it has refilled a little)
// and boostOn (true while boost is actually being applied this step).
// stepBoost() is allocation free.
export const BOOST_SECONDS = 6;          // a full meter lasts this long
export const BOOST_REFILL_SECONDS = 12;  // empty to full when not boosting
export const BOOST_RESTART = 0.2;        // after running dry, boost needs this much meter again
export const BOOST_RAMP_UP = 0.3;        // s for the level to rise to 1
export const BOOST_FADE = 3.0;           // s for the level to fall back to 0

// Per craft: force multiplier and top speed gain at full level.
export const CAR_BOOST = { force: 1.6, top: 0.25 };
export const BOAT_BOOST = { force: 1.8, top: 0.3 };

export const PLANE_BOOST = { force: 0.5 };           // extra thrust share for planes without an afterburner
export const HELI_BOOST = { force: 1.6, top: 0.35 };  // forward acceleration and speed gain

export function initBoost(e) {
  e.boostMeter = 1;
  e.boostLevel = 0;
  e.boostLock = false;
  e.boostOn = false;
  return e;
}

// want: the player holds the button and the craft can use it now.
// Returns true while boost is applied. dt is the fixed step.
export function stepBoost(e, want, dt) {
  if (!(e.boostMeter >= 0)) initBoost(e);
  const can = want && !e.boostLock && e.boostMeter > 0;
  if (can) {
    e.boostMeter -= dt / BOOST_SECONDS;
    if (e.boostMeter <= 0) {
      e.boostMeter = 0;
      e.boostLock = true;
    }
  } else {
    e.boostMeter = Math.min(1, e.boostMeter + dt / BOOST_REFILL_SECONDS);
    if (e.boostLock && e.boostMeter >= BOOST_RESTART) e.boostLock = false;
  }
  const on = can && !e.boostLock;
  e.boostOn = on;
  if (on) e.boostLevel = Math.min(1, e.boostLevel + dt / BOOST_RAMP_UP);
  else e.boostLevel = Math.max(0, e.boostLevel - dt / BOOST_FADE);
  return on;
}
