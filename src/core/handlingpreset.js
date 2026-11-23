// Handling lab presets (docs/PLAN_V3.md 2.4 item 5, first form). Pure data and
// three tiny functions, no three.js, no DOM. The player's pick is stored as
// settings.handlingPreset (an enum; absent reads as 'standard') and the last
// one-tap verdict as settings.handlingVerdict (absent reads as 'none').
//
// Values, all 1 or 0 for 'standard' (today's model, nothing changes):
//   lockScale      steering lock scale: multiplies the steer share at every speed.
//   speedReduction speed-sensitive steering reduction: the share of the lock taken
//                  away at SPEED_FULL m/s and above (0 = none).
//   gripFeel       grip feel scale for the model's grip (1 = today). Informative
//                  until the HANDLE model task reads it.
export const PRESETS = ['standard', 'relaxed', 'sharp'];
export const PRESET_LABELS = { standard: 'Standard', relaxed: 'Relaxed', sharp: 'Sharp' };
export const PRESET_VALUES = Object.freeze({
  standard: Object.freeze({ lockScale: 1, speedReduction: 0, gripFeel: 1 }),
  relaxed: Object.freeze({ lockScale: 0.85, speedReduction: 0.25, gripFeel: 0.94 }),
  sharp: Object.freeze({ lockScale: 1.15, speedReduction: 0.05, gripFeel: 1.06 }),
});
export const SPEED_FULL = 30; // m/s, about 67 mph

// Verdict ids, their button text and the Phone check token (the id itself).
export const VERDICTS = ['right', 'twitchy', 'heavy', 'wide'];
export const VERDICT_LABELS = {
  right: 'This feels right', twitchy: 'Too twitchy', heavy: 'Too heavy', wide: 'Turns too wide',
};

export const validPreset = (name) => (typeof name === 'string' && PRESETS.includes(name) ? name : 'standard');
export const validVerdict = (name) => (typeof name === 'string' && VERDICTS.includes(name) ? name : 'none');

let active = 'standard';
// The preset every car uses (module-wide, like the handling mode). Returns the name set.
export function setActivePreset(name) { active = validPreset(name); return active; }
export function activePreset() { return active; }
// The numbers of a preset (the active one with no argument). Frozen, never allocates.
export function presetValues(name) { return PRESET_VALUES[name === undefined ? active : validPreset(name)]; }
// Steer share multiplier at speed u (m/s) for the active preset (or `name`).
export function steerScale(u, name) {
  const p = presetValues(name);
  const k = u < 0 ? -u : u;
  return p.lockScale * (1 - p.speedReduction * (k >= SPEED_FULL ? 1 : k / SPEED_FULL));
}
