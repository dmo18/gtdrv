// Handling lab presets (docs/PLAN_V3.md 2.4 item 5, first form). Pure data and
// three tiny functions, no three.js, no DOM. The player's pick is stored as
// settings.handlingPreset (an enum; absent reads as 'standard') and the last
// one-tap verdict as settings.handlingVerdict (absent reads as 'none').
//
// One table, PRESET_VALUES, read by the car model (entities/vehicle.js
// setHandlingPreset and every step) and by the lab; 'standard' is the
// Arcade target of task PLANTED (docs/REVAMP.md 6.3: planted, sharp,
// direct), every multiplier 1:
//   lockK / returnK  steering rate multipliers (to full lock, back to center)
//   lockDeg          lowest full-lock wheel angle at walking pace in either
//                    mode (0: the spec's, or Arcade's 40 degrees for cars)
//   lockAdd          degrees added to Arcade's lock (Sharp 44)
//   gripK            lateral grip multiplier (both modes)
//   gainK            share of Arcade's grip gain over the real car kept
//                    (Arcade 1.6 times the table in town: Relaxed 1.42)
//   rollK            body roll multiplier
//   shapeK           Sim: player input shaping by speed (vehicle.js
//                    steerShapeExp): multiplier on the exponent's rise
//                    above 1 (more is finer at speed, less is more direct)
//   arcShape         Arcade: the player's shaping exponent from 70 mph up
//                    (task GRIP: Standard 1.4, small thumb moves stay
//                    small on the highway; Sharp 1, linear; Relaxed 1.6)
//   turnK            Arcade: share of the player's full-input turn
//                    (vehicle.js playerLatG: Standard about 2.6 g at 60 to
//                    100 mph; Relaxed less, Sharp more)
// Relaxed is gentler (less grip gain, slower steering, more roll); Sharp is quicker and cuts further (Sim too: lockDeg).
// (assistK went with the Arcade stability assist: the planted model has none.)
export const PRESETS = ['standard', 'relaxed', 'sharp'];
export const PRESET_LABELS = { standard: 'Standard', relaxed: 'Relaxed', sharp: 'Sharp' };
export const PRESET_VALUES = Object.freeze({
  standard: Object.freeze({ lockK: 1, returnK: 1, lockDeg: 0, lockAdd: 0, gripK: 1, gainK: 1, rollK: 1, shapeK: 1, arcShape: 1.4, turnK: 1 }),
  relaxed: Object.freeze({ lockK: 0.7, returnK: 0.8, lockDeg: 0, lockAdd: 0, gripK: 1, gainK: 0.7, rollK: 1.3, shapeK: 1.25, arcShape: 1.6, turnK: 0.8 }),
  sharp: Object.freeze({ lockK: 1.25, returnK: 1.2, lockDeg: 40, lockAdd: 4, gripK: 1, gainK: 1, rollK: 0.85, shapeK: 0.5, arcShape: 1, turnK: 1.1 }),
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
