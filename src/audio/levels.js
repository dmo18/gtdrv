// Volume model (pure, no Web Audio). Like other games:
//   master scales everything; music, effects and ambience each have their
//   own slider inside the master; mute silences all without moving sliders.
// Effective level of a sound = master * category. The audio graph applies
// `master` on the master node and `music`/`effects`/`ambience` on the
// category buses, so every category ends in the master.

const c01 = (v, d) => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : d);

// Which category each bus in audio.js belongs to.
export const BUS_CATEGORY = {
  music: 'music',
  world: 'ambience', // city, birds, wind, surf, rain, cabin wind
  engine: 'effects',
  tires: 'effects',
  effects: 'effects',
  ui: 'effects',
};

// vol: { master, music, musicOn, sfx, ambience, muteAll } (each 0..1 / bool).
export function categoryLevels(vol, muted = false) {
  const off = !!(muted || (vol && vol.muteAll));
  const master = off ? 0 : c01(vol && vol.master, 0.8);
  const music = vol && vol.musicOn === false ? 0 : c01(vol && vol.music, 0.5);
  const effects = c01(vol && vol.sfx, 1);
  const ambience = c01(vol && vol.ambience, 1);
  return {
    master,
    music,
    effects,
    ambience,
    // what the listener gets, before the per-bus mixing trims
    effective: { music: master * music, effects: master * effects, ambience: master * ambience },
  };
}

// The setVolume() argument for a saved settings object (older saves lack
// the newer keys: each falls back to its default).
export function volumeFromSettings(s) {
  return {
    master: s.master,
    musicOn: s.music !== false,
    music: Number.isFinite(s.musicVol) ? s.musicVol : 0.5,
    sfx: Number.isFinite(s.sfxVol) ? s.sfxVol : 1,
    ambience: Number.isFinite(s.ambVol) ? s.ambVol : 1,
    muteAll: s.muteAll === true,
  };
}
