# On-screen UI

Touch controls live in `src/ui/touch.js`, the CSS in `src/ui/styles.js`,
the text HUD in `src/ui/hud.js`, the menus in `src/ui/menu.js`, the title
screen in `src/ui/title.js` (new in 0.4.0).

Status of this file: the layout and menu rules below are the approved
target for version 0.4.0. The exact rectangles, the menu map and the
tests are in docs/REVAMP.md sections 6.4 (menus), 6.5 (HUD grid) and 6.8
(title screen); that file wins where the two differ. 0.4.0 shipped that
layout.

Version 0.5.0 adds BOOST and its meter, SIREN, the EXTRA button of the
service vehicles and the top centre stack: docs/REVAMP.md 6.12 (rects,
the one-line rule, tests HG-1 to HG-5) and 6.11 (what each EXTRA does).
U1 has built all of it (the lines marked "0.5.0" below are in the game);
where this file differs from 6.12 it says so under "Differences from
6.12" at the end of the HUD sections.

## Screens

- Title: a designed street view, "Start" and, when there is a saved
  place, "Continue". The map credit and the version are on it.
- Pause: four sections. Resume (with tiles for Adventures, Garages and
  the Map), Stats (the old Scores and Records in one page), Settings,
  Help.
- Settings: four groups, at most 6 rows each, none scrolls at 780x360.
  Controls (steering style, sensitivity, handling, left-handed, invert
  flying stick), Sound (master, mute all, music, sound effects, ambience,
  car radio), Game (police chases, hard mode, map, new game), Display
  (HUD, graphics quality, live day and night, time of day, Phone check).
- Phone check (0.5.0, `src/ui/phonecheck.js`): Settings, Display, Start.
  The menu closes and the game drives a test car by itself for 60 s along
  a fixed route (the node walk from the nearest crossing, always the edge
  that turns least) with a fight (a parked crew car shot with the car's
  own gun) and a real blast (`combat.explode`). A scripted input source
  steers; no game rule changes. Then eight numbered test sounds play, 3.2 s
  each, through the existing audio events: 1 engine, 2 tyre squeal, 3
  gunshot, 4 blast, 5 siren, 6 music, 7 radio (station changed and put
  back), 8 boost whoosh. Numbered buttons (48 px) mark any that sound bad.
  The result card shows one line in a selectable box and a "Copy result"
  button (clipboard, else the text is selected for a long press):
  `RW 0.5.0 | 915x412 inset L40 R0 T0 B0 | median 16.7 ms worst 48.3 ms |
  over33 3 | res 0.85 | fullscreen yes | bad 2,5` (one line; `res` is the
  lowest adaptive resolution scale seen). The player and the car they were
  in are put back afterwards. Nothing leaves the phone. Tests:
  test/phonecheck.test.js (headless, shortened run and the line format).
- Own screens with a two-tap confirm: New game (new game, erase all
  progress), Map choice (Miami or the classic island; switching
  restarts). The first tap turns the button into "Cancel" in the same
  place and a red "Yes, ..." beside it, so a double tap cancels.
- Garage (opens at a garage in the world), Garages and Adventures (from
  the Resume tiles): docs/REVAMP.md section 6.6.

## HUD grid

One grid for every mode, checked at 915x412 and 780x360 with a left
safe-area inset of 0 and 40 px. Rectangles are in docs/REVAMP.md 6.5.

- The canvas covers the whole viewport, under the camera cut-out too.
  Only HUD items move in by the safe-area insets.
- Top left: minimap, with the speed readout (in craft only) to its
  right, the health meter (hard mode) under the speed and the boost
  meter (6 px high) under those. Top centre: the stack (below). Top
  right: score and combo, then pause in the corner.
- Bottom left: the steering slot (wheel, arrow buttons, slider bar or
  tilt bar; the foot and flight sticks use it too). Bottom right: GAS
  and BRAKE, with EXIT or ENTER above GAS, HAND above BRAKE, FIRE and
  LOCK in a third column, MORE above EXIT, BOOST above MORE (car, boat,
  plane, heli). LOCK is a foot-only button. 0.5.0: in a service vehicle
  EXTRA takes the LOCK rect; in a vehicle with a siren SIREN sits 8 px
  beside the steering slot, on the side toward the screen centre. The
  cluster never grows a fourth column and nothing ever sits above BOOST
  (GARAGE and TALK take the BOOST cell; BOOST hides while they are
  offered, which in a craft is only under 3 m/s).
- Keep-out rect: x 36 to 64 percent of the width, y 40 to 90 percent of
  the height. That is where the player's craft is drawn. Nothing
  permanent may touch it; the speed and score are never over the craft.
- Every hit box is at least 48 by 48 px (primaries 56 or more), with at
  least 8 px between hit boxes and to the safe edge. 0.5.0: at 780x360
  the fan cells are 48 px (columns at x 660, 604, 548, rows at y 156 and
  100) so the third column clears the keep-out rect when left-handed
  with a 40 px inset.
- BOOST cell and the offers: GARAGE and TALK (any unslotted primary) take
  the BOOST cell and BOOST hides while one shows (`hideWhen` in
  `registerAction`); a second offer waits (`rw-spare`). EXTRA is
  `touch.setExtra({ can, text, fill, weak })`: caption WATER, TREAT, LIFT,
  HOOK or DROP, a 4 px fill bar, dim at 40 percent when it cannot act.
  SIREN is `touch.setSiren(can, on)` (car only).

Differences from 6.12 (U1 decisions, reported to the coordinator):
- The objective distance uses the game's units (`formatDistance`:
  "820 ft", "0.4 mi"), not metres and kilometres.
- 6.12 says the stack box never overlaps the speed readout with the
  minimap grown. With a 40 px inset the grown readout ends at x 314
  (276 at 780x360) and the box starts at 290 (240), so the box itself
  cannot clear it. Instead the message pills
  get a `max-width` that keeps them centred and clear of the readout
  (`.rw-mapbig .rw-msg`); the test checks the pills, and the box only at
  inset 0.
- Left-handed at 780x360 the BOOST cell (x 8, y 88) is 4 px under the
  76 px minimap (ends y 84): the contract rects cannot give 8 px and the
  column has no slack. Not resolved here; `scripts/ui-test.mjs` reports
  it (50 states). One fix is a 72 px minimap at 780x360 (gap 8).
- `hud.toast(text, seconds, kind)` infers a kind from the text for
  callers that pass none (police lines, "... +250" score lines, else
  info), because police.js and score.js are not U1 files.
- `hud.tick(dt)`, `hud.canHint()` and `hud.setObjective(on, angle, text)`
  are new; the stack timers run on UI time at 10 Hz, never in the
  simulation. The tutorial asks `canHint()` first and keeps its queue.
- Hint texts are one line each (about 36 characters fit the narrowest
  row); the tutorial hints were cut into short lines.
- All HUD text is white on a dark pill (`rgba(0, 0, 0, 0.55)` or
  darker), contrast at least 4.5 to 1.
- Left-handed mirrors the steering slot (with SIREN) and the button
  cluster; the minimap, speed, score, stack and pause stay where they
  are.

## Top centre stack (0.5.0)

One box, 335 by 92 px at 915x412 and 300 by 92 at 780x360, centred, top
at 8 px. The one-line rule: every item is one line in one pill of fixed
height, nothing wraps (ellipsis), each row shows one item at a time,
rows never move, and the stack never passes y = 100.

- Status row (24 px): wanted stars in the centre (150 px, only while
  wanted) and, to their right, the objective arrow and distance (only
  while an objective is tracked). The escape bar (150 by 4) is right
  under the stars.
- Message row 1 (28 px, y 40): police toast, else objective text, else
  the district banner. Higher replaces lower at once; a lower one waits
  at most 3 s and is then dropped (a banner never waits). No district
  banner while wanted. Old class names `.rw-toasts`, `.rw-toast` and
  `.rw-title` (the banner) still exist for the screenshot scripts.
- Message row 2 (28 px, y 72): tutorial hint, else score toast or any
  other toast. While a hint shows, score toasts are dropped and other
  toasts wait (one, the newest). No hint starts while wanted.
- Callers use `hud.toast(text, seconds, kind)` with kind `'police'`,
  `'objective'`, `'district'`, `'hint'`, `'score'` or `'info'`; nobody
  places their own text in the top centre.

## HUD modes

Setting: Pause, Settings, Display, HUD (`settings.hud`: `'minimal'`
default, or `'full'`), applied by `touch.setHudMode`, `hud.setHudMode`
and `combatHud.setHudMode`.

Minimal (default):
- Primary, always on screen: steering, foot or flight stick, GAS and
  BRAKE (THRUST, UP, DOWN), HAND (car), BOOST (car, boat, plane, heli),
  FIRE, LOCK (on foot), ENTER or EXIT, pause; SIREN in a car with a
  siren, EXTRA in a service vehicle. Idle they draw at 85% size and 70% opacity and grow to
  full within 120 ms under a finger. Only the inner `.rw-face` scales;
  the hit box never shrinks.
- Secondary, folded behind the round MORE button (`aria-expanded`):
  VIEW, HORN, RELOAD, MAP, RADIO, RESPAWN as the mode needs, and SIREN
  in a police helicopter, plane or tank only; at most 6 per mode. (SWAP
  and RUN are primaries with their own slots.) A tap opens a fan of 3 columns by 2 rows to
  the left of MORE; 160 ms ease, none under `prefers-reduced-motion`.
  It folds 4 s after the last use, right after using one, or on a touch
  elsewhere. A held fan button (RUN, RELOAD) keeps it open until release.
- Reload chip on foot, only when the magazine is low or empty.
- Mini-map 84 px (76 on short screens); tap grows it to 170 (140), it
  shrinks after 5 s. No clock. District name: a one-line banner in
  message row 1 for 3 s. Score, combo and heat fade to 35% after 4 s
  unchanged.

Full: the fan stays open (no MORE button), ammo panel, clock, bigger
text.

## Steering styles

Four styles, all kept: wheel, buttons, tilt, slider. The maths
(`wheelCurve`, `steerTravel`, `rawFromTravel` in `src/core/input.js`)
and the acceptance test for each style are in docs/REVAMP.md 6.3. The
sensitivity setting changes how far the thumb or phone must move for
full lock; it never changes the curve.

## Layout slots

CSS custom properties `--x` (from the thumb-side edge) and `--y` (from the
bottom) place each control; left-handed swaps the edge and sets
`--dir: -1`. Fan items get `--c` and `--r` from `layoutActions()`.
A primary with `slot: 'name'` takes the fixed position `.rw-slot-name`
from styles.js (the armed-craft arc, src/ui/armsctl.js; docs/ARMS.md
section 8). Arc slots stay in the bottom 220 px and within 352 px of the
thumb edge and must not cover EXIT, MORE or BOOST. Other fixed slots:
`boost` (the cell above MORE), `siren` (beside the steering slot from
0.5.0) and `extra` (the LOCK rect, car mode, service vehicles).

## Armed craft and explosives

Mode `tank` joins foot car boat plane heli. Minimal shows at most 6
buttons at once, except the armed-aircraft arc (GUN, MSL, BOMB, LOCK: up
to 9 with pedals, EXIT, more and pause) and DETONATE (+1, pulsing) while
the player owns placed charges. VIEW stays in the fan, and so does SIREN
in a police helicopter, plane or tank; in a car SIREN is a primary. With
thrown weapons FIRE aims on hold (arc preview) and throws on release;
lifting the finger over the more button or SWAP cancels.

## Weapon wheel

Hold SWAP (about 250 ms) to open a ring of the seven weapons around the
button; tapping SWAP under 250 ms still cycles. While the same finger stays
down, dragging highlights the slice nearest the drag angle (slice 0 is up,
clockwise) and shows its name in the middle; lifting picks it
(`game.combat.pickWeapon`, the same `weaponSwitch` event as a tap, so the
name toasts). Inside 24 px of the centre or past 128 px the lift changes
nothing. The ring (216 px) is clamped on screen and slid clear of FIRE and
pause. A throw being aimed is cancelled when the wheel opens. `releaseAll`
(blur, hidden, mode change, pause) closes it without a change. Maths in
`src/ui/wheel.js`, tests in `test/wheel.test.js`, check with
`node scripts/wheel-shots.mjs`. The slices carry aria-labels and the ring is
aria-hidden while closed. Left-handed layouts mirror automatically.

## Adding a control

```js
const h = game.touch.registerAction({
  id: 'grenade', label: 'Throw grenade',   // aria-label
  icon: 'fire',                            // built-in name or '<path d=".."/>'
  text: 'NADE',                            // short caption
  group: 'secondary',                      // or 'primary' (default 'secondary')
  modes: ['foot'],                         // foot car boat plane heli tank; default all
  slot: 'gun',                             // optional fixed slot (primary only): an arc slot, 'boost', 'siren', 'extra'
  press() {}, release() {},                // or input: 'inputButtonName'
  visible: () => true,                     // optional, polled every step
  pointer: { down(e) {}, move(e) {}, up(e) {} }, // optional finger path (SWAP wheel)
});
h.remove();
```

`scripts/ui-test.mjs` runs against the built game (0.4.0): no overlaps, gaps of
at least 8 px, a 48 px floor, nothing permanent in the keep-out rect, in
every mode at 915x412 and 780x360, left inset 0 and 40 px, fan open and
closed, Minimal and Full, right and left handed. From 0.5.0 it also runs
HG-1 to HG-5 of docs/REVAMP.md 6.12: BOOST, the meter, SIREN and EXTRA
in place, GARAGE never over pause, and the top centre stack with every
item forced on at once.
