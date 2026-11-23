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
service vehicles and the top center stack: docs/REVAMP.md 6.12 (rects,
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
  car radio), Game (police chases, hard mode, blood, street names (0.10.1),
  map, new game), Display
  (HUD, graphics quality, live day and night, time of day, Phone check).
- Phone check (0.5.0, `src/ui/phonecheck.js`): Settings, Display, Start.
  The menu closes and the game drives a test car by itself for 60 s along
  a fixed route (the node walk from the nearest crossing, always the edge
  that turns least) with a fight (a parked crew car shot with the car's
  own gun) and a real blast (`combat.explode`). A scripted input source
  steers; no game rule changes. Then eight numbered test sounds play, 3.2 s
  each, through the existing audio events: 1 engine, 2 tire squeal, 3
  gunshot, 4 blast, 5 siren, 6 music, 7 radio (station changed and put
  back), 8 boost whoosh. Numbered buttons (48 px) mark any that sound bad.
  The result card shows one line in a selectable box and a "Copy result"
  button (clipboard, else the text is selected for a long press):
  `RW 0.5.0 | 915x412 inset L40 R0 T0 B0 | median 16.7 ms worst 48.3 ms |
  over33 3 | res 0.85 | fullscreen yes | bad 2,5` (one line; `res` is the
  lowest adaptive resolution scale seen). The player and the car they were
  in are put back afterwards. Nothing leaves the phone. Tests:
  test/phonecheck.test.js (headless, shortened run and the line format).
- About (0.6.0, U2): Settings is unchanged; the Help tab starts with an
  "About Rustwater" row, and the title has an "About" button (top right,
  48 high). Both show the same content (`fillAbout` in `src/ui/title.js`):
  version (from the build), credits (original game, three.js MIT), the map
  credit "Map data (c) OpenStreetMap contributors, ODbL" with the
  ODbL line, a note that venue, shop and business names are invented, a
  privacy summary (no network requests while playing, saves stay on the
  phone) and a link to `privacy.html`. The privacy contact email lives on
  that page only; the About screen shows none.
- Sound test (0.6.0, U2): Settings, Display, Sound test. The eight
  numbered sounds of the Phone check, taken from `SOUNDS` in
  `src/ui/phonecheck.js` with a one-line note each (`SOUND_NOTES`) and a
  "Start the Phone check" button. It does not play sounds by itself:
  engine, tire squeal, boost and siren need the test car.
- Blood (0.6.0, U2): Settings, Game, "Blood", On by default (owner
  decision). `settings.blood` (boolean; anything else reads as On).
  `src/render/combatfx.js` should return early from `bloodHit` and
  `bloodDeath` when `settings.blood === false`, and `src/core/save.js`
  must keep the boolean (add `blood` to the boolean list and default).
  Both are outside U2's files and are reported to the coordinator.
- Menu text check (0.6.0, U2): New game said the starter car and that
  garages are kept; it now says favorite car (sedan if none), parked cars
  cleared, score, medals and found garages kept (`session.newSession`).
  The Phone check, Sound test and About texts take their numbers from
  `DRIVE_SECONDS`, `SOUND_SECONDS` and `SOUNDS`. Rows per Settings group
  are still at most 6: Controls 5, Sound 6, Game 5, Display 6.
- Own screens with a two-tap confirm: New game (new game, erase all
  progress), Map choice (Miami or the classic island; switching
  restarts). The first tap turns the button into "Cancel" in the same
  place and a red "Yes, ..." beside it, so a double tap cancels.
- Garage (opens at a garage in the world), Garages and Adventures (from
  the Resume tiles): docs/REVAMP.md section 6.6.

## HUD grid

One grid for every mode, checked at 915x412 and 780x360 with a left
safe-area inset of 0 and 40 px. Rectangles are in docs/REVAMP.md 6.5. 748x360 (the owner's phone) is
checked too, without exact rectangles: overlap, gaps, sizes, keep-out and
edges only.

- The canvas covers the whole viewport, under the camera cut-out too.
  Only HUD items move in by the safe-area insets.
- Top left: minimap, with the speed readout (in craft only) to its
  right, the health meter (hard mode) under the speed and the boost
  meter (6 px high) under those. Top center: the stack (below). Top
  right: score and combo, then pause in the corner.
- Bottom left: the steering slot (wheel, arrow buttons, slider bar or
  tilt bar; the foot and flight sticks use it too). Bottom right: GAS
  and BRAKE, with EXIT or ENTER above GAS, HAND above BRAKE, FIRE and
  LOCK in a third column, MORE above EXIT, BOOST above MORE (car, boat,
  plane, heli). LOCK is a foot-only button. 0.5.0: in a service vehicle
  EXTRA takes the LOCK rect; in a vehicle with a siren SIREN sits 8 px
  beside the steering slot, on the side toward the screen center. The
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
  "820 ft", "0.4 mi"), not meters and kilometers.
- 6.12 says the stack box never overlaps the speed readout with the
  minimap grown. With a 40 px inset the grown readout ends at x 314
  (276 at 780x360) and the box starts at 290 (240), so the box itself
  cannot clear it. Instead the message pills
  get a `max-width` that keeps them centered and clear of the readout
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

## Top center stack (0.5.0)

One box, 335 by 92 px at 915x412 and 300 by 92 at 780x360, centered, top
at 8 px. The one-line rule: every item is one line in one pill of fixed
height, nothing wraps (ellipsis), each row shows one item at a time,
rows never move, and the stack never passes y = 100.

- Status row (24 px): wanted stars in the center (150 px, only while
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
  places their own text in the top center.

## Out of the view (0.10.1)

The owner: "OSD kills the display". The road ahead stays clear:
- Turn by turn is one compact pill in the top center stack's second row
  (y 40, 28 high): arrow icon, distance, street ("200 ft · SW 1st Ave";
  "Turn right · SW 1st Ave" at the turn; "U-turn · S Miami Ave"). While it
  shows, row 1's message (police, objective, district) uses row 2 and
  row 2's own waits. It never reaches the middle half of the screen.
- It shows only for a goal the player chose or accepted: a destination
  set on the map, a running activity or mission. A merely tracked
  adventure shows the small distance pill only (a map destination now
  comes before it), and the Phone check never shows turn by turn. A route
  that asks for a U-turn is searched again every second while the car
  drives on; the pill asks for the U-turn only after 3 s of the route still
  wanting one (`UTURN_WAIT_S`, `src/systems/objective.js`).
- The street name is a small label under the minimap (11 px text, 16
  high; hidden while the minimap is grown). Settings, Game, "Street names"
  switches it (on by default; `settings.streetLabel`). The "next: cross
  street" text is gone.
- Short screens (300 px high or less: Chrome's bars showing, 748x285 and
  690x280): pedals and FIRE are 56 high, EXIT, HAND and the LOCK rect sit
  above them, MORE above EXIT with the fan in two rows of 48 px cells left
  of it, and BOOST (with the GARAGE and TALK offers) moves to a fourth column
  beside the LOCK rect, 48 wide, clear of the keep-out rect down to 690 wide.
  The stack narrows to end 8 px left of the fan (`min(300px, 100vw - 464px)`),
  the stars move to its left end, the objective distance merges into the turn
  pill, the score is 24 high and the combo line and the Full ammo panel are
  dropped, the prompt strip is 190 by 20 (it ends at 90 percent of the height)
  and the steering slot is 120 (wheel 116, arrow pads 56, stick 112, SIREN 8 px
  beside it). Left-handed, MORE and its fan stay at the top right (the top left
  holds the minimap and speed), and in a service vehicle SWAP waits (its cell
  above SIREN would be under that fan). Below 780 wide the score pill is 120
  wide.
- Left-handed (every size) the cell under the minimap is BOOST's, so the
  street label sits under the speed readout (no wider than it, below the
  boost and health meters); in Full, where the fan stays open there, it is
  not shown.
- The Phone check's bottom bar owns the bottom edge while it runs (the
  prompt strip waits); the touch controls are hidden then, as before.
- What was removed from the always-on display (Minimal): the two-line turn
  strip in the middle of the view, the bottom center street line and its
  "next:" cross street, turn by turn for adventures and during the Phone
  check, the U-turn nag, and on short screens the combo line, the ammo
  panel and the separate objective distance. Kept, each for a reason:
  minimap (where am I), speed with the craft health bar, the boost meter
  (only where BOOST shows), score and pause (top right), the street label
  (small, switchable), and the controls of the mode.

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

0.10.1 (owner round 3, "still impossible to steer"): touch steering that
a thumb can use.
- The steering zone is the whole left 40 percent of the screen below the
  minimap (from y 100; right 40 percent when left-handed). A thumb may start
  anywhere in it; the drawn wheel, bar or arrow pads only show it.
- Wheel: a RELATIVE drag (`createDragSteer` in `src/ui/wheel.js`). Touching
  down never steers. Each move adds the larger of its horizontal travel
  (55 px is full input at sensitivity 1, divided by the sensitivity 0.5 to
  1.5) and its rotation about the drawn wheel's center (60 degrees is full,
  counted only outside 40 px of the center). Rotation only counts when it
  turns the same way as the travel, or when the move is mostly up or down,
  so a thumb below the center that slides right steers right. The sum is
  clamped at full input, so turning back answers at once. The drawn wheel
  turns with the input (100 degrees at full) and springs back on release.
- Slider: also relative: where the thumb lands is the center, 90 px of
  travel from there is full input; the knob shows the value.
- Buttons: the two arrow pads ramp as before; a thumb anywhere else in the
  zone steers by its side of the slot center and may slide across.
- Every control ends its finger on a pointerup or pointercancel seen
  anywhere in the document (capture phase), so nothing stays held.
- Bugs found in 0.10.0 with real two-finger touches
  (`node scripts/touch-test.mjs`): the wheel read the thumb's angle about
  the center, so a thumb below the center sliding right steered left; a
  drag across the center flipped the angle by 180 degrees (a jump to the
  other full lock); a drag sideways at 3 o'clock gave nothing, then jumped;
  inside 16 px of the center nothing moved; 110 degrees of rotation was
  full lock, so a thumb far from the wheel barely steered; the zone began
  at 35 percent of the height (dead space under the minimap); the slider
  was absolute (a touch at the bar's end was full lock at once); the
  buttons style ignored the zone. A second finger (GAS, BRAKE, FIRE, the
  look area, a third finger in the zone) never stole the steering finger,
  and touchcancel already cleared everything.
- `scripts/touch-test.mjs` (a gate step) holds GAS with one finger and
  steers with another in all four styles (tilt falls back to the wheel in
  headless Chromium), BRAKE plus steer, FIRE plus steer, a look drag and a
  third finger beside the steering, a finger past the screen edge,
  touchcancel, left-handed, the sensitivity range and SWAP while driving, at
  748x360, 748x285 and 915x412. It fails on any lost, stolen, reversed,
  jumping or stuck steer.

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

0.10.1: SWAP works while driving (car and boat). It takes the LOCK rect,
the free cell above the drive-by FIRE (docs/REVAMP.md 6.12 "CONTROLS"); in
a service vehicle EXTRA keeps that rect and SWAP sits 8 px above SIREN. Its
wheel holds only the drive-by weapons (`WEAPONS[id].driveBy`: the pistol
and the SMG), a tap switches to the next one, and the pick sets the gun the
drive-by fires (`arms.lastGun`, `pickWeapon` in `src/ui/combathud.js`) with
the same `weaponSwitch` event, so the name toasts. The weapon on foot is
kept.

Hold SWAP (about 250 ms) to open a ring of the seven weapons around the
button; tapping SWAP under 250 ms still cycles. While the same finger stays
down, dragging highlights the slice nearest the drag angle (slice 0 is up,
clockwise) and shows its name in the middle; lifting picks it
(`game.combat.pickWeapon`, the same `weaponSwitch` event as a tap, so the
name toasts). Inside 24 px of the center or past 128 px the lift changes
nothing. The ring (216 px) is clamped on screen and slid clear of FIRE and
pause. A throw being aimed is canceled when the wheel opens. `releaseAll`
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
in place, GARAGE never over pause, and the top center stack with every
item forced on at once.
