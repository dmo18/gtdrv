// All CSS for the touch controls and HUD. One <style> element, added once.
const CSS = `
.rw-touch, .rw-hud, .rw-chud {
  --rw-accent: #e2733a;
  --rw-accent-soft: rgba(226, 115, 58, 0.78);
  --rw-text: #f6efe6;
  --rw-dim: rgba(246, 239, 230, 0.62);
  --rw-panel: rgba(24, 18, 15, 0.58);
  --rw-panel-edge: rgba(246, 239, 230, 0.22);
  --rw-sl: max(env(safe-area-inset-left, 0px), var(--rw-test-sl, 0px));
  --rw-sr: max(env(safe-area-inset-right, 0px), var(--rw-test-sr, 0px));
  --rw-st: max(env(safe-area-inset-top, 0px), var(--rw-test-st, 0px));
  --rw-sb: max(env(safe-area-inset-bottom, 0px), var(--rw-test-sb, 0px));
  position: absolute; inset: 0; overflow: hidden;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--rw-text);
  -webkit-user-select: none; user-select: none;
  -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
  touch-action: none;
}
.rw-touch *, .rw-hud *, .rw-chud * {
  box-sizing: border-box; -webkit-user-select: none; user-select: none;
  touch-action: none; -webkit-tap-highlight-color: transparent;
}

/* ---------- touch controls ---------- */
.rw-touch { z-index: 20; pointer-events: none; }
.rw-touch.rw-hidden { display: none; }
.rw-zone { position: absolute; pointer-events: auto; }
.rw-look { left: 40%; right: 0; top: 0; bottom: 0; }
.rw-stickzone { left: 0; width: 40%; top: 35%; bottom: 0; }

/* steering styles: only the chosen one shows (car and boat) */
.rw-touch:not(.rw-steer-wheel) .rw-st-wheel,
.rw-touch:not(.rw-steer-slider) .rw-st-slider,
.rw-touch:not(.rw-steer-buttons) .rw-st-buttons,
.rw-touch:not(.rw-steer-tilt) .rw-st-tilt { display: none; }

/* on-screen steering wheel (touches anywhere in the zone turn it) */
.rw-wheel {
  position: absolute; left: calc(var(--rw-sl) + 16px + (var(--slot) - var(--wsize)) / 2);
  bottom: calc(var(--rw-sb) + var(--sgap) + (var(--slot) - var(--wsize)) / 2);
  width: var(--wsize); height: var(--wsize); pointer-events: none; opacity: 0.7; transition: opacity 0.12s;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
}
.rw-wheel.rw-active { opacity: 1; }
.rw-wheel-rot { width: 100%; height: 100%; will-change: transform; }
.rw-wheel.rw-spring .rw-wheel-rot { transition: transform 0.24s cubic-bezier(0.3, 1.45, 0.55, 1); }
.rw-wheel svg { display: block; width: 100%; height: 100%; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.rw-w-rim { stroke: rgba(30, 23, 19, 0.88); stroke-width: 15; }
.rw-w-grip { stroke: var(--rw-accent); stroke-width: 15; }
.rw-w-spoke { stroke: rgba(30, 23, 19, 0.88); stroke-width: 11; }
.rw-w-hub { fill: rgba(30, 23, 19, 0.92); stroke: var(--rw-panel-edge); stroke-width: 2; }
.rw-w-mark { stroke: var(--rw-accent); stroke-width: 3; }
.rw-w-top { fill: #ffd0b5; stroke: none; }
.rw-wheel.rw-active .rw-w-rim { stroke: rgba(46, 33, 26, 0.95); }

/* floating steering slider (car, style 'slider'): rests in the steering slot (docs/REVAMP.md 6.5) */
.rw-pad {
  position: absolute; left: 0; top: 0; width: var(--slot); height: 56px; border-radius: 28px;
  background: var(--rw-panel); border: 2px solid var(--rw-panel-edge);
  opacity: 0.55; pointer-events: none; transition: opacity 0.12s;
}
.rw-pad.rw-active { opacity: 0.95; border-color: var(--rw-accent-soft); }
.rw-pad::before, .rw-pad::after {
  content: ""; position: absolute; top: 50%; width: 0; height: 0; margin-top: -6px;
  border: 6px solid transparent;
}
.rw-pad::before { left: 10px; border-right-color: var(--rw-dim); border-left-width: 0; }
.rw-pad::after { right: 10px; border-left-color: var(--rw-dim); border-right-width: 0; }
.rw-pad .rw-knob { left: 50%; top: 50%; margin: -20px 0 0 -20px; width: 40px; height: 40px; }

/* steering arrow pads (style 'buttons'): two 72 square buttons, 8 apart, bottom of the slot */
.rw-btn.rw-steerbtn { width: var(--sbtn); height: var(--sbtn); border-radius: 20px; bottom: calc(var(--rw-sb) + var(--sgap)); }
.rw-btn.rw-steerbtn svg { width: 36px; height: 36px; stroke-width: 2.6; }
.rw-sleft { left: calc(var(--rw-sl) + 16px); }
.rw-sright { left: calc(var(--rw-sl) + 16px + var(--sbtn) + 8px); }

/* tilt indicator (style 'tilt'): a 120 by 20 display, not a target; a tap in the zone re-centres */
.rw-btn.rw-tiltbar {
  left: calc(var(--rw-sl) + 16px + (var(--slot) - 120px) / 2); bottom: calc(var(--rw-sb) + var(--sgap));
  width: 120px; height: 20px; border-radius: 10px; pointer-events: none;
}
.rw-tiltbar .rw-face { flex-direction: row; gap: 6px; border-radius: 10px; }
.rw-tilt-track {
  position: relative; display: block; width: 76px; height: 8px; border-radius: 4px;
  background: rgba(0, 0, 0, 0.45); border: 1px solid var(--rw-panel-edge);
}
.rw-tilt-track::before { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--rw-dim); }
.rw-tilt-dot {
  position: absolute; left: 50%; top: 50%; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f3a173, var(--rw-accent) 70%); border: 2px solid rgba(255, 255, 255, 0.6);
}
.rw-tilt-label { font-size: 10px; color: var(--rw-text); }

/* floating 2-axis stick (foot, plane, heli, tank): rests in the steering slot */
.rw-stick {
  position: absolute; left: 0; top: 0; width: 128px; height: 128px; border-radius: 50%;
  background: var(--rw-panel); border: 2px solid var(--rw-panel-edge);
  opacity: 0.55; pointer-events: none; transition: opacity 0.12s;
}
.rw-stick.rw-active { opacity: 0.95; border-color: var(--rw-accent-soft); }
.rw-stick.rw-sprint { border-color: var(--rw-accent); box-shadow: 0 0 14px var(--rw-accent-soft); }
.rw-stick .rw-knob { left: 50%; top: 50%; margin: -26px 0 0 -26px; width: 52px; height: 52px; }

.rw-knob {
  position: absolute; border-radius: 50%; pointer-events: none;
  background: radial-gradient(circle at 35% 30%, #f3a173, var(--rw-accent) 70%);
  border: 2px solid rgba(255, 255, 255, 0.5); box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}

/* buttons: the box is the hit area; the .rw-face inside is what you see */
.rw-btn {
  position: absolute; pointer-events: auto; display: block; padding: 0; margin: 0;
  width: 58px; height: 58px; border-radius: 50%; background: transparent; color: var(--rw-text);
  border: 0; outline: none;
  font: 700 10px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: 0.06em;
}
.rw-face {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  background: var(--rw-panel); border: 2px solid var(--rw-panel-edge);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: transform 0.12s ease-out, opacity 0.12s ease-out, background 0.08s;
}
.rw-btn svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.rw-btn span { pointer-events: none; }
.rw-btn:focus-visible .rw-face { outline: 3px solid #fff; outline-offset: 3px; }
.rw-btn.rw-down .rw-face { background: var(--rw-accent-soft); border-color: #ffd0b5; }
.rw-off { display: none !important; }

/* idle: a little smaller and dimmer until a finger is on it (hit box unchanged) */
.rw-pri .rw-face { transform: scale(0.85); opacity: 0.7; }
.rw-pri.rw-down .rw-face, .rw-pri:focus-visible .rw-face { transform: none; opacity: 1; }
.rw-full .rw-pri .rw-face { transform: none; opacity: 1; }

.rw-pedal { width: var(--pw); height: var(--ph); border-radius: 22px; font-size: 13px; }
.rw-pedal .rw-face { gap: 6px; }
.rw-pedal svg { width: 28px; height: 28px; }
.rw-pedal.rw-gas .rw-face { border-color: rgba(226, 115, 58, 0.7); }

/* per-mode groups: a gated element shows only in the modes it lists */
.rw-mode-foot .rw-gated:not(.rw-m-foot),
.rw-mode-car .rw-gated:not(.rw-m-car),
.rw-mode-boat .rw-gated:not(.rw-m-boat),
.rw-mode-plane .rw-gated:not(.rw-m-plane),
.rw-mode-heli .rw-gated:not(.rw-m-heli),
.rw-mode-tank .rw-gated:not(.rw-m-tank) { display: none; }

/* flight stick: cross-hair ring behind the knob */
.rw-stick.rw-flight { border-style: dashed; }
.rw-stick.rw-flight::before, .rw-stick.rw-flight::after {
  content: ""; position: absolute; background: var(--rw-dim); opacity: 0.45; border-radius: 1px;
}
.rw-stick.rw-flight::before { left: 50%; top: 10px; bottom: 10px; width: 2px; margin-left: -1px; }
.rw-stick.rw-flight::after { top: 50%; left: 10px; right: 10px; height: 2px; margin-top: -1px; }

/* placement (docs/REVAMP.md 6.5): --x from the thumb-side edge, --y from the
   bottom, both before the safe-area insets. Left-handed swaps the side.
   Size set A is 915x412; the media query at the end of this block is 780x360. */
.rw-touch {
  --dir: 1; --slot: 160px; --sgap: 12px; --sbtn: 72px; --mx: 16px; --my: 176px;
  --pw: 72px; --ph: 88px; --fw: 64px; --ew: 56px; --wsize: 150px;
}
.rw-touch.rw-lefty { --dir: -1; }
.rw-gas, .rw-brake, .rw-exit, .rw-enter, .rw-fire, .rw-dbfire, .rw-lock, .rw-chipbtn, .rw-more,
.rw-sec, .rw-extra, .rw-slot {
  right: calc(var(--rw-sr) + var(--x)); bottom: calc(var(--rw-sb) + var(--y));
}
.rw-lefty .rw-gas, .rw-lefty .rw-brake, .rw-lefty .rw-exit, .rw-lefty .rw-enter, .rw-lefty .rw-fire,
.rw-lefty .rw-dbfire, .rw-lefty .rw-lock, .rw-lefty .rw-chipbtn, .rw-lefty .rw-more,
.rw-lefty .rw-sec, .rw-lefty .rw-extra, .rw-lefty .rw-slot {
  right: auto; left: calc(var(--rw-sl) + var(--x));
}
.rw-gas { --x: 8px; --y: 8px; }
.rw-brake { --x: calc(8px + var(--pw) + 12px); --y: 8px; }
.rw-exit, .rw-enter { --x: 16px; --y: 108px; width: var(--ew); height: var(--ew); }
.rw-enter svg { width: 28px; height: 28px; }
.rw-enter span { font-size: 11px; }
.rw-dbfire { --x: 180px; --y: 8px; width: var(--fw); height: var(--fw); }
.rw-lock, .rw-chipbtn { --x: 184px; --y: 84px; width: var(--ew); height: var(--ew); }
.rw-chipbtn .rw-face { background: rgba(120, 30, 22, 0.7); border-color: rgba(255, 150, 120, 0.85); font-size: 9px; }
.rw-chipbtn svg { width: 22px; height: 22px; }
.rw-touch:not(.rw-chip-on) .rw-chipbtn, .rw-full .rw-chipbtn { display: none; }
.rw-chip-on:not(.rw-full) .rw-lock { display: none; }
.rw-enter.rw-dim { opacity: 0.32; filter: grayscale(0.8); pointer-events: none; }
.rw-more { --x: var(--mx); --y: var(--my); width: var(--ew); height: var(--ew); }
.rw-full .rw-more { display: none; }
.rw-touch.rw-fan-open .rw-more .rw-face { background: var(--rw-accent-soft); border-color: #ffd0b5; }
/* extra primaries other systems register without a slot (GARAGE, TALK): the BOOST cell above MORE
   (docs/REVAMP.md 6.12). BOOST hides while one shows; a second one waits; the cell above is never used. */
.rw-extra { --x: var(--mx); --y: calc(var(--my) + 64px); width: var(--ew); height: var(--ew); }
.rw-extra.rw-spare { display: none; }
.rw-slot { width: var(--ew); height: var(--ew); }
/* HAND (car, boat), SWAP (foot): above BRAKE. RUN (foot): the BRAKE rect. */
.rw-slot-hand { --x: 100px; --y: 108px; width: var(--ew); height: var(--ew); }
/* BOOST: the cell above MORE (915x412: 843, 116; 780x360: 716, 88) */
.rw-slot-boost { --x: var(--mx); --y: calc(var(--my) + 64px); width: var(--ew); height: var(--ew); }
.rw-slot-boost .rw-face { border-color: rgba(255, 170, 60, 0.85); }
.rw-slot-boost.rw-down .rw-face { background: rgba(255, 140, 30, 0.85); box-shadow: 0 0 12px rgba(255, 150, 40, 0.8); }
.rw-slot-run { --x: calc(8px + var(--pw) + 12px); --y: 8px; width: var(--pw); height: var(--ph); border-radius: 22px; }
.rw-slot-run .rw-face { gap: 6px; }
.rw-a-detonate .rw-face { border-color: rgba(255, 120, 90, 0.95); animation: rw-pulse 0.9s ease-in-out infinite; }
@keyframes rw-pulse { 50% { box-shadow: 0 0 14px rgba(255, 90, 60, 0.9); } }

/* armed craft (docs/ARMS.md): the weapon arc sits inside the bottom right
   352 by 220 box and keeps clear of EXIT, MORE, the pedals and the prompt
   strip: GUN (FIRE rect), BOMB (HAND rect), LOCK (LOCK rect), MSL left of
   LOCK, BOOM beside or above MSL. Tank: CANNON (FIRE rect), LOCK (LOCK rect),
   COAX left of LOCK. */
.rw-slot span { font-size: 10px; }
.rw-slot svg { width: 24px; height: 24px; }
.rw-slot-gun, .rw-slot-cannon { --x: 180px; --y: 8px; width: var(--fw); height: var(--fw); }
.rw-slot-msl, .rw-slot-coax { --x: calc(184px + var(--ew) + 8px); --y: 84px; }
.rw-slot-bomb { --x: 100px; --y: 108px; }
.rw-slot-alock, .rw-slot-tlock, .rw-slot-extra { --x: 184px; --y: 84px; }
/* SIREN: 8 px beside the steering slot on the side toward the screen centre, centred on its height
   (915x412: 184, 292; 780x360: 164, 246). It moves with the left inset and mirrors with the slot. */
.rw-btn.rw-slot-siren { right: auto; left: calc(var(--rw-sl) + var(--sx)); bottom: calc(var(--rw-sb) + var(--sy)); width: var(--ew); height: var(--ew); }
.rw-lefty .rw-btn.rw-slot-siren { left: auto; right: calc(var(--rw-sr) + var(--sx)); }
.rw-touch { --sx: 184px; --sy: 64px; }
/* EXTRA: a 4 px fill bar along the bottom of the face; dim (40 %) when it cannot act */
.rw-xbar { position: absolute; left: 8px; right: 8px; bottom: 4px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); overflow: hidden; display: none; }
.rw-xbar i { display: block; height: 100%; background: #6fd1ff; transform-origin: left; transform: scaleX(0); }
.rw-pri.rw-weak .rw-face { opacity: 0.4; }
.rw-slot-det { --x: 272px; --y: 148px; }
.rw-slot-gun svg, .rw-slot-cannon svg { width: 28px; height: 28px; }
.rw-mode-tank .rw-exit { --x: 16px; --y: 108px; }
.rw-slot-gun .rw-face, .rw-slot-cannon .rw-face { border-color: rgba(226, 115, 58, 0.8); }
.rw-slot.rw-down .rw-face { background: rgba(226, 70, 48, 0.85); border-color: #ffd0b5; }
.rw-slot.rw-on .rw-face { background: rgba(226, 46, 31, 0.85); border-color: #ffd0b5; box-shadow: 0 0 12px rgba(255, 70, 50, 0.8); }
.rw-slot .rw-face::after {
  content: ""; position: absolute; inset: -4px; border-radius: 50%; pointer-events: none; opacity: 0;
  background: conic-gradient(#ffb48a calc(var(--ring, 0) * 1turn), rgba(0, 0, 0, 0.25) 0);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
}
.rw-slot.rw-ringon .rw-face::after { opacity: 1; }
.rw-pip { position: absolute; right: 12%; top: 10%; font: 800 10px/1 system-ui, sans-serif; color: #ffe2cc; font-variant-numeric: tabular-nums; pointer-events: none; }

/* the fan: up to 6 secondary buttons, 3 columns by 2 rows, growing up and
   away from MORE (--r row, --c column; 56 squares, 8 apart) */
.rw-sec {
  --x: calc(var(--mx) + 64px + var(--c, 0) * 64px); --y: calc(var(--my) + var(--r, 0) * 64px);
  width: var(--ew); height: var(--ew);
  transform: translate(calc(var(--dir) * (var(--c, 0) + 1) * 64px), calc(var(--r, 0) * 64px)) scale(0.3);
  opacity: 0; visibility: hidden;
  transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.3, 1), opacity 0.16s ease, visibility 0s linear 0.16s;
}
.rw-fan-open .rw-sec, .rw-full .rw-sec {
  transform: none; opacity: 1; visibility: visible; transition-delay: 0s;
}
.rw-sec span { font-size: 9px; }
.rw-sec svg { width: 22px; height: 22px; }

/* 780 by 360 and smaller: the second set of rectangles */
@media (max-height: 380px) {
  .rw-touch { --slot: 140px; --sgap: 16px; --sbtn: 66px; --mx: 8px; --my: 152px; --pw: 64px; --ph: 72px; --wsize: 136px; }
  .rw-brake, .rw-slot-run { --x: calc(8px + var(--pw) + 12px); }
  .rw-exit, .rw-enter, .rw-mode-tank .rw-exit { --x: 8px; --y: 88px; }
  .rw-slot-hand, .rw-slot-bomb { --x: 88px; --y: 88px; }
  .rw-dbfire, .rw-slot-gun, .rw-slot-cannon { --x: 156px; }
  .rw-lock, .rw-chipbtn, .rw-slot-alock, .rw-slot-tlock, .rw-slot-extra { --x: 160px; --y: 80px; }
  .rw-touch { --sx: 164px; --sy: 58px; }
  .rw-slot-msl, .rw-slot-coax { --x: calc(160px + var(--ew) + 8px); --y: 80px; }
  .rw-slot-det { --x: 288px; --y: 80px; }
  /* the fan at 780x360 (docs/REVAMP.md 6.12): 48 px cells, 8 apart, columns at x 660, 604, 548, rows at y 156 and 100 */
  .rw-sec {
    --x: calc(var(--mx) + 64px + var(--c, 0) * 56px); --y: calc(var(--my) + 4px + var(--r, 0) * 56px);
    width: 48px; height: 48px;
    transform: translate(calc(var(--dir) * (var(--c, 0) + 1) * 56px), calc(var(--r, 0) * 56px)) scale(0.3);
  }
  .rw-fan-open .rw-sec, .rw-full .rw-sec { transform: none; }
}

/* weapon wheel: hold SWAP, drag, lift. A 216 px ring placed at the SWAP
   button by touch.js (kept off FIRE and pause). Never takes touches. */
.rw-ww {
  position: absolute; left: 0; top: 0; width: 216px; height: 216px; z-index: 30;
  pointer-events: none; visibility: hidden; opacity: 0;
  transition: opacity 0.1s ease-out, visibility 0s linear 0.1s;
}
.rw-ww.rw-ww-open { visibility: visible; opacity: 1; transition-delay: 0s; }
.rw-ww-disc {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle, rgba(10, 14, 20, 0.96) 0 24px, rgba(16, 22, 30, 0.93) 25px);
  border: 2px solid var(--rw-panel-edge); box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
}
.rw-ww-cancel .rw-ww-disc { border-color: rgba(226, 70, 48, 0.8); opacity: 0.7; }
.rw-ww-slice {
  position: absolute; width: 54px; height: 50px; margin: -25px 0 0 -27px; border-radius: 14px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  color: var(--rw-text); border: 2px solid transparent;
  font: 700 8px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: 0.05em;
}
.rw-ww-slice svg { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.rw-ww-slice.rw-cur { border-color: rgba(255, 255, 255, 0.28); }
.rw-ww-slice.rw-sel { background: var(--rw-accent); border-color: #ffd0b5; transform: scale(1.14); box-shadow: 0 0 12px var(--rw-accent-soft); }
.rw-ww-label {
  position: absolute; left: 50%; top: 50%; width: 84px; transform: translate(-50%, -50%);
  text-align: center; font: 700 11px/1.15 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: var(--rw-text);
}
.rw-ww-cancel .rw-ww-label { color: #ff9c86; }

/* combat: FIRE takes the GAS rect on foot, LOCK and the reload chip share the LOCK rect */
.rw-btn.rw-fire { --x: 8px; --y: 8px; width: var(--pw); height: var(--ph); border-radius: 22px; font-size: 13px; }
.rw-btn.rw-fire .rw-face, .rw-btn.rw-dbfire .rw-face {
  background: rgba(120, 30, 22, 0.62); border: 3px solid rgba(255, 120, 96, 0.8);
}
.rw-btn.rw-fire svg { width: 32px; height: 32px; }
.rw-btn.rw-dbfire { font-size: 11px; }
.rw-btn.rw-dbfire svg { width: 26px; height: 26px; }
.rw-btn.rw-fire.rw-down .rw-face, .rw-btn.rw-dbfire.rw-down .rw-face { background: rgba(226, 70, 48, 0.85); border-color: #ffd0b5; }
.rw-fire-mag { position: absolute; right: 10%; top: 8%; font: 800 11px/1 system-ui, sans-serif; color: #ffe2cc; font-variant-numeric: tabular-nums; }
.rw-dbfire .rw-fire-mag { right: 14%; top: 12%; }
.rw-lock.rw-on .rw-face { background: rgba(226, 70, 48, 0.8); border-color: #ffd0b5; box-shadow: 0 0 12px rgba(255, 110, 80, 0.7); }
/* ammo panel: HUD Full only, under the score; a display (reload is RELOAD in the fan or the chip) */
.rw-btn.rw-ammo { right: calc(var(--rw-sr) + 64px); top: calc(var(--rw-st) + 60px); width: 160px; height: 40px; border-radius: 6px; pointer-events: none; }
.rw-ammo .rw-face {
  flex-direction: row; justify-content: flex-start; gap: 6px; padding: 0 8px; border-radius: 6px;
  background: rgba(0, 0, 0, 0.6); border: 0;
}
.rw-touch:not(.rw-full) .rw-ammo { display: none; }
.rw-ammo-icon svg { width: 20px; height: 20px; display: block; }
.rw-ammo-txt { display: flex; align-items: baseline; gap: 1px; }
.rw-ammo-n { font-size: 18px; font-weight: 800; color: #fff; font-variant-numeric: tabular-nums; }
.rw-ammo-of { font-size: 11px; color: #fff; }
.rw-ammo-name { margin-left: auto; font-style: normal; font-size: 10px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 62px; }
.rw-ammo-bar { position: absolute; left: 8px; right: 8px; bottom: 3px; height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); display: none; overflow: hidden; }
.rw-ammo-bar i { display: block; height: 100%; background: var(--rw-accent); transform-origin: left; transform: scaleX(0); }
.rw-ammo.rw-reloading .rw-ammo-bar { display: block; }
.rw-ammo.rw-reloading .rw-ammo-n { color: var(--rw-dim); }
.rw-ammo.rw-empty .rw-ammo-n { color: #ff9c86; }
.rw-nocombat .rw-cmb, .rw-nodrive .rw-dbfire,
.rw-nodrive.rw-mode-car .rw-ammo, .rw-nodrive.rw-mode-boat .rw-ammo { display: none; }

.rw-btn.rw-pause { right: calc(var(--rw-sr) + 8px); top: calc(var(--rw-st) + 8px); width: 48px; height: 48px; }

/* left-handed: steering slot and the button cluster mirror to the other side;
   minimap, speed, score, stars and pause stay (docs/REVAMP.md 6.5) */
.rw-lefty .rw-look { left: 0; right: 40%; }
.rw-lefty .rw-stickzone { left: auto; right: 0; }
.rw-lefty .rw-wheel { left: auto; right: calc(var(--rw-sr) + 16px + (var(--slot) - var(--wsize)) / 2); }
.rw-lefty .rw-tiltbar { left: auto; right: calc(var(--rw-sr) + 16px + (var(--slot) - 120px) / 2); }
.rw-lefty .rw-sright { left: auto; right: calc(var(--rw-sr) + 16px); }
.rw-lefty .rw-sleft { left: auto; right: calc(var(--rw-sr) + 16px + var(--sbtn) + 8px); }

@media (prefers-reduced-motion: reduce) {
  .rw-hot .rw-badge.rw-on { animation: none !important; background: #ff3b30; }
  .rw-face, .rw-sec, .rw-ww, .rw-wheel, .rw-wheel-rot, .rw-pad, .rw-stick, .rw-minimap, .rw-tl { transition: none !important; }
  .rw-a-detonate .rw-face { animation: none; }
}

/* ---------- HUD (docs/REVAMP.md 6.5) ---------- */
/* Every HUD text sits on its own dark pill: white on rgba(0,0,0,0.6) is at least 4.8 to 1 over any sky. */
.rw-hud { z-index: 21; pointer-events: none; --map: 84px; --map-big: 170px; --mapw: var(--map); --spw: 88px; }
.rw-hud.rw-mapbig { --mapw: var(--map-big); }
.rw-hud .rw-tl { position: absolute; left: calc(var(--rw-sl) + 8px); top: calc(var(--rw-st) + 8px); width: var(--mapw); transition: width 0.16s ease; }
.rw-minimap {
  display: block; width: 100%; aspect-ratio: 1; height: auto; border-radius: 50%; cursor: pointer;
  pointer-events: auto; touch-action: none;
  background: rgba(24, 18, 15, 0.7); border: 3px solid var(--rw-accent);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
.rw-minimap:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
.rw-pill {
  background: rgba(0, 0, 0, 0.6); color: #fff; border-radius: 6px;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
/* speed: always 8 px right of the minimap (also when it is grown); a craft only */
.rw-speedbox {
  position: absolute; left: calc(var(--rw-sl) + 16px + var(--mapw)); top: calc(var(--rw-st) + 8px);
  width: 88px; height: 44px; padding: 3px 6px 0; text-align: center; overflow: hidden;
}
.rw-speedbox.rw-none, .rw-prompt.rw-none { display: none; }
.rw-speed { font-size: 28px; font-weight: 800; line-height: 34px; height: 34px; }
.rw-speed small { font-size: 11px; font-weight: 700; margin-left: 3px; letter-spacing: 0.06em; }
.rw-vehbar { position: absolute; left: 6px; right: 6px; bottom: 4px; width: auto; height: 4px; }
.rw-hpmeter {
  position: absolute; left: calc(var(--rw-sl) + 16px + var(--mapw)); top: calc(var(--rw-st) + 56px);
  width: 88px; height: 12px; border-radius: 6px; overflow: hidden;
  background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(255, 255, 255, 0.4);
}
.rw-hpmeter.rw-none { display: none; }
.rw-hpfill { position: absolute; inset: 0; transform-origin: left; background: hsl(120, 70%, 48%); transition: transform 0.15s linear; }
.rw-hpmeter.rw-low { animation: rw-hplow 0.9s ease-in-out infinite; }
@keyframes rw-hplow { 50% { border-color: #e2503a; } }
.rw-hptext {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 800; letter-spacing: 0.06em; font-variant-numeric: tabular-nums; color: #fff;
  text-shadow: 0 1px 2px #000;
}
/* speed lines while boosting: streaks that fade in toward the screen edges */
.rw-speedlines {
  position: absolute; inset: 0; opacity: 0; transition: opacity 0.2s linear;
  background: repeating-conic-gradient(from 0deg at 50% 54%, rgba(255, 255, 255, 0) 0deg 2.2deg, rgba(255, 255, 255, 0.55) 2.5deg 2.9deg, rgba(255, 255, 255, 0) 3.2deg 6.3deg);
  -webkit-mask-image: radial-gradient(ellipse at 50% 54%, transparent 52%, #000 92%);
  mask-image: radial-gradient(ellipse at 50% 54%, transparent 52%, #000 92%);
}
@media (prefers-reduced-motion: reduce) { .rw-speedlines { display: none; } }
/* boost meter: under the speed (health and clock slots push it down) */
.rw-boostbar {
  position: absolute; left: calc(var(--rw-sl) + 16px + var(--mapw)); top: calc(var(--rw-st) + 56px);
  width: 88px; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(0, 0, 0, 0.6);
}
.rw-boostbar.rw-hp { top: calc(var(--rw-st) + 72px); }
.rw-full .rw-boostbar { top: calc(var(--rw-st) + 91px); }
.rw-boostbar.rw-none { display: none; }
.rw-boostfill { position: absolute; inset: 0; transform-origin: left; background: #ffa63c; transition: transform 0.1s linear; }
.rw-boostbar.rw-on .rw-boostfill { background: #fff0b0; }
.rw-boostbar.rw-spent .rw-boostfill { background: #e2503a; }
/* clock: Full only, under the health slot */
.rw-clock {
  display: none; position: absolute; left: calc(var(--rw-sl) + 16px + var(--mapw)); top: calc(var(--rw-st) + 72px);
  width: 88px; height: 16px; font-size: 12px; line-height: 16px; text-align: center;
}
.rw-full .rw-clock { display: block; }

/* top centre stack (docs/REVAMP.md 6.12): 335 by 92 (300 by 92 at 780x360), centred, top at 8.
   Status row (stars, objective cell), then two one-line message rows at y 32 and 64 of the box.
   Rows never move: an empty row stays empty. */
.rw-stack {
  position: absolute; left: 50%; top: calc(var(--rw-st) + 8px); width: 335px; height: 92px; margin-left: -167.5px;
  pointer-events: none;
}
/* stars: centred, only while wanted; the cooldown bar sits right under */
.rw-wanted {
  position: absolute; left: 50%; top: 0; width: 150px; height: 24px; margin-left: -75px;
  display: flex; align-items: center; justify-content: center;
}
/* objective arrow and distance: beside the stars, right end of the status row */
.rw-objcell {
  position: absolute; right: 0; top: 0; width: 84px; height: 24px; padding: 0 6px; gap: 4px;
  display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; overflow: hidden;
}
.rw-objcell.rw-none { display: none; }
.rw-objarrow { display: block; width: 16px; height: 16px; flex: 0 0 16px; will-change: transform; }
.rw-objarrow svg { display: block; width: 16px; height: 16px; }
.rw-objdist { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-wanted.rw-none { display: none; }
.rw-stars { display: flex; gap: 4px; }
.rw-badge {
  width: 16px; height: 16px; background: rgba(246, 239, 230, 0.3);
  clip-path: polygon(50% 0, 62% 35%, 98% 36%, 69% 57%, 80% 92%, 50% 71%, 20% 92%, 31% 57%, 2% 36%, 38% 35%);
}
.rw-badge.rw-on { background: #ffd24a; }
.rw-hot .rw-badge.rw-on { animation: rw-siren 0.6s steps(1, end) infinite; }
.rw-hot .rw-badge.rw-on:nth-child(even) { animation-delay: -0.3s; }
@keyframes rw-siren { 0% { background: #ff3b30; } 50% { background: #3a7bff; } }
.rw-cooling .rw-badge.rw-on { opacity: 0.8; }
.rw-cool { display: none; position: absolute; left: 0; top: 25px; width: 150px; height: 4px; border-radius: 2px; background: rgba(0, 0, 0, 0.6); overflow: hidden; }
.rw-cooling .rw-cool { display: block; }
.rw-coolfill { height: 100%; width: 100%; background: #6fd18b; transform-origin: left; transform: scaleX(0); }

/* score and combo: right aligned, left of the pause button */
.rw-tr { position: absolute; right: calc(var(--rw-sr) + 64px); top: calc(var(--rw-st) + 8px); width: 160px; }
.rw-money { height: 28px; padding: 0 8px; text-align: right; font-size: 17px; font-weight: 800; line-height: 28px; letter-spacing: 0.02em; }
.rw-combo { height: 18px; padding: 0 8px; text-align: right; font-size: 12px; font-weight: 700; line-height: 18px; }
.rw-slowmo {
  position: absolute; inset: 0; pointer-events: none; opacity: 0; z-index: 3;
  background: radial-gradient(ellipse at center, rgba(40, 60, 90, 0) 28%, rgba(16, 24, 44, 0.78) 100%), rgba(110, 120, 140, 0.22);
}
.rw-bar { height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.25); overflow: hidden; }
.rw-fill { height: 100%; width: 100%; border-radius: 2px; background: #6fd18b; }
.rw-bar.rw-low .rw-fill { background: #ff6a50; }
.rw-bar.rw-empty { display: none; }

/* message rows: one line in one pill of fixed height; nothing wraps, long text ends in an ellipsis */
.rw-msg {
  position: absolute; left: 0; right: 0; margin: 0 auto; width: fit-content; max-width: 100%; height: 28px; padding: 0 12px;
  font-size: 14px; font-weight: 700; line-height: 28px; text-align: center;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  border-left: 4px solid transparent; transition: opacity 0.3s;
}
.rw-toasts { display: contents; }
.rw-msg[hidden] { display: none; }
.rw-m1 { top: 32px; }
.rw-m2 { top: 64px; }
.rw-msg.rw-in { animation: rw-toast-in 0.2s ease-out; }
.rw-msg.rw-out { opacity: 0; }
.rw-k-police { border-left-color: #ff4a3a; }
.rw-k-score { border-left-color: #ffb43a; }
.rw-k-hint { border-left-color: #4a8bff; }
.rw-k-district { font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; }
@keyframes rw-toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .rw-msg.rw-in { animation: none; } }
/* with the minimap grown the speed readout reaches further right: keep long lines clear of it */
.rw-mapbig .rw-msg { max-width: calc(100vw - 2 * (var(--rw-sl) + 24px + var(--mapw) + var(--spw))); }

/* prompt strip: centred, under the keep-out rect */
.rw-prompt {
  position: absolute; left: 50%; bottom: calc(var(--rw-sb) + 8px); width: 300px; height: 28px; margin-left: -150px;
  font-size: 14px; font-weight: 700; line-height: 28px; text-align: center; overflow: hidden; text-overflow: ellipsis;
  border: 1px solid var(--rw-accent-soft);
}

/* ---------- combat HUD (combathud.js) ---------- */
.rw-chud { z-index: 15; pointer-events: none; }
.rw-chud > * { position: absolute; pointer-events: none; }
.rw-xhair { left: 0; top: 0; width: 60px; height: 60px; margin: -30px 0 0 -30px; display: none; will-change: transform; }
.rw-xhair.rw-on { display: block; }
.rw-xhair svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; fill: none; stroke-linecap: round; }
.rw-x-ticks { stroke: #fff; stroke-width: 2.6; filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.9)); }
.rw-x-dot { fill: #fff; stroke: rgba(0, 0, 0, 0.6); stroke-width: 0.8; }
.rw-xhair.rw-hot .rw-x-ticks { stroke: #ff4a36; }
.rw-xhair.rw-hot .rw-x-dot { fill: #ff4a36; }
.rw-x-hit { stroke: #fff; stroke-width: 2.8; opacity: 0; }
.rw-xhair.rw-hit .rw-x-hit { opacity: 1; }
.rw-xhair.rw-hot.rw-hit .rw-x-hit { stroke: #ffd2a8; }
.rw-x-lock { stroke: #ff4a36; stroke-width: 2.2; opacity: 0; stroke-dasharray: 8 5; }
.rw-xhair.rw-locked .rw-x-lock { opacity: 1; }
.rw-xring { position: absolute; inset: 0; display: none; }
.rw-xring.rw-on { display: block; }
.rw-x-ringbg { stroke: rgba(0, 0, 0, 0.35); stroke-width: 3.5; }
.rw-x-ringarc { stroke: #ffd0b5; stroke-width: 3.5; stroke-dasharray: 100; stroke-dashoffset: 100; transform: rotate(-90deg); }
.rw-tgt { left: 0; top: 0; width: 40px; height: 40px; display: none; will-change: transform; }
.rw-tgt.rw-on { display: block; }
.rw-tgt i { position: absolute; width: 28%; height: 28%; border: 0 solid #ff6a50; filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8)); }
.rw-tgt i:nth-child(1) { left: 0; top: 0; border-left-width: 3px; border-top-width: 3px; }
.rw-tgt i:nth-child(2) { right: 0; top: 0; border-right-width: 3px; border-top-width: 3px; }
.rw-tgt i:nth-child(3) { left: 0; bottom: 0; border-left-width: 3px; border-bottom-width: 3px; }
.rw-tgt i:nth-child(4) { right: 0; bottom: 0; border-right-width: 3px; border-bottom-width: 3px; }
.rw-tgt.rw-locked i { border-color: #ff2e1f; width: 36%; height: 36%; }
/* armed craft: nose pipper, seeker box (shrinks while locking), arrow */
.rw-pipper { left: 0; top: 0; width: 40px; height: 40px; margin: -20px 0 0 -20px; display: none; will-change: transform; }
.rw-pipper.rw-on { display: block; }
.rw-pipper svg { width: 100%; height: 100%; overflow: visible; fill: none; stroke: #bff5c8; stroke-width: 2; filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.9)); }
.rw-pipper .rw-pdot { fill: #bff5c8; }
.rw-seek { left: 0; top: 0; width: 60px; height: 60px; display: none; will-change: transform; }
.rw-seek.rw-on { display: block; }
.rw-seek i { position: absolute; width: 26%; height: 26%; border: 0 solid #ffd27a; filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8)); }
.rw-seek i:nth-child(1) { left: 0; top: 0; border-left-width: 2px; border-top-width: 2px; }
.rw-seek i:nth-child(2) { right: 0; top: 0; border-right-width: 2px; border-top-width: 2px; }
.rw-seek i:nth-child(3) { left: 0; bottom: 0; border-left-width: 2px; border-bottom-width: 2px; }
.rw-seek i:nth-child(4) { right: 0; bottom: 0; border-right-width: 2px; border-bottom-width: 2px; }
.rw-seek b { position: absolute; left: 50%; top: 100%; transform: translate(-50%, 4px); font-size: 11px; font-weight: 800; color: #ff3b26; display: none; text-shadow: 0 1px 3px #000; }
.rw-seek.rw-locked i { border-color: #ff2e1f; border-width: 3px; }
.rw-seek.rw-locked b { display: block; }
.rw-sarrow { left: 50%; top: 50%; width: 0; height: 0; display: none; }
.rw-sarrow.rw-on { display: block; }
.rw-sarrow i {
  position: absolute; left: min(40vw, 42vh); top: -9px; width: 0; height: 0;
  border-left: 16px solid #ffd27a; border-top: 9px solid transparent; border-bottom: 9px solid transparent;
  filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.8));
}
.rw-notarget {
  left: 50%; top: 58%; transform: translateX(-50%); padding: 4px 10px; border-radius: 10px; display: none;
  font-size: 13px; font-weight: 700; background: var(--rw-panel); border: 1px solid var(--rw-panel-edge);
}
.rw-notarget.rw-on { display: block; }
.rw-chp {
  left: 50%; bottom: var(--rw-sb); width: 180px; margin-left: -90px; height: 7px; border-radius: 4px;
  background: rgba(0, 0, 0, 0.55); border: 1px solid rgba(246, 239, 230, 0.3); overflow: hidden;
  opacity: 0; transition: opacity 0.25s;
}
.rw-chp.rw-on { opacity: 1; }
.rw-chp i { display: block; height: 100%; background: #6fd18b; transform-origin: left; }
.rw-chp.rw-low i { background: #e2503a; }
.rw-dmg { left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
.rw-dmg i {
  position: absolute; left: -70px; top: calc(-1 * min(46vh, 40vw)); width: 140px; height: 26px;
  border-radius: 50% 50% 0 0 / 100% 100% 0 0; border-top: 6px solid rgba(255, 70, 40, 0.85);
  filter: drop-shadow(0 0 6px rgba(255, 60, 30, 0.8));
}
.rw-cfade { inset: 0; background: #0d0907; opacity: 0; display: none; }
.rw-cfade.rw-on { display: block; }
.rw-cfade-text {
  left: 0; right: 0; top: 40%; text-align: center; opacity: 0; transition: opacity 0.4s;
  font-size: 30px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #ffe2cc;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.9);
}
.rw-cfade-text.rw-on { opacity: 1; }

@media (max-height: 380px) {
  .rw-hud { --map: 72px; --map-big: 140px; --spw: 80px; }
  .rw-speedbox, .rw-hpmeter, .rw-clock { width: 80px; }
  .rw-speedbox { height: 40px; padding-top: 2px; }
  .rw-speed { font-size: 28px; line-height: 32px; height: 32px; }
  .rw-hpmeter { top: calc(var(--rw-st) + 52px); }
  .rw-boostbar { width: 80px; top: calc(var(--rw-st) + 52px); }
  .rw-boostbar.rw-hp { top: calc(var(--rw-st) + 68px); }
  .rw-full .rw-boostbar { top: calc(var(--rw-st) + 85px); }
  .rw-clock { top: calc(var(--rw-st) + 68px); }
  .rw-tr { width: 152px; }
  .rw-money { height: 26px; line-height: 26px; }
  .rw-stack { width: 300px; margin-left: -150px; }
  .rw-objcell { width: 67px; padding: 0 4px; gap: 3px; font-size: 11px; }
  .rw-btn.rw-ammo { width: 152px; height: 24px; top: calc(var(--rw-st) + 56px); }
  .rw-ammo-name, .rw-ammo-bar { display: none; }
  .rw-ammo-n { font-size: 14px; }
}
`;

// Adds the style element once (safe to call many times).
export function injectStyles() {
  if (document.getElementById('rw-styles')) return;
  const el = document.createElement('style');
  el.id = 'rw-styles';
  el.textContent = CSS;
  document.head.appendChild(el);
}
