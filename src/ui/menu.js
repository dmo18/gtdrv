import { formatDistance, formatMiles, formatClock12 } from '../core/units.js';
import { createPhoneCheck, createLabDrive, SOUNDS, SOUND_NOTES, DRIVE_SECONDS, SOUND_SECONDS } from './phonecheck.js';
import { fillAbout } from './title.js';
// The pause menu (docs/REVAMP.md 6.4): four sections (Resume, Stats,
// Settings, Help), Settings in four groups, destructive actions on their own
// confirm screens, and a registry for screens other systems add.
// All text goes through textContent / DOM APIs, never innerHTML.
import { setHandlingMode, setHandlingPreset } from '../entities/vehicle.js';
import { PRESETS, PRESET_LABELS, VERDICTS, VERDICT_LABELS, validPreset, validVerdict } from '../core/handlingpreset.js';
import { volumeFromSettings } from '../audio/levels.js';
import { nextStation, stationInfo } from '../core/radio.js';
import { SECRET_DEFS, GARAGE_NAME } from '../world/secrets.js';
import { fillMapPicker, switchMap } from './mappicker.js';
import { mapName, pickerCurrent } from '../core/travel.js';
import { MAP_CHOICE_KEY } from '../world/maps.js';
// The loop's screens (docs/LOOP.md sections c, d, f): Records, Daily, Customize.
import { loopOf, medalCounts, boardRows, closestMedals, bestFlow, totalDistance, REGION_SLUGS, REGION_NAMES } from '../core/records.js';
import { valueText, TEMPLATE_INFO, nextMedal, cap } from '../core/streetevents.js';
import { PAINTS, FINISHES, WHEELS, TINTS, DECALS, lockText } from '../core/custom.js';
import { TEXT_SIZES } from '../core/access.js';
import { VEHICLE_SPECS } from '../entities/vehicle.js';

const STYLE_ID = 'rw-menu-style';
const CREDIT = 'Map data (c) OpenStreetMap contributors, ODbL';

const CSS = `
/* 0.13.7 redesign: dark glass panels, one accent (orange) for selected and primary, 48 to 52 px rows. */
.rw-menu {
  --rw-accent: #e2733a; --rw-accent-hi: #f28d55; --rw-accent-ink: #1c0f07;
  --rw-accent-soft: rgba(226,115,58,0.2); --rw-accent-line: rgba(242,141,85,0.75);
  --rw-text: #f3f5f8; --rw-dim: rgba(214,222,233,0.74);
  --rw-panel: rgba(15,19,26,0.9); --rw-panel-edge: rgba(255,255,255,0.12);
  --rw-fill: rgba(255,255,255,0.06); --rw-fill-2: rgba(255,255,255,0.1); --rw-fill-3: rgba(255,255,255,0.15);
  --rw-line: rgba(255,255,255,0.08); --rw-ease: cubic-bezier(0.2, 0.8, 0.3, 1);
  --rw-sl: max(env(safe-area-inset-left, 0px), var(--rw-test-sl, 0px)); --rw-sr: max(env(safe-area-inset-right, 0px), var(--rw-test-sr, 0px));
  --rw-st: max(env(safe-area-inset-top, 0px), var(--rw-test-st, 0px)); --rw-sb: max(env(safe-area-inset-bottom, 0px), var(--rw-test-sb, 0px));
  position: fixed; inset: 0; z-index: 40; display: none;
  padding: calc(4px + var(--rw-st)) calc(8px + var(--rw-sr)) calc(4px + var(--rw-sb)) calc(8px + var(--rw-sl));
  background: radial-gradient(120% 140% at 70% 0%, rgba(20,26,36,0.7), rgba(5,7,11,0.86) 70%);
  color: var(--rw-text);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px; line-height: 1.3; touch-action: pan-y;
  -webkit-tap-highlight-color: transparent; -webkit-font-smoothing: antialiased;
}
.rw-menu.rw-menu-open { display: flex; gap: 8px; }
.rw-menu *, .rw-menu *::before, .rw-menu *::after { box-sizing: border-box; }
.rw-menu svg { flex: 0 0 auto; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
/* the side rail: Back and the four sections on one glass strip */
.rw-menu-side {
  flex: 0 0 132px; display: flex; flex-direction: column; gap: 8px; min-height: 0; padding: 6px;
  border-radius: 16px; background: var(--rw-panel); box-shadow: inset 0 0 0 1px var(--rw-panel-edge), 0 10px 30px rgba(0,0,0,0.35);
}
.rw-menu-rail { display: flex; flex-direction: column; gap: 4px; }
.rw-menu button { font-family: inherit; color: var(--rw-text); cursor: pointer; touch-action: manipulation; }
.rw-menu-tab, .rw-menu-btn, .rw-menu-seg button, .rw-menu-back {
  min-height: 48px; border-radius: 12px; border: 0; background: var(--rw-fill);
  box-shadow: inset 0 0 0 1px var(--rw-line);
  font-weight: 600; font-size: 15px; padding: 0 14px;
  transition: background-color 0.14s ease, color 0.14s ease, box-shadow 0.14s ease;
}
.rw-menu-btn:active, .rw-menu-seg button:active, .rw-menu-back:active, .rw-menu-tab:active { background: var(--rw-fill-3); }
.rw-menu-tab {
  position: relative; width: 100%; flex: 0 0 auto; display: flex; align-items: center; gap: 10px; padding: 0 10px;
  text-align: left; background: transparent; box-shadow: none; color: var(--rw-dim);
}
.rw-menu-tab svg { width: 20px; height: 20px; }
.rw-menu-tab[aria-selected="true"] { background: var(--rw-accent-soft); color: var(--rw-text); box-shadow: inset 0 0 0 1px rgba(242,141,85,0.35); }
.rw-menu-tab[aria-selected="true"] svg { color: var(--rw-accent-hi); }
.rw-menu-tab[aria-selected="true"]::before {
  content: ""; position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 0 3px 3px 0; background: var(--rw-accent);
}
.rw-menu-back { width: 48px; height: 48px; min-height: 48px; padding: 0; flex: 0 0 48px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: var(--rw-fill-2); }
.rw-menu-back svg { width: 24px; height: 24px; stroke-width: 2.4; }
.rw-menu-btn.rw-menu-primary {
  background: linear-gradient(180deg, var(--rw-accent-hi), var(--rw-accent)); color: var(--rw-accent-ink); font-weight: 700;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25), 0 6px 16px rgba(226,115,58,0.25);
}
.rw-menu-btn.rw-menu-primary:active { background: var(--rw-accent); }
.rw-menu-btn.rw-menu-danger { background: #c4392d; color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,0.18); }
.rw-menu-btn:disabled { opacity: 0.5; cursor: default; }
.rw-menu button:focus-visible, .rw-menu input:focus-visible { outline: 2px solid #ffd2b5; outline-offset: 2px; }
.rw-menu-main {
  flex: 1 1 auto; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden;
  border-radius: 16px; background: var(--rw-panel); box-shadow: inset 0 0 0 1px var(--rw-panel-edge), 0 10px 30px rgba(0,0,0,0.35);
}
.rw-menu-head { flex: 0 0 48px; height: 48px; display: flex; align-items: center; gap: 8px; padding: 0 8px 0 16px; box-shadow: inset 0 -1px var(--rw-line); }
.rw-menu-title { margin: 0; font-size: 21px; font-weight: 700; letter-spacing: 0.01em; flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rw-menu-version { font-size: 12px; opacity: 0.8; }
.rw-menu-points {
  flex: 0 0 auto; font-size: 13px; font-weight: 700; color: #ffc49e; font-variant-numeric: tabular-nums; white-space: nowrap;
  padding: 4px 10px; border-radius: 999px; background: var(--rw-fill); box-shadow: inset 0 0 0 1px var(--rw-line);
}
/* Settings groups: plain tabs with an accent bar under the chosen one */
.rw-menu-groups { display: flex; gap: 2px; flex: 1 1 auto; margin-left: -8px; align-self: stretch; }
.rw-menu-groups button {
  position: relative; flex: 1 1 0; min-width: 0; height: 48px; min-height: 48px; margin: 0; padding: 0 6px;
  background: transparent; box-shadow: none; border-radius: 10px; color: var(--rw-dim); font-size: 15px;
}
.rw-menu-groups button[aria-selected="true"] { color: var(--rw-text); font-weight: 700; }
.rw-menu-groups button[aria-selected="true"]::after {
  content: ""; position: absolute; left: 22%; right: 22%; bottom: 0; height: 3px; border-radius: 3px 3px 0 0; background: var(--rw-accent);
}
/* head buttons (Access, Done): a 48 px hit area drawing a slimmer pill */
.rw-menu-head > .rw-menu-btn { position: relative; z-index: 0; flex: 0 0 auto; margin: 0; background: transparent; box-shadow: none; }
.rw-menu-head > .rw-menu-btn::before {
  content: ""; position: absolute; z-index: -1; inset: 6px 0; border-radius: 999px;
  background: var(--rw-fill-2); box-shadow: inset 0 0 0 1px var(--rw-line);
}
.rw-menu-head > .rw-menu-btn:active { background: transparent; }
.rw-menu-head > .rw-menu-btn:active::before { background: var(--rw-fill-3); }
.rw-menu-head > .rw-menu-btn.rw-menu-primary::before { background: linear-gradient(180deg, var(--rw-accent-hi), var(--rw-accent)); box-shadow: 0 4px 12px rgba(226,115,58,0.3); }
.rw-menu-access { display: inline-flex; align-items: center; gap: 6px; height: 48px; min-height: 48px; min-width: 56px; padding: 0 14px; font-size: 14px; }
.rw-menu-access svg { width: 18px; height: 18px; }
.rw-menu-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; padding: 0 12px 4px; }
.rw-menu-body p { margin: 0 0 8px; }
.rw-menu-body > p:first-child { margin-top: 8px; }
.rw-menu-dim { color: var(--rw-dim); font-size: 13px; line-height: 1.4; }
.rw-menu-group { margin: 14px 0 6px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--rw-accent-hi); }
.rw-menu-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 28px; padding: 2px 0; }
/* a run of setting rows reads as one grouped card */
.rw-menu-setting {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 48px; padding: 0 0 0 14px;
  background: var(--rw-fill); box-shadow: inset 0 -1px var(--rw-line); font-size: 16px;
}
.rw-menu-setting:not(.rw-menu-setting + .rw-menu-setting) { margin-top: 4px; border-top-left-radius: 14px; border-top-right-radius: 14px; }
.rw-menu-setting:not(:has(+ .rw-menu-setting)) { border-bottom-left-radius: 14px; border-bottom-right-radius: 14px; box-shadow: none; margin-bottom: 4px; }
.rw-menu-setting > span:first-child { flex: 0 0 auto; min-width: 7.5em; white-space: nowrap; font-weight: 500; }
.rw-menu-setting input[type=range] {
  --p: 50%; flex: 1 1 120px; min-width: 0; height: 48px; margin: 0; padding: 0; background: transparent;
  -webkit-appearance: none; appearance: none; accent-color: var(--rw-accent); cursor: pointer; touch-action: pan-y;
}
.rw-menu-setting input[type=range]::-webkit-slider-runnable-track {
  height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--rw-accent) var(--p), rgba(255,255,255,0.16) var(--p));
}
.rw-menu-setting input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 26px; height: 26px; margin-top: -10px; border-radius: 50%;
  background: #fff; border: 0; box-shadow: 0 0 0 4px rgba(226,115,58,0.9), 0 2px 8px rgba(0,0,0,0.5);
}
.rw-menu-setting input[type=range]::-moz-range-track { height: 6px; border-radius: 3px; background: rgba(255,255,255,0.16); }
.rw-menu-setting input[type=range]::-moz-range-progress { height: 6px; border-radius: 3px; background: var(--rw-accent); }
.rw-menu-setting input[type=range]::-moz-range-thumb { width: 26px; height: 26px; border-radius: 50%; background: #fff; border: 0; box-shadow: 0 0 0 4px rgba(226,115,58,0.9); }
.rw-menu-setting input[type=range]:active::-webkit-slider-thumb { box-shadow: 0 0 0 6px rgba(226,115,58,0.95), 0 2px 10px rgba(0,0,0,0.5); }
.rw-menu-setting input[type=range]:disabled { opacity: 0.35; cursor: default; }
.rw-menu-value { flex: 0 0 3.4em; padding-right: 14px; text-align: right; color: var(--rw-dim); font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; box-sizing: content-box; }
/* buttons at the right end of a row sit flush with the card's padding */
.rw-menu-setting > .rw-menu-btn, .rw-menu-setting > .rw-menu-seg { margin-right: 6px; }
/* switches: the button keeps its On / Off text (small, beside a drawn track) */
.rw-menu-tier { display: block; font-size: 12px; color: var(--rw-dim); font-variant-numeric: tabular-nums; }
.rw-menu-switch { min-width: 92px; }
.rw-menu-switch[role="switch"] {
  position: relative; min-width: 96px; padding: 0 64px 0 8px; text-align: right; background: transparent; box-shadow: none;
  font-size: 13px; font-weight: 600; color: var(--rw-dim);
}
.rw-menu-switch[role="switch"]::before {
  content: ""; position: absolute; right: 8px; top: 50%; width: 48px; height: 28px; margin-top: -14px; border-radius: 14px;
  background: rgba(255,255,255,0.16); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); transition: background-color 0.16s ease;
}
.rw-menu-switch[role="switch"]::after {
  content: ""; position: absolute; right: 32px; top: 50%; width: 22px; height: 22px; margin-top: -11px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.45); transition: transform 0.16s var(--rw-ease);
}
.rw-menu-switch[role="switch"][aria-checked="true"] { color: var(--rw-text); }
.rw-menu-switch[role="switch"][aria-checked="true"]::before { background: var(--rw-accent); box-shadow: none; }
.rw-menu-switch[role="switch"][aria-checked="true"]::after { transform: translateX(21px); }
.rw-menu-switch[role="switch"]:active { background: transparent; }
.rw-menu-switch[role="switch"]:active::after { width: 26px; }
/* segmented controls (2 to 4 choices) */
.rw-menu-seg { display: flex; gap: 2px; padding: 0; border-radius: 12px; background: rgba(0,0,0,0.28); box-shadow: inset 0 0 0 1px var(--rw-line); }
.rw-menu-seg button { min-width: 72px; padding: 0 12px; background: transparent; box-shadow: none; color: var(--rw-dim); }
.rw-menu-seg button { line-height: 1.15; }
.rw-menu-seg button[data-verdict] { font-size: 13px; padding: 0 8px; }
.rw-menu-seg button[aria-checked="true"] { background: var(--rw-accent); color: var(--rw-accent-ink); font-weight: 700; box-shadow: 0 2px 8px rgba(226,115,58,0.3); }
/* a row that opens another screen: its value and a chevron */
.rw-menu-go {
  display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 132px;
  background: transparent; box-shadow: none; color: var(--rw-dim); font-weight: 600; padding: 0 16px 0 12px;
}
.rw-menu-go::after {
  content: ""; flex: 0 0 auto; width: 8px; height: 8px; margin-left: 2px; border: solid currentColor; border-width: 2px 2px 0 0;
  transform: rotate(45deg); opacity: 0.8;
}
.rw-menu-go:active { background: var(--rw-fill-2); }
.rw-menu-setting .rw-menu-go { margin-right: 0; }
.rw-menu-switch:not([role="switch"]) { background: var(--rw-fill-2); }
.rw-menu-confirm { display: flex; gap: 8px; flex: 0 0 auto; }
.rw-menu-confirm .rw-menu-btn { min-width: 112px; }
.rw-menu-confirmrow {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 64px; padding: 8px 8px 8px 14px;
  border-radius: 14px; background: var(--rw-fill); box-shadow: inset 0 0 0 1px var(--rw-line);
}
.rw-menu-body > .rw-menu-confirmrow { margin: 8px 0; }
.rw-menu-confirmrow[role="alert"] { box-shadow: inset 0 0 0 1px rgba(255,110,90,0.55); background: rgba(196,57,45,0.12); }
.rw-menu-confirmrow > span { flex: 1 1 auto; font-size: 14px; line-height: 1.35; }
.rw-menu-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 10px 0 10px; }
.rw-menu-stat { padding: 7px 12px; border-radius: 12px; background: var(--rw-fill); box-shadow: inset 0 0 0 1px var(--rw-line); min-height: 52px; overflow: hidden; }
.rw-menu-stat b { display: block; font-size: 19px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.rw-menu-stat span { font-size: 12px; }
.rw-menu ul { margin: 0 0 10px; padding-left: 20px; }
.rw-menu li { margin-bottom: 4px; font-size: 14px; line-height: 1.4; }
.rw-menu li::marker { color: var(--rw-accent); }
.rw-menu-hub { display: flex; flex-direction: column; gap: 10px; padding-top: 12px; }
.rw-menu-hub .rw-menu-primary { height: 60px; font-size: 21px; display: flex; align-items: center; justify-content: center; gap: 10px; border-radius: 14px; }
.rw-menu-hub .rw-menu-primary svg { width: 22px; height: 22px; fill: currentColor; stroke-width: 1.5; }
.rw-menu-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.rw-menu-tile {
  min-height: 72px; display: grid; grid-template-columns: auto minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 8px; row-gap: 2px;
  align-content: center; justify-items: start; text-align: left; padding: 0 10px; border-radius: 14px;
}
.rw-menu-tile svg { grid-row: 1; grid-column: 1; width: 18px; height: 18px; align-self: center; color: var(--rw-accent-hi); }
.rw-menu-tile b { grid-row: 1; grid-column: 2; font-size: 16px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.rw-menu-tile span { grid-row: 2; grid-column: 1 / -1; font-size: 12px; font-weight: 500; color: var(--rw-dim); line-height: 1.3; }
.rw-lp-row { display: flex; align-items: center; gap: 8px; min-height: 52px; padding: 2px 6px 2px 12px; margin-bottom: 4px; border-radius: 12px; background: var(--rw-fill); }
.rw-lp-row > span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.rw-lp-row > i { flex: 0 0 auto; font-style: normal; font-size: 13px; font-variant-numeric: tabular-nums; color: var(--rw-dim); }
.rw-lp-row .rw-menu-btn { flex: 0 0 auto; min-width: 76px; height: 40px; min-height: 48px; }
.rw-lp-medal { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; vertical-align: -1px; background: rgba(255,255,255,0.16); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); }
.rw-lp-gold { background: #ffd34d; } .rw-lp-silver { background: #d4dbe2; } .rw-lp-bronze { background: #c98a52; }
.rw-lp-table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 0 0 8px; font-variant-numeric: tabular-nums; border-radius: 12px; overflow: hidden; background: var(--rw-fill); }
.rw-lp-table th, .rw-lp-table td { text-align: right; padding: 6px 10px; font-weight: 500; font-size: 14px; box-shadow: inset 0 -1px var(--rw-line); }
.rw-lp-table th { font-size: 12px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--rw-dim); }
.rw-lp-table th:first-child, .rw-lp-table td:first-child { text-align: left; }
.rw-lp-table tr:last-child td { box-shadow: none; font-weight: 700; }
.rw-lp-table tr[data-here="true"] td { color: #ffc49e; font-weight: 700; background: rgba(226,115,58,0.1); }
.rw-lp-card { display: flex; align-items: center; gap: 12px; min-height: 64px; margin: 0 0 8px; padding: 6px 8px 6px 14px; border-radius: 14px; background: var(--rw-fill); box-shadow: inset 0 0 0 1px var(--rw-line); }
.rw-lp-card[data-done="true"] { box-shadow: inset 0 0 0 2px #8bd66f; }
.rw-lp-card > div { flex: 1 1 auto; min-width: 0; }
.rw-lp-card b { display: block; font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rw-lp-card span { font-size: 13px; color: var(--rw-dim); }
.rw-lp-card .rw-menu-btn { flex: 0 0 auto; min-width: 84px; }
.rw-lp-opts { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 6px; }
.rw-lp-opts button {
  min-width: 48px; min-height: 48px; border-radius: 12px; border: 0; background: var(--rw-fill-2); box-shadow: inset 0 0 0 1px var(--rw-line);
  font-weight: 600; font-size: 13px; padding: 0 12px;
}
.rw-lp-opts button[aria-checked="true"] { box-shadow: inset 0 0 0 2px var(--rw-accent), 0 0 0 2px rgba(226,115,58,0.35); background: var(--rw-accent-soft); }
.rw-lp-opts button.rw-lp-sw[aria-checked="true"] { box-shadow: inset 0 0 0 3px #fff, 0 0 0 3px var(--rw-accent); }
.rw-lp-opts button:disabled { opacity: 0.45; }
.rw-lp-sw { width: 48px; padding: 0 !important; }
/* Customize: the menu steps aside so the car shows while its look changes. */
.rw-menu.rw-menu-see { background: transparent; }
.rw-menu.rw-menu-see .rw-menu-side { display: none; }
.rw-menu.rw-menu-see .rw-menu-main { margin-left: auto; flex: 0 0 min(46%, 380px); }
.rw-menu.rw-menu-see .rw-menu-points { display: none; }
.rw-menu.rw-menu-see .rw-menu-head .rw-menu-btn { min-width: 84px; height: 48px; }
.rw-menu.rw-menu-see .rw-menu-title { font-size: 18px; }
.rw-menu-steer { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 8px 0 10px; }
.rw-menu-btn.rw-menu-choice {
  min-height: 70px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start;
  gap: 3px; padding: 8px 14px; text-align: left; line-height: 1.2; border-radius: 14px;
}
.rw-menu-choice b { font-size: 17px; }
.rw-menu-choice span { font-size: 13px; font-weight: 500; color: var(--rw-dim); }
.rw-menu-choice[aria-checked="true"] { background: var(--rw-accent-soft); box-shadow: inset 0 0 0 2px var(--rw-accent); }
.rw-menu-choice[aria-checked="true"] b { color: #ffc49e; }
.rw-menu-maps { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding-top: 4px; }
.rw-menu-card { padding: 10px 12px; border-radius: 14px; background: var(--rw-fill); display: flex; flex-direction: column; gap: 8px; min-height: 96px; }
.rw-menu-card[data-current="true"] { box-shadow: inset 0 0 0 2px var(--rw-accent); }
.rw-menu-card b { font-size: 18px; }
.rw-menu-ask {
  position: fixed; inset: 0; z-index: 41; display: flex; align-items: center; justify-content: center;
  padding: calc(8px + var(--rw-st)) calc(10px + var(--rw-sr)) calc(8px + var(--rw-sb)) calc(10px + var(--rw-sl));
}
.rw-menu-askbox {
  width: min(680px, 100%); max-height: 100%; overflow-y: auto; padding: 14px 16px 12px;
  border-radius: 18px; background: var(--rw-panel); box-shadow: inset 0 0 0 1px var(--rw-panel-edge), 0 16px 40px rgba(0,0,0,0.5);
}
.rw-menu-askbox h2 { margin: 0 0 2px; font-size: 21px; font-weight: 700; }
.rw-menu-askbox p { margin: 0; }
@media (max-height: 380px) {
  .rw-menu-btn.rw-menu-choice { min-height: 60px; padding: 6px 12px; }
  .rw-menu-askbox { padding: 10px 14px 8px; }
  .rw-menu-askbox h2 { font-size: 19px; }
  .rw-menu-steer { padding: 6px 0 8px; }
}
.rw-about-h { margin: 14px 0 4px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--rw-accent-hi); font-weight: 700; }
.rw-menu-body .rw-about-p { margin: 0 0 6px; font-size: 14px; line-height: 1.45; }
.rw-about-dim { color: var(--rw-dim); }
.rw-about-link { display: inline-flex; align-items: center; min-height: 48px; padding: 0 4px; color: #ffc49e; font-weight: 700; }
.rw-menu-sounds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: column; grid-template-rows: repeat(4, auto); gap: 4px 12px; margin: 4px 0 6px; padding: 0; list-style: none; }
.rw-menu-sounds li { margin: 0; display: flex; align-items: center; gap: 10px; min-height: 44px; }
.rw-menu-sounds .rw-menu-num { flex: 0 0 32px; height: 32px; border-radius: 50%; background: var(--rw-accent-soft); box-shadow: inset 0 0 0 1px var(--rw-accent-line); color: #ffc49e; font-weight: 800; font-size: 14px; display: flex; align-items: center; justify-content: center; }
.rw-menu-sounds b { display: block; font-size: 15px; }
.rw-menu-sounds span.rw-menu-note { display: block; font-size: 12px; color: var(--rw-dim); }
.rw-menu-body > .rw-menu-btn.rw-menu-primary { padding: 0 20px; }
@media (prefers-reduced-motion: no-preference) {
  html:not([data-rw-calm="on"]) .rw-menu.rw-menu-open { animation: rw-menu-in 0.16s ease-out; }
}
@keyframes rw-menu-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .rw-menu *, .rw-menu *::before, .rw-menu *::after { transition: none !important; } }
html[data-rw-calm="on"] .rw-menu *, html[data-rw-calm="on"] .rw-menu *::before, html[data-rw-calm="on"] .rw-menu *::after { transition: none !important; }
/* high contrast: solid panels, visible edges on every control */
html[data-rw-contrast="high"] .rw-menu { --rw-panel: rgba(6,8,12,0.98); --rw-panel-edge: rgba(255,255,255,0.55); --rw-dim: rgba(236,240,246,0.92); --rw-line: rgba(255,255,255,0.32); --rw-fill: rgba(255,255,255,0.09); }
html[data-rw-contrast="high"] .rw-menu-btn, html[data-rw-contrast="high"] .rw-menu-tab, html[data-rw-contrast="high"] .rw-menu-seg button { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.5); }
html[data-rw-contrast="high"] .rw-menu-switch[role="switch"]::before { box-shadow: inset 0 0 0 2px #fff; }
@media (min-height: 381px) {
  .rw-menu { padding-top: calc(8px + var(--rw-st)); padding-bottom: calc(8px + var(--rw-sb)); }
  .rw-menu-head { flex-basis: 56px; height: 56px; }
  .rw-menu-groups button { height: 56px; }
  .rw-menu-head > .rw-menu-btn::before { inset: 8px 0; }
  .rw-menu-setting { height: 52px; }
  .rw-menu-title { font-size: 22px; }
}
@media (max-height: 380px) {
  .rw-menu { font-size: 14px; }
  .rw-menu-tab, .rw-menu-btn, .rw-menu-seg button { font-size: 14px; }
  .rw-menu-groups button { font-size: 15px; }
  .rw-menu-seg button { min-width: 64px; padding: 0 10px; }
  .rw-menu-stat { padding: 5px 10px; min-height: 48px; }
  .rw-menu-stat b { font-size: 17px; }
  .rw-menu-stats { margin: 8px 0; }
}
`;

const TABS = [['resume', 'Resume'], ['stats', 'Stats'], ['settings', 'Settings'], ['help', 'Help']];
const GROUPS = [['controls', 'Controls'], ['sound', 'Sound'], ['game', 'Game'], ['display', 'Display']];
const STEER_CHOICES = [
  ['wheel', 'Wheel', 'Turn the on-screen wheel with your thumb.'],
  ['buttons', 'Buttons', 'Hold the left or right arrow; the turn builds up.'],
  ['tilt', 'Tilt', 'Tilt your phone like a steering wheel.'],
  ['slider', 'Slider', 'Slide your thumb left and right on a pad.'],
];
// Small line icons (24 by 24, 2 px stroke), static markup only.
const ICON = {
  resume: '<path d="M8 5.5v13l10.5-6.5z"/>',
  stats: '<path d="M5 20v-8M12 20V4M19 20v-5"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.6"/><path d="M12 17.3v.2"/>',
  access: '<circle cx="12" cy="4.6" r="1.8"/><path d="M5 8.6l7 1.4 7-1.4M12 10v4.6M9 21l3-6.4 3 6.4"/>',
  adventures: '<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>',
  garages: '<path d="M3 10l9-6 9 6v10H3z"/><path d="M7 20v-6h10v6M7 17h10"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  travel: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  records: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
  daily: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  customize: '<path d="M14 4l6 6-8 8H6v-6z"/><path d="M11 7l6 6"/>',
  intro: '<path d="M6 5l8 7-8 7z"/><path d="M18 5v14"/>',
};
const icon = (name) => (ICON[name] ? '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>' : '');
const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
// The Settings graphics row's note: what is drawn now, e.g. "Now Normal at 2.25x"
// (pixels per CSS pixel), "of 2.25x" when the adaptive resolution is under its cap.
export function tierText(t) {
  const f = (x) => String(Math.round(x * 100) / 100);
  const under = t.max > 0 && t.ratio < t.max - 0.01 ? ` of ${f(t.max)}x` : '';
  return `Now ${t.name} at ${f(t.ratio)}x${under}${t.shed > 0 ? ', detail shed' : ''}`;
}

function button(text, cls, onClick, label) {
  const b = h('button', 'rw-menu-btn' + (cls ? ' ' + cls : ''), text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}
const num = (n) => Math.round(n).toLocaleString('en-US');
const isFlag = (k) => k.startsWith('seen_') || k.startsWith('hint_');

export function createMenu(root, game, economy) {
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const el = h('div', 'rw-menu');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Game menu');
  const side = h('div', 'rw-menu-side');
  const back = h('button', 'rw-menu-back');
  back.type = 'button';
  back.dataset.role = 'back';
  back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  back.addEventListener('click', () => goBack());
  const rail = h('div', 'rw-menu-rail');
  rail.setAttribute('role', 'tablist');
  rail.setAttribute('aria-label', 'Menu sections');
  side.append(back, rail);
  const main = h('div', 'rw-menu-main');
  const head = h('div', 'rw-menu-head');
  const title = h('h2', 'rw-menu-title');
  const groupBar = h('div', 'rw-menu-groups');
  groupBar.setAttribute('role', 'tablist');
  groupBar.setAttribute('aria-label', 'Settings groups');
  const pointsEl = h('span', 'rw-menu-points');
  pointsEl.setAttribute('aria-label', 'Score');
  // Accessibility opens its own screen from a head button (every Settings group is full at 6 rows).
  const accessBtn = h('button', 'rw-menu-btn rw-menu-access');
  accessBtn.innerHTML = icon('access');
  accessBtn.appendChild(h('span', '', 'Access'));
  accessBtn.type = 'button';
  accessBtn.setAttribute('aria-label', 'Accessibility settings');
  accessBtn.dataset.role = 'access';
  accessBtn.addEventListener('click', () => go('access'));
  head.append(title, groupBar, accessBtn, pointsEl);
  const body = h('div', 'rw-menu-body');
  body.tabIndex = -1;
  main.append(head, body);
  el.append(side, main);
  root.appendChild(el);
  // __VERSION__ comes from package.json at build time (scripts/build.mjs).
  /* global __VERSION__ */
  const version = typeof __VERSION__ !== 'undefined' ? 'v' + __VERSION__ : '';

  const doneBtn = button('Done', 'rw-menu-primary', () => goBack(), 'Done');
  doneBtn.dataset.role = 'customize-done';
  const tabButtons = {};
  for (const [id, label] of TABS) {
    const b = h('button', 'rw-menu-tab');
    b.innerHTML = icon(id);
    b.appendChild(h('span', '', label));
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { parents.delete(id); show(id); });
    rail.appendChild(b);
    tabButtons[id] = b;
  }
  const groupButtons = {};
  for (const [id, label] of GROUPS) {
    const b = h('button', 'rw-menu-btn', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.group = id;
    b.addEventListener('click', () => { group = id; armed = null; render(); });
    groupBar.appendChild(b);
    groupButtons[id] = b;
  }

  let active = 'resume';
  let group = 'controls';
  let opened = false;
  let armed = null; // key of the confirm row waiting for its second tap
  let phone = null; // the Phone check (created on first use)
  let labDrive = null; // the Handling lab test drive (created on first use)
  // The Handling lab preset every car uses (entities/vehicle.js), at load.
  if (game.progress && game.progress.settings) setHandlingPreset(game.progress.settings.handlingPreset);
  const parents = new Map(); // screen id -> the screen Back returns to
  const screens = new Map(); // registered screens: id -> { id, title, render }

  const settings = () => game.progress.settings;
  function applySettings() {
    // Time of day: a fixed time locks the clock; live resumes the cycle.
    const st = settings();
    if (game.daynight && game.daynight.setHour) {
      if (st.liveTime === false && Number.isFinite(st.timeOfDay)) {
        game.timeLocked = true;
        game.daynight.setHour(st.timeOfDay);
      } else {
        game.timeLocked = false;
      }
    }
    setHandlingPreset(st.handlingPreset); // the Handling lab preset (entities/vehicle.js)
    if (economy && economy.applySettings) { economy.applySettings(); return; }
    const s = settings();
    if (game.audio && game.audio.setVolume) game.audio.setVolume(volumeFromSettings(s));
    if (game.input) game.input.invertPitch = s.invertPitch;
    setHandlingMode(s.handling);
    if (game.touch && game.touch.setLeftHanded) game.touch.setLeftHanded(s.leftHanded);
    if (game.touch && game.touch.setSteering) game.touch.setSteering(s.steering, s.steerSensitivity);
    if (game.touch && game.touch.setHudMode) game.touch.setHudMode(s.hud);
    if (game.hud && game.hud.setHudMode) game.hud.setHudMode(s.hud);
    if (game.hud && game.hud.setStreetLabel) game.hud.setStreetLabel(s.streetLabel !== false);
    if (game.quality !== s.quality) {
      game.quality = s.quality;
      if (game.resize) game.resize();
    }
  }
  const commit = () => { applySettings(); game.events.emit('progress'); };
  // The Phone check starts from Settings, Display and from the Sound test screen.
  function startPhoneCheck() {
    if (!phone) phone = createPhoneCheck(game, root);
    close();
    if (!phone.start() && game.hud && game.hud.toast) game.hud.toast(phone.error() || 'The phone check cannot start here', 3, 'info');
  }

  // The Handling lab test drive: the menu closes, the player is in the sedan on a clear straight street.
  function startLabDrive() {
    if (!labDrive) {
      labDrive = createLabDrive(game, root, {
        onVerdict: (id) => { settings().handlingVerdict = validVerdict(id); commit(); },
      });
    }
    close();
    if (!labDrive.start() && game.hud && game.hud.toast) game.hud.toast(labDrive.error || 'The test drive cannot start here', 3, 'info');
  }

  // ---------- the api given to registered screens ----------
  // A row with the confirm rule (docs/REVAMP.md 6.4): the first tap swaps the
  // button for "Cancel" (in the same place, so a double tap cancels) and a red
  // "Yes, ..." beside it. The armed state ends on Cancel, on leaving the
  // screen and on closing the menu. No timer.
  function confirmRow(label, yesText, onYes, opts = {}) {
    const key = opts.id || label;
    const isArmed = armed === key;
    const row = h('div', 'rw-menu-confirmrow');
    row.dataset.confirm = key;
    row.appendChild(h('span', isArmed || !opts.dim ? '' : 'rw-menu-dim', opts.text || label));
    const c = h('div', 'rw-menu-confirm');
    if (!isArmed) {
      const b = button(opts.button || label, opts.danger ? 'rw-menu-danger' : '', () => { armed = key; render(); }, opts.button || label);
      b.dataset.role = opts.role || key;
      c.appendChild(b);
    } else {
      row.setAttribute('role', 'alert');
      const yes = button(yesText, 'rw-menu-danger', () => { armed = null; onYes(); }, yesText);
      yes.dataset.role = (opts.role || key) + '-confirm';
      const cancel = button('Cancel', '', () => { armed = null; render(); }, 'Cancel');
      cancel.dataset.role = (opts.role || key) + '-cancel';
      c.append(yes, cancel);
    }
    row.appendChild(c);
    return row;
  }
  const api = {
    back: () => goBack(),
    close: () => close(),
    go: (id) => go(id),
    confirmRow,
    rerender: () => render(),
    h, button,
    game,
  };

  // ---------- Resume (the hub) ----------
  function renderResume() {
    const box = h('div', 'rw-menu-hub');
    const r = button('', 'rw-menu-primary', close, 'Resume game');
    r.innerHTML = icon('resume');
    r.appendChild(h('span', '', 'Resume'));
    r.dataset.role = 'resume';
    box.appendChild(r);
    const tiles = h('div', 'rw-menu-tiles');
    const ex = game.explore && game.explore.counts ? game.explore.counts() : null;
    const miami = !!(game.city && game.city.map);
    const tile = (role, name, sub, fn) => {
      const b = button('', 'rw-menu-tile', fn, name + (sub ? ', ' + sub : ''));
      b.dataset.role = role;
      b.innerHTML = icon(role);
      b.append(h('b', '', name), h('span', '', sub));
      tiles.appendChild(b);
    };
    // The first two tiles belong to Miami (the classic island has no garages or adventures).
    if (miami && ex && screens.has('adventures')) tile('adventures', 'Adventures', ex.adventuresDone + ' / ' + ex.adventuresTotal, () => go('adventures'));
    if (miami && ex && screens.has('garages')) tile('garages', 'Garages', ex.garagesFound + ' / ' + ex.garagesTotal, () => go('garages'));
    tile('map', 'Map', 'Open the full map', () => {
      close();
      // The map system opens on the map button (systems/mapui.js).
      if (game.input && game.input.press) { game.input.press('map'); game.input.release('map'); }
    });
    if (game.city && game.city.region && game.session && game.session.travelTo) tile('travel', 'Travel', 'To another part', () => go('travel'));
    // The loop (docs/LOOP.md): events and records, the Daily Three, the looks, the intro.
    const se = game.streetEvents;
    if (se && se.list.length) {
      const mc = medalCounts(loopOf(game.progress), se.slug);
      tile('records', 'Records', mc.any + ' / ' + se.list.length + ' medals', () => go('records'));
    }
    if (game.daily && game.daily.picks.length) tile('daily', 'Daily Three', game.daily.doneCount + ' / 3 today', () => go('daily'));
    if (game.custom) tile('customize', 'Customize', 'Paint and wheels, free', () => go('customize'));
    const tut = game.tutorial;
    if (tut && se && se.list.length) {
      if (tut.introOn) tile('intro', 'Skip intro', 'No more guide lines', () => { tut.skip(); render(); });
      else tile('intro', 'Replay intro', 'The first five minutes', () => { tut.replay(); close(); });
    }
    box.appendChild(tiles);
    body.appendChild(box);
  }

  // ---------- Stats: the old Scores and Records on one page ----------
  function renderStats() {
    const p = game.progress;
    const sc = p.score;
    const live = game.score;
    const stats = h('div', 'rw-menu-stats');
    const add = (v, label) => {
      const s = h('div', 'rw-menu-stat');
      s.append(h('b', '', v), h('span', 'rw-menu-dim', label));
      stats.appendChild(s);
    };
    add(num(live ? live.total : sc.total), 'Total score');
    add(num(sc.sessionBest), 'Best session');
    add(sc.best.combo > 0 ? 'x' + sc.best.combo : '-', 'Best combo');
    add(sc.best.jump > 0 ? formatDistance(sc.best.jump) : '-', 'Longest jump');
    add(sc.best.airtime > 0 ? sc.best.airtime.toFixed(1) + ' s' : '-', 'Air time');
    add(sc.best.drift > 0 ? num(sc.best.drift) : '-', 'Best drift');
    add(sc.best.nearMiss > 0 ? String(Math.round(sc.best.nearMiss)) : '-', 'Near misses');
    add(formatMiles(p.stats.distance), 'Distance');
    add(String(Math.floor(p.stats.flights)), 'Flights');
    add(String(Math.floor(p.stats.races)), 'Races');
    const medalIds = Object.keys(p.medals).filter((k) => !isFlag(k));
    add(String(medalIds.length), 'Medals');
    const ex = game.explore && game.explore.counts ? game.explore.counts() : null;
    const seen = Object.keys(p.medals).filter((k) => k.startsWith('seen_')).length;
    add(ex && Number.isFinite(ex.percent) ? Math.round(ex.percent) + ' %' : String(seen), ex && Number.isFinite(ex.percent) ? 'Explored' : 'Areas seen');
    body.appendChild(stats);

    // Hidden spots: a found one shows its name.
    const foundIds = p.secrets && Array.isArray(p.secrets.found) ? p.secrets.found : [];
    const names = SECRET_DEFS.filter((d) => foundIds.includes(d.id)).map((d) => d.name);
    const line = h('p', '', 'Secrets ' + foundIds.length + ' / ' + SECRET_DEFS.length + (names.length ? ': ' + names.join(', ') : ''));
    line.dataset.role = 'secrets';
    body.appendChild(line);
    if (foundIds.length >= SECRET_DEFS.length) body.appendChild(h('p', 'rw-menu-dim', GARAGE_NAME + ' unlocked: look for the lock-up garage on the map.'));
  }

  // ---------- Settings: four groups ----------
  function toggleRow(label, key, dflt = false) {
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', label));
    const on = typeof settings()[key] === 'boolean' ? settings()[key] : dflt;
    const b = button(on ? 'On' : 'Off', 'rw-menu-switch', () => {
      settings()[key] = !on;
      commit();
      render();
    }, label);
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(on));
    b.dataset.setting = key;
    row.appendChild(b);
    return row;
  }
  // A row of radio buttons: choices are [value, label]; onPick(value).
  function segRow(label, choices, current, attr, onPick) {
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', label));
    const seg = h('div', 'rw-menu-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', label);
    for (const [val, text] of choices) {
      const b = h('button', '', text);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(current === val));
      b.dataset[attr] = String(val);
      b.addEventListener('click', () => onPick(val));
      seg.appendChild(b);
    }
    row.appendChild(seg);
    return row;
  }
  function sliderRow(label, key, o) {
    const s = settings();
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', label));
    const val = h('span', 'rw-menu-value', '');
    const sl = document.createElement('input');
    sl.type = 'range';
    sl.min = String(o.min); sl.max = String(o.max); sl.step = String(o.step);
    const cur = Number.isFinite(s[key]) ? s[key] : o.dflt;
    sl.value = String(o.toUi(cur));
    val.textContent = o.text(Number(sl.value));
    // The filled part of the track (drawn by CSS from --p).
    const fill = () => sl.style.setProperty('--p', ((Number(sl.value) - o.min) / (o.max - o.min)) * 100 + '%');
    fill();
    sl.setAttribute('aria-label', o.aria || label);
    sl.dataset.setting = key;
    if (o.disabled) sl.disabled = true;
    sl.addEventListener('input', () => {
      settings()[key] = o.fromUi(Number(sl.value));
      if (o.after) o.after();
      val.textContent = o.text(Number(sl.value));
      fill();
      applySettings();
    });
    sl.addEventListener('change', () => commit());
    row.append(sl, val);
    return row;
  }
  const vol = (label, key, dflt) => sliderRow(label, key, {
    min: 0, max: 100, step: 1, dflt, toUi: (v) => Math.round(v * 100), fromUi: (v) => v / 100,
    text: (v) => v + '%', aria: label + ' volume',
  });
  const hourText = (x) => formatClock12(Math.floor(x) * 60 + Math.round((x - Math.floor(x)) * 60));
  // A row that opens another screen (shows an arrow).
  function goRow(label, valueText, role, id) {
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', label));
    const b = button(valueText, 'rw-menu-go', () => go(id), label + ': ' + valueText);
    b.dataset.role = role;
    row.appendChild(b);
    return row;
  }
  // The map being played (the city knows it; the island has no id).
  const currentMap = () => {
    const c = game.city;
    if (c) return c.mapId || (c.map ? 'miami' : 'island');
    try {
      return pickerCurrent(localStorage.getItem(MAP_CHOICE_KEY));
    } catch {
      return pickerCurrent(null);
    }
  };

  function renderSettings() {
    const s = settings();
    if (group === 'controls') {
      body.appendChild(segRow('Steering', STEER_CHOICES.map(([id, label]) => [id, label]), s.steering, 'steering', (id) => {
        // setSteering runs inside this tap, which tilt needs for its permission question.
        settings().steering = id; commit(); render();
      }));
      body.appendChild(sliderRow('Steering sensitivity', 'steerSensitivity', {
        min: 50, max: 150, step: 5, dflt: 1, toUi: (v) => Math.round(v * 100),
        fromUi: (v) => Math.max(0.5, Math.min(1.5, v / 100)), text: (v) => v + '%',
      }));
      body.appendChild(segRow('Handling', [['arcade', 'Arcade'], ['sim', 'Sim']], s.handling, 'handling', (id) => { settings().handling = id; commit(); render(); }));
      body.appendChild(goRow('Handling lab', PRESET_LABELS[validPreset(s.handlingPreset)], 'handlinglab', 'handlinglab'));
      body.appendChild(toggleRow('Left-handed', 'leftHanded'));
      body.appendChild(toggleRow('Invert flying stick', 'invertPitch'));
    } else if (group === 'sound') {
      if (typeof s.muteAll !== 'boolean') s.muteAll = false;
      // The old music on/off switch is gone: the Music slider at 0 is off.
      if (s.music === false) { s.music = true; s.musicVol = 0; }
      body.appendChild(vol('Master', 'master', 0.8));
      body.appendChild(toggleRow('Mute all', 'muteAll'));
      body.appendChild(vol('Music', 'musicVol', 0.5));
      body.appendChild(vol('Sound effects', 'sfxVol', 1));
      body.appendChild(vol('Ambience', 'ambVol', 1));
      // Car radio: Off and the four stations; a tap steps to the next.
      const row = h('div', 'rw-menu-setting');
      row.appendChild(h('span', '', 'Car radio'));
      const station = game.radio ? game.radio.station : s.station;
      const cur = stationInfo(station);
      const rb = button(cur.name, 'rw-menu-switch', () => {
        if (game.radio) game.radio.setStation(nextStation(game.radio.station, 1), false);
        else s.station = nextStation(s.station, 1);
        commit();
        render();
      }, 'Car radio station: ' + cur.name + '. Tap for the next one.');
      rb.dataset.setting = 'station';
      row.appendChild(rb);
      body.appendChild(row);
    } else if (group === 'game') {
      body.appendChild(toggleRow('Police chases', 'police', true));
      body.appendChild(toggleRow('Hard: you can die', 'mortal'));
      // Blood (red spatters and pools): on unless switched off. Read by render/combatfx.js.
      if (typeof s.blood !== 'boolean') delete s.blood;
      body.appendChild(toggleRow('Blood', 'blood', true));
      // Street names: the small label under the minimap (src/ui/hud.js), on unless switched off.
      if (typeof s.streetLabel !== 'boolean') delete s.streetLabel;
      body.appendChild(toggleRow('Street names', 'streetLabel', true));
      body.appendChild(goRow('Map', mapName(currentMap()) || 'Miami', 'map', 'mapchoice'));
      body.appendChild(goRow('New game', 'Open', 'newgame', 'newgame'));
    } else {
      body.appendChild(segRow('HUD', [['minimal', 'Minimal'], ['full', 'Full']], s.hud, 'hud', (v) => { settings().hud = v; commit(); render(); }));
      const qRow = segRow('Graphics quality', [[0.75, 'Low'], [1, 'Normal'], [1.25, 'High']], s.quality, 'quality', (v) => { settings().quality = v; settings().qualityChosen = true; commit(); render(); });
      // The tier drawn now (render/graphics.js): the adaptive resolution and
      // shed detail move it under the chosen setting.
      const tn = game.graphics && game.graphics.tierNow ? game.graphics.tierNow() : null;
      if (tn) qRow.firstChild.appendChild(h('span', 'rw-menu-tier', tierText(tn)));
      body.appendChild(qRow);
      if (typeof s.liveTime !== 'boolean') s.liveTime = true;
      body.appendChild(toggleRow('Live day and night', 'liveTime', true));
      body.appendChild(sliderRow('Time of day', 'timeOfDay', {
        min: 0, max: 23.5, step: 0.5, dflt: game.clock || 9, toUi: (v) => v, fromUi: (v) => v,
        text: hourText, disabled: s.liveTime, aria: 'Time of day',
      }));
      // Phone check (docs/PLAN_V1.md 4.2): the game drives itself for a minute, then plays eight test sounds.
      const row = h('div', 'rw-menu-setting');
      row.appendChild(h('span', '', 'Phone check'));
      const pb = button('Start', 'rw-menu-go', startPhoneCheck, 'Phone check: a one minute drive and eight test sounds. Start');
      pb.dataset.role = 'phonecheck';
      row.appendChild(pb);
      body.appendChild(row);
      body.appendChild(goRow('Sound test', 'Open', 'soundtest', 'soundtest'));
    }
  }

  // ---------- Accessibility: text size, reduce motion, high contrast, color-safe markers ----------
  function renderAccess() {
    const s = settings();
    const set = (k, v) => { settings()[k] = v; applySettings(); commit(); render(); };
    body.appendChild(segRow('HUD text size', [['normal', 'Normal'], ['large', 'Large']], TEXT_SIZES.includes(s.textSize) ? s.textSize : 'normal', 'textsize', (v) => set('textSize', v)));
    for (const [label, key] of [['Reduce motion', 'reduceMotion'], ['High contrast HUD', 'highContrast'], ['Color-safe markers', 'colorSafe']]) {
      const on = s[key] === true;
      const row = h('div', 'rw-menu-setting');
      row.appendChild(h('span', '', label));
      const b = button(on ? 'On' : 'Off', 'rw-menu-switch', () => set(key, !on), label);
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(on));
      b.dataset.setting = key;
      row.appendChild(b);
      body.appendChild(row);
    }
    body.appendChild(h('p', 'rw-menu-dim', 'Reduce motion: no camera shake or kick, no hit freeze. Color-safe markers add an arrow and a new palette to gates.'));
  }

  // ---------- Sound test: the eight numbered sounds of the Phone check ----------
  function renderSoundTest() {
    body.appendChild(h('p', 'rw-menu-dim', 'The Phone check drives a test car for ' + DRIVE_SECONDS + ' seconds, then plays these ' + SOUNDS.length + ' sounds in order, ' + SOUND_SECONDS + ' seconds each. Tap the number of any that sounds bad.'));
    const list = h('ol', 'rw-menu-sounds');
    list.dataset.role = 'sound-list';
    SOUNDS.forEach((name, i) => {
      const li = h('li');
      li.dataset.sound = String(i + 1);
      const text = h('div');
      text.append(h('b', '', name), h('span', 'rw-menu-note', SOUND_NOTES[i] || ''));
      li.append(h('span', 'rw-menu-num', String(i + 1)), text);
      list.appendChild(li);
    });
    body.appendChild(list);
    const go1 = button('Start the Phone check', 'rw-menu-primary', startPhoneCheck, 'Start the Phone check');
    go1.dataset.role = 'phonecheck-start';
    body.appendChild(go1);
  }

  // ---------- Handling lab: three presets, sensitivity, a test drive, a one-tap verdict ----------
  function renderHandlingLab() {
    const s = settings();
    body.appendChild(segRow('Preset', PRESETS.map((id) => [id, PRESET_LABELS[id]]), validPreset(s.handlingPreset), 'preset', (id) => {
      settings().handlingPreset = id; setHandlingPreset(id); commit(); render();
    }));
    body.appendChild(sliderRow('Steering sensitivity', 'steerSensitivity', {
      min: 50, max: 150, step: 5, dflt: 1, toUi: (v) => Math.round(v * 100),
      fromUi: (v) => Math.max(0.5, Math.min(1.5, v / 100)), text: (v) => v + '%',
    }));
    const row = h('div', 'rw-menu-setting');
    row.appendChild(h('span', '', 'Test drive'));
    const tb = button('Start', 'rw-menu-go', startLabDrive, 'Test drive: the sedan on a clear straight street, no traffic. Start');
    tb.dataset.role = 'labdrive';
    row.appendChild(tb);
    body.appendChild(row);
    const cur = validVerdict(s.handlingVerdict);
    body.appendChild(segRow('How it feels', VERDICTS.map((id) => [id, VERDICT_LABELS[id]]), cur, 'verdict', (id) => {
      settings().handlingVerdict = id; commit(); render();
    }));
  }

  // ---------- About: version, credits, map license, names, privacy ----------
  function renderAbout() {
    const box = h('div');
    fillAbout(document, box, { version: version || 'dev' });
    body.appendChild(box);
  }

  // ---------- New game and Map choice (their own screens) ----------
  function renderNewGame() {
    body.appendChild(confirmRow('New game', 'Yes, new game', () => {
      const ses = game.session;
      if (ses && ses.newGame) ses.newGame();
      else if (game.newSession) game.newSession();
      close();
    }, { id: 'newgame', role: 'newgame', text: 'New game: back to the start street in your favorite car (the sedan if none is set). Parked cars are cleared. Score, medals and found garages are kept.' }));
    body.appendChild(confirmRow('Erase all progress', 'Yes, erase everything', () => {
      economy.reset();
      render();
    }, { id: 'reset', role: 'reset', danger: true, text: 'Erase all progress: score, medals, secrets, garages, adventures and settings.' }));
  }
  // One tap on a map: the place on this map is saved, then the page reloads
  // behind the loading veil (the region's data loads with the page).
  function renderMapChoice() {
    body.appendChild(h('p', 'rw-menu-dim', 'Pick a map. Your place on each map is kept.'));
    fillMapPicker(document, body, {
      current: currentMap(),
      onPick: (id) => {
        switchMap(document, id, { before: () => { if (game.saveSession) game.saveSession(); commit(); } });
      },
    });
  }
  // Travel: every region, tap to go (refused while wanted).
  function renderTravel() {
    const note = h('p', 'rw-menu-dim', 'Travel keeps your car. On foot, in a boat or a plane you arrive at the start place.');
    body.appendChild(note);
    const msg = h('p', 'rw-menu-dim', '');
    msg.dataset.role = 'travel-msg';
    body.appendChild(msg);
    fillMapPicker(document, body, {
      current: currentMap(), regionsOnly: true, hint: 'Tap to travel',
      onPick: (id) => {
        const why = game.session && game.session.travelTo ? game.session.travelTo(id) : '';
        if (why) msg.textContent = why;
      },
    });
  }

  // ---------- Records (docs/LOOP.md section c) ----------
  const medalDot = (m) => {
    const d = h('i', 'rw-lp-medal' + (m ? ' rw-lp-' + m : ''));
    d.setAttribute('aria-hidden', 'true');
    return d;
  };
  function routeTo(ev) {
    if (game.streetEvents) game.streetEvents.track(ev);
    close();
  }
  function renderRecords() {
    const L = loopOf(game.progress);
    const se = game.streetEvents;
    const here = se ? se.slug : '';
    const stats = h('div', 'rw-menu-stats');
    stats.dataset.role = 'records-stats';
    const add = (v, label) => {
      const s = h('div', 'rw-menu-stat');
      s.append(h('b', '', v), h('span', 'rw-menu-dim', label));
      stats.appendChild(s);
    };
    const mc = medalCounts(L), mh = medalCounts(L, here);
    add(num(L.flow[here] || 0), 'Best flow run here');
    add(num(bestFlow(L)), 'Best flow run');
    add(mh.gold + ' / ' + mh.silver + ' / ' + mh.bronze, 'Gold, silver, bronze here');
    add(mc.any + '', 'Event medals');
    add(num(L.totals.banked), 'Flow banked');
    add(L.best.tier > 1 ? 'x' + Math.round(L.best.tier) : '-', 'Top multiplier');
    add(L.best.mph > 0 ? Math.round(L.best.mph) + ' mph' : '-', 'Top speed');
    add(L.best.jumpFt > 0 ? Math.round(L.best.jumpFt) + ' ft' : '-', 'Longest event jump');
    add(num(L.totals.nearMiss + L.totals.passes), 'Close passes');
    add(num(L.totals.smashes), 'Things smashed');
    add(L.driven.length + ' / ' + Object.keys(VEHICLE_SPECS).length, 'Vehicles driven');
    add(formatMiles(L.dist[here] || 0), 'Distance here');
    body.appendChild(stats);

    // Three closest medals, each with a button that sets the GPS on its gate.
    if (se && se.list.length) {
      body.appendChild(h('div', 'rw-menu-group', 'Closest medals'));
      for (const ev of closestMedals(L, se.list, 3)) {
        const r = L.events[ev.id] || null;
        const want = nextMedal(r ? r.m : '');
        const row = h('div', 'rw-lp-row');
        row.dataset.event = ev.id;
        const name = h('span', '', '');
        name.append(medalDot(r ? r.m : ''), document.createTextNode(cap(ev.name)));
        const tgt = h('i', '', (r && Number.isFinite(r.b) ? valueText(ev.tpl, r.b) + ' \u2192 ' : '') + want + ' ' + valueText(ev.tpl, ev.targets[want]));
        const b = button('Route', '', () => routeTo(ev), 'Route to ' + ev.name);
        b.dataset.role = 'route';
        row.append(name, tgt, b);
        body.appendChild(row);
      }
    }
    // Every region (only this one's gates are loaded; the others show what is saved).
    body.appendChild(h('div', 'rw-menu-group', 'By region'));
    const table = h('table', 'rw-lp-table');
    table.dataset.role = 'records-regions';
    const head = h('tr');
    for (const t of ['Region', 'Gold', 'Silver', 'Bronze', 'Best flow', 'Miles']) head.appendChild(h('th', '', t));
    table.appendChild(head);
    for (const slug of REGION_SLUGS) {
      const c = medalCounts(L, slug);
      if (slug !== here && !c.tried && !(L.flow[slug] > 0) && !(L.dist[slug] > 0) && (slug === 'miami' || slug === 'island')) continue;
      const tr = h('tr');
      tr.dataset.here = String(slug === here);
      for (const t of [REGION_NAMES[slug], c.gold, c.silver, c.bronze, num(L.flow[slug] || 0), formatMiles(L.dist[slug] || 0).replace(' mi', '')]) tr.appendChild(h('td', '', String(t)));
      table.appendChild(tr);
    }
    const all = h('tr');
    for (const t of ['Overall', mc.gold, mc.silver, mc.bronze, num(bestFlow(L)), formatMiles(totalDistance(L)).replace(' mi', '')]) all.appendChild(h('td', '', String(t)));
    table.appendChild(all);
    body.appendChild(table);
    // Medals by event, template by template.
    if (se) {
      for (const row of boardRows(L, se.list)) {
        body.appendChild(h('div', 'rw-menu-group', row.title + '  ' + (row.gold + row.silver + row.bronze) + ' / ' + row.total));
        for (const it of row.items) {
          const line = h('div', 'rw-lp-row');
          line.dataset.event = it.ev.id;
          const name = h('span', '', '');
          name.append(medalDot(it.medal), document.createTextNode(cap(it.ev.tpl === 'dash' ? it.ev.name : it.ev.street)));
          const best = h('i', '', Number.isFinite(it.best) ? valueText(row.tpl, it.best) : 'gold ' + valueText(row.tpl, it.ev.targets.gold));
          const b = button('Route', '', () => routeTo(it.ev), 'Route to ' + it.ev.name);
          line.append(name, best, b);
          body.appendChild(line);
        }
      }
    }
  }

  // ---------- Daily Three (docs/LOOP.md section d) ----------
  function renderDaily() {
    const d = game.daily;
    if (!d || !d.picks.length) { body.appendChild(h('p', 'rw-menu-dim', 'No daily events on this map.')); return; }
    const st = d.state;
    const top = h('p', '', 'Three events a day, each with a twist. Days played: ' + st.streak + '.');
    top.dataset.role = 'daily-streak';
    body.appendChild(top);
    const msg = h('p', 'rw-menu-dim', 'A missed day costs nothing.');
    msg.dataset.role = 'daily-msg';
    const L = loopOf(game.progress);
    for (const p of d.picks) {
      const card = h('div', 'rw-lp-card');
      card.dataset.slot = String(p.slot);
      card.dataset.done = String(!!st.done[p.slot]);
      const text = h('div');
      const r = L.events[p.ev.id] || null;
      text.append(h('b', '', p.group + ': ' + TEMPLATE_INFO[p.ev.tpl].title + ' ' + p.twist.text),
        h('span', '', cap(p.ev.name) + '. Bronze ' + valueText(p.ev.tpl, p.ev.targets.bronze) + ', gold ' + valueText(p.ev.tpl, p.ev.targets.gold) + (r && r.m ? '. Yours: ' + r.m : '') + '.'));
      const b = button(st.done[p.slot] ? 'Again' : 'Go', st.done[p.slot] ? '' : 'rw-menu-primary', () => {
        const why = d.go(p.slot);
        if (why) msg.textContent = why; else close();
      }, 'Go: ' + p.ev.name + ' ' + p.twist.text);
      b.dataset.role = 'daily-go';
      card.append(text, b);
      body.appendChild(card);
    }
    body.appendChild(msg);
  }

  // ---------- Customize (docs/LOOP.md section f) ----------
  function renderCustomize() {
    const C = game.custom;
    const v = game.player && game.player.vehicle;
    if (!C || !v || v.kind !== 'car') {
      const p = h('p', 'rw-menu-dim', 'Get in a car to change its look. Every look is free and is kept for that kind of car.');
      p.dataset.role = 'customize-none';
      body.appendChild(p);
      return;
    }
    const id = v.spec.id;
    const look = C.lookFor(id);
    const group = (label, key, options, swatch) => {
      body.appendChild(h('div', 'rw-menu-group', label));
      const row = h('div', 'rw-lp-opts');
      row.setAttribute('role', 'radiogroup');
      row.setAttribute('aria-label', label);
      row.dataset.look = key;
      options.forEach((o, k) => {
        const i = key === 'paint' ? k - 1 : k;
        const name = key === 'paint' && k === 0 ? 'Stock' : o[0];
        const open = C.open(key, i);
        const b = h('button', swatch && k > 0 ? 'rw-lp-sw' : '', swatch && k > 0 ? '' : (open ? name : name + ' (' + lockText(key, i) + ')'));
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(look[key] === i));
        b.setAttribute('aria-label', name + (open ? '' : ', locked: ' + lockText(key, i)));
        b.dataset.opt = String(i);
        if (swatch && k > 0) b.style.background = '#' + o[1].toString(16).padStart(6, '0');
        if (!open) b.disabled = true;
        b.addEventListener('click', () => { C.set(id, key, i); render(); });
        row.appendChild(b);
      });
      body.appendChild(row);
    };
    group('Paint', 'paint', [['Stock', 0]].concat(PAINTS), true);
    group('Finish', 'finish', FINISHES, false);
    group('Wheels', 'wheels', WHEELS, false);
    group('Window tint', 'tint', TINTS, false);
    group('Decal', 'decal', DECALS, false);
    const reset = button('Back to stock', '', () => { C.reset(id); render(); }, 'Back to the stock look');
    reset.dataset.role = 'look-reset';
    body.appendChild(reset);
  }

  // ---------- Help ----------
  function renderHelp() {
    const inv = settings().invertPitch;
    const sections = [
      ['Driving', ['Turn the steering wheel on the left with your thumb (or pick buttons, tilt or a slider under Settings). Use the pedals for gas and brake.',
        'Ease off the gas to turn in sharper. Hold the brake when stopped to reverse.',
        'Hold the handbrake to slide round tight corners, then let go to straighten up.']],
      ['Boating', ['Throttle up to plane across the water. Steer gently; boats keep sliding after you turn.',
        'Pull up to a pier to get out.']],
      ['Flying a plane', ['Hold THRUST to speed up. Pick up speed on the runway before you climb.',
        inv ? 'Pull the stick down to climb and push it up to dive (the inverted stick setting is on).'
          : 'Push the stick up to climb and pull it down to dive (change this under Settings).',
        'Push the stick left or right to bank and turn. Ease off before landing and touch down gently.']],
      ['Helicopter', ['Raise the lift to take off and lower it to land. The stick moves you around and turns the nose.',
        'Heavy helicopters are slower to turn, so plan ahead.']],
      ['Getting in and out', ['Walk up to any craft and tap ENTER. Tap ENTER again to get out once you are slow enough.']],
      ['Map and races', ['Open the map to place a waypoint and see race starts.',
        'Finish races and challenges for medals and points. Everything is open from the start.']],
      ['Flow and events', ['Near misses, clean passes, drifts, air time, smashes, wrecks and escapes fill the Flow bar under the score; a full bar raises the multiplier, up to x5. Stop anywhere with no stars to bank the run. A hard crash costs two steps and a fifth of the run.',
        'Drive through a glowing gate to start its event: bronze, silver and gold. RETRY puts you back at the gate. Pause shows Records, the Daily Three and Customize.']],
      ['Scores', ['Race and stunt medals and street event medals pay points straight into the score. Everything is open from the start.',
        (game.city && game.city.texts && game.city.texts.fleet) || 'The jet, stunt plane, heavy helicopter and yacht wait at Gullwing Airfield and Saltyard Marina.']],
    ];
    const aboutRow = goRow('About Rustwater', 'Open', 'about', 'about');
    aboutRow.firstChild.style.minWidth = '0';
    body.appendChild(aboutRow);
    for (const [t, items] of sections) {
      body.appendChild(h('div', 'rw-menu-group', t));
      const ul = h('ul');
      for (const i of items) ul.appendChild(h('li', '', i));
      body.appendChild(ul);
    }
    body.appendChild(h('div', 'rw-menu-group', 'Credits'));
    const credit = h('p', 'rw-menu-dim', CREDIT);
    credit.dataset.role = 'map-credit';
    body.appendChild(credit);
    const ver = h('p', 'rw-menu-dim', 'Rustwater ' + version);
    ver.dataset.role = 'version';
    body.appendChild(ver);
  }

  // ---------- screens ----------
  const BUILTIN = {
    resume: { title: 'Resume', render: renderResume },
    stats: { title: 'Stats', render: renderStats },
    settings: { title: 'Settings', render: renderSettings },
    help: { title: 'Help', render: renderHelp },
    about: { title: 'About', render: renderAbout },
    soundtest: { title: 'Sound test', render: renderSoundTest },
    access: { title: 'Accessibility', render: renderAccess },
    handlinglab: { title: 'Handling lab', render: renderHandlingLab },
    newgame: { title: 'New game', render: renderNewGame },
    mapchoice: { title: 'Map', render: renderMapChoice },
    travel: { title: 'Travel', render: renderTravel },
    records: { title: 'Records', render: renderRecords },
    daily: { title: 'Daily Three', render: renderDaily },
    customize: { title: 'Customize', render: renderCustomize },
  };
  const screenOf = (id) => BUILTIN[id] || screens.get(id) || null;
  const isTop = (id) => TABS.some(([t]) => t === id);

  function render() {
    const top = body.scrollTop;
    body.textContent = '';
    const sc = screenOf(active) || BUILTIN.resume;
    const railId = isTop(active) ? active : (parents.get(active) && isTop(parents.get(active)) ? parents.get(active) : (active === 'newgame' || active === 'mapchoice' || active === 'soundtest' || active === 'handlinglab' || active === 'access' ? 'settings' : (active === 'about' ? 'help' : 'resume')));
    for (const [id] of TABS) {
      tabButtons[id].setAttribute('aria-selected', String(id === railId));
      tabButtons[id].tabIndex = id === railId ? 0 : -1;
    }
    const inSettings = active === 'settings';
    groupBar.style.display = inSettings ? '' : 'none';
    accessBtn.style.display = inSettings ? '' : 'none';
    title.style.display = inSettings ? 'none' : '';
    title.textContent = active === 'customize' && game.player && game.player.vehicle && game.player.vehicle.spec ? 'Customize: ' + game.player.vehicle.spec.label : sc.title;
    // Customize steps aside (the car shows while its look changes) and keeps a Done button in its head.
    const see = active === 'customize';
    el.classList.toggle('rw-menu-see', see);
    if (see !== !!doneBtn.parentNode) { if (see) head.appendChild(doneBtn); else doneBtn.remove(); }
    for (const [id] of GROUPS) {
      groupButtons[id].setAttribute('aria-selected', String(id === group));
      groupButtons[id].tabIndex = id === group ? 0 : -1;
    }
    const atTop = isTop(active) && !parents.has(active);
    back.setAttribute('aria-label', atTop ? 'Resume game' : 'Back');
    back.dataset.mode = atTop ? 'resume' : 'back';
    pointsEl.textContent = num(game.score ? game.score.total : game.progress.score.total) + ' pts';
    if (screenOf(active) === BUILTIN[active]) sc.render();
    else sc.render(body, api);
    // In a garage, in a car: the way to its look.
    if (active === 'garage' && game.custom && game.player && game.player.vehicle && game.player.vehicle.kind === 'car') {
      const row = goRow('Look of this car', 'Customize', 'garage-customize', 'customize');
      body.appendChild(row);
    }
    body.scrollTop = top;
  }

  function show(id) {
    if (!screenOf(id)) id = 'resume';
    if (id !== active) { body.scrollTop = 0; armed = null; }
    active = id;
    render();
  }
  // Open a screen from another screen: Back returns to where it came from.
  function go(id) {
    if (!screenOf(id)) return;
    const from = active;
    if (id !== from) parents.set(id, from);
    show(id);
  }
  function goBack() {
    const p = parents.get(active);
    if (p && screenOf(p)) { parents.delete(active); show(p); } else close();
  }

  rail.addEventListener('keydown', (e) => {
    const i = TABS.findIndex(([id]) => id === active);
    let n = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    if (n < 0) return;
    e.preventDefault();
    parents.delete(TABS[n][0]);
    show(TABS[n][0]);
    tabButtons[TABS[n][0]].focus();
  });

  function reveal(id) {
    opened = true;
    el.classList.add('rw-menu-open');
    if (game.touch && game.touch.setVisible) game.touch.setVisible(false);
    if (id && id !== active) parents.delete(id);
    show(id || active);
    const f = (isTop(active) ? tabButtons[active] : back);
    f.focus({ preventScroll: true });
  }
  function hide() {
    if (!opened) return;
    opened = false;
    armed = null;
    parents.clear();
    el.classList.remove('rw-menu-open', 'rw-menu-see');
    if (game.touch && game.touch.setVisible) game.touch.setVisible(true);
  }
  // open() with no id (or a pause) shows the hub; open(id) any screen by id.
  function open(id) {
    reveal(id || 'resume');
    if (!game.paused) {
      game.paused = true;
      game.events.emit('pause', true);
    }
  }
  function close() {
    hide();
    if (game.paused) {
      game.paused = false;
      game.events.emit('pause', false);
    }
  }

  game.events.on('pause', (v) => {
    if (v) { if (!opened) reveal('resume'); } else hide();
  });
  const refresh = () => { if (opened) render(); };
  game.events.on('progress', refresh);
  game.events.on('scoreBanked', refresh);

  // First run: ask once how the player wants to steer. Pauses the game
  // while the question is up; remembered in the save. Returns true if shown.
  let ask = null;
  function maybeAskSteering() {
    const medals = game.progress.medals;
    if (medals.hint_steer === 'bronze' || ask || opened) return false;
    const wasPaused = game.paused;
    game.paused = true;
    if (game.touch && game.touch.setVisible) game.touch.setVisible(false);
    ask = h('div', 'rw-menu rw-menu-ask');
    ask.setAttribute('role', 'dialog');
    ask.setAttribute('aria-modal', 'true');
    ask.setAttribute('aria-label', 'Choose steering');
    const box = h('div', 'rw-menu-askbox');
    box.appendChild(h('h2', '', 'How do you want to steer?'));
    box.appendChild(steeringChooser(settings().steering, (id) => {
      medals.hint_steer = 'bronze';
      settings().steering = id;
      commit();
      ask.remove();
      ask = null;
      if (game.touch && game.touch.setVisible) game.touch.setVisible(true);
      if (!wasPaused) game.paused = false;
    }));
    box.appendChild(h('p', 'rw-menu-dim', 'You can change this any time under Settings.'));
    ask.appendChild(box);
    root.appendChild(ask);
    const first = ask.querySelector('[aria-checked="true"]') || ask.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    return true;
  }

  // The four steering styles as big radio buttons; onPick(style) on tap.
  function steeringChooser(current, onPick) {
    const grid = h('div', 'rw-menu-steer');
    grid.setAttribute('role', 'radiogroup');
    grid.setAttribute('aria-label', 'Steering style');
    for (const [id, label, desc] of STEER_CHOICES) {
      const b = h('button', 'rw-menu-btn rw-menu-choice');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(current === id));
      b.setAttribute('aria-label', label + ' steering: ' + desc);
      b.dataset.steering = id;
      b.append(h('b', '', label), h('span', '', desc));
      b.addEventListener('click', () => onPick(id));
      grid.appendChild(b);
    }
    return grid;
  }

  return {
    open, close, isOpen: () => opened, maybeAskSteering, isAsking: () => !!ask,
    // W11 and others add screens: { id, title, render(body, api) }. Returns a remover.
    registerScreen(def) {
      if (!def || typeof def.id !== 'string' || typeof def.render !== 'function' || BUILTIN[def.id]) return () => {};
      const s = { id: def.id, title: String(def.title || def.id), render: def.render };
      screens.set(s.id, s);
      return () => { if (screens.get(s.id) === s) screens.delete(s.id); };
    },
    screen: () => active,
  };
}
