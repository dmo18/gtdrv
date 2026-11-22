# On-screen UI

Touch controls live in `src/ui/touch.js`, the CSS in `src/ui/styles.js`,
the text HUD in `src/ui/hud.js`, the menus in `src/ui/menu.js`, the title
screen in `src/ui/title.js` (new in 0.4.0).

Status of this file: the layout and menu rules below are the approved
target for version 0.4.0. The exact rectangles, the menu map and the
tests are in docs/REVAMP.md sections 6.4 (menus), 6.5 (HUD grid) and 6.8
(title screen); that file wins where the two differ. Until 0.4.0 ships
the running game still has the old layout (speed at bottom centre, one
long Settings list, no title choice).

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
  (HUD, graphics quality, live day and night, time of day).
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
  right and the health meter (hard mode) under the speed. Top centre:
  wanted stars, then the district and toasts strip. Top right: score and
  combo, then pause in the corner.
- Bottom left: the steering slot (wheel, arrow buttons, slider bar or
  tilt bar; the foot and flight sticks use it too). Bottom right: GAS
  and BRAKE, with EXIT or ENTER above GAS, HAND above BRAKE, FIRE and
  LOCK in a third column, MORE above EXIT.
- Keep-out rect: x 36 to 64 percent of the width, y 40 to 90 percent of
  the height. That is where the player's craft is drawn. Nothing
  permanent may touch it; the speed and score are never over the craft.
- Every hit box is at least 48 by 48 px (primaries 56 or more), with at
  least 8 px between hit boxes and to the safe edge.
- All HUD text is white on a dark pill (`rgba(0, 0, 0, 0.55)` or
  darker), contrast at least 4.5 to 1.
- Left-handed mirrors the steering slot and the button cluster; the
  minimap, speed, score, stars and pause stay where they are.

## HUD modes

Setting: Pause, Settings, Display, HUD (`settings.hud`: `'minimal'`
default, or `'full'`), applied by `touch.setHudMode`, `hud.setHudMode`
and `combatHud.setHudMode`.

Minimal (default):
- Primary, always on screen: steering, foot or flight stick, GAS and
  BRAKE (THRUST, UP, DOWN), HAND (car and boat), FIRE, LOCK, ENTER or
  EXIT, pause. Idle they draw at 85% size and 70% opacity and grow to
  full within 120 ms under a finger. Only the inner `.rw-face` scales;
  the hit box never shrinks.
- Secondary, folded behind the round MORE button (`aria-expanded`):
  VIEW, HORN, SWAP, RELOAD, RUN, MAP, RADIO, RESPAWN, SIREN as the mode
  needs, at most 6 per mode. A tap opens a fan of 3 columns by 2 rows to
  the left of MORE; 160 ms ease, none under `prefers-reduced-motion`.
  It folds 4 s after the last use, right after using one, or on a touch
  elsewhere. A held fan button (RUN, RELOAD) keeps it open until release.
- Reload chip on foot, only when the magazine is low or empty.
- Mini-map 84 px (76 on short screens); tap grows it to 170 (140), it
  shrinks after 5 s. No clock. District name: the big title plus small
  text for 3 s. Score, combo and heat fade to 35% after 4 s unchanged.

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
thumb edge and must not cover EXIT or MORE.

## Armed craft and explosives

Mode `tank` joins foot car boat plane heli. Minimal shows at most 6
buttons at once, except the armed-aircraft arc (GUN, MSL, BOMB, LOCK: up
to 9 with pedals, EXIT, more and pause) and DETONATE (+1, pulsing) while
the player owns placed charges. SIREN and VIEW stay in the fan. With
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
  slot: 'gun',                             // optional fixed arc slot (primary only)
  press() {}, release() {},                // or input: 'inputButtonName'
  visible: () => true,                     // optional, polled every step
  pointer: { down(e) {}, move(e) {}, up(e) {} }, // optional finger path (SWAP wheel)
});
h.remove();
```

`scripts/ui-test.mjs` runs against the built game (0.4.0): no overlaps, gaps of
at least 8 px, a 48 px floor, nothing permanent in the keep-out rect, in
every mode at 915x412 and 780x360, left inset 0 and 40 px, fan open and
closed, Minimal and Full, right and left handed.
