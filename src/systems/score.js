// Score and combo (task 24 fills this): `add(points, reason, x, z)` is
// the only way to score. Listens to 'takedown' and the activity events.
// See docs/MISSIONS.md "Score".
//
// Stub: registered by game.js, counts nothing yet.
export function createScore(game) {
  return {
    name: 'score',
    game,
    total: 0,
    pending: 0,
    combo: 1,
    add() {
      return 0;
    },
    fixedUpdate() {},
  };
}
