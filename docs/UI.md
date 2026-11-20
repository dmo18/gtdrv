# On-screen UI

Touch controls live in `src/ui/touch.js`, the CSS in `src/ui/styles.js`,
the text HUD in `src/ui/hud.js`. Setting: Pause, Settings, HUD
(`settings.hud`: `'minimal'` default, or `'full'`), applied by
`touch.setHudMode`, `hud.setHudMode` and `combatHud.setHudMode`.

## Minimal (default)

- Primary, always on screen: steering (wheel, arrows, tilt bar, slider),
  foot or flight stick, GAS and BRAKE (THRUST, UP, DOWN), FIRE, LOCK,
  ENTER, EXIT, pause. Idle they draw at 85% size and 70% opacity and grow
  to full within 120 ms under a finger. Only the inner `.rw-face` scales;
  the button box (the hit area) is never below 56 px.
- Secondary, folded behind one round "more" button (`aria-expanded`):
  VIEW, HORN, HAND, SWAP, RELOAD, RUN, MAP. A tap fans them upward in a
  column of four (a fifth starts a second column); 160 ms ease, none under
  `prefers-reduced-motion`. It folds 4 s after the last use, right after
  using one, or on a touch elsewhere. A held fan button (HAND, RUN,
  RELOAD) keeps it open until release.
- Reload chip beside FIRE on foot, only when the magazine is low or empty.
- Mini-map 84 px (76 on short screens); tap grows it to 170 (140), it
  shrinks after 5 s. No clock. District name: the big title plus small
  text for 3 s. Score, combo and heat fade to 35% after 4 s unchanged.
- Speed readout: small, bottom-centre, in craft only.

## Full

Everything un-collapsed and un-faded: the fan stays open (no more
button), ammo panel, clock, bigger map and text.

## Layout slots

CSS custom properties `--x` (from the thumb-side edge) and `--y` (from the
bottom) place each control; left-handed swaps the edge and sets
`--dir: -1`. Fan items get `--c` and `--r` from `layoutActions()`.
Extra primary actions stack above the thumb cluster (`--k`); keep to one
extra primary per mode so it fits at 780x360.

## Adding a control

```js
const h = game.touch.registerAction({
  id: 'grenade', label: 'Throw grenade',   // aria-label
  icon: 'fire',                            // built-in name or '<path d=".."/>'
  text: 'NADE',                            // short caption
  group: 'secondary',                      // or 'primary' (default 'secondary')
  modes: ['foot'],                         // foot car boat plane heli; default all
  press() {}, release() {},                // or input: 'inputButtonName'
  visible: () => true,                     // optional, polled every step
});
h.remove();
```

`ui-test.mjs` asserts no overlaps and a 56 px floor in every mode at
915x412 and 780x360, with the fan open and in Full.
