// All CSS for the touch controls and HUD. One <style> element, added once.
const CSS = `
.rw-touch, .rw-hud, .rw-chud {
  --rw-accent: #e2733a;
  --rw-accent-soft: rgba(226, 115, 58, 0.78);
  --rw-text: #f6efe6;
  --rw-dim: rgba(246, 239, 230, 0.62);
  --rw-panel: rgba(24, 18, 15, 0.58);
  --rw-panel-edge: rgba(246, 239, 230, 0.22);
  --rw-sl: env(safe-area-inset-left, 0px);
  --rw-sr: env(safe-area-inset-right, 0px);
  --rw-st: env(safe-area-inset-top, 0px);
  --rw-sb: env(safe-area-inset-bottom, 0px);
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
  position: absolute; left: calc(var(--rw-sl) + 20px); bottom: calc(var(--rw-sb) + 16px);
  width: 150px; height: 150px; pointer-events: none; opacity: 0.7; transition: opacity 0.12s;
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

/* floating steering slider (car, style 'slider') */
.rw-pad {
  position: absolute; left: 0; top: 0; width: 272px; height: 60px; border-radius: 30px;
  background: var(--rw-panel); border: 2px solid var(--rw-panel-edge);
  opacity: 0.55; pointer-events: none; transition: opacity 0.12s;
}
.rw-pad.rw-active { opacity: 0.95; border-color: var(--rw-accent-soft); }
.rw-pad::before, .rw-pad::after {
  content: ""; position: absolute; top: 50%; width: 0; height: 0; margin-top: -6px;
  border: 6px solid transparent;
}
.rw-pad::before { left: 12px; border-right-color: var(--rw-dim); border-left-width: 0; }
.rw-pad::after { right: 12px; border-left-color: var(--rw-dim); border-right-width: 0; }
.rw-pad .rw-knob { left: 50%; top: 50%; margin: -24px 0 0 -24px; width: 48px; height: 48px; }

/* steering arrow pads (style 'buttons') */
.rw-btn.rw-steerbtn { width: 92px; height: 104px; border-radius: 24px; bottom: calc(var(--rw-sb) + 16px); }
.rw-btn.rw-steerbtn svg { width: 40px; height: 40px; stroke-width: 2.6; }
.rw-sleft { left: calc(var(--rw-sl) + 18px); }
.rw-sright { left: calc(var(--rw-sl) + 124px); }

/* tilt indicator (style 'tilt'); tap to re-centre */
.rw-btn.rw-tiltbar {
  left: calc(var(--rw-sl) + 20px); bottom: calc(var(--rw-sb) + 30px);
  width: 168px; height: 64px; border-radius: 20px;
}
.rw-tiltbar .rw-face { gap: 7px; }
.rw-tilt-track {
  position: relative; display: block; width: 132px; height: 10px; border-radius: 5px;
  background: rgba(0, 0, 0, 0.45); border: 1px solid var(--rw-panel-edge);
}
.rw-tilt-track::before { content: ""; position: absolute; left: 50%; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: var(--rw-dim); }
.rw-tilt-dot {
  position: absolute; left: 50%; top: 50%; width: 20px; height: 20px; margin: -10px 0 0 -10px; border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #f3a173, var(--rw-accent) 70%); border: 2px solid rgba(255, 255, 255, 0.6);
}
.rw-tilt-label { font-size: 11px; color: var(--rw-dim); }

/* floating 2-axis stick (foot) */
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

.rw-pedal { width: 84px; height: 110px; border-radius: 22px; font-size: 13px; }
.rw-pedal .rw-face { gap: 6px; }
.rw-pedal svg { width: 30px; height: 30px; }
.rw-pedal.rw-gas .rw-face { border-color: rgba(226, 115, 58, 0.7); }
.rw-pedal.rw-tall { height: 122px; }

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

/* placement slots: --x from the thumb side edge, --y from the bottom.
   Left-handed swaps the side. docs/UI.md draws the whole layout. */
.rw-gas, .rw-brake, .rw-exit, .rw-enter, .rw-fire, .rw-dbfire, .rw-lock, .rw-chipbtn, .rw-more,
.rw-sec, .rw-extra, .rw-slot {
  right: calc(var(--rw-sr) + var(--x)); bottom: calc(var(--rw-sb) + var(--y));
}
.rw-lefty .rw-gas, .rw-lefty .rw-brake, .rw-lefty .rw-exit, .rw-lefty .rw-enter, .rw-lefty .rw-fire,
.rw-lefty .rw-dbfire, .rw-lefty .rw-lock, .rw-lefty .rw-chipbtn, .rw-lefty .rw-more,
.rw-lefty .rw-sec, .rw-lefty .rw-extra, .rw-lefty .rw-slot {
  right: auto; left: calc(var(--rw-sl) + var(--x));
}
.rw-touch { --dir: 1; }
.rw-touch.rw-lefty { --dir: -1; }
.rw-gas { --x: 16px; --y: 14px; }
.rw-brake { --x: 112px; --y: 14px; }
.rw-dbfire { --x: 16px; --y: 134px; width: 72px; height: 72px; }
.rw-exit { --x: 100px; --y: 134px; width: 64px; height: 64px; }
.rw-mode-plane .rw-exit, .rw-mode-heli .rw-exit { --x: 16px; --y: 150px; }
.rw-enter { --x: 26px; --y: 132px; width: 72px; height: 72px; }
.rw-enter svg { width: 32px; height: 32px; }
.rw-enter span { font-size: 12px; }
.rw-lock { --x: 142px; --y: 30px; width: 62px; height: 62px; }
.rw-chipbtn { --x: 142px; --y: 98px; width: 56px; height: 56px; }
.rw-chipbtn .rw-face { background: rgba(120, 30, 22, 0.7); border-color: rgba(255, 150, 120, 0.85); font-size: 9px; }
.rw-chipbtn svg { width: 22px; height: 22px; }
.rw-touch:not(.rw-chip-on) .rw-chipbtn, .rw-full .rw-chipbtn { display: none; }
.rw-enter.rw-dim { opacity: 0.32; filter: grayscale(0.8); pointer-events: none; }
.rw-more { --x: 216px; --y: 30px; width: 56px; height: 56px; }
.rw-full .rw-more { display: none; }
.rw-touch.rw-fan-open .rw-more .rw-face { background: var(--rw-accent-soft); border-color: #ffd0b5; }
.rw-extra { --x: 16px; --y: calc(214px + var(--k, 0) * 72px); width: 64px; height: 64px; }
.rw-extra.rw-a-handbrake { --x: 206px; --y: 14px; width: 56px; height: 56px; }
/* in a car the more button and its fan sit one step higher, over the HAND button */
.rw-mode-car .rw-more { --y: 80px; }
.rw-mode-car .rw-sec { --y: calc(80px + (var(--r, 0) + 1) * 64px); }
.rw-a-detonate .rw-face { border-color: rgba(255, 120, 90, 0.95); animation: rw-pulse 0.9s ease-in-out infinite; }
@keyframes rw-pulse { 50% { box-shadow: 0 0 14px rgba(255, 90, 60, 0.9); } }

/* armed craft (docs/ARMS.md): an arc for the right thumb, kept in the
   bottom 220 px so the HUD corners stay clear at 780x360 and within 352 px
   of the edge so the bottom-centre speed and prompt stay clear: GUN (big,
   hold), MSL and BOMB in a row above the pedals, LOCK and DETONATE beside
   the pedals, the more fan moved up and out while the arc is up. Tank:
   CANNON under the thumb, COAX and LOCK beside it. */
.rw-slot { width: 64px; height: 64px; }
.rw-slot span { font-size: 10px; }
.rw-slot svg { width: 24px; height: 24px; }
.rw-slot-gun { --x: 92px; --y: 136px; width: 84px; height: 84px; }
.rw-slot-gun svg { width: 30px; height: 30px; }
.rw-slot-msl { --x: 188px; --y: 140px; }
.rw-slot-bomb { --x: 264px; --y: 140px; }
.rw-slot-alock { --x: 204px; --y: 30px; }
.rw-slot-det { --x: 284px; --y: 96px; }
.rw-arc.rw-mode-plane .rw-slot-det, .rw-arc.rw-mode-heli .rw-slot-det { --x: 272px; --y: 30px; }
.rw-slot-cannon { --x: 26px; --y: 24px; width: 100px; height: 100px; }
.rw-slot-cannon svg { width: 36px; height: 36px; }
.rw-slot-coax { --x: 142px; --y: 30px; }
.rw-slot-tlock { --x: 142px; --y: 106px; }
.rw-mode-tank .rw-exit { --x: 26px; --y: 140px; width: 72px; height: 72px; }
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
.rw-arc.rw-mode-plane .rw-more, .rw-arc.rw-mode-heli .rw-more { --x: 352px; --y: 96px; }
.rw-arc.rw-mode-plane .rw-sec, .rw-arc.rw-mode-heli .rw-sec {
  --x: calc(352px + var(--c, 0) * 64px); --y: calc(96px + (var(--r, 0) + 1) * 64px);
}

/* the fan: secondary buttons grow upward out of the more button, one
   column of four (--r = place in the column, --c = column) */
.rw-sec {
  --x: calc(216px + var(--c, 0) * 64px); --y: calc(30px + (var(--r, 0) + 1) * 64px);
  width: 56px; height: 56px;
  transform: translate(calc(var(--dir) * var(--c, 0) * 64px), calc((var(--r, 0) + 1) * 64px)) scale(0.3);
  opacity: 0; visibility: hidden;
  transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.3, 1), opacity 0.16s ease, visibility 0s linear 0.16s;
}
.rw-fan-open .rw-sec, .rw-full .rw-sec {
  transform: none; opacity: 1; visibility: visible; transition-delay: 0s;
}
.rw-sec span { font-size: 9px; }
.rw-sec svg { width: 22px; height: 22px; }

/* combat: FIRE under the right thumb, LOCK beside it, reload chip above LOCK */
.rw-btn.rw-fire { --x: 26px; --y: 24px; width: 100px; height: 100px; font-size: 13px; }
.rw-btn.rw-fire .rw-face, .rw-btn.rw-dbfire .rw-face {
  background: rgba(120, 30, 22, 0.62); border: 3px solid rgba(255, 120, 96, 0.8);
}
.rw-btn.rw-fire svg { width: 38px; height: 38px; }
.rw-btn.rw-dbfire { font-size: 11px; }
.rw-btn.rw-dbfire svg { width: 28px; height: 28px; }
.rw-btn.rw-fire.rw-down .rw-face, .rw-btn.rw-dbfire.rw-down .rw-face { background: rgba(226, 70, 48, 0.85); border-color: #ffd0b5; }
.rw-fire-mag { position: absolute; right: 10%; top: 8%; font: 800 11px/1 system-ui, sans-serif; color: #ffe2cc; font-variant-numeric: tabular-nums; }
.rw-dbfire .rw-fire-mag { right: 14%; top: 12%; }
.rw-lock.rw-on .rw-face { background: rgba(226, 70, 48, 0.8); border-color: #ffd0b5; box-shadow: 0 0 12px rgba(255, 110, 80, 0.7); }
/* ammo counter: HUD Full only (Minimal reads the count off FIRE) */
.rw-btn.rw-ammo { right: calc(var(--rw-sr) + 8px); top: calc(var(--rw-st) + 88px); width: 112px; height: 56px; border-radius: 16px; }
.rw-ammo .rw-face {
  flex-direction: row; justify-content: flex-start; gap: 6px; padding: 0 8px; flex-wrap: wrap;
  align-content: center; row-gap: 2px;
}
.rw-touch:not(.rw-full) .rw-ammo { display: none; }
.rw-ammo-icon svg { width: 24px; height: 24px; display: block; }
.rw-ammo-txt { display: flex; align-items: baseline; gap: 1px; }
.rw-ammo-n { font-size: 20px; font-weight: 800; color: #ffe2cc; font-variant-numeric: tabular-nums; }
.rw-ammo-of { font-size: 11px; color: var(--rw-dim); }
.rw-ammo-name { flex-basis: 100%; font-style: normal; font-size: 9px; color: var(--rw-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.rw-ammo-bar { position: absolute; left: 10px; right: 10px; bottom: 5px; height: 3px; border-radius: 2px; background: rgba(0, 0, 0, 0.4); display: none; overflow: hidden; }
.rw-ammo-bar i { display: block; height: 100%; background: var(--rw-accent); transform-origin: left; transform: scaleX(0); }
.rw-ammo.rw-reloading .rw-ammo-bar { display: block; }
.rw-ammo.rw-reloading .rw-ammo-n { color: var(--rw-dim); }
.rw-ammo.rw-empty .rw-ammo-n { color: #ff8a70; }
.rw-nocombat .rw-cmb, .rw-nodrive .rw-dbfire,
.rw-nodrive.rw-mode-car .rw-ammo, .rw-nodrive.rw-mode-boat .rw-ammo { display: none; }

.rw-btn.rw-pause { right: calc(var(--rw-sr) + 8px); top: calc(var(--rw-st) + 8px); width: 56px; height: 56px; }

/* left-handed: steering and stick on the right, pedals and buttons left */
.rw-lefty .rw-look { left: 0; right: 40%; }
.rw-lefty .rw-stickzone { left: auto; right: 0; }
.rw-lefty .rw-wheel, .rw-lefty .rw-tiltbar { left: auto; right: calc(var(--rw-sr) + 20px); }
.rw-lefty .rw-sright { left: auto; right: calc(var(--rw-sr) + 18px); }
.rw-lefty .rw-sleft { left: auto; right: calc(var(--rw-sr) + 124px); }

@media (prefers-reduced-motion: reduce) {
  .rw-face, .rw-sec, .rw-wheel, .rw-wheel-rot, .rw-pad, .rw-stick, .rw-minimap, .rw-tl, .rw-tr { transition: none !important; }
  .rw-a-detonate .rw-face { animation: none; }
}

/* ---------- HUD ---------- */
.rw-hud { z-index: 21; pointer-events: none; --map: 84px; --map-big: 170px; }
.rw-hud .rw-tl { position: absolute; left: calc(var(--rw-sl) + 10px); top: calc(var(--rw-st) + 8px); width: var(--map); transition: width 0.16s ease; }
.rw-hud .rw-tl.rw-big { width: var(--map-big); }
.rw-minimap {
  display: block; width: 100%; aspect-ratio: 1; height: auto; border-radius: 50%; cursor: pointer;
  pointer-events: auto; touch-action: none;
  background: rgba(24, 18, 15, 0.7); border: 3px solid var(--rw-accent);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
.rw-minimap:focus-visible { outline: 3px solid #fff; outline-offset: 3px; }
/* district: small text beside the map for 3 s after a change (Full: always, below) */
.rw-district {
  position: absolute; left: calc(100% + 8px); top: 6px; white-space: nowrap; opacity: 0;
  font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 6px rgba(0, 0, 0, 0.6);
}
.rw-district.rw-show { animation: rw-district 3s ease-out; }
@keyframes rw-district { 0% { opacity: 0; } 10% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
.rw-clock { display: none; font-size: 12px; text-align: center; color: var(--rw-dim); font-variant-numeric: tabular-nums; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); }
.rw-full .rw-clock { display: block; }
.rw-hpmeter {
  position: relative; height: 14px; margin-top: 5px; border-radius: 7px; overflow: hidden;
  background: rgba(0, 0, 0, 0.55); border: 1px solid rgba(255, 255, 255, 0.28);
}
.rw-hpmeter.rw-none { display: none; }
.rw-hpfill { position: absolute; inset: 0; transform-origin: left; background: hsl(120, 70%, 48%); transition: transform 0.15s linear; }
.rw-hpmeter.rw-low { animation: rw-hplow 0.9s ease-in-out infinite; }
@keyframes rw-hplow { 50% { border-color: #e2503a; } }
.rw-hptext {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 9px; font-weight: 800; letter-spacing: 0.06em; font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
}
.rw-full .rw-district {
  position: static; opacity: 1; animation: none; margin: 4px 0 0; text-align: left;
  white-space: nowrap; overflow: visible;
}
.rw-full { --map: 116px; }

.rw-toasts {
  position: absolute; left: 50%; top: calc(var(--rw-st) + 10px); transform: translateX(-50%);
  width: 34%; min-width: 200px; display: flex; flex-direction: column; align-items: center; gap: 6px;
}
.rw-toast {
  max-width: 100%; padding: 7px 14px; border-radius: 14px; font-size: 14px; font-weight: 600; text-align: center;
  background: var(--rw-panel); border: 1px solid var(--rw-panel-edge); border-left: 4px solid var(--rw-accent);
  animation: rw-toast-in 0.2s ease-out; transition: opacity 0.3s;
}
.rw-toast.rw-out { opacity: 0; }
@keyframes rw-toast-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: none; } }

.rw-tr {
  position: absolute; right: calc(var(--rw-sr) + 72px); top: calc(var(--rw-st) + 8px);
  display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
  padding: 2px 4px; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 6px rgba(0, 0, 0, 0.6);
  transition: opacity 0.4s ease;
}
.rw-tr.rw-faded { opacity: 0.35; }
.rw-full .rw-tr {
  padding: 7px 10px; border-radius: 14px; background: var(--rw-panel); border: 1px solid var(--rw-panel-edge);
  min-width: 128px; gap: 3px;
}
.rw-money { font-size: 17px; font-weight: 800; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; color: #ffe2cc; }
.rw-combo { font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; color: #ffb48a; }
.rw-full .rw-money { font-size: 22px; }
.rw-full .rw-combo { font-size: 14px; }
.rw-wanted { display: flex; gap: 3px; }
.rw-wanted.rw-none { display: none; }
.rw-badge {
  width: 12px; height: 12px; background: rgba(246, 239, 230, 0.22);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
}
.rw-badge.rw-on { background: var(--rw-accent); }
.rw-full .rw-badge { width: 16px; height: 16px; }
.rw-bars { display: flex; flex-direction: column; gap: 4px; width: 128px; }
.rw-bar { height: 9px; border-radius: 5px; background: rgba(0, 0, 0, 0.5); overflow: hidden; }
.rw-fill { height: 100%; width: 100%; border-radius: 5px; background: #6fd18b; }
.rw-armor .rw-fill { background: #6fb4e8; }
.rw-bar.rw-low .rw-fill { background: #e2503a; }
.rw-bar.rw-empty { display: none; }
.rw-weapon { font-size: 13px; font-weight: 700; color: var(--rw-dim); white-space: nowrap; font-variant-numeric: tabular-nums; }
.rw-weapon.rw-none { display: none; }

.rw-bottom {
  position: absolute; left: 50%; bottom: calc(var(--rw-sb) + 10px); transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px; width: 30%; min-width: 180px;
}
.rw-prompt {
  padding: 6px 14px; border-radius: 14px; font-size: 14px; font-weight: 700; text-align: center;
  background: var(--rw-panel); border: 1px solid var(--rw-accent-soft);
}
.rw-prompt.rw-none, .rw-speedbox.rw-none { display: none; }
.rw-speedbox { display: flex; flex-direction: column; align-items: center; gap: 3px; text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8); }
.rw-speed { font-size: 22px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
.rw-speed small { font-size: 10px; font-weight: 700; color: var(--rw-dim); margin-left: 3px; letter-spacing: 0.06em; }
.rw-vehbar { width: 64px; height: 5px; }
.rw-full .rw-speed { font-size: 34px; }
.rw-full .rw-speed small { font-size: 12px; }
.rw-full .rw-vehbar { width: 90px; height: 6px; }

.rw-title {
  position: absolute; left: 0; right: 0; top: 32%; text-align: center; opacity: 0;
  font-size: 40px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #ffe2cc;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.85), 0 0 22px rgba(226, 115, 58, 0.6);
}
.rw-title.rw-show { animation: rw-title 3.2s ease-out; }
@keyframes rw-title {
  0% { opacity: 0; transform: scale(1.15); letter-spacing: 0.3em; }
  15% { opacity: 1; transform: scale(1); letter-spacing: 0.14em; }
  70% { opacity: 1; }
  100% { opacity: 0; }
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
  left: 50%; bottom: calc(var(--rw-sb) + 3px); width: 180px; margin-left: -90px; height: 7px; border-radius: 4px;
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
  .rw-hud { --map: 76px; --map-big: 140px; }
  .rw-hud .rw-tl { top: calc(var(--rw-st) + 4px); }
  .rw-full { --map: 96px; }
  .rw-title { font-size: 32px; top: 28%; }
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
