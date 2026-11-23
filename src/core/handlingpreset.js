// Handling lab presets (docs/PLAN_V3.md 2.4 item 5, first form). Pure data and
// three tiny functions, no three.js, no DOM. The player's pick is stored as
// settings.handlingPreset (an enum; absent reads as 'standard') and the last
// one-tap verdict as settings.handlingVerdict (absent reads as 'none').
//
// One table, PRESET_VALUES, read by the car model (entities/vehicle.js
// setHandlingPreset and every step) and by the lab; 'standard' is today's
// car (every multiplier 1, no lock floor):
//   lockK / returnK  steering rate multipliers (to full lock, back to center)
//   lockDeg          lowest full-lock wheel angle at walking pace (0: the spec's;
//                    Sharp's 40 degrees is past every car's own 33 to 36, a
//                    circle about 0.8 of Standard's)
//   gripK            lateral grip multiplier
//   assistK          stability assist (yaw and slide) gain multiplier
//   rollK            body roll multiplier
//   shapeK           player input shaping by speed (vehicle.js steerShapeExp):
//                    multiplier on the exponent's rise above 1 (more is
//                    finer at speed, less is more direct)
export const PRESETS = ['standard', 'relaxed', 'sharp'];
export const PRESET_LABELS = { standard: 'Standard', relaxed: 'Relaxed', sharp: 'Sharp' };
export const PRESET_VALUES = Object.freeze({
  standard: Object.freeze({ lockK: 1, returnK: 1, lockDeg: 0, gripK: 1, assistK: 1, rollK: 1, shapeK: 1 }),
  relaxed: Object.freeze({ lockK: 0.8, returnK: 0.85, lockDeg: 0, gripK: 0.95, assistK: 0.85, rollK: 1.3, shapeK: 1.2 }),
  sharp: Object.freeze({ lockK: 1.25, returnK: 1.2, lockDeg: 40, gripK: 1, assistK: 1.25, rollK: 0.85, shapeK: 0.75 }),
});

// Verdict ids, their button text and the Phone check token (the id itself).
export const VERDICTS = ['right', 'twitchy', 'heavy', 'wide'];
export const VERDICT_LABELS = {
  right: 'This feels right', twitchy: 'Too twitchy', heavy: 'Too heavy', wide: 'Turns too wide',
};

export const validPreset = (name) => (typeof name === 'string' && PRESETS.includes(name) ? name : 'standard');
export const validVerdict = (name) => (typeof name === 'string' && VERDICTS.includes(name) ? name : 'none');

let active = 'standard';
// The preset every car uses (module-wide, like the handling mode): set
// through entities/vehicle.js setHandlingPreset (the menu at load and on
// change, the economy at start). Returns the name set.
export function setActivePreset(name) { active = validPreset(name); return active; }
export function activePreset() { return active; }
// The numbers of a preset (the active one with no argument). Frozen, never allocates.
export function presetValues(name) { return PRESET_VALUES[name === undefined ? active : validPreset(name)]; }
