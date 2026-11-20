// All CSS for the touch controls and HUD. One <style> element, added once.
const CSS = `
.rw-touch, .rw-hud {
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
.rw-touch *, .rw-hud * {
  box-sizing: border-box; -webkit-user-select: none; user-select: none;
  touch-action: none; -webkit-tap-highlight-color: transparent;
}

/* ---------- touch controls ---------- */
.rw-touch { z-index: 20; pointer-events: none; }
.rw-touch.rw-hidden { display: none; }
.rw-zone { position: absolute; pointer-events: auto; }
.rw-look { left: 40%; right: 0; top: 0; bottom: 0; }
.rw-stickzone { left: 0; width: 40%; top: 35%; bottom: 0; }

/* floating steering pad (car) */
.rw-pad {
  position: absolute; left: 0; top: 0; width: 176px; height: 60px; border-radius: 30px;
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

/* buttons */
.rw-btn {
  position: absolute; pointer-events: auto; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1px; padding: 0; margin: 0;
  width: 58px; height: 58px; border-radius: 50%;
  background: var(--rw-panel); color: var(--rw-text);
  border: 2px solid var(--rw-panel-edge); outline: none;
  font: 700 10px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: 0.06em;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  transition: transform 0.06s, background 0.06s;
}
.rw-btn svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.rw-btn span { pointer-events: none; }
.rw-btn.rw-down { background: var(--rw-accent-soft); border-color: #ffd0b5; transform: scale(0.92); }
.rw-btn.rw-big { width: 76px; height: 76px; }
.rw-btn.rw-big svg { width: 32px; height: 32px; }

.rw-pedal {
  width: 84px; height: 110px; border-radius: 22px; font-size: 13px; gap: 6px;
}
.rw-pedal svg { width: 30px; height: 30px; }
.rw-pedal.rw-gas { border-color: rgba(226, 115, 58, 0.7); }

/* per-mode groups: a gated element shows only in the modes it lists */
.rw-mode-foot .rw-gated:not(.rw-m-foot),
.rw-mode-car .rw-gated:not(.rw-m-car),
.rw-mode-boat .rw-gated:not(.rw-m-boat),
.rw-mode-plane .rw-gated:not(.rw-m-plane),
.rw-mode-heli .rw-gated:not(.rw-m-heli) { display: none; }

/* flight stick: cross-hair ring behind the knob */
.rw-stick.rw-flight { border-style: dashed; }
.rw-stick.rw-flight::before, .rw-stick.rw-flight::after {
  content: ""; position: absolute; background: var(--rw-dim); opacity: 0.45; border-radius: 1px;
}
.rw-stick.rw-flight::before { left: 50%; top: 10px; bottom: 10px; width: 2px; margin-left: -1px; }
.rw-stick.rw-flight::after { top: 50%; left: 10px; right: 10px; height: 2px; margin-top: -1px; }

.rw-pedal.rw-tall { height: 122px; }

/* placement (offsets from the safe area) */
.rw-gas { right: calc(var(--rw-sr) + 16px); bottom: calc(var(--rw-sb) + 14px); }
.rw-brake { right: calc(var(--rw-sr) + 112px); bottom: calc(var(--rw-sb) + 14px); }
.rw-handbrake { right: calc(var(--rw-sr) + 16px); bottom: calc(var(--rw-sb) + 138px); }
.rw-horn { right: calc(var(--rw-sr) + 84px); bottom: calc(var(--rw-sb) + 138px); }
.rw-exit { right: calc(var(--rw-sr) + 152px); bottom: calc(var(--rw-sb) + 138px); }
.rw-cam { right: calc(var(--rw-sr) + 220px); bottom: calc(var(--rw-sb) + 138px); }
.rw-mode-plane .rw-exit, .rw-mode-heli .rw-exit { right: calc(var(--rw-sr) + 16px); bottom: calc(var(--rw-sb) + 150px); }
.rw-mode-plane .rw-cam, .rw-mode-heli .rw-cam { right: calc(var(--rw-sr) + 84px); bottom: calc(var(--rw-sb) + 150px); }

.rw-enter { right: calc(var(--rw-sr) + 24px); bottom: calc(var(--rw-sb) + 24px); width: 100px; height: 100px; }
.rw-enter svg { width: 40px; height: 40px; }
.rw-enter span { font-size: 13px; }
.rw-run { right: calc(var(--rw-sr) + 140px); bottom: calc(var(--rw-sb) + 28px); width: 68px; height: 68px; }

.rw-pause { right: calc(var(--rw-sr) + 8px); top: calc(var(--rw-st) + 8px); width: 56px; height: 56px; }
.rw-map { right: calc(var(--rw-sr) + 70px); top: calc(var(--rw-st) + 8px); width: 56px; height: 56px; }

/* ---------- HUD ---------- */
.rw-hud { z-index: 10; pointer-events: none; }
.rw-hud .rw-tl { position: absolute; left: calc(var(--rw-sl) + 10px); top: calc(var(--rw-st) + 8px); width: 116px; }
.rw-minimap {
  display: block; width: 116px; height: 116px; border-radius: 50%;
  background: rgba(24, 18, 15, 0.7); border: 3px solid var(--rw-accent);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
.rw-district {
  margin: 4px -30px 0; font-size: 12px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
  text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
}
.rw-clock { font-size: 12px; text-align: center; color: var(--rw-dim); font-variant-numeric: tabular-nums; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8); }

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
  position: absolute; right: calc(var(--rw-sr) + 134px); top: calc(var(--rw-st) + 8px);
  display: flex; flex-direction: column; align-items: flex-end; gap: 5px;
  padding: 7px 10px; border-radius: 14px; background: var(--rw-panel); border: 1px solid var(--rw-panel-edge);
  min-width: 128px;
}
.rw-money { font-size: 22px; font-weight: 800; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; color: #ffe2cc; }
.rw-wanted { display: flex; gap: 4px; }
.rw-wanted.rw-none { display: none; }
.rw-badge {
  width: 16px; height: 16px; background: rgba(246, 239, 230, 0.22);
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
}
.rw-badge.rw-on { background: var(--rw-accent); }
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
.rw-speed { font-size: 34px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
.rw-speed small { font-size: 12px; font-weight: 700; color: var(--rw-dim); margin-left: 3px; letter-spacing: 0.06em; }
.rw-vehbar { width: 90px; height: 6px; }

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

@media (max-height: 380px) {
  .rw-minimap { width: 96px; height: 96px; }
  .rw-hud .rw-tl { width: 96px; }
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
