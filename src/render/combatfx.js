// Combat effects (task 25 fills this): muzzle flashes, tracers, sparks,
// hit flashes, fireballs, smoke and flames on burning craft, scorch
// decals (game.combat.decals) and the camera shake. Listens to the
// combat events in docs/COMBAT.md; at most 4 extra draw calls.
//
// Stub: registered by game.js, does nothing yet.
export function createCombatFx(game) {
  return {
    name: 'combatfx',
    game,
    fixedUpdate() {},
    render() {},
  };
}
