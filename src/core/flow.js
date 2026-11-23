// Flow: the moment-to-moment loop (docs/LOOP.md section a). Pure logic,
// fixed steps, no DOM, no three.js, no allocation per step.
//
// A run collects points from sources (near misses, drifts, air time, clean
// passes, speed, takedowns, smashes, escapes). Each source also fills the
// meter; a full meter raises the multiplier one tier (x1 to x5). The meter
// holds for a moment after every source, then drains; an empty meter costs
// one tier. The run is BANKED into the score by stopping at a safe spot
// (bonus per tier), by finishing a street event, or when the flow has gone
// cold. A hard crash costs tiers and a share of the run, a wreck or a bust
// the whole run. The banked score is never touched.
export const TIER_MAX = 5;
export const FILL = { // meter units per source (1.0 is one tier at x1)
  nearMiss: 0.25, oncoming: 0.35, shave: 0.1, overtake: 0.12, drift: 0.2, air: 0.3, jump: 0.3, speed: 0.03,
  takedown: 0.4, chain: 0.6, smash: 0.07, escape: 1, stunt: 0.5, event: 0.5, other: 0.1,
};
export const FILL_PER_SECOND = { drift: 0.2, air: 0.15 }; // extra fill for a long drift or flight (seconds)
export const FILL_CAP = 0.8; // one source never fills more than this (escape: a whole tier)
export const TIER_COST = 0.35; // each tier needs this much more meter than the one before
export const CARRY = 0.3; // meter left after a tier up
export const HOLD_S = 3.2, HOLD_STEP = 0.4; // seconds before the drain starts: 3.2 at x1, 1.6 at x5
export const DRAIN = 0.18, DRAIN_STEP = 0.05; // meter per second: 0.18 at x1, 0.38 at x5
export const FAST_MPS = 22.35; // 50 mph: driving faster halves the drain
export const SPEED_MPS = 31.3; // 70 mph: faster than this is a source (every SPEED_TICK seconds)
export const SPEED_TICK = 0.5, SPEED_POINTS = 10;
export const DROP_REFILL = 0.5; // meter after losing a tier
export const COOL_S = 4; // seconds empty at x1 before the run banks by itself
export const BANK_SPEED = 1, BANK_STILL_S = 0.7; // m/s and seconds standing still to bank
export const BANK_BONUS = 0.1; // share of the run added per tier above x1 for a deliberate bank
export const CRASH_MPS = 8; // an impact harder than this is a hard crash
export const CRASH_TIERS = 2, CRASH_LOSS = 0.2; // tiers and share of the run lost
export const CRASH_GAP_S = 1; // one crash penalty per this long
export const MAX_RUN = 1000000, MAX_EVENT = 20000;

const need = (tier) => 1 + TIER_COST * (tier - 1);

// emit(kind, a, b): 'feed' (source, points), 'tier' (new tier, up),
// 'bank' (amount, how: 'stop' | 'cool' | 'event'), 'crash' (lost, tier),
// 'wipe' (lost). Optional.
export function createFlow(emit = null) {
  const st = {
    run: 0, // points not banked yet
    tier: 1,
    meter: 0, // 0..1 of the current tier
    hold: 0, // seconds until the drain starts
    cold: 0, // seconds empty at x1
    still: 0, // seconds standing still
    speedT: 0,
    crashGap: 0,
    count: 0, // sources in this run
    peak: 1, // highest tier of this run
    banked: 0, // total banked through this object
    best: 0, // biggest single bank
    last: '', // last source (for the HUD)
  };
  const say = emit || (() => {});

  // A source. Returns the points added to the run (after the multiplier).
  // `seconds`: length of a drift or flight, for the extra fill.
  st.feed = function feed(kind, points, seconds = 0) {
    if (!(points > 0) || !Number.isFinite(points)) return 0;
    const src = Object.hasOwn(FILL, kind) ? kind : 'other';
    const amount = Math.min(MAX_EVENT, Math.round(points)) * st.tier;
    st.run = Math.min(MAX_RUN, st.run + amount);
    st.count++;
    st.last = src;
    let f = FILL[src] + (FILL_PER_SECOND[src] || 0) * Math.max(0, seconds || 0);
    if (src !== 'escape' && f > FILL_CAP) f = FILL_CAP;
    st.meter += f / need(st.tier);
    st.cold = 0;
    say('feed', src, amount);
    while (st.meter >= 1 && st.tier < TIER_MAX) {
      const over = (st.meter - 1) * need(st.tier);
      st.tier++;
      if (st.tier > st.peak) st.peak = st.tier;
      st.meter = Math.min(1, CARRY + over / need(st.tier));
      say('tier', st.tier, true);
    }
    if (st.meter > 1) st.meter = 1;
    st.hold = HOLD_S - HOLD_STEP * (st.tier - 1);
    return amount;
  };

  function reset() {
    st.run = 0;
    st.tier = 1;
    st.meter = 0;
    st.hold = 0;
    st.cold = 0;
    st.count = 0;
    st.peak = 1;
    st.last = '';
  }

  // Bank the run. how: 'stop' (bonus per tier), 'event' (bonus per tier),
  // 'cool' (no bonus). Returns the points banked.
  st.bank = function bank(how = 'stop') {
    if (!(st.run > 0)) { reset(); return 0; }
    const bonus = how === 'cool' ? 0 : Math.round(st.run * BANK_BONUS * (st.tier - 1));
    const amount = Math.min(MAX_RUN, st.run + bonus);
    st.banked += amount;
    if (amount > st.best) st.best = amount;
    const tier = st.tier;
    reset();
    say('bank', amount, how, tier);
    return amount;
  };

  // A hard crash: tiers and a share of the run. Returns the points lost.
  st.crash = function crash() {
    if (st.crashGap > 0) return 0;
    st.crashGap = CRASH_GAP_S;
    if (st.tier === 1 && !(st.run > 0)) return 0;
    const lost = Math.round(st.run * CRASH_LOSS);
    st.run -= lost;
    st.tier = Math.max(1, st.tier - CRASH_TIERS);
    st.meter = 0;
    st.hold = 0;
    say('crash', lost, st.tier);
    return lost;
  };

  // Wrecked, busted or downed: the whole run is gone.
  st.wipe = function wipe() {
    const lost = st.run;
    const had = lost > 0 || st.tier > 1;
    reset();
    if (had) say('wipe', lost);
    return lost;
  };

  // One fixed step. facts: { speed (m/s, absolute), driving (in a car or
  // boat), airborne, wanted (stars > 0), canBank (false holds the bank
  // back, e.g. a running event) }.
  st.step = function step(dt, facts) {
    if (!(dt > 0)) return;
    const speed = facts ? +facts.speed || 0 : 0;
    const driving = !!(facts && facts.driving);
    const air = !!(facts && facts.airborne);
    if (st.crashGap > 0) st.crashGap -= dt;
    // Speed as a source.
    if (driving && !air && speed >= SPEED_MPS) {
      st.speedT += dt;
      if (st.speedT >= SPEED_TICK) {
        st.speedT -= SPEED_TICK;
        st.feed('speed', SPEED_POINTS);
      }
    } else st.speedT = 0;
    // Hold, then drain (frozen in the air, halved at speed).
    if (st.hold > 0) st.hold -= dt;
    else if (!air && (st.meter > 0 || st.tier > 1)) {
      const rate = (DRAIN + DRAIN_STEP * (st.tier - 1)) * (driving && speed >= FAST_MPS ? 0.5 : 1);
      st.meter -= rate * dt;
      if (st.meter <= 0) {
        if (st.tier > 1) {
          st.tier--;
          st.meter = DROP_REFILL;
          say('tier', st.tier, false);
        } else st.meter = 0;
      }
    }
    if (!(st.run > 0)) { st.still = 0; st.cold = 0; return; }
    const wanted = !!(facts && facts.wanted);
    const may = !facts || facts.canBank !== false;
    // Standing still at a safe spot banks the run.
    if (may && !wanted && speed < BANK_SPEED && !air) {
      st.still += dt;
      if (st.still >= BANK_STILL_S) { st.still = 0; st.bank('stop'); return; }
    } else st.still = 0;
    // A cold flow banks by itself, without the bonus.
    if (may && !wanted && st.tier === 1 && st.meter <= 0 && st.hold <= 0) {
      st.cold += dt;
      if (st.cold >= COOL_S) { st.cold = 0; st.bank('cool'); }
    } else st.cold = 0;
  };

  st.reset = reset;
  return st;
}
