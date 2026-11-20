// Rival crew AI (task 27 fills this): patrol, alert, engage from cover,
// chase in crew cars, flee. Members are combat actors (team 'crew')
// pushed to game.actors; they shoot through game.combat.fire. See
// docs/COMBAT.md "Rival crew".
//
// Stub: registered by game.js, spawns nobody yet.
export function createCrew(game) {
  return {
    name: 'crew',
    game,
    members: [],
    fixedUpdate() {},
  };
}
