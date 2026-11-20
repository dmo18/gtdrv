// Small pure helpers for hard mode (settings.mortal): the health meter
// fraction and where the RESPAWN button puts the player.

// Health as 0..1. Bad input (NaN, negative max) reads as empty.
export function healthFraction(hp, max) {
  if (!Number.isFinite(hp) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, hp / max));
}

// What the meter shows: the craft's health while aboard (a 0..1 fraction,
// or null on foot), otherwise the walker's hp out of maxHp. Whole percent.
export function meterPercent(hp, maxHp, craftFrac) {
  const f = craftFrac !== null && craftFrac !== undefined ? healthFraction(craftFrac, 1) : healthFraction(hp, maxHp);
  return Math.round(f * 100);
}

// Where the player is put by RESPAWN. In a craft the craft stays where it
// is and the player is set down on dry land near it: `rescue(x, z, out)`
// (game.findRescueSpot, sets out.ok/x/z) is asked about a point 4 m to the
// craft's right so they do not land inside the hull; if it has no usable
// answer, `fallback(x, z, out)` (combat.respawnSpot) decides. On foot the
// fallback (a quiet road node) is always used.
// Returns `out` with `out.craftSide` true when the craft rule was used.
export function respawnPlacement(inCraft, x, z, heading, rescue, fallback, out) {
  out.craftSide = false;
  if (inCraft && typeof rescue === 'function') {
    const px = x - Math.sin(heading) * 4, pz = z + Math.cos(heading) * 4;
    out.ok = false;
    rescue(Number.isFinite(px) ? px : x, Number.isFinite(pz) ? pz : z, out);
    if (out.ok && Number.isFinite(out.x) && Number.isFinite(out.z)) {
      out.craftSide = true;
      return out;
    }
  }
  fallback(x, z, out);
  out.ok = true;
  return out;
}
