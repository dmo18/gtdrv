// Accessibility settings (0.13.0, PLAN_V4 task 16). Pure rules: the allowed
// values, the save sanitizer step and what each switch means. The DOM and
// the camera are touched by applyAccess(), which guards for node tests.
//
//   textSize     'normal' (default) | 'large'   HUD text, one CSS variable
//   reduceMotion boolean   no camera kick, no screen shake, no hit-stop
//   highContrast boolean   stronger outlines and darker pills on the HUD
//   colorSafe    boolean   gate and objective markers add a shape to the color

export const TEXT_SIZES = Object.freeze(['normal', 'large']);
export const TEXT_SCALE = Object.freeze({ normal: 1, large: 1.15 });
export const ACCESS_BOOLS = Object.freeze(['reduceMotion', 'highContrast', 'colorSafe']);
export const ACCESS_DEFAULTS = Object.freeze({ textSize: 'normal', reduceMotion: false, highContrast: false, colorSafe: false });

// Save sanitizer step: copies only valid values from `src` into `dst`.
// Anything else (wrong type, unknown text size) leaves the default alone.
export function sanitizeAccess(src, dst) {
  if (src === null || typeof src !== 'object') return dst;
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k);
  if (has('textSize') && typeof src.textSize === 'string' && TEXT_SIZES.includes(src.textSize)) dst.textSize = src.textSize;
  for (const k of ACCESS_BOOLS) {
    if (has(k) && typeof src[k] === 'boolean') dst[k] = src[k];
  }
  return dst;
}

export const textScale = (s) => TEXT_SCALE[s && s.textSize] || 1;
export const isLarge = (s) => !!s && s.textSize === 'large';
export const isCalm = (s) => !!s && s.reduceMotion === true;
export const isColorSafe = (s) => !!s && s.colorSafe === true;

// Color-safe marker palette (blue / orange / white differ for most color
// vision types) and the extra shape each checkpoint style carries:
// next = one arrow, finish = a big arrow on a wide tube, after = none.
export const SAFE_COLORS = Object.freeze({ next: 0xffb000, after: 0x56b4e9, finish: 0xffffff, passed: 0xcccccc });
const CUES = Object.freeze({
  next: Object.freeze({ arrow: true, arrowScale: 1, wide: 1 }),
  finish: Object.freeze({ arrow: true, arrowScale: 1.8, wide: 1.25 }),
  after: Object.freeze({ arrow: false, arrowScale: 1, wide: 0.7 }),
  passed: Object.freeze({ arrow: false, arrowScale: 1, wide: 0.7 }),
});
const NO_CUE = Object.freeze({ arrow: false, arrowScale: 1, wide: 1 });
// Color and shape for a checkpoint style; plain (null cue) when off.
export function markerLook(style, colorSafe, plainColor) {
  if (!colorSafe) return { color: plainColor, ...NO_CUE };
  return { color: SAFE_COLORS[style] ?? plainColor, ...(CUES[style] || NO_CUE) };
}

// Apply the settings at once. `root` is document.documentElement (or null
// in node); `game` may lack chase. Cheap and idempotent: safe every frame
// of menu use, called from economy.applySettings.
export function applyAccess(s, root, game) {
  if (root && root.style && root.dataset) {
    root.style.setProperty('--rw-text-scale', String(textScale(s)));
    root.dataset.rwText = isLarge(s) ? 'large' : 'normal';
    root.dataset.rwContrast = s && s.highContrast === true ? 'high' : 'normal';
    root.dataset.rwCalm = isCalm(s) ? 'on' : 'off';
  }
  if (game && game.chase && game.chase.setShake) game.chase.setShake(isCalm(s) ? 0 : 1);
}
